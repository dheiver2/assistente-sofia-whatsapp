import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, OrderItem, OrderSource, OrderStatus } from './entities/order.entity';
import { EventsGateway } from '../events/events.gateway';

export interface CreateOrderInput {
  sessionId: string;
  phone: string;
  customerName?: string | null;
  items: OrderItem[];
  source?: OrderSource;
  status?: OrderStatus;
  notes?: string | null;
  reference?: string | null;
  placedAt?: Date | null;
  /** Emite a notificação em tempo real (order.created). Default: true. */
  notify?: boolean;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order, 'data') private readonly repo: Repository<Order>,
    private readonly events: EventsGateway,
  ) {}

  private computeTotal(items: OrderItem[]): number {
    return +(items ?? []).reduce((sum, i) => sum + (Number(i.qtd) || 0) * (Number(i.preco) || 0), 0).toFixed(2);
  }

  async create(input: CreateOrderInput): Promise<Order> {
    const items = (input.items ?? []).filter(i => i && i.produto);
    const order = this.repo.create({
      sessionId: input.sessionId,
      phone: input.phone,
      customerName: input.customerName ?? null,
      items,
      total: this.computeTotal(items),
      status: input.status ?? 'novo',
      source: input.source ?? 'conversa',
      notes: input.notes ?? null,
      reference: input.reference ?? null,
      placedAt: input.placedAt ?? new Date(),
    });
    const saved = await this.repo.save(order);

    // Notifica a plataforma (toast + badge) quando um pedido NOVO chega pela conversa.
    if (input.notify !== false && saved.status === 'novo') {
      this.events.emitOrderCreated(saved.sessionId, {
        orderId: saved.id,
        phone: saved.phone,
        customerName: saved.customerName,
        total: saved.total,
        itemCount: saved.items.length,
        items: saved.items,
        source: saved.source,
        createdAt: saved.createdAt,
      });
    }
    return saved;
  }

  list(sessionId: string, opts: { status?: string; search?: string; take?: number } = {}): Promise<Order[]> {
    const qb = this.repo.createQueryBuilder('o').where('o.sessionId = :sid', { sid: sessionId });
    if (opts.status) qb.andWhere('o.status = :st', { st: opts.status });
    if (opts.search) qb.andWhere('(o.customerName LIKE :s OR o.phone LIKE :s)', { s: `%${opts.search}%` });
    return qb
      .orderBy('o.placedAt', 'DESC')
      .addOrderBy('o.createdAt', 'DESC')
      .limit(Math.min(opts.take ?? 100, 500))
      .getMany();
  }

  findByPhone(sessionId: string, phone: string): Promise<Order[]> {
    return this.repo.find({ where: { sessionId, phone }, order: { placedAt: 'DESC', createdAt: 'DESC' } });
  }

  async countByStatus(sessionId: string): Promise<Record<string, number>> {
    const rows = await this.repo
      .createQueryBuilder('o')
      .select('o.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('o.sessionId = :sid', { sid: sessionId })
      .groupBy('o.status')
      .getRawMany<{ status: string; count: string }>();
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  }

  async findById(id: string): Promise<Order> {
    const order = await this.repo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Pedido ${id} não encontrado`);
    return order;
  }

  async update(id: string, patch: { status?: OrderStatus; items?: OrderItem[]; notes?: string }): Promise<Order> {
    const order = await this.findById(id);
    if (patch.status) order.status = patch.status;
    if (patch.items) {
      order.items = patch.items.filter(i => i && i.produto);
      order.total = this.computeTotal(order.items);
    }
    if (patch.notes !== undefined) order.notes = patch.notes;
    return this.repo.save(order);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
