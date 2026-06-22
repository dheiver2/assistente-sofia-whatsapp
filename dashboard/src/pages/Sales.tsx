import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Rocket, Sparkles } from 'lucide-react';
import { SalesEngine } from './SalesEngine';
import Recommendations from './Recommendations';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './Sales.css';

type Mode = 'campanhas' | 'recomendacoes';

/**
 * Hub de Vendas — unifica os dois modos do mesmo objetivo (IA vende produto):
 *  - Campanhas: disparo em massa / proativo (lista → IA → dispara)
 *  - Recomendações: sugestão 1:1 / reativa (contato → multi-agente → sugere)
 * Reaproveita as páginas existentes embutidas (sem título próprio).
 */
export function Sales() {
  useDocumentTitle('Vendas');
  const [params, setParams] = useSearchParams();
  const initial: Mode = params.get('m') === 'rec' ? 'recomendacoes' : 'campanhas';
  const [mode, setMode] = useState<Mode>(initial);

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
