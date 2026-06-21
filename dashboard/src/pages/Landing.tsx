import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import './Landing.css';

/* ── Intersection Observer hook for fade-in ── */
function useFadeIn() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('lp-visible');
          }
        });
      },
      { threshold: 0.12 }
    );

    const targets = el.querySelectorAll('.lp-fade-in');
    targets.forEach((t) => observer.observe(t));

    return () => observer.disconnect();
  }, []);

  return ref;
}

/* ── Feature data ── */
const features = [
  {
    icon: '🤖',
    title: 'IA Conversacional',
    desc: 'Responde automaticamente com persona customizada e histórico de contexto para conversas naturais.',
  },
  {
    icon: '📢',
    title: 'Campanhas em massa',
    desc: 'Disparo personalizado com IA, agendamento inteligente e segmentação avançada de leads.',
  },
  {
    icon: '👥',
    title: 'CRM de Contatos',
    desc: 'Gestão completa com tags, notas, histórico de interações e importação/exportação CSV.',
  },
  {
    icon: '📊',
    title: 'Relatórios em tempo real',
    desc: 'Taxas de resposta, conversão e score de leads com dashboards interativos.',
  },
  {
    icon: '🔗',
    title: 'Webhooks & API',
    desc: 'Integre com qualquer sistema via REST API ou webhooks autenticados com HMAC.',
  },
  {
    icon: '🕐',
    title: 'Horário de Atendimento',
    desc: 'IA só responde no horário comercial configurado por você, com mensagens automáticas fora do horário.',
  },
];

/* ── Pricing data ── */
const plans = [
  {
    name: 'Starter',
    price: 'Grátis',
    period: 'para sempre',
    desc: 'Self-hosted. Você controla tudo no seu servidor.',
    badge: null,
    pro: false,
    features: [
      'Self-hosted no seu servidor',
      '1 número WhatsApp',
      'IA conversacional básica',
      'CRM de contatos',
      'API REST completa',
      'Suporte via comunidade',
    ],
    cta: 'Começar grátis',
    ctaLink: '/',
  },
  {
    name: 'Pro',
    price: '$49',
    period: '/mês',
    desc: 'Cloud gerenciado por nós. Zero configuração.',
    badge: 'Mais popular',
    pro: true,
    features: [
      'Cloud managed — sem infra',
      'Até 5 números WhatsApp',
      'IA avançada com persona',
      'Campanhas em massa',
      'Relatórios avançados',
      'Suporte prioritário 24/7',
    ],
    cta: 'Assinar Pro',
    ctaLink: '/login',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    desc: 'Para grandes operações com SLA garantido.',
    badge: null,
    pro: false,
    features: [
      'Números ilimitados',
      'SLA 99.99% uptime',
      'Onboarding dedicado',
      'Integrações customizadas',
      'Treinamento de IA personalizado',
      'Gerente de conta exclusivo',
    ],
    cta: 'Falar com vendas',
    ctaLink: 'mailto:vendas@mangaba.ai',
  },
];

