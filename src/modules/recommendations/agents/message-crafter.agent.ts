import { Injectable, Logger } from '@nestjs/common';
import { Product } from '../entities/product.entity';
import { CustomerProfile } from './profile.agent';
import { CustomerAnalysis } from './analysis.agent';
import { ollamaChat } from '../../../common/ollama/ollama.client';

export interface CraftedMessage {
  productId: string;
  message: string;
  mediaUrl: string | null;
  mediaType: 'image' | 'video' | 'document' | null;
}

@Injectable()
export class MessageCrafterAgent {
  private readonly logger = new Logger(MessageCrafterAgent.name);
  private readonly ollamaUrl = process.env.OLLAMA_URL ?? 'http://host.docker.internal:11434';
  private readonly defaultModel = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
  private readonly timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 30000);

  async craft(
    product: Product,
    profile: CustomerProfile,
    analysis: CustomerAnalysis,
    reason: string,
    persona?: string,
  ): Promise<CraftedMessage> {
    const systemPrompt = `${persona ?? 'Você é um consultor de vendas especialista.'}
Escreva UMA mensagem de WhatsApp curta (3 a 5 frases) recomendando este produto/serviço ao cliente.
A mensagem deve: ser personalizada com dados do cliente, focar no benefício para ESTE cliente específico, soar natural e humana, terminar com uma pergunta suave. Sem markdown, em português brasileiro.
Responda SOMENTE com JSON: {"message":"..."}`;

    const userContent = `Produto: ${product.name}
Descrição: ${product.description ?? ''}
Por que é relevante para este cliente: ${reason}

Cliente:
Nome: ${profile.name ?? 'cliente'}
Perfil: ${analysis.summary}
Necessidade identificada: ${analysis.likelyNeeds}`;

    let message = '';
    try {
      const content = await ollamaChat({
        model: this.defaultModel,
        json: true,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
        temperature: 0.7,
        numPredict: 300,
        url: this.ollamaUrl,
        timeoutMs: this.timeoutMs,
      });
      const parsed = JSON.parse(content || '{"message":""}') as { message: string };
      message = parsed.message;
    } catch (err) {
      this.logger.warn('MessageCrafterAgent error', err);
      message = `Olá ${profile.name ?? ''}! Pensando no seu perfil, acredito que ${product.name} pode ser exatamente o que você precisa. Posso te contar mais?`;
    }

    // Select best media: prefer video > image > document
    let mediaUrl: string | null = null;
    let mediaType: CraftedMessage['mediaType'] = null;
    if (product.videoUrl) { mediaUrl = product.videoUrl; mediaType = 'video'; }
    else if (product.imageUrl) { mediaUrl = product.imageUrl; mediaType = 'image'; }
    else if (product.documentUrl) { mediaUrl = product.documentUrl; mediaType = 'document'; }

    return { productId: product.id, message, mediaUrl, mediaType };
  }

  /** Craft all messages in parallel */
  async craftAll(
    products: Product[],
    profile: CustomerProfile,
    analysis: CustomerAnalysis,
    matches: { productId: string; reason: string }[],
    persona?: string,
  ): Promise<CraftedMessage[]> {
    return Promise.all(
      products.map(p => {
        const match = matches.find(m => m.productId === p.id);
        return this.craft(p, profile, analysis, match?.reason ?? '', persona);
      })
    );
  }
}
