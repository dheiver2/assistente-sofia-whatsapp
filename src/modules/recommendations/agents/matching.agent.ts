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

    const catalogSummary = catalog.map(p =>
      `ID:${p.id} | Nome:${p.name} | Categoria:${p.category ?? 'geral'} | Keywords:${p.keywords ?? ''} | Tags:${p.tags.join(',')}`
    ).join('\n');

    const systemPrompt = `Você é um especialista em recomendação de produtos.
Analise o perfil do cliente e selecione os ${topN} produtos mais relevantes do catálogo.
Responda SOMENTE com JSON: {"matches":[{"productId":"...","productName":"...","relevanceScore":85,"reason":"..."}]}`;

    const userContent = `Perfil do cliente:
${analysis.summary}
Interesses: ${analysis.interests.join(', ')}
Necessidades prováveis: ${analysis.likelyNeeds}
Padrões de compra: ${analysis.buyingPatterns}

Catálogo disponível:
${catalogSummary}

Selecione os ${topN} produtos mais relevantes. Score de relevância: 0 a 100.`;

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
      const parsed = JSON.parse(content || '{"matches":[]}') as { matches: ProductMatch[] };
      return parsed.matches.slice(0, topN);
    } catch (err) {
      this.logger.warn('MatchingAgent error', err);
      // Fallback: return first N products
      return catalog.slice(0, topN).map(p => ({ productId: p.id, productName: p.name, relevanceScore: 50, reason: 'Seleção padrão' }));
    }
  }
}
