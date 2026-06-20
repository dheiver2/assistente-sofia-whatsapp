import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageService } from '../message/message.service';
import { createLogger } from '../../common/services/logger.service';
import { Campaign, Outreach, OptOut } from './entities/sales.entities';

const TICK_MS = 10_000; // a cada 10s; rate por minuto = ratePerMinute (≈ /6 por tick)

/**
 * Item 3 — Dispatcher de envio com cadência (in-process, sem Redis).
 * A cada tick, envia um número limitado de abordagens 'approved' por campanha, respeitando o
 * rate-limit, pulando contatos em opt-out. Marca 'sent'/'failed' e dispara o write-back no CRM.
 *
 * Para escala/produção: trocar este loop por uma fila BullMQ (Redis) e o envio por um engine
 * WhatsApp Cloud API oficial (templates aprovados). A interface de envio permanece a mesma.
 */
@Injectable()
export class DispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('SalesDispatcher');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectRepository(Outreach, 'data') private readonly outreach: Repository<Outreach>,
    @InjectRepository(Campaign, 'data') private readonly campaigns: Repository<Campaign>,
    @InjectRepository(OptOut, 'data') private readonly optOuts: Repository<OptOut>,
    private readonly messages: MessageService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.logger.log(`Dispatcher de vendas iniciado (tick ${TICK_MS / 1000}s)`);
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const active = await this.campaigns.find({ where: { status: 'sending' as Campaign['status'] } });
      for (const campaign of active) {
        await this.processCampaign(campaign);
      }
    } catch (err) {
      this.logger.warn('Erro no tick do dispatcher', { error: String(err) });
    } finally {
      this.running = false;
    }
  }

  private async processCampaign(campaign: Campaign): Promise<void> {
    const perTick = Math.max(1, Math.round((campaign.ratePerMinute || 6) / (60_000 / TICK_MS)));
    const batch = await this.outreach.find({
      where: { campaignId: campaign.id, stage: 'approved' },
      order: { score: 'DESC' },
      take: perTick,
    });

    if (!batch.length) {
      // Nada mais para enviar → campanha concluída.
      await this.campaigns.update(campaign.id, { status: 'done' });
      return;
    }

    for (const o of batch) {
      const phone = (o.phone ?? '').replace(/\D/g, '');
      if (!phone) {
        await this.outreach.update(o.id, { stage: 'failed', error: 'sem telefone' });
        continue;
      }
      const opted = await this.optOuts.findOne({ where: { sessionId: o.sessionId, phone } });
      if (opted) {
        await this.outreach.update(o.id, { stage: 'opted_out' });
        continue;
      }
      try {
        await this.messages.sendText(o.sessionId, { chatId: `${phone}@c.us`, text: o.message });
        await this.outreach.update(o.id, { stage: 'sent', error: null });
        void this.notifyCrm(campaign, { ...o, stage: 'sent' });
      } catch (err) {
        await this.outreach.update(o.id, { stage: 'failed', error: String(err instanceof Error ? err.message : err) });
      }
    }
  }

  /** Item 4 — write-back: POST do evento para o CRM/automação da empresa. */
  private async notifyCrm(campaign: Campaign, o: Outreach): Promise<void> {
    if (!campaign.crmWebhookUrl) return;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      await fetch(campaign.crmWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'outreach.sent',
          campaignId: campaign.id,
          campaign: campaign.name,
          sessionId: o.sessionId,
          lead: { name: o.leadName, phone: o.phone, attributes: o.attributes },
          need: o.need,
          score: o.score,
          message: o.message,
          stage: o.stage,
          at: new Date().toISOString(),
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(t));
    } catch (err) {
      this.logger.warn('Falha no write-back do CRM', { error: String(err) });
    }
  }
}
