import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { SalesEngineService } from './sales-engine.service';
import { GenerateOutreachDto, OutreachResultDto } from './dto/generate-outreach.dto';

@ApiTags('sales-engine')
@Controller('sales')
export class SalesEngineController {
  constructor(private readonly salesEngine: SalesEngineService) {}

  @Post('outreach/generate')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({
    summary:
      'Motor de Vendas: gera abordagem personalizada por lead (necessidade + mensagem) usando a IA da empresa. Modo preview — NÃO envia.',
  })
  @ApiResponse({ status: 201, description: 'Abordagens geradas (para revisão humana antes do envio).' })
  @ApiResponse({ status: 404, description: 'Sessão não encontrada' })
  async generate(@Body() dto: GenerateOutreachDto): Promise<OutreachResultDto[]> {
    return this.salesEngine.generateOutreach(dto);
  }
}
