import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { LeadDto } from './generate-outreach.dto';

export class CreateLeadSourceDto {
  @ApiProperty() @IsString() sessionId: string;
  @ApiProperty() @IsString() @MaxLength(120) name: string;
  @ApiProperty({ enum: ['postgres', 'inline'] }) @IsIn(['postgres', 'inline']) type: 'postgres' | 'inline';
  @ApiProperty({ type: 'object', additionalProperties: true }) @IsObject() config: Record<string, unknown>;
}

export class CreateCampaignDto {
  @ApiProperty() @IsString() sessionId: string;
  @ApiProperty() @IsString() @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) offerHint?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() leadSourceId?: string;
  @ApiPropertyOptional({ default: 6 }) @IsOptional() @IsInt() @Min(1) @Max(60) ratePerMinute?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) crmWebhookUrl?: string;
}

export class GenerateCampaignDto {
  @ApiPropertyOptional({ type: [LeadDto], description: 'Leads inline (se a campanha não tiver fonte).' })
  @IsOptional()
  leads?: LeadDto[];
}

export class UpdateOutreachDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4096) message?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() stage?: string;
}

export class OptOutDto {
  @ApiProperty() @IsString() sessionId: string;
  @ApiProperty() @IsString() phone: string;
}
