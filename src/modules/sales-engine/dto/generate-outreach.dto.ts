import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** Um lead/cliente vindo da base da empresa (dados já normalizados). */
export class LeadDto {
  @ApiPropertyOptional({ description: 'Nome do cliente.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Telefone (E.164 ou JID). Só usado em envio, opcional no preview.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiProperty({
    description: 'Atributos do cliente vindos da base (ex.: ultimo_pedido, plano, cidade, ticket_medio).',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  attributes: Record<string, unknown>;
}

/** Pedido de geração de abordagem (Motor de Vendas). Modo preview: NÃO envia. */
export class GenerateOutreachDto {
  @ApiProperty({ description: 'ID da sessão/empresa cuja IA (persona + conhecimento) será usada.' })
  @IsString()
  sessionId: string;

  @ApiPropertyOptional({ description: 'Dica de oferta/objetivo da campanha (ex.: "renovar plano anual").' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  offerHint?: string;

  @ApiProperty({ description: 'Lista de leads a abordar (máx. 50 por requisição).', type: [LeadDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LeadDto)
  leads: LeadDto[];
}

/** Resultado por lead: necessidade inferida + mensagem de abordagem. */
export class OutreachResultDto {
  lead: LeadDto;
  need: string;
  score: number;
  message: string;
  model: string;
  error?: string;
}
