import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HookManager } from '../../core/hooks/hook-manager.service';
import { HookContext } from '../../core/hooks/hook.interfaces';
import { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import { createLogger } from '../../common/services/logger.service';
import { Contact } from '../contacts/entities/contact.entity';
import { Recommendation } from './entities/recommendation.entity';
import { RecommendationOrchestrator } from './recommendation-orchestrator.service';

/**
 * Recomendação automática: quando um cliente CONHECIDO (que já tem histórico de compras na base)
 * manda mensagem, dispara o motor de recomendação em segundo plano. As sugestões entram como
 * "pendentes" para o atendente revisar/aprovar — nada é enviado automaticamente ao cliente.
 *
 * Salvaguardas: só roda para contatos com histórico; respeita um cooldown por cliente e não gera
 * de novo se já existem sugestões pendentes para aquele telefone (evita duplicar a cada mensagem).
 * Desligue com AUTO_RECOMMEND=false.
 */
@Injectable()
export class AutoRecommendService implements OnModuleInit {
  private readonly logger = createLogger('AutoRecommend');
  private readonly lastRun = new Map<string, number>();
  private readonly cooldownMs = Number(process.env.AUTO_RECOMMEND_COOLDOWN_MS ?? 6 * 60 * 60_000); // 6h

  constructor(
    private readonly hooks: HookManager,
    private readonly orchestrator: RecommendationOrchestrator,
    @InjectRepository(Contact, 'data') private readonly contacts: Repository<Contact>,
    @InjectRepository(Recommendation, 'data') private readonly recs: Repository<Recommendation>,
  ) {}

  onModuleInit(): void {
    if (process.env.AUTO_RECOMMEND === 'false') {
      this.logger.log('Auto-recomendação desativada (AUTO_RECOMMEND=false)');
      return;
    }
    this.hooks.register('auto-recommend', 'message:received', async ctx => {
      try {
        await this.maybeGenerate(ctx as HookContext<IncomingMessage>);
      } catch (err) {
        this.logger.warn('Falha na auto-recomendação', { error: String(err) });
      }
      return { continue: true }; // nunca bloqueia o pipeline de mensagens
    });
    this.logger.log('Auto-recomendação registrada (message:received)');
  }

  private async maybeGenerate(ctx: HookContext<IncomingMessage>): Promise<void> {
    const msg = ctx.data;
    if (ctx.source !== 'Engine' || !ctx.sessionId || msg.fromMe || msg.isGroup || msg.isStatusBroadcast) {
      return;
    }
    const chatId = msg.chatId ?? '';
    if (!/@(c\.us|s\.whatsapp\.net|lid)$/.test(chatId)) return;
    const phone = (msg.senderPhone || chatId.split('@')[0] || '').replace(/\D/g, '');
    if (!phone) return;

    const sessionId = ctx.sessionId;
    const key = `${sessionId}:${phone}`;

    // Cooldown por cliente
    const last = this.lastRun.get(key) ?? 0;
    if (Date.now() - last < this.cooldownMs) return;

    // Só clientes com histórico de compras (a auto-recomendação não faz sentido sem dados)
    const contact = await this.contacts.findOne({ where: { sessionId, phone } });
    const purchases = (contact?.attributes?.['purchases'] as unknown[] | undefined) ?? [];
    if (!contact || purchases.length === 0) return;

    // Não regenera se já há sugestões pendentes para este cliente
    const pending = await this.recs.count({ where: { sessionId, phone, status: 'pending' } });
    if (pending > 0) {
      this.lastRun.set(key, Date.now());
      return;
    }

    this.lastRun.set(key, Date.now());
    this.logger.log('Cliente conhecido detectado — gerando sugestões em segundo plano', {
      sessionId,
      phone,
      name: contact.name,
    });

    // Em segundo plano: o motor usa Ollama (~30s) e não pode segurar o hook de mensagem.
    void this.orchestrator
      .analyze({ sessionId, phone, topN: 3 })
      .then(r => this.logger.log('Sugestões geradas', { phone, total: r.recommendations.length }))
      .catch(err => this.logger.warn('Erro ao gerar sugestões', { phone, error: String(err) }));
  }
}
