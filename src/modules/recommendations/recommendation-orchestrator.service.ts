import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { Recommendation } from './entities/recommendation.entity';
import { ProfileAgent } from './agents/profile.agent';
import { AnalysisAgent } from './agents/analysis.agent';
import { MatchingAgent } from './agents/matching.agent';
import { MessageCrafterAgent } from './agents/message-crafter.agent';
import { Session } from '../session/entities/session.entity';

export interface OrchestrateParams {
  sessionId: string;
  phone: string;
  topN?: number;
  campaignId?: string;
  externalData?: Record<string, unknown>;
  autoDeliver?: boolean;
}

export interface OrchestrateResult {
  phone: string;
  recommendations: {
    productId: string;
    productName: string;
    message: string;
    mediaUrl: string | null;
    mediaType: string | null;
    relevanceScore: number;
    reason: string;
  }[];
  customerInsight: string;
  interests: string[];
  intent: string;
}

@Injectable()
export class RecommendationOrchestrator {
  private readonly logger = new Logger(RecommendationOrchestrator.name);

  constructor(
    @InjectRepository(Product, 'data') private readonly products: Repository<Product>,
    @InjectRepository(Recommendation, 'data') private readonly recs: Repository<Recommendation>,
    @InjectRepository(Session, 'data') private readonly sessions: Repository<Session>,
    private readonly profileAgent: ProfileAgent,
    private readonly analysisAgent: AnalysisAgent,
    private readonly matchingAgent: MatchingAgent,
    private readonly crafterAgent: MessageCrafterAgent,
  ) {}

  /**
   * Multi-agent orchestration pipeline:
   * Stage 1 (parallel): ProfileAgent + CatalogLoader
   * Stage 2: AnalysisAgent (uses profile)
   * Stage 3: MatchingAgent (uses analysis + catalog)
   * Stage 4 (parallel per product): MessageCrafterAgent
   * Stage 5: Persist recommendations
   */
  async orchestrate(params: OrchestrateParams): Promise<OrchestrateResult> {
    const { sessionId, phone, topN = 3, campaignId, externalData } = params;

    // ── Stage 1: Parallel data fetch ──────────────────────────────────────
    this.logger.log(`[Orchestrator] Stage 1 — fetching profile + catalog for ${phone}`);
    const [profile, sessionCatalog, session] = await Promise.all([
      this.profileAgent.fetch(sessionId, phone, externalData),
      this.products.find({ where: { active: true, sessionId } }),
      this.sessions.findOne({ where: { id: sessionId }, select: ['id', 'config'] }),
    ]);

    // Catálogo da própria sessão; se a sessão não tem produtos seus, cai no catálogo global (compatível
    // com instalações antigas que cadastram produtos sem sessionId).
    const catalog = sessionCatalog.length > 0 ? sessionCatalog : await this.products.find({ where: { active: true } });

    const ai = ((session?.config as Record<string, unknown> | undefined)?.ai as { persona?: string; knowledge?: string } | undefined) ?? {};

    if (catalog.length === 0) {
      this.logger.warn('[Orchestrator] No active products in catalog');
      return { phone, recommendations: [], customerInsight: 'Catálogo vazio', interests: [], intent: '' };
    }

    // ── Stage 2: Customer analysis ─────────────────────────────────────────
    this.logger.log(`[Orchestrator] Stage 2 — analyzing customer profile`);
    const analysis = await this.analysisAgent.analyze(profile, ai.knowledge);

    // ── Stage 3: Product matching ──────────────────────────────────────────
    this.logger.log(`[Orchestrator] Stage 3 — matching products`);
    const matches = await this.matchingAgent.match(analysis, catalog, topN);

    // Resolve matched products from catalog, keeping each product paired with its
    // originating match so relevanceScore/reason never drift when a productId the
    // LLM returned isn't found in the catalog (which drops elements and shifts indices).
    const pairs = matches
      .map(m => ({ product: catalog.find(p => p.id === m.productId), match: m }))
      .filter((pair): pair is { product: Product; match: typeof matches[number] } => !!pair.product);
    const matchedProducts = pairs.map(pair => pair.product);

    // ── Stage 4: Parallel message crafting ────────────────────────────────
    this.logger.log(`[Orchestrator] Stage 4 — crafting ${matchedProducts.length} messages in parallel`);
    const crafted = await this.crafterAgent.craftAll(
      matchedProducts,
      profile,
      analysis,
      pairs.map(pair => ({ productId: pair.match.productId, reason: pair.match.reason })),
      ai.persona,
    );

    // ── Stage 5: Persist ──────────────────────────────────────────────────
    const saved = await Promise.all(
      crafted.map((c, i) =>
        this.recs.save(this.recs.create({
          sessionId,
          phone,
          productId: c.productId,
          productName: pairs[i]?.product.name ?? '',
          message: c.message,
          mediaUrl: c.mediaUrl,
          mediaType: c.mediaType,
          status: 'pending',
          customerInsight: analysis.summary,
          relevanceScore: pairs[i]?.match.relevanceScore ?? 50,
          campaignId: campaignId ?? null,
        }))
      )
    );

    this.logger.log(`[Orchestrator] Done — ${saved.length} recommendations generated for ${phone}`);

    return {
      phone,
      customerInsight: analysis.summary,
      interests: analysis.interests ?? [],
      intent: analysis.likelyNeeds ?? '',
      recommendations: saved.map((r, i) => ({
        productId: r.productId,
        productName: r.productName,
        message: r.message,
        mediaUrl: r.mediaUrl,
        mediaType: r.mediaType,
        relevanceScore: r.relevanceScore,
        reason: pairs[i]?.match.reason ?? '',
      })),
    };
  }

