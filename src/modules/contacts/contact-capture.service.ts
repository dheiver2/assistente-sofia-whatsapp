import { Injectable, OnModuleInit } from '@nestjs/common';
import { HookManager } from '../../core/hooks/hook-manager.service';
import { HookContext } from '../../core/hooks/hook.interfaces';
import { IncomingMessage } from '../../engine/interfaces/whatsapp-engine.interface';
import { createLogger } from '../../common/services/logger.service';
import { ContactsService } from './contacts.service';

/**
 * Auto-captura de leads no CRM (fase de Qualificação do funil).
 *
 * Toda mensagem 1:1 recebida cria/atualiza um contato na base: contatos novos entram com o nome
 * (pushName) e a tag "Lead", marcando o início do funil. Contatos já existentes só têm o
 * "último contato" atualizado — nome e tags editados pelo operador NÃO são sobrescritos.
 */
@Injectable()
export class ContactCaptureService implements OnModuleInit {
  private readonly logger = createLogger('ContactCapture');

  constructor(
    private readonly contacts: ContactsService,
    private readonly hooks: HookManager,
  ) {}

  onModuleInit(): void {
    this.hooks.register('contact-capture', 'message:received', async ctx => {
      try {
        await this.capture(ctx as HookContext<IncomingMessage>);
      } catch (err) {
        this.logger.warn('Falha ao auto-capturar contato', { error: String(err) });
      }
      return { continue: true }; // nunca bloqueia o pipeline de mensagens
    });
    this.logger.log('Auto-captura de contatos registrada (message:received)');
  }

  private async capture(ctx: HookContext<IncomingMessage>): Promise<void> {
    const msg = ctx.data;
    // Só conversas 1:1 reais, recebidas, originadas do engine. Ignora grupos/canais/status/próprias.
    if (ctx.source !== 'Engine' || !ctx.sessionId || msg.fromMe || msg.isGroup || msg.isStatusBroadcast) {
      return;
    }
    const chatId = msg.chatId ?? '';
    if (!/@(c\.us|s\.whatsapp\.net|lid)$/.test(chatId)) {
      return;
    }
    // Telefone: prefere o senderPhone resolvido (para @lid); senão, os dígitos do JID.
    const phone = (msg.senderPhone || chatId.split('@')[0] || '').replace(/\D/g, '');
    if (!phone) return;

    const existing = await this.contacts.findByPhone(ctx.sessionId, phone);
    if (existing) {
      // Já é um contato: só marca o último contato (não toca em nome/tags do operador).
      await this.contacts.upsert(ctx.sessionId, phone, { lastContactAt: new Date() });
      return;
    }

    // Lead novo → entra no CRM no topo do funil.
    const name = msg.contact?.pushName?.trim() || msg.contact?.name?.trim() || null;
    await this.contacts.upsert(ctx.sessionId, phone, {
      name,
      tags: ['Lead'],
      lastContactAt: new Date(),
    });
    this.logger.log('Novo lead capturado no CRM', { sessionId: ctx.sessionId, phone, name });
  }
}
