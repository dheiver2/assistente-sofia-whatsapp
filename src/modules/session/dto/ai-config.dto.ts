import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/**
 * Horário comercial da IA de atendimento. Quando habilitado, a Sofia só responde dentro da
 * agenda; fora dela envia `outsideMessage`. `schedule` mapeia o dia (mon..sun) para
 * { start, end } no formato "HH:MM", ou `false` quando fechado naquele dia.
 */
export class BusinessHoursDto {
  @ApiPropertyOptional({ description: 'Liga/desliga a checagem de horário comercial.' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: "Fuso horário IANA (ex.: 'America/Sao_Paulo')." })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ description: 'Agenda por dia: { mon: { start, end } | false, ... }.' })
  @IsOptional()
  @IsObject()
  schedule?: Record<string, { start: string; end: string } | false>;

  @ApiPropertyOptional({ description: 'Mensagem enviada fora do horário comercial.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  outsideMessage?: string;
}

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

  @ApiPropertyOptional({
    description: 'Modelo Ollama a usar nesta sessão (ex.: qwen2.5:7b-instruct). Vazio = padrão global.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @ApiPropertyOptional({ description: 'Saudação inicial fixa enviada no primeiro contato (opcional).' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  greeting?: string;

  @ApiPropertyOptional({ description: 'Horário comercial: responde só dentro da agenda; fora envia outsideMessage.', type: BusinessHoursDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BusinessHoursDto)
  businessHours?: BusinessHoursDto;
}

export type AiConfig = AiConfigDto;

/**
 * Configuração padrão do bot — toda sessão nasce com isto, funcional na hora.
 * A pessoa abre a aba IA e personaliza (persona, conhecimento, saudação, horário, modelo).
 */
export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: true,
  persona:
    'Você é um assistente virtual de atendimento via WhatsApp, simpático, claro e prestativo. ' +
    'Responda em português brasileiro, em mensagens curtas e naturais (1 a 4 frases), sem markdown. ' +
    'Cumprimente e se apresente apenas no primeiro contato; depois vá direto ao ponto, sem repetir saudações. ' +
    'Entenda a necessidade da pessoa e ajude com o que souber. Quando não tiver a informação, seja honesto: ' +
    'diga que vai verificar e retorna — nunca invente preços, prazos ou detalhes que você não conhece. ' +
    'FLUIDEZ (importante): cada resposta deve ser ÚNICA — jamais repita a mesma abertura (não comece toda ' +
    'mensagem com "Claro"), o mesmo fecho ou a mesma pergunta que já usou. Leia o histórico e avance a conversa, ' +
    'variando o jeito de falar como uma pessoa de verdade; não termine toda mensagem com pergunta e use emoji com parcimônia.',
  knowledge: '',
  greeting: 'Olá! 👋 Sou o assistente virtual de atendimento. Como posso te ajudar hoje?',
  model: '',
};
