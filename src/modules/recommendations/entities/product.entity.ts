import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { jsonColumnType } from '../../../common/utils/column-types';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  sessionId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  category: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  price: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  imageUrl: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  videoUrl: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  documentUrl: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  thumbnailUrl: string | null;

  // Tags for matching (e.g. ["tech","premium","B2B"])
  @Column({ type: jsonColumnType(), default: '[]' })
  tags: string[];

  // Keywords the AI uses for matching (e.g. "automação, eficiência, redução de custo")
  @Column({ type: 'text', nullable: true })
  keywords: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
