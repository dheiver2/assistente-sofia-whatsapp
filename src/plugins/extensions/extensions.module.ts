import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PluginLoaderService, PluginManifest, PluginType } from '../../core/plugins';
import { AutoReplyPlugin, SessionAi, CommerceHooks, OrderItemDescriptor, ResolvedOrderItem } from './auto-reply';
import { TranslationPlugin } from './translation';
import { Session } from '../../modules/session/entities/session.entity';
import { Contact } from '../../modules/contacts/entities/contact.entity';
import { Product } from '../../modules/recommendations/entities/product.entity';
import { OrdersModule } from '../../modules/orders/orders.module';
import { OrdersService } from '../../modules/orders/orders.service';
import { createLogger } from '../../common/services/logger.service';

/**
 * Registers first-party built-in EXTENSION plugins with the (global) PluginLoaderService.
 * Mirrors EngineFactory's registration pattern so src/core never imports a concrete plugin.
 * Built-in extensions are registered DISABLED; operators enable them via POST /plugins/:id/enable.
 */
@Injectable()
export class ExtensionsRegistrar implements OnModuleInit {
  private readonly logger = createLogger('ExtensionsRegistrar');

  constructor(
    private readonly pluginLoader: PluginLoaderService,
    @InjectRepository(Session, 'data') private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Contact, 'data') private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Product, 'data') private readonly productRepo: Repository<Product>,
    private readonly ordersService: OrdersService,
  ) {}

  /** Minúsculas + sem acento (catálogo é "RACAO", a IA descreve "Ração" — precisam casar). */
  private deburr(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /** Pontuação simples de match: nº de termos da descrição encontrados no produto. */
  private scoreProduct(p: Product, terms: string[]): number {
    const hay = this.deburr(`${p.name} ${p.category ?? ''} ${p.keywords ?? ''}`);
    return terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
  }

  async onModuleInit(): Promise<void> {
    const autoReplyManifest: PluginManifest = {
      id: 'auto-reply',
      name: 'Auto Reply (reference)',
      version: '1.0.0',
      type: PluginType.EXTENSION,
      description: 'Reference extension plugin: replies to inbound direct messages. Disabled by default.',
      main: 'index.ts',
      permissions: ['messages:send'],
      sessions: ['*'],
    };

    // Resolver de UUID -> { nome, config de IA } da sessão, para o auto-reply montar a IA por empresa.
    const resolveSession = async (sessionId: string): Promise<{ name: string | null; ai: SessionAi | null }> => {
      const row = await this.sessionRepo.findOne({ where: { id: sessionId }, select: ['name', 'config'] });
      const ai = row?.config?.ai as SessionAi | undefined;
      return { name: row?.name ?? null, ai: ai ?? null };
    };
    // Resolve o contexto do cliente (perfil/histórico/cadência já calculados em attributes.aiContext)
    // por sessão+telefone, para a IA da conversa recomendar com base no que a pessoa já comprou.
    const resolveContact = async (sessionId: string, phone: string): Promise<{ name: string | null; aiContext: string } | null> => {
      const c = await this.contactRepo.findOne({ where: { sessionId, phone }, select: ['name', 'attributes'] });
      const aiContext = c?.attributes?.['aiContext'];
      if (typeof aiContext !== 'string' || !aiContext.trim()) return null;
      return { name: c?.name ?? null, aiContext };
    };
    // Hooks de comércio: a IA descreve o que o cliente quer, o backend resolve preço/nome no catálogo
    // (fonte da verdade) e cria o pedido (status 'novo' → notificação). Liga só em sessões com catálogo.
    const commerce: CommerceHooks = {
      isEnabled: async (sessionId: string): Promise<boolean> => {
        const n = await this.productRepo.count({ where: { sessionId, active: true } });
        return n > 0;
      },
      resolveProducts: async (sessionId: string, items: OrderItemDescriptor[]): Promise<ResolvedOrderItem[]> => {
        const catalog = await this.productRepo.find({ where: { sessionId, active: true } });
        return items.map(it => {
          const terms = `${it.descricao} ${it.marca ?? ''}`
            .toLowerCase()
            .split(/[^a-zà-ú0-9]+/)
            .filter(w => w.length >= 3);
          let best: Product | null = null;
          let bestScore = 0;
          for (const p of catalog) {
            const s = this.scoreProduct(p, terms);
            if (s > bestScore) { bestScore = s; best = p; }
          }
          const qtd = Number(it.qtd) > 0 ? Number(it.qtd) : 1;
          // Match confiável → nome+preço canônicos; senão mantém a descrição com preço 0 (a IA confirma depois).
          if (best && bestScore > 0) return { produto: best.name, qtd, preco: Number(best.price) || 0 };
          return { produto: it.descricao, qtd, preco: 0 };
        });
      },
      placeOrder: async input => {
        const order = await this.ordersService.create({
          sessionId: input.sessionId,
          phone: input.phone,
          customerName: input.customerName ?? null,
          items: input.items,
          source: 'conversa',
          status: 'novo',
        });
        return { id: order.id, total: Number(order.total) };
      },
      appendOrder: async (orderId, items) => {
        const order = await this.ordersService.appendItems(orderId, items);
        return { id: order.id, total: Number(order.total) };
      },
    };

    this.pluginLoader.registerBuiltInPlugin(autoReplyManifest, new AutoReplyPlugin(resolveSession, resolveContact, commerce));
    this.logger.log('Auto-reply plugin registered — enabling automatically');
    await this.pluginLoader.enablePlugin('auto-reply');

    const translationManifest: PluginManifest = {
      id: 'translation',
      name: 'Group Auto-Translation',
      version: '1.0.0',
      type: PluginType.EXTENSION,
      description:
        "Auto-translates group messages between participants' languages via LibreTranslate. Configure in-group with /tr commands. Disabled by default.",
      main: 'index.ts',
      permissions: ['messages:send'],
      sessions: ['*'],
      // Exposed via GET /plugins so the dashboard renders an editable config form (URL + API key, etc.).
      configSchema: {
        type: 'object',
        properties: {
          libretranslateUrl: {
            type: 'string',
            title: 'LibreTranslate URL',
            description:
              'Base URL of the LibreTranslate instance (e.g. http://libretranslate:7001 or https://libretranslate.com).',
            default: 'http://localhost:7001',
            required: true,
          },
          libretranslateApiKey: {
            type: 'string',
            title: 'LibreTranslate API key',
            description:
              'Optional API key, if your LibreTranslate instance requires one (e.g. hosted libretranslate.com).',
            secret: true,
          },
          timeoutMs: { type: 'number', title: 'Translate timeout (ms)', default: 5000 },
          commandPrefix: { type: 'string', title: 'Command prefix', default: '/tr' },
          minLength: { type: 'number', title: 'Min message length to translate', default: 2 },
          maxLength: { type: 'number', title: 'Max message length to translate', default: 2000 },
          denyReply: {
            type: 'boolean',
            title: 'Reply on denied commands',
            description: "Reply with an 'admins only' message when a non-admin runs a restricted command.",
            default: false,
          },
        },
      },
    };

    this.pluginLoader.registerBuiltInPlugin(translationManifest, new TranslationPlugin());
    this.logger.log('Translation plugin registered (disabled)');
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Session, Contact, Product], 'data'), OrdersModule],
  providers: [ExtensionsRegistrar],
})
export class ExtensionsModule {}
