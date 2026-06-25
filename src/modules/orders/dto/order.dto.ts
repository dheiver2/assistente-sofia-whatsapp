import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { OrderSource, OrderStatus } from '../entities/order.entity';

export class OrderItemDto {
  @ApiProperty({ example: 'Ração Premium Cães Adultos 15kg' })
  @IsString()
  @MaxLength(160)
  produto: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(0)
  qtd: number;

  @ApiPropertyOptional({ example: 159.9 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  preco: number;
}

export class CreateOrderDto {
  @ApiProperty({ example: 'c56f20a9-2448-4153-bfa5-f4c0208535dd' })
  @IsString()
  sessionId: string;

  @ApiProperty({ example: '5582988180696' })
  @IsString()
  phone: string;

  @ApiPropertyOptional({ example: 'Adeline Soraya Menezes' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerName?: string;

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiPropertyOptional({ enum: ['conversa', 'historico-bi', 'manual'] })
  @IsOptional()
  @IsIn(['conversa', 'historico-bi', 'manual'])
  source?: OrderSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateOrderDto {
  @ApiPropertyOptional({ enum: ['novo', 'confirmado', 'concluido', 'cancelado'] })
  @IsOptional()
  @IsIn(['novo', 'confirmado', 'concluido', 'cancelado'])
  status?: OrderStatus;

  @ApiPropertyOptional({ type: [OrderItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items?: OrderItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