  /** Run orchestration for a batch of phones */
  async orchestrateBatch(phones: string[], sessionId: string, campaignId?: string): Promise<OrchestrateResult[]> {
    // Run in sequence to avoid saturating Ollama
    const results: OrchestrateResult[] = [];
    for (const phone of phones) {
      try {
        results.push(await this.orchestrate({ sessionId, phone, campaignId }));
      } catch (err) {
        this.logger.error(`Batch orchestration failed for ${phone}`, err);
        results.push({ phone, recommendations: [], customerInsight: 'Erro', interests: [], intent: '' });
      }
    }
    return results;
  }

  async getPendingRecommendations(sessionId: string): Promise<Recommendation[]> {
    return this.recs.find({ where: { sessionId, status: 'pending' }, order: { createdAt: 'DESC' } });
  }

  async markSent(id: string): Promise<void> {
    await this.recs.update(id, { status: 'sent' });
  }

  async deleteRecommendation(id: string): Promise<void> {
    await this.recs.delete(id);
  }

  private mapRec(r: Recommendation) {
    return {
      id: r.id,
      sessionId: r.sessionId,
      phone: r.phone,
      productId: r.productId,
      productName: r.productName,
      score: Math.round(r.relevanceScore ?? 0) / 100, // 0..1
      message: r.message,
      mediaType: r.mediaType,
      status: r.status,
      createdAt: r.createdAt,
    };
  }

  async analyze(params: { sessionId: string; phone: string; topN?: number }): Promise<{
    customerInsight: { summary: string; interests?: string[]; intent?: string };
    recommendations: ReturnType<RecommendationOrchestrator['mapRec']>[];
  }> {
    const result = await this.orchestrate({ sessionId: params.sessionId, phone: params.phone, topN: params.topN });
    const saved = await this.recs.find({
      where: { sessionId: params.sessionId, phone: params.phone, status: 'pending' },
      order: { createdAt: 'DESC' },
      take: params.topN ?? 3,
    });
    return {
      customerInsight: {
        summary: result.customerInsight,
        interests: result.interests,
        intent: result.intent,
      },
      recommendations: saved.map(r => this.mapRec(r)),
    };
  }

  async batch(sessionId: string, phones: string[], topN?: number): Promise<number> {
    let total = 0;
    for (const phone of phones) {
      try {
        const r = await this.analyze({ sessionId, phone, topN });
        total += r.recommendations.length;
      } catch (e) {
        this.logger.error(`batch ${phone}`, e as Error);
      }
    }
    return total;
  }

  async listPending(sessionId: string): Promise<ReturnType<RecommendationOrchestrator['mapRec']>[]> {
    const pending = await this.recs.find({ where: { sessionId, status: 'pending' }, order: { createdAt: 'DESC' } });
    return pending.map(r => this.mapRec(r));
  }
}
