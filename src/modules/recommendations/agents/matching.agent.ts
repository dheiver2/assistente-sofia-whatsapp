import { Injectable, Logger } from '@nestjs/common';
import { Product } from '../entities/product.entity';
import { CustomerAnalysis } from './analysis.agent';
import { ollamaChat } from '../../../common/ollama/ollama.client';

export interface ProductMatch {
  productId: string;
  productName: string;
  relevanceScore: number;
  reason: string;
}

@Injectable()
export class MatchingAgent {
  private readonly logger = new Logger(MatchingAgent.name);
  private readonly ollamaUrl = process.env.OLLAMA_URL ?? 'http://host.docker.internal:11434';
  private readonly defaultModel = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
  private readonly timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 45000);

  async match(analysis: CustomerAnalysis, catalog: Product[], topN = 3): Promise<ProductMatch[]> {
    if (catalog.length === 0) return [];

    // Catálogos grandes (centenas de itens) estouram o contexto e baixam a qualidade do casamento.
    // Pré-filtra pelo interesse do cliente (categoria/nome batem com os interesses da análise) e
    // limita o "pool" enviado ao modelo. Assim o LLM escolhe entre um conjunto pequeno e relevante.
    const pool = this.narrowCatalog(catalog, analysis, 50);

    // IMPORTANTE: usamos um índice curto (1..N), não o UUID — modelos 7B não reproduzem UUIDs longos
    // de forma confiável, e qualquer erro de dígito fazia a recomendação ser descartada (lista vazia).
    const catalogSummary = pool.map((p, i) =>
      `${i + 1}. ${p.name} | Categoria:${p.category ?? 'geral'} | ${p.keywords ?? ''}`
    ).join('\n');

    const systemPrompt = `Você é um especialista em recomendação de produtos de pet shop.
Analise o perfil do cliente e selecione os ${topN} itens mais relevantes do catálogo abaixo.
Use o NÚMERO do item (idx). Responda SOMENTE com JSON:
{"matches":[{"idx":3,"relevanceScore":85,"reason":"motivo curto e específico"}]}`;

    const userContent = `Perfil do cliente:
${analysis.summary}
Interesses: ${analysis.interests.join(', ')}
Necessidades prováveis: ${analysis.likelyNeeds}
Padrões de compra: ${analysis.buyingPatterns}

Catálogo (use o número idx):
${catalogSummary}

Selecione os ${topN} mais relevantes para ESTE cliente. Score: 0 a 100.`;

    try {
      const content = await ollamaChat({
        model: this.defaultModel,
        json: true,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
        temperature: 0.3,
        numPredict: 600,
        url: this.ollamaUrl,
        timeoutMs: this.timeoutMs,
      });
      const parsed = JSON.parse(content || '{"matches":[]}') as { matches?: { idx?: number; relevanceScore?: number; reason?: string }[] };
      const raw = Array.isArray(parsed?.matches) ? parsed.matches : [];
      const matches: ProductMatch[] = [];
      const seen = new Set<string>();
      for (const m of raw) {
        const i = Number(m?.idx);
        const p = Number.isInteger(i) && i >= 1 && i <= pool.length ? pool[i - 1] : undefined;
        if (!p || seen.has(p.id)) continue;
        seen.add(p.id);
        matches.push({
          productId: p.id,
          productName: p.name,
          relevanceScore: typeof m.relevanceScore === 'number' ? m.relevanceScore : 70,
          reason: m.reason || 'Combina com o histórico do cliente',
        });
        if (matches.length >= topN) break;
      }
      // Se o modelo não retornou nada aproveitável, cai no fallback relevante (topo do pool filtrado).
      if (matches.length === 0) {
        return pool.slice(0, topN).map(p => ({ productId: p.id, productName: p.name, relevanceScore: 50, reason: 'Sugestão pelo histórico de compras' }));
      }
      return matches;
    } catch (err) {
      this.logger.warn('MatchingAgent error', err);
      return pool.slice(0, topN).map(p => ({ productId: p.id, productName: p.name, relevanceScore: 50, reason: 'Sugestão pelo histórico de compras' }));
    }
  }

  /** Reduz o catálogo a um conjunto pequeno e relevante: prioriza itens cuja categoria/nome batem
   *  com os interesses do cliente; completa com os demais até `limit`. */
  private narrowCatalog(catalog: Product[], analysis: CustomerAnalysis, limit: number): Product[] {
    if (catalog.length <= limit) return catalog;
    const terms = [...(analysis.interests ?? []), analysis.likelyNeeds ?? '', analysis.buyingPatterns ?? '']
      .join(' ')
      .toLowerCase()
      .split(/[^a-zà-ú0-9]+/)
      .filter(w => w.length >= 4);
    const score = (p: Product) => {
      const hay = `${p.name} ${p.category ?? ''} ${p.keywords ?? ''}`.toLowerCase();
      return terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
    };
    const ranked = catalog.map(p => ({ p, s: score(p) })).sort((a, b) => b.s - a.s);
    const relevant = ranked.filter(r => r.s > 0).map(r => r.p);
    if (relevant.length >= limit) return relevant.slice(0, limit);
    const rest = ranked.filter(r => r.s === 0).map(r => r.p);
    return [...relevant, ...rest].slice(0, limit);
  }
}
