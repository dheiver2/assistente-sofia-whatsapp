import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Configuração da IA de atendimento de uma sessão (uma empresa = uma sessão).
 * Persistida em `Session.config.ai`. Lida pelo plugin auto-reply para montar a persona,
 * o conhecimento da empresa, o modelo e a saudação inicial.
 */
export class AiConfigDto {
  @ApiPropertyOptional({ description: 'Liga/desliga a IA de atendimento desta sessão.' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Personalidade/instruções (system prompt) da IA desta empresa.' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  persona?: string;

  @ApiPropertyOptional({ description: 'Conhecimento da empresa: serviços, produtos, FAQ, diferenciais.' })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  knowledge?: string;

  @ApiPropertyOptional({ description: 'Modelo Ollama a usar nesta sessão (ex.: qwen2.5:7b-instruct). Vazio = padrão global.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({ description: 'Saudação inicial fixa enviada no primeiro contato (opcional).' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  greeting?: string;
}

export type AiConfig = AiConfigDto;
