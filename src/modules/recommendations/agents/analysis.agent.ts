import { Injectable, Logger } from '@nestjs/common';
import { CustomerProfile } from './profile.agent';
import { ollamaChat } from '../../../common/ollama/ollama.client';

export interface CustomerAnalysis {
  interests: string[];
  buyingPatterns: string;
  likelyNeeds: string;
  preferredChannels: string[];
  summary: string;
}

@Injectable()
export class AnalysisAgent {
  private readonly logger = new Logger(AnalysisAgent.name);
  private readonly ollamaUrl = process.env.OLLAMA_URL ?? 'http://host.docker.internal:11434';
  private readonly defaultModel = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
  private readonly timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 30000);

  async analyze(profile: CustomerProfile, sessionKnowledge?: string): Promise<CustomerAnalysis> {
    const systemPrompt = `Você é um analista especialista em comportamento de clientes.
Analise os dados do cliente e identifique: interesses, padrões de compra, necessidades prováveis e resumo do perfil.
${sessionKnowledge ? `\nContexto da empresa:\n${sessionKnowledge}` : ''}
Responda SOMENTE com JSON válido: {"interests":["..."],"buyingPatterns":"...","likelyNeeds":"...","preferredChannels":["..."],"summary":"..."}`;

    const userContent = `Dados do cliente:
Nome: ${profile.name ?? '(não informado)'}
Tags: ${profile.tags.join(', ') || 'nenhuma'}
Notas: ${profile.notes ?? 'nenhuma'}
Histórico de compras: ${JSON.stringify(profile.purchaseHistory, null, 2)}
Atributos: ${JSON.stringify(profile.attributes, null, 2)}`;

    try {
      const content = await ollamaChat({
        model: this.defaultModel,
        json: true,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
        temperature: 0.4,
        numPredict: 500,
        url: this.ollamaUrl,
        timeoutMs: this.timeoutMs,
      });
      const parsed = JSON.parse(content || '{}') as Partial<CustomerAnalysis>;
      // Normalise fields the LLM may omit so downstream consumers (e.g. MatchingAgent's
      // analysis.interests.join) never dereference undefined.
      return {
        interests: Array.isArray(parsed.interests) ? parsed.interests : [],
        buyingPatterns: typeof parsed.buyingPatterns === 'string' ? parsed.buyingPatterns : '',
        likelyNeeds: typeof parsed.likelyNeeds === 'string' ? parsed.likelyNeeds : '',
        preferredChannels: Array.isArray(parsed.preferredChannels) ? parsed.preferredChannels : ['whatsapp'],
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      };
    } catch (err) {
      this.logger.warn('AnalysisAgent error', err);
      return { interests: profile.tags, buyingPatterns: '', likelyNeeds: '', preferredChannels: ['whatsapp'], summary: profile.notes ?? '' };
    }
  }
}
