import { Controller, Post, Headers, Body, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { AuthService } from './auth.service';
import { Public } from './decorators/auth.decorators';
import { createLogger } from '../../common/services/logger.service';

/** Comparação em tempo constante (evita timing attacks no usuário/senha). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

@ApiTags('auth')
@Controller('auth')
export class AuthValidateController {
  private readonly logger = createLogger('AuthValidateController');

  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login tradicional (usuário + senha) — devolve a chave de acesso do dashboard' })
  @ApiResponse({ status: 200, description: 'Login válido' })
  @ApiResponse({ status: 401, description: 'Usuário ou senha inválidos' })
  login(@Body() body: { username?: string; password?: string }): { apiKey: string } {
    const expectedUser = process.env.DASHBOARD_USERNAME ?? 'admin';
    const expectedPass = process.env.DASHBOARD_PASSWORD ?? '';
    const okUser = safeEqual(body?.username ?? '', expectedUser);
    const okPass = expectedPass.length > 0 && safeEqual(body?.password ?? '', expectedPass);
    if (!okUser || !okPass) {
      this.logger.warn('Tentativa de login inválida', { username: body?.username });
      throw new UnauthorizedException('Usuário ou senha inválidos');
    }
    const apiKey = this.authService.getRawApiKey();
    if (!apiKey) {
      throw new UnauthorizedException('Chave de acesso indisponível no servidor');
    }
    return { apiKey };
  }

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate an API key' })
  @ApiHeader({ name: 'X-API-Key', description: 'API key to validate' })
  @ApiResponse({ status: 200, description: 'API key is valid' })
  @ApiResponse({ status: 401, description: 'Invalid or missing API key' })
  async validate(@Headers('x-api-key') apiKey?: string): Promise<{ valid: boolean; role?: string }> {
    // This route is behind the global API-key guard, so in normal operation only a valid key
    // reaches this handler (a missing/invalid key 401s first) and the `valid:false` branches
    // below are unreachable. They are retained as defense-in-depth in case the guard
    // config ever changes — they are cheap and keep the endpoint safe to expose directly.
    if (!apiKey) {
      return { valid: false };
    }

    try {
      const keyEntity = await this.authService.validateApiKey(apiKey);
      if (keyEntity && keyEntity.isActive) {
        return { valid: true, role: keyEntity.role };
      }
      return { valid: false };
    } catch (error) {
      this.logger.warn('API key validation error', { error: error instanceof Error ? error.message : String(error) });
      return { valid: false };
    }
  }
}
