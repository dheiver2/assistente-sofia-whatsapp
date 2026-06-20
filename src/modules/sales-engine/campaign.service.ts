import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HookManager } from '../../core/hooks/hook-manager.service';
import { HookContext } from '../../core/hooks/hook.interfaces';
import { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import { createLogger } from '../../common/services/logger.service';
import { Campaign, LeadSource, Outreach, OptOut, OutreachStage } from './entities/sales.entities';
import { ConnectorLead, DataConnectorService } from './data-connector.service';
import { SalesEngineService } from './sales-engine.service';

/** Normaliza um telefone para somente dígitos (chave de opt-out e JID). */
export function normalizePhone(phone?: string | null): string {
  return (phone ?? '').replace(/\D/g, '');
}

const OPT_OUT_RE = /\b(sair|parar|cancelar|descadastrar|remover|stop|n[ãa]o quero|pare)\b/i;

@Injectable()
export class CampaignService implements OnModuleInit {
  private readonly logger = createLogger('CampaignService');

  constructor(
    @InjectRepository(LeadSource, 'data') private readonly sources: Repository<LeadSource>,
    @InjectRepository(Campaign, 'data') private readonly campaigns: Repository<Campaign>,
    @InjectRepository(Outreach, 'data') private readonly outreach: Repository<Outreach>,
    @InjectRepository(OptOut, 'data') private readonly optOuts: Repository<OptOut>,
    private readonly connector: DataConnectorService,
    private readonly salesEngine: SalesEngineService,
    private readonly hooks: HookManager,
  ) {}

  // Item 4 — rastreia o funil: marca 'replied' e detecta opt-out quando o cliente responde.
  onModuleInit(): void {
    this.hooks.register('sales-engine', 'message:received', async ctx => {
      const c = ctx as HookContext<IncomingMessage>;
      const msg = c.data;
      if (c.source !== 'Engine' || !c.sessionId || msg.fromMe || msg.isGroup) {
        return { continue: true };
      }
      const phone = normalizePhone(msg.chatId?.split('@')[0]);
      if (!phone) return { continue: true };

      if (OPT_OUT_RE.test(msg.body ?? '')) {
        await this.addOptOut(c.sessionId, phone);
        await this.outreach.update(
          { sessionId: c.sessionId, phone, stage: 'sent' as OutreachStage },
          { stage: 'opted_out' },
        );
        return { continue: true };
      }
      // Marca como respondida a abordagem enviada para este contato.
      await this.outreach.update(
        { sessionId: c.sessionId, phone, stage: 'sent' as OutreachStage },
        { stage: 'replied' },
      );
      return { continue: true };
    });
    this.logger.log('Funnel tracking hook registrado (message:received)');
  }

  // ---- Fontes de leads (Item 1) ----
  listSources(sessionId: string): Promise<LeadSource[]> {
    return this.sources.find({ where: { sessionId }, order: { createdAt: 'DESC' } });
  }
  createSource(data: Partial<LeadSource>): Promise<LeadSource> {
    return this.sources.save(this.sources.create(data));
  }
  async deleteSource(id: string): Promise<void> {
    await this.sources.delete(id);
  }
  async testSource(id: string): Promise<{ ok: boolean; message: string }> {
    const src = await this.sources.findOne({ where: { id } });
    if (!src) throw new NotFoundException('Fonte não encontrada');
    return this.connector.testConnection(src);
  }

  // ---- Campanhas (Item 2) ----
  listCampaigns(sessionId: string): Promise<Campaign[]> {
    return this.campaigns.find({ where: { sessionId }, order: { createdAt: 'DESC' } });
  }
  createCampaign(data: Partial<Campaign>): Promise<Campaign> {
    return this.campaigns.save(this.campaigns.create({ status: 'draft', ratePerMinute: 6, ...data }));
  }
  async deleteCampaign(id: string): Promise<void> {
    await this.outreach.delete({ campaignId: id });
    await this.campaigns.delete(id);
  }

  /** Gera as abordagens da campanha: busca leads na fonte + roda a IA por lead. */
  async generate(
    campaignId: string,
    inlineLeads?: { name?: string; phone?: string; attributes: Record<string, unknown> }[],
  ): Promise<Outreach[]> {
    const campaign = await this.campaigns.findOne({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada');

    let leads = inlineLeads ?? [];
    if (!leads.length && campaign.leadSourceId) {
      const src = await this.sources.findOne({ where: { id: campaign.leadSourceId } });
      if (src) leads = await this.connector.fetchLeads(src, 50);
    }
    if (!leads.length) throw new NotFoundException('Nenhum lead encontrado (defina uma fonte ou envie leads).');

    await this.campaigns.update(campaignId, { status: 'generating' });
    const generated = await this.salesEngine.generateOutreach({
      sessionId: campaign.sessionId,
      offerHint: campaign.offerHint ?? undefined,
      leads,
    });

    // Limpa abordagens anteriores ainda pendentes e grava as novas.
    await this.outreach.delete({ campaignId, stage: 'pending' });
    const rows = generated.map(g =>
      this.outreach.create({
        campaignId,
        sessionId: campaign.sessionId,
        leadName: g.lead.name ?? null,
        phone: normalizePhone(g.lead.phone) || null,
        attributes: g.lead.attributes,
        need: g.need,
        score: g.score,
        message: g.message,
        stage: 'pending',
        error: g.error ?? null,
      }),
    );
    const saved = await this.outreach.save(rows);
    await this.campaigns.update(campaignId, { status: 'ready' });
    return saved;
  }

  listOutreach(campaignId: string): Promise<Outreach[]> {
    return this.outreach.find({ where: { campaignId }, order: { score: 'DESC' } });
  }

  async updateOutreach(id: string, patch: { message?: string; stage?: OutreachStage }): Promise<Outreach> {
    await this.outreach.update(id, patch);
    const row = await this.outreach.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Abordagem não encontrada');
    return row;
  }

  /** Aprova as abordagens pendentes (com telefone) para o dispatcher enviar. */
  async approveAndSend(campaignId: string): Promise<{ approved: number }> {
    const res = await this.outreach
      .createQueryBuilder()
      .update(Outreach)
      .set({ stage: 'approved' })
      .where('campaignId = :campaignId AND stage = :stage AND phone IS NOT NULL', {
        campaignId,
        stage: 'pending',
      })
      .execute();
    await this.campaigns.update(campaignId, { status: 'sending' });
    return { approved: res.affected ?? 0 };
  }

  // Item 4 — métricas do funil
  async metrics(campaignId: string): Promise<Record<string, number>> {
    const rows = await this.outreach.find({ where: { campaignId }, select: ['stage'] });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.stage] = (counts[r.stage] ?? 0) + 1;
    counts.total = rows.length;
    return counts;
  }

  // ---- Opt-out (Item 3) ----
  async addOptOut(sessionId: string, phone: string): Promise<void> {
    const p = normalizePhone(phone);
    if (!p) return;
    const exists = await this.optOuts.findOne({ where: { sessionId, phone: p } });
    if (!exists) await this.optOuts.save(this.optOuts.create({ sessionId, phone: p }));
  }

  /** Lança campanha automaticamente: gera, aprova tudo e inicia o disparo. */
  async autoRun(campaignId: string, inlineLeads?: ConnectorLead[]): Promise<{ generated: number; approved: number }> {
    const rows = await this.generate(campaignId, inlineLeads);
    const { approved } = await this.approveAndSend(campaignId);
    return { generated: rows.length, approved };
  }

  async pauseCampaign(campaignId: string): Promise<void> {
    await this.campaigns.update(campaignId, { status: 'paused' });
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    await this.campaigns.update(campaignId, { status: 'sending' });
  }

  async progress(campaignId: string): Promise<{
    sent: number; approved: number; pending: number; failed: number; total: number; etaMinutes: number; rate: number; status: string;
  }> {
    const campaign = await this.campaigns.findOne({ where: { id: campaignId } });
    const rows = await this.outreach.find({ where: { campaignId }, select: ['stage'] });
    const count = (stage: string) => rows.filter(r => r.stage === stage).length;
    const sent = ['sent', 'replied', 'qualified', 'won', 'opted_out'].reduce((a, s) => a + count(s), 0);
    const approved = count('approved');
    const pending = count('pending');
    const failed = count('failed');
    const rate = campaign?.ratePerMinute ?? 6;
    return { sent, approved, pending, failed, total: rows.length, etaMinutes: Math.ceil(approved / rate), rate, status: campaign?.status ?? 'done' };
  }

  async listOptOuts(sessionId: string): Promise<OptOut[]> {
    return this.optOuts.find({ where: { sessionId }, order: { createdAt: 'DESC' } });
  }

  async removeOptOut(id: string): Promise<void> {
    await this.optOuts.delete(id);
  }
}
