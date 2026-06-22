import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { sessionApi } from '../services/api';
import {
  Home,
  Smartphone,
  MessageSquare,
  Rocket,
  Settings2,
  LogOut,
  Sun,
  Moon,
  Monitor,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Languages,
  Users,
  Sparkles,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { type UserRole } from '../hooks/useRole';
import { languageOptions, resolveSupportedLanguage, rtlLanguages, type SupportedLanguage } from '../i18n';
import './Layout.css';

interface LayoutProps {
  onLogout: () => void;
  userRole: UserRole | null;
}

type NavItem = { to: string; icon: typeof Home; key: string; adminOnly?: boolean };
type NavGroup = { section: string; items: NavItem[] };

// Grouped navigation — mirrors how messaging platforms (Chatwoot, Respond.io) organise the
// sidebar by area instead of a flat list.
const navGroups: NavGroup[] = [
  { section: 'general', items: [{ to: '/', icon: Home, key: 'home' }] },
  {
    section: 'support',
    items: [
      { to: '/conversas', icon: MessageSquare, key: 'chats' },
      { to: '/contatos', icon: Users, key: 'contacts' },
    ],
  },
  {
    section: 'growth',
    items: [
      { to: '/campanhas', icon: Rocket, key: 'campaigns' },
      { to: '/recomendacoes', icon: Sparkles, key: 'recommendations' },
    ],
  },
  { section: 'connections', items: [{ to: '/sessoes', icon: Smartphone, key: 'sessions' }] },
  { section: 'system', items: [{ to: '/config', icon: Settings2, key: 'config' }] },
];

const themeIcons = { light: Sun, dark: Moon, system: Monitor };

export function Layout({ onLogout, userRole }: LayoutProps) {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const ThemeIcon = themeIcons[theme];
  const themeLabel = t(`theme.${theme}`);

  const visibleGroups = navGroups
    .map(g => ({ ...g, items: g.items.filter(it => !it.adminOnly || userRole === 'admin') }))
    .filter(g => g.items.length > 0);
  const allItems = visibleGroups.flatMap(g => g.items);

  // Title shown in the topbar = label of the currently active route.
  const activeItem =
    allItems.find(it => it.to !== '/' && location.pathname.startsWith(it.to)) ??
    allItems.find(it => it.to === '/' && location.pathname === '/');
  const pageTitle = activeItem ? t(`nav.${activeItem.key}`) : t('common.appName');

  const [readySessions, setReadySessions] = useState(0);
  useEffect(() => {
    const check = () => sessionApi.getStats().then(s => setReadySessions(s.ready)).catch(() => {});
    void check();
    const tid = setInterval(() => void check(), 30000);
    return () => clearInterval(tid);
  }, []);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setIsMobileOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleNavClick = () => {
    if (isMobile) setIsMobileOpen(false);
  };

  useEffect(() => {
    document.body.style.overflow = isMobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileOpen]);

  // Close popover menus on outside click / Escape.
  useEffect(() => {
    if (!isLanguageMenuOpen && !isAccountMenuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (isLanguageMenuOpen && !languageMenuRef.current?.contains(event.target as Node)) {
        setIsLanguageMenuOpen(false);
      }
      if (isAccountMenuOpen && !accountMenuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsLanguageMenuOpen(false);
        setIsAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, [isLanguageMenuOpen, isAccountMenuOpen]);

  const toggleCollapse = () => setIsCollapsed(!isCollapsed);
  const toggleMobile = () => setIsMobileOpen(!isMobileOpen);

  const currentLang = resolveSupportedLanguage(i18n.resolvedLanguage || i18n.language);
  const languageLabel = languageOptions.find(option => option.value === currentLang)?.compactLabel ?? 'EN';
  const changeLanguage = (language: SupportedLanguage) => {
    setIsLanguageMenuOpen(false);
    void i18n.changeLanguage(language);
  };
  const isRtl = rtlLanguages.includes(currentLang);

  const roleLabel = userRole === 'admin' ? t('roles.admin', { defaultValue: 'Administrador' }) : t('roles.member', { defaultValue: 'Operador' });

  return (
    <div className="layout">
      {isMobile && isMobileOpen && <div className="sidebar-overlay" onClick={() => setIsMobileOpen(false)} />}

      <aside
        className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobile ? 'mobile' : ''} ${isMobileOpen ? 'open' : ''}`}
      >
        <div className="sidebar-header">
          <img src="/openwa_logo.webp" alt="Mangaba AI" className="sidebar-logo" />
          {!isCollapsed && (
            <div className="sidebar-brand">
              <span className="brand-name">{t('common.appName')}</span>
              <span className="brand-subtitle">{t('common.appSubtitle')}</span>
            </div>
          )}
        </div>

        {!isMobile && (
          <button
            className="collapse-toggle"
            onClick={toggleCollapse}
            title={isCollapsed ? t('common.expand') : t('common.collapse')}
            aria-label={isCollapsed ? t('common.expand') : t('common.collapse')}
          >
            {isCollapsed
              ? (isRtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />)
              : (isRtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />)}
          </button>
        )}

        <nav className="sidebar-nav">
          {visibleGroups.map(group => (
            <div key={group.section} className="nav-group">
              {!isCollapsed && (
                <span className="nav-group-label">{t(`nav.section.${group.section}`, { defaultValue: group.section })}</span>
              )}
              {group.items.map(({ to, icon: Icon, key }) => {
                const label = t(`nav.${key}`);
                return (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    end={to === '/'}
                    onClick={handleNavClick}
                    title={isCollapsed ? label : undefined}
                  >
                    <Icon size={19} />
                    {!isCollapsed && <span>{label}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="session-health" title={`${readySessions} sessão(ões) conectada(s)`}>
          <span className={`health-dot ${readySessions > 0 ? 'online' : 'offline'}`} />
          {!isCollapsed && (
            <span className="health-label">
              {readySessions > 0 ? `${readySessions} conectada${readySessions > 1 ? 's' : ''}` : 'Sem sessão ativa'}
            </span>
          )}
        </div>
      </aside>

      <div className={`content-area ${isCollapsed ? 'expanded' : ''} ${isMobile ? 'mobile' : ''}`}>
        <header className="topbar">
          <div className="topbar-left">
            {isMobile && (
              <button className="topbar-icon-btn" onClick={toggleMobile} aria-label={t('common.expand')}>
                {isMobileOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
            )}
            <h1 className="topbar-title">{pageTitle}</h1>
          </div>

          <div className="topbar-right">
            {/* Global context chip: connected sessions */}
            <div className="topbar-chip" title={`${readySessions} sessão(ões) conectada(s)`}>
              <span className={`health-dot ${readySessions > 0 ? 'online' : 'offline'}`} />
              <span className="topbar-chip-label">
                {readySessions > 0 ? `${readySessions} on-line` : 'Offline'}
              </span>
            </div>

            <div className="topbar-menu" ref={languageMenuRef}>
              <button
                className="topbar-icon-btn"
                onClick={() => { setIsLanguageMenuOpen(open => !open); setIsAccountMenuOpen(false); }}
                title={t('common.language')}
                aria-label={t('common.language')}
                aria-haspopup="menu"
                aria-expanded={isLanguageMenuOpen}
              >
                <Languages size={18} />
                <span className="topbar-icon-btn-label">{languageLabel}</span>
              </button>
              {isLanguageMenuOpen && (
                <div className="topbar-dropdown" role="menu" aria-label={t('common.language')}>
                  {languageOptions.map(option => (
                    <button
                      key={option.value}
                      className={`topbar-dropdown-item ${option.value === currentLang ? 'active' : ''}`}
                      onClick={() => changeLanguage(option.value)}
                      role="menuitemradio"
                      aria-checked={option.value === currentLang}
                    >
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              className="topbar-icon-btn"
              onClick={toggleTheme}
              title={t('theme.label', { value: themeLabel })}
              aria-label={t('theme.label', { value: themeLabel })}
            >
              <ThemeIcon size={18} />
            </button>

            <div className="topbar-menu" ref={accountMenuRef}>
              <button
                className="topbar-account"
                onClick={() => { setIsAccountMenuOpen(open => !open); setIsLanguageMenuOpen(false); }}
                aria-haspopup="menu"
                aria-expanded={isAccountMenuOpen}
                aria-label={t('common.account', { defaultValue: 'Conta' })}
              >
                <span className="topbar-avatar">{(userRole ?? 'u').charAt(0).toUpperCase()}</span>
              </button>
              {isAccountMenuOpen && (
                <div className="topbar-dropdown account-dropdown" role="menu">
                  <div className="account-info">
                    <span className="account-role">{roleLabel}</span>
                    <span className="account-sub">{t('common.appName')}</span>
                  </div>
                  <button className="topbar-dropdown-item danger" onClick={onLogout} role="menuitem">
                    <LogOut size={16} />
                    <span>{t('common.logout')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