export default function Landing() {
  const pageRef = useFadeIn();

  return (
    <div className="lp-page" ref={pageRef}>
      {/* ── NAVBAR ── */}
      <nav className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <Link to="/landing" className="lp-nav-logo">
            🥭 Mangaba AI
          </Link>
          <ul className="lp-nav-links">
            <li><a href="#funcionalidades">Funcionalidades</a></li>
            <li><a href="#precos">Preços</a></li>
            <li><a href="#como-funciona">Como funciona</a></li>
          </ul>
          <Link to="/" className="lp-btn lp-btn-primary">
            Acessar plataforma
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-bg" />
        <div className="lp-hero-orb lp-hero-orb-1" />
        <div className="lp-hero-orb lp-hero-orb-2" />

        <div className="lp-container lp-hero-content">
          <div className="lp-hero-badge lp-fade-in">
            <span>✦</span> 100% Self-hosted · Open Source
          </div>

          <h1 className="lp-hero-title lp-fade-in lp-fade-in-delay-1">
            Automatize seu WhatsApp com{' '}
            <span className="lp-gradient-text">Inteligência Artificial</span>
          </h1>

          <p className="lp-hero-subtitle lp-fade-in lp-fade-in-delay-2">
            Disparos em massa, IA conversacional, CRM de contatos e muito mais —
            100% self-hosted, sem mensalidades por conversa.
          </p>

          <div className="lp-hero-ctas lp-fade-in lp-fade-in-delay-3">
            <Link to="/" className="lp-btn lp-btn-primary lp-btn-lg">
              Começar agora →
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="lp-btn lp-btn-ghost lp-btn-lg"
            >
              Ver documentação
            </a>
          </div>

          {/* Stats mockup card */}
          <div className="lp-stats-card lp-glass lp-fade-in lp-fade-in-delay-4">
            <div className="lp-stat-item">
              <span
                className="lp-stat-value"
                style={{ color: 'var(--lp-primary-light)' }}
              >
                1.247
              </span>
              <span className="lp-stat-label">
                <span
                  className="lp-stat-dot"
                  style={{ background: 'var(--lp-primary-light)' }}
                />
                Enviadas
              </span>
            </div>
            <div className="lp-stat-divider" />
            <div className="lp-stat-item">
              <span
                className="lp-stat-value"
                style={{ color: 'var(--lp-secondary)' }}
              >
                312
              </span>
              <span className="lp-stat-label">
                <span
                  className="lp-stat-dot"
                  style={{ background: 'var(--lp-secondary)' }}
                />
                Respostas
              </span>
            </div>
            <div className="lp-stat-divider" />
            <div className="lp-stat-item">
              <span
                className="lp-stat-value"
                style={{ color: 'var(--lp-accent)' }}
              >
                47
              </span>
              <span className="lp-stat-label">
                <span
                  className="lp-stat-dot"
                  style={{ background: 'var(--lp-accent)' }}
                />
                Conversões
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="lp-section lp-features" id="funcionalidades">
        <div className="lp-container">
          <div className="lp-section-header lp-fade-in">
            <p className="lp-section-label">Funcionalidades</p>
            <h2 className="lp-section-title">
              Tudo que você precisa para{' '}
              <span className="lp-gradient-text">escalar no WhatsApp</span>
            </h2>
            <p className="lp-section-subtitle">
              Uma plataforma completa que combina IA, automação e CRM para
              transformar seu WhatsApp em uma máquina de vendas.
            </p>
          </div>

          <div className="lp-features-grid">
            {features.map((f, i) => (
              <div
                key={f.title}
                className={`lp-feature-card lp-glass lp-fade-in lp-fade-in-delay-${Math.min(i + 1, 6)}`}
              >
                <div className="lp-feature-icon">{f.icon}</div>
                <h3 className="lp-feature-title">{f.title}</h3>
                <p className="lp-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="lp-section" id="como-funciona">
        <div className="lp-container">
          <div className="lp-section-header lp-fade-in" style={{ textAlign: 'center' }}>
            <p className="lp-section-label">Como funciona</p>
            <h2 className="lp-section-title">
              Três passos para{' '}
              <span className="lp-gradient-text">começar a vender</span>
            </h2>
          </div>

          <div className="lp-how-grid">
            {[
              {
                n: '1',
                title: 'Conecte seu número',
                desc: 'Escaneie o QR code e conecte seu WhatsApp em segundos. Suporte a múltiplas sessões simultâneas.',
              },
              {
                n: '2',
                title: 'Configure a IA',
                desc: 'Defina a persona, o tom de voz, os horários de atendimento e as regras de resposta automática.',
              },
              {
                n: '3',
                title: 'Dispare campanhas',
                desc: 'Crie listas de contatos, personalize mensagens com IA e agende disparos com análise em tempo real.',
              },
            ].map((step, i) => (
              <div
                key={step.n}
                className={`lp-how-step lp-glass lp-fade-in lp-fade-in-delay-${i + 1}`}
              >
                <div className="lp-how-number">{step.n}</div>
                <h3 className="lp-how-title">{step.title}</h3>
                <p className="lp-how-desc">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="lp-section lp-pricing" id="precos">
        <div className="lp-container">
          <div className="lp-section-header lp-fade-in" style={{ textAlign: 'center' }}>
            <p className="lp-section-label">Preços</p>
            <h2 className="lp-section-title">
              Simples e{' '}
              <span className="lp-gradient-text">sem surpresas</span>
            </h2>
            <p
              className="lp-section-subtitle"
              style={{ margin: '0 auto' }}
            >
              Sem cobrar por conversa. Sem limites arbitrários. Você paga pelo
              plano, não pelo volume.
            </p>
          </div>

          <div className="lp-pricing-grid">
            {plans.map((plan, i) => (
              <div
                key={plan.name}
                className={`lp-pricing-card lp-glass lp-fade-in lp-fade-in-delay-${i + 1}${plan.pro ? ' lp-pricing-pro' : ''}`}
              >
                {plan.badge && (
                  <span className="lp-pricing-badge">{plan.badge}</span>
                )}
                <div>
                  <h3 className="lp-pricing-name">{plan.name}</h3>
                  <div className="lp-pricing-price">
                    <span
                      className="lp-pricing-amount"
                      style={
                        plan.pro
                          ? { background: 'linear-gradient(135deg, var(--lp-primary-light), var(--lp-secondary))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }
                          : undefined
                      }
                    >
                      {plan.price}
                    </span>
                    {plan.period && (
                      <span className="lp-pricing-period">{plan.period}</span>
                    )}
                  </div>
                  <p className="lp-pricing-desc">{plan.desc}</p>
                </div>

                <div className="lp-pricing-divider" />

                <ul className="lp-pricing-features">
                  {plan.features.map((feat) => (
                    <li key={feat}>{feat}</li>
                  ))}
                </ul>

                <Link
                  to={plan.ctaLink.startsWith('mailto') ? '#' : plan.ctaLink}
                  className={`lp-btn ${plan.pro ? 'lp-btn-primary' : 'lp-btn-ghost'}`}
                  onClick={
                    plan.ctaLink.startsWith('mailto')
                      ? (e) => { e.preventDefault(); window.location.href = plan.ctaLink; }
                      : undefined
                  }
                  style={{ justifyContent: 'center' }}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="lp-cta">
        <div className="lp-container">
          <div className="lp-cta-inner lp-fade-in">
            <h2 className="lp-cta-title">
              Pronto para automatizar{' '}
              <span className="lp-gradient-text">seu WhatsApp?</span>
            </h2>
            <p className="lp-cta-subtitle">
              Junte-se a centenas de empresas que já usam Mangaba AI para
              escalar vendas e atendimento no WhatsApp.
            </p>
            <div className="lp-cta-actions">
              <Link to="/" className="lp-btn lp-btn-primary lp-btn-lg">
                Começar agora — é grátis
              </Link>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="lp-btn lp-btn-ghost lp-btn-lg"
              >
                ⭐ Ver no GitHub
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <Link to="/landing" className="lp-footer-logo">
            🥭 Mangaba AI
          </Link>
          <p className="lp-footer-copy">
            © {new Date().getFullYear()} Mangaba AI. Todos os direitos reservados.
          </p>
          <ul className="lp-footer-links">
            <li><a href="#funcionalidades">Funcionalidades</a></li>
            <li><a href="#precos">Preços</a></li>
            <li><a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a></li>
            <li><a href="mailto:contato@mangaba.ai">Contato</a></li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
