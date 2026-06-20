import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { jsonColumnType } from '../../../common/utils/column-types';

/** Estágios do funil de uma abordagem (outreach) de vendas. */
export type OutreachStage =
  | 'pending' // gerada, aguardando aprovação humana
  | 'approved' // liberada para envio
  | 'sent' // mensagem enviada
  | 'replied' // cliente respondeu
  | 'qualified' // SDR qualificou
  | 'won' // convertido
  | 'lost' // perdido
  | 'opted_out' // pediu para sair
  | 'failed'; // falha no envio

/** Fonte de leads de uma empresa (sessão): Postgres (read-only) ou leads inline. */
@Entity('sales_lead_sources')
export class LeadSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  sessionId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'inline' })
  type: 'postgres' | 'inline';

  // postgres: { host, port, database, user, password, query, nameColumn, phoneColumn, ssl? }
  // inline:   { leads: [{ name, phone, attributes }] }
  @Column({ type: jsonColumnType(), default: '{}' })
  config: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}

/** Campanha de vendas ativas de uma empresa (sessão). */
@Entity('sales_campaigns')
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  sessionId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  offerHint: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  leadSourceId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: 'draft' | 'generating' | 'ready' | 'sending' | 'paused' | 'done';

  // Limite de envios por minuto (anti-spam / proteção do número).
  @Column({ type: 'int', default: 6 })
  ratePerMinute: number;

  // Write-back: URL que recebe POST a cada mudança de estágio (CRM/Zapier/etc).
  @Column({ type: 'varchar', length: 500, nullable: true })
  crmWebhookUrl: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  mediaUrl: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  mediaType: 'image' | 'video' | 'document' | 'audio' | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** Uma abordagem por lead, com o estágio do funil. */
@Entity('sales_outreach')
export class Outreach {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  campaignId: string;

  @Column({ type: 'varchar', length: 64 })
  sessionId: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  leadName: string | null;

  @Index()
  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ type: jsonColumnType(), default: '{}' })
  attributes: Record<string, unknown>;

  @Column({ type: 'text', default: '' })
  need: string;

  @Column({ type: 'int', default: 0 })
  score: number;

  @Column({ type: 'text', default: '' })
  message: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  stage: OutreachStage;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

/** Lista de descadastro (opt-out) por empresa. */
@Entity('sales_opt_outs')
@Index(['sessionId', 'phone'], { unique: true })
export class OptOut {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  sessionId: string;

  @Column({ type: 'varchar', length: 40 })
  phone: string;

  @CreateDateColumn()
  createdAt: Date;
}
