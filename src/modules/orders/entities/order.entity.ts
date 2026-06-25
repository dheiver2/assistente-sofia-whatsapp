import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { jsonColumnType } from '../../../common/utils/column-types';

export type OrderStatus = 'novo' | 'confirmado' | 'concluido' | 'cancelado';
export type OrderSource = 'conversa' | 'historico-bi' | 'manual';

export interface OrderItem {
  produto: string;
  qtd: number;
  preco: number;
}

/**
 * Pedido de um cliente. Pode vir da conversa (a IA fecha o pedido — status "novo", gera notificação),
 * do histórico importado do BI da loja (status "concluido") ou cadastrado manualmente.
 */
@Entity('orders')
@Index(['sessionId', 'phone'])
@Index(['sessionId', 'status'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  sessionId: string;

  @Index()
  @Column({ type: 'varchar', length: 40 })
  phone: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  customerName: string | null;

  @Column({ type: jsonColumnType(), default: '[]' })
  items: OrderItem[];

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  total: number;

  @Column({ type: 'varchar', length: 20, default: 'novo' })
  status: OrderStatus;

  @Column({ type: 'varchar', length: 20, default: 'conversa' })
  source: OrderSource;

  /** Referência externa (ex.: N. Pedido do BI da loja). */
  @Column({ type: 'varchar', length: 40, nullable: true })
  reference: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** Data real do pedido (para histórico importado, difere de createdAt). */
  @Column({ type: 'datetime', nullable: true })
  placedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
