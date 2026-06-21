import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../../contacts/entities/contact.entity';

export interface CustomerProfile {
  phone: string;
  name: string | null;
  tags: string[];
  notes: string | null;
  attributes: Record<string, unknown>;
  purchaseHistory: Record<string, unknown>[];
}

@Injectable()
export class ProfileAgent {
  private readonly logger = new Logger(ProfileAgent.name);

  constructor(@InjectRepository(Contact, 'data') private readonly contacts: Repository<Contact>) {}

  async fetch(sessionId: string, phone: string, externalData?: Record<string, unknown>): Promise<CustomerProfile> {
    const contact = await this.contacts.findOne({ where: { sessionId, phone } });

    return {
      phone,
      name: contact?.name ?? null,
      tags: contact?.tags ?? [],
      notes: contact?.notes ?? null,
      attributes: { ...(contact?.attributes ?? {}), ...(externalData ?? {}) },
      purchaseHistory: (contact?.attributes?.['purchases'] as Record<string, unknown>[] | undefined) ?? [],
    };
  }
}
