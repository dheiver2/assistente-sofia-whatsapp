import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';

@Injectable()
export class ProductsService {
  constructor(@InjectRepository(Product, 'data') private readonly repo: Repository<Product>) {}
  list(sessionId: string): Promise<Product[]> { return this.repo.find({ where: { sessionId }, order: { createdAt: 'DESC' } }); }
  create(dto: Partial<Product>): Promise<Product> { return this.repo.save(this.repo.create(dto)); }
  async update(id: string, dto: Partial<Product>): Promise<Product> { await this.repo.update(id, dto); return this.repo.findOneOrFail({ where: { id } }); }
  async delete(id: string): Promise<void> { await this.repo.delete(id); }
}
