import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RecommendationStatus = 'pending' | 'sent' | 'viewed' | 'clicked' | 'converted' | 'rejected';

@Entity('recommendations')
export class Recommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  sessionId: string;

  @Column({ type: 'varchar', length: 80 })
  phone: string;

  @Column({ type: 'varchar', length: 36 })
  productId: string;

  @Column({ type: 'varchar', length: 120 })
  productName: string;

  @Column({ type: 'text' })
  message: string;  // AI-crafted personalized message

  @Column({ type: 'varchar', length: 500, nullable: true })
  mediaUrl: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  mediaType: 'image' | 'video' | 'document' | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: RecommendationStatus;

  @Column({ type: 'text', nullable: true })
  customerInsight: string | null;  // what the AI understood about customer

  @Column({ type: 'int', default: 0 })
  relevanceScore: number;  // 0-100

  @Column({ type: 'varchar', length: 36, nullable: true })
  campaignId: string | null;

  @CreateDateColumn() createdAt: Date;
}
