import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Rocket, Sparkles } from 'lucide-react';
import { SalesEngine } from './SalesEngine';
import Recommendations from './Recommendations';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './Sales.css';

type Mode = 'campanhas' | 'recomendacoes';

// Disparo em massa (campanhas) fica DESLIGADO por padrão: conflita com o foco humanizado 1:1 e é o
// maior vetor de banimento do WhatsApp para uma loja única. Ligue com VITE_FEATURE_CAMPAIGNS=true.
const CAMPAIGNS_ENABLED = import.meta.env.VITE_FEATURE_CAMPAIGNS === 'true';

/**
 * Hub de Recomendações (1:1, reativo). Com campanhas habilitadas, vira um hub com as duas abas.
 */
export function Sales() {
  useDocumentTitle('Recomendações');
  const [params, setParams] = useSearchParams();
  const initial: Mode = params.get('m') === 'rec' ? 'recomendacoes' : 'campanhas';
  const [mode, setMode] = useState<Mode>(initial);

  // Padrão (campanhas off): só Recomendações 1:1, sem abas.
  if (!CAMPAIGNS_ENABLED) {
    return (
      <div className="sales-hub">
        <div className="sales-hub-body">
          <Recommendations embedded />
        </div>
      </div>
    );
  }

  // Mantém as abas em sincronia com a URL (back/forward do navegador, deep links).
  useEffect(() => {
    setMode(params.get('m') === 'rec' ? 'recomendacoes' : 'campanhas');
  }, [params]);

  const select = (m: Mode) => {
    setMode(m);
    setParams(m === 'recomendacoes' ? { m: 'rec' } : {}, { replace: true });
  };

  return (
    <div className="sales-hub">
      <div className="sales-hub-tabs">
        <button
          className={`sales-hub-tab ${mode === 'campanhas' ? 'active' : ''}`}
          onClick={() => select('campanhas')}
        >
          <Rocket size={16} />
          <span>
            <strong>Campanhas</strong>
            <small>Disparo em massa</small>
          </span>
        </button>
        <button
          className={`sales-hub-tab ${mode === 'recomendacoes' ? 'active' : ''}`}
          onClick={() => select('recomendacoes')}
        >
          <Sparkles size={16} />
          <span>
            <strong>Recomendações</strong>
            <small>Sugestão 1:1 por contato</small>
          </span>
        </button>
      </div>

      <div className="sales-hub-body">
        {mode === 'campanhas' ? <SalesEngine embedded /> : <Recommendations embedded />}
      </div>
    </div>
  );
}

export default Sales;
