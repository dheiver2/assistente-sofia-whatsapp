import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from './entities/contact.entity';

@Injectable()
export class ContactsService {
  constructor(@InjectRepository(Contact, 'data') private readonly repo: Repository<Contact>) {}

  findByPhone(sessionId: string, phone: string): Promise<Contact | null> {
    return this.repo.findOne({ where: { sessionId, phone } });
  }

  async upsert(sessionId: string, phone: string, patch: Partial<Contact>): Promise<Contact> {
    let c = await this.repo.findOne({ where: { sessionId, phone } });
    if (!c) {
      c = this.repo.create({ sessionId, phone, ...patch });
    } else {
      Object.assign(c, patch);
    }
    return this.repo.save(c);
  }

  list(sessionId: string, tag?: string, search?: string): Promise<Contact[]> {
    const qb = this.repo.createQueryBuilder('c').where('c.sessionId = :sid', { sid: sessionId });
    if (tag) qb.andWhere("JSON_EXTRACT(c.tags, '$') LIKE :tag", { tag: `%"${tag}"%` });
    if (search) qb.andWhere('(c.name LIKE :s OR c.phone LIKE :s)', { s: `%${search}%` });
    return qb.orderBy('c.updatedAt', 'DESC').getMany();
  }

  find(sessionId: string, phone: string): Promise<Contact | null> {
    return this.repo.findOne({ where: { sessionId, phone } });
  }

  async addTag(id: string, tag: string): Promise<Contact> {
    const c = await this.repo.findOneOrFail({ where: { id } });
    if (!c.tags.includes(tag)) { c.tags = [...c.tags, tag]; await this.repo.save(c); }
    return c;
  }

  async removeTag(id: string, tag: string): Promise<Contact> {
    const c = await this.repo.findOneOrFail({ where: { id } });
    c.tags = c.tags.filter(t => t !== tag);
    return this.repo.save(c);
  }

  async delete(id: string): Promise<void> { await this.repo.delete(id); }
}
