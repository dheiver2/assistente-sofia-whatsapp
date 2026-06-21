import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { jsonColumnType } from '../../../common/utils/column-types';

@Entity('contacts')
@Index(['sessionId', 'phone'], { unique: true })
export class Contact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  sessionId: string;

  @Index()
  @Column({ type: 'varchar', length: 40 })
  phone: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email: string | null;

  @Column({ type: jsonColumnType(), default: '[]' })
  tags: string[];

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: jsonColumnType(), default: '{}' })
  attributes: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'blocked' | 'opted_out';

  @Column({ type: 'datetime', nullable: true })
  lastContactAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
