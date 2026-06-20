import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useRole } from '../hooks/useRole';
import { Webhooks } from './Webhooks';
import { Templates } from './Templates';
import { ApiKeys } from './ApiKeys';
import { Infrastructure } from './Infrastructure';
import { Logs } from './Logs';
import './Config.css';

// Plugins page uses default export
const Plugins = lazy(() => import('./Plugins'));

const ALL_TABS = [
  { id: 'webhooks', label: '🔗 Integrações', adminOnly: false },
  { id: 'templates', label: '📝 Templates', adminOnly: false },
  { id: 'logs', label: '📋 Logs', adminOnly: false },
  { id: 'apikeys', label: '🔑 Chaves API', adminOnly: true },
  { id: 'plugins', label: '🧩 Plugins', adminOnly: true },
  { id: 'infra', label: '🖥️ Infraestrutura', adminOnly: true },
];

export function Config() {
  const { role } = useRole();
  const [params, setParams] = useSearchParams();
  const tabs = ALL_TABS.filter(t => !t.adminOnly || role === 'admin');
  const activeTab = params.get('tab') ?? tabs[0].id;
  const setTab = (id: string) => setParams({ tab: id }, { replace: true });

  return (
    <div className="config-page">
      <nav className="config-tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`config-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="config-content">
        {activeTab === 'webhooks' && <Webhooks />}
        {activeTab === 'templates' && <Templates />}
        {activeTab === 'logs' && <Logs />}
        {activeTab === 'apikeys' && role === 'admin' && <ApiKeys />}
        {activeTab === 'plugins' && role === 'admin' && (
          <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Loader2 className="spin" size={28} /></div>}>
            <Plugins />
          </Suspense>
        )}
        {activeTab === 'infra' && role === 'admin' && <Infrastructure />}
      </div>
    </div>
  );
}
