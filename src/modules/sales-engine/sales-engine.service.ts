import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '../session/entities/session.entity';
import { createLogger } from '../../common/services/logger.service';
import { GenerateOutreachDto, LeadDto, OutreachResultDto } from './dto/generate-outreach.dto';
import { ollamaChat } from '../../common/ollama/ollama.client';

interface SessionAi {
  persona?: string;
  knowledge?: string;
  model?: string;
}

/**
 * Motor de Vendas — núcleo de IA (modo preview, sem disparo).
 * Para cada lead, um agente de IA (Analista de Necessidade + Redator) lê os dados do cliente
 * e a base de conhecimento da empresa (Session.config.ai) e produz: a necessidade inferida,
 * um score de propensão e a 1ª mensagem de abordagem personalizada — pronta para revisão humana.
 */
@Injectable()
export class SalesEngineService {
  private readonly logger = createLogger('SalesEngineService');
  private readonly ollamaUrl = process.env.OLLAMA_URL ?? 'http://host.docker.internal:11434';
  private readonly defaultModel = process.env.OLLAMA_MODEL ?? 'qwen2.5:7b-instruct';
  private readonly timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 30000);

  constructor(@InjectRepository(Session, 'data') private readonly sessionRepo: Repository<Session>) {}

  async generateOutreach(dto: GenerateOutreachDto): Promise<OutreachResultDto[]> {
    const session = await this.sessionRepo.findOne({
      where: { id: dto.sessionId },
      select: ['id', 'name', 'config'],
    });
    if (!session) {
      throw new NotFoundException(`Session with id '${dto.sessionId}' not found`);
    }
    const ai = ((session.config as Record<string, unknown> | undefined)?.ai as SessionAi | undefined) ?? {};
    const model = ai.model?.trim() || this.defaultModel;

    // Processa os leads em sequência para não saturar o modelo local.
    const results: OutreachResultDto[] = [];
    for (const lead of dto.leads) {
      results.push(await this.forLead(lead, ai, model, dto.offerHint));
    }
    return results;
  }

  private buildSystemPrompt(ai: SessionAi, offerHint?: string): string {
    const persona = ai.persona?.trim() || 'Você é um(a) consultor(a) de vendas simpático(a) e consultivo(a).';
    let p = `${persona}\n\nVocê é um agente de vendas ativo. Tarefa: a partir dos DADOS de um cliente, identifique a principal necessidade/oportunidade dele, dê um score de propensão de 0 a 100, e escreva a PRIMEIRA mensagem de WhatsApp para iniciar a conversa.`;
    if (ai.knowledge?.trim()) {
      p += `\n\nConhecimento e oferta da empresa (baseie-se nisto; não invente o que não estiver aqui):\n${ai.knowledge.trim()}`;
    }
    if (offerHint?.trim()) {
      p += `\n\nObjetivo desta campanha: ${offerHint.trim()}`;
    }
    p +=
      '\n\nRegras da mensagem: curta (2 a 4 frases), calorosa e natural para WhatsApp, em português brasileiro; personalize com os dados do cliente; foque na necessidade dele, não no produto; termine com uma pergunta que convide à resposta; nunca invente preços, prazos ou dados que não foram fornecidos; sem markdown.';
    p +=
      '\n\nResponda SOMENTE com um JSON válido no formato: {"need": "<necessidade em 1 frase>", "score": <0-100>, "message": "<mensagem de abordagem>"}';
    return p;
  }

  /** Gera uma resposta de follow-up para continuar a conversa com um lead que respondeu. */
  async generateFollowUp(params: {
    sessionId: string;
    offerHint?: string | null;
    need?: string;
    history: { role: 'user' | 'assistant'; content: string }[];
    lastMessage: string;
  }): Promise<string> {
    const session = await this.sessionRepo.findOne({ where: { id: params.sessionId }, select: ['id', 'config'] });
    const ai = ((session?.config as Record<string, unknown> | undefined)?.ai as SessionAi | undefined) ?? {};
    const model = ai.model?.trim() || this.defaultModel;

    const persona = ai.persona?.trim() || 'Você é um(a) consultor(a) de vendas simpático(a) e consultivo(a).';
    let systemPrompt = `${persona}\n\nVocê está em uma conversa de vendas pelo WhatsApp. Seu objetivo é engajar o lead e guiá-lo até a conversão.`;

    if (ai.knowledge?.trim()) {
      systemPrompt += `\n\nConhecimento da empresa (use como base, nunca invente o que não estiver aqui):\n${ai.knowledge.trim()}`;
    }
    if (params.offerHint?.trim()) {
      systemPrompt += `\n\nObjetivo desta campanha: ${params.offerHint.trim()}`;
    }
    if (params.need?.trim()) {
      systemPrompt += `\n\nNecessidade identificada deste lead: ${params.need.trim()}`;
    }
    systemPrompt +=
      '\n\nRegras: resposta curta (2 a 3 frases), natural para WhatsApp, em português brasileiro; avance para o fechamento se o lead demonstrar interesse; se pedir preço ou condições, forneça se disponível na base de conhecimento; faça uma pergunta de fechamento quando oportuno; sem markdown.';

    const messages = [
      { role: 'system', content: systemPrompt },
      ...params.history.map(h => ({ role: h.role as string, content: h.content })),
      { role: 'user', content: params.lastMessage },
    ];

    try {
      return await ollamaChat({
        model,
        messages,
        temperature: 0.7,
        numPredict: 250,
        url: this.ollamaUrl,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      this.logger.warn('Falha no follow-up de conversa', { error: String(err) });
      return '';
    }
  }

  private async forLead(lead: LeadDto, ai: SessionAi, model: string, offerHint?: string): Promise<OutreachResultDto> {
    const userContent = `Dados do cliente:\nNome: ${lead.name ?? '(desconhecido)'}\nAtributos: ${JSON.stringify(
      lead.attributes,
      null,
      2,
    )}`;
    try {
      const content = await ollamaChat({
        model,
        json: true,
        messages: [
          { role: 'system', content: this.buildSystemPrompt(ai, offerHint) },
          { role: 'user', content: userContent },
        ],
        temperature: 0.6,
        numPredict: 400,
        url: this.ollamaUrl,
        timeoutMs: this.timeoutMs,
      });
      const parsed = JSON.parse(content || '{}') as {
        need?: string;
        score?: number;
        message?: string;
      };
      return {
        lead,
        need: parsed.need ?? '',
        score: typeof parsed.score === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 0,
        message: parsed.message ?? '',
        model,
      };
    } catch (err) {
      this.logger.warn('Falha ao gerar abordagem para lead', { error: String(err) });
      return { lead, need: '', score: 0, message: '', model, error: String(err) };
    }
  }
}
