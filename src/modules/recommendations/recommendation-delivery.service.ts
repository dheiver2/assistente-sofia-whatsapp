import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Recommendation } from './entities/recommendation.entity';
import { MessageService } from '../message/message.service';

@Injectable()
export class RecommendationDeliveryService {
  private readonly logger = new Logger(RecommendationDeliveryService.name);

  constructor(
    @InjectRepository(Recommendation, 'data') private readonly recs: Repository<Recommendation>,
    private readonly messageService: MessageService,
  ) {}

  private chatIdFor(phone: string): string {
    return phone.includes('@') ? phone : `${phone}@c.us`;
  }

  private async deliverRecommendation(rec: Recommendation): Promise<boolean> {
    try {
      const chatId = this.chatIdFor(rec.phone);
      if (rec.mediaUrl && rec.mediaType === 'image') {
        await this.messageService.sendImage(rec.sessionId, { chatId, url: rec.mediaUrl, caption: rec.message });
      } else if (rec.mediaUrl && rec.mediaType === 'video') {
        await this.messageService.sendVideo(rec.sessionId, { chatId, url: rec.mediaUrl, caption: rec.message });
      } else {
        await this.messageService.sendText(rec.sessionId, { chatId, text: rec.message });
      }
      await this.recs.update(rec.id, { status: 'sent' });
      return true;
    } catch (err) {
      this.logger.error(`Failed to deliver recommendation ${rec.id}`, err as Error);
      await this.recs.update(rec.id, { status: 'failed' });
      return false;
    }
  }

  async deliverOne(id: string): Promise<{ ok: boolean }> {
    const rec = await this.recs.findOne({ where: { id } });
    if (!rec) return { ok: false };
    const ok = await this.deliverRecommendation(rec);
    return { ok };
  }

  async deliverAllPending(sessionId: string): Promise<{ sent: number }> {
    const pending = await this.recs.find({ where: { sessionId, status: 'pending' }, order: { createdAt: 'DESC' } });
    let sent = 0;
    for (const rec of pending) {
      if (await this.deliverRecommendation(rec)) sent += 1;
    }
    return { sent };
  }

  async deliverPendingForPhone(sessionId: string, phone: string): Promise<{ sent: number }> {
    const pending = await this.recs.find({ where: { sessionId, phone, status: 'pending' }, order: { createdAt: 'DESC' } });
    let sent = 0;
    for (const rec of pending) {
      if (await this.deliverRecommendation(rec)) sent += 1;
    }
    return { sent };
  }
}
