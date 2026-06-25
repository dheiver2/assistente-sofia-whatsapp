/* Importa o BI da Super Pet (xlsx) para a plataforma, extraindo o MÁXIMO de inteligência:
   - contatos: nome, telefone WA, tags, notas e attributes ricos
     (histórico, perfil do pet, valor/LTV, marcas preferidas, cadência de recompra, e um
      `aiContext` pronto para a IA da conversa usar inline).
   - catálogo: todos os produtos no catálogo da sessão (motor de recomendação casa contra eles).
   Idempotente: substitui contatos por (sessionId, phone) e recria os produtos da sessão. */
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { read, utils } = require('xlsx');
const sqlite3 = require('sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB = path.join(ROOT, 'openwa');
const XLSX = process.argv[2] || '/Users/dheiver/Downloads/bi_global_230626 (1).xlsx';
const SESSION = 'c56f20a9-2448-4153-bfa5-f4c0208535dd'; // super-pet
const MAX_PRODUCTS = 5000;
const MAX_PURCHASES = 20;

const titleCase = s => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
const digits = s => String(s || '').replace(/\D/g, '');
const upper = s => String(s || '').toUpperCase();
function toWa(raw) {
  let d = digits(raw);
  if (!d || d.length < 10) return null;
  if (d.startsWith('55') && d.length >= 12) return d;
  return '55' + d;
}
const money = v => { const n = parseFloat(String(v || '').replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
const brl = n => 'R$ ' + n.toFixed(2).replace('.', ',');
// Resolução de data do BI. A coluna "Data" é inconsistente: parte é texto "DD/MM/YYYY" (correto) e
// parte é data serial do Excel COM DIA E MÊS TROCADOS na origem (vira datas futuras erradas). A
// "Data Pagamento" é um timestamp real e confiável (presente em ~98% das linhas) → usamos ela primeiro.
const asDate = v => (v instanceof Date && !isNaN(v) ? v : null);
const strDate = s => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; };
const dayOnly = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
function resolveRowDate(r) {
  // 1) Data Pagamento (fonte confiável)
  const pg = asDate(r['Data Pagamento']) || strDate(r['Data Pagamento']);
  if (pg) return dayOnly(pg);
  // 2) "Data" como texto DD/MM/YYYY (correto)
  const s = strDate(r['Data']);
  if (s) return s;
  // 3) "Data" como data serial: dia<->mês trocados na origem → corrige
  const d = asDate(r['Data']);
  if (d) return new Date(d.getFullYear(), d.getDate() - 1, d.getMonth() + 1);
  return null;
}
const fmtDate = d => d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : null;

// Inferência do perfil do pet a partir dos nomes de produtos/serviços comprados.
function inferPet(productNames) {
  const hay = ' ' + productNames.join(' | ').toUpperCase() + ' ';
  let species = null;
  const gato = /GATO|FELIN|GATInh/i.test(hay);
  const cao = /\bCAO\b|\bCÃO\b|CACHORR|\bDOG\b|CANIN/i.test(hay);
  if (cao && !gato) species = 'cão'; else if (gato && !cao) species = 'gato'; else if (cao && gato) species = 'cão e gato';
  let size = null;
  if (/PELO LONGO|\bGRANDE\b|PORTE G\b|\(G\)|\bG\/GG\b|\bGG\b/.test(hay)) size = 'grande';
  else if (/PELO MEDIO|\bMEDIO\b|PORTE M\b|\(M\)|\(P\/M\)/.test(hay)) size = 'médio';
  else if (/PELO CURTO|PEQUENO|PORTE P\b|\(P\)/.test(hay)) size = 'pequeno';
  let coat = null;
  if (/PELO LONGO/.test(hay)) coat = 'pelo longo';
  else if (/PELO MEDIO/.test(hay)) coat = 'pelo médio';
  else if (/PELO CURTO/.test(hay)) coat = 'pelo curto';
  return { species, size, coat };
}

const CONSUMIVEIS = ['RACAO', 'MEDICAMENTO', 'HIGIENE', 'PETISCO', 'AREIA'];
const isConsumivel = grupoUpper => CONSUMIVEIS.some(k => grupoUpper.includes(k));

const wb = read(fs.readFileSync(XLSX), { cellDates: true });
const rows = utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

// Data de referência = última data presente no relatório (para julgar "está na hora de repor").
let refDate = null;
for (const r of rows) { const d = resolveRowDate(r); if (d && (!refDate || d > refDate)) refDate = d; }

const custs = {}; // phone -> agg
const prods = {}; // produto -> agg
const ordersByNum = {}; // N. Pedido -> { phone, nome, data, items[], total }
for (const r of rows) {
  const phone = toWa(r['Celular']) || toWa(r['Fone']);
  const nome = String(r['Cliente'] || '').trim();
  const produto = String(r['Produto'] || '').trim();
  const grupo = titleCase(r['Grupo Linha']);
  const grupoUp = upper(r['Grupo Linha']);
  const data = resolveRowDate(r);
  const fab = String(r['Fabricante'] || '').trim();
  const total = money(r['Total Item']);

  // Pedido (agrupa itens pelo N. Pedido)
  const numPedido = r['N. Pedido'] ? String(r['N. Pedido']) : null;
  if (numPedido && produto) {
    const o = (ordersByNum[numPedido] = ordersByNum[numPedido] || {
      phone: phone || digits(r['Celular']) || digits(r['Fone']) || '',
      nome,
      data,
      items: [],
      total: 0,
    });
    if (!o.data && data) o.data = data;
    o.items.push({ produto, qtd: parseFloat(String(r['Qtd'] || '1').replace(',', '.')) || 1, preco: money(r['Preço Liquido']) });
    o.total += total;
  }
  if (phone && nome) {
    const c = (custs[phone] = custs[phone] || { nome, bairro: titleCase(r['Bairro']), cats: {}, brands: {}, pedidos: new Set(), purchases: [], total: 0, byCat: {} });
    if (grupo) c.cats[grupo] = (c.cats[grupo] || 0) + 1;
    if (fab && !/NAO INFORMADO|SEM FORNECEDOR|SEM CADASTRO/i.test(fab)) c.brands[titleCase(fab)] = (c.brands[titleCase(fab)] || 0) + 1;
    if (r['N. Pedido']) c.pedidos.add(String(r['N. Pedido']));
    c.total += total;
    if (produto) c.purchases.push({ produto, categoria: grupo, data: fmtDate(data), _d: data });
    if (isConsumivel(grupoUp) && data) { (c.byCat[grupo] = c.byCat[grupo] || []).push(data); }
  }
  if (produto) {
    const p = (prods[produto] = prods[produto] || { cat: grupo, sub: titleCase(r['Sub Grupo']), preco: null, n: 0 });
    p.n++;
    const pr = money(r['Preço Liquido']);
    if (pr) p.preco = pr;
  }
}

// Cadência de recompra por categoria de consumível.
function cadencia(byCat) {
  const out = [];
  for (const [cat, dates] of Object.entries(byCat)) {
    const ds = dates.slice().sort((a, b) => a - b);
    const last = ds[ds.length - 1];
    let intervalo = null;
    if (ds.length >= 2) {
      let soma = 0; for (let i = 1; i < ds.length; i++) soma += (ds[i] - ds[i - 1]) / 86400000;
      intervalo = Math.round(soma / (ds.length - 1));
    }
    const diasDesde = refDate && last ? Math.round((refDate - last) / 86400000) : null;
    const devido = intervalo != null && diasDesde != null && diasDesde >= intervalo;
    out.push({ categoria: cat, ultima: fmtDate(last), compras: ds.length, intervaloDias: intervalo, diasDesde, devido });
  }
  return out.sort((a, b) => (b.devido - a.devido) || (b.compras - a.compras));
}

const contacts = Object.entries(custs).map(([phone, c]) => {
  const petMatch = c.nome.match(/\(([^)]+)\)/);
  const petNome = petMatch ? petMatch[1].trim() : null;
  const nomeLimpo = c.nome.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const catsOrd = Object.entries(c.cats).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const brandsOrd = Object.entries(c.brands).sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 3);
  const allProdNames = c.purchases.map(p => p.produto);
  const topProds = [...new Set(allProdNames)].slice(0, 6);
  const pet = inferPet(allProdNames);
  const numPedidos = c.pedidos.size || 1;
  const ticket = c.total / numPedidos;
  const datasOrd = c.purchases.map(p => p._d).filter(Boolean).sort((a, b) => a - b);
  const primeira = fmtDate(datasOrd[0]);
  const ultima = fmtDate(datasOrd[datasOrd.length - 1]);
  const cad = cadencia(c.byCat);
  const devidos = cad.filter(x => x.devido);

  const petDesc = [petNome, [pet.species, pet.size, pet.coat].filter(Boolean).join(', ')].filter(Boolean).join(' — ') || null;
  const value = { numPedidos, totalGasto: +c.total.toFixed(2), ticketMedio: +ticket.toFixed(2), primeiraCompra: primeira, ultimaCompra: ultima };

  // Texto pronto para a IA da conversa usar de forma natural.
  const aiContext = [
    `Cliente: ${nomeLimpo}${petDesc ? `. Pet: ${petDesc}` : ''}.`,
    `Relacionamento: cliente desde ${primeira || '—'}, ${numPedidos} pedido(s), ticket médio ${brl(ticket)}, total gasto ${brl(c.total)}.`,
    `Costuma comprar: ${catsOrd.slice(0, 4).join(', ') || '—'}.`,
    brandsOrd.length ? `Marcas preferidas: ${brandsOrd.join(', ')}.` : '',
    topProds.length ? `Itens recentes: ${topProds.join('; ')}.` : '',
    devidos.length
      ? `Possível reposição agora: ${devidos.map(d => `${d.categoria} (última ${d.ultima}, costuma comprar a cada ~${d.intervaloDias} dias)`).join('; ')}.`
      : (cad.length ? `Recompra: ${cad.slice(0, 2).map(d => `${d.categoria} a cada ~${d.intervaloDias ?? '?'} dias (última ${d.ultima})`).join('; ')}.` : ''),
  ].filter(Boolean).join('\n');

  const tags = ['Cliente Super Pet', ...catsOrd.slice(0, 3), ...(devidos.length ? ['Reposição'] : [])];
  const notes =
    `Cliente Super Pet${petDesc ? ` — pet: ${petDesc}` : ''}. ${numPedidos} pedidos, ticket ${brl(ticket)}, total ${brl(c.total)}. ` +
    `Categorias: ${catsOrd.slice(0, 4).join(', ') || '—'}.` +
    (brandsOrd.length ? ` Marcas: ${brandsOrd.join(', ')}.` : '') +
    (devidos.length ? ` ⏰ Reposição provável: ${devidos.map(d => d.categoria).join(', ')}.` : '') +
    (c.bairro ? ` Bairro: ${c.bairro}.` : '');

  const attributes = {
    origem: 'BI Super Pet',
    pet: petNome,
    petProfile: pet,
    value,
    bairro: c.bairro || null,
    categorias: catsOrd,
    marcas: brandsOrd,
    replenishment: cad,
    aiContext,
    purchases: c.purchases.slice(-MAX_PURCHASES).map(p => ({ produto: p.produto, categoria: p.categoria, data: p.data })),
  };
  return { id: randomUUID(), phone, name: nomeLimpo.slice(0, 120), tags, notes, attributes };
});

const products = Object.entries(prods)
  .sort((a, b) => b[1].n - a[1].n)
  .slice(0, MAX_PRODUCTS)
  .map(([nome, p]) => ({
    id: randomUUID(),
    name: nome.slice(0, 120),
    description: `Categoria: ${p.cat || '—'}${p.sub ? ` — ${p.sub}` : ''}. Produto/serviço da Super Pet.`,
    category: (p.cat || '').slice(0, 80) || null,
    price: p.preco,
    keywords: [p.cat, p.sub].filter(Boolean).join(', '),
    tags: JSON.stringify([p.cat].filter(Boolean)),
  }));

// Pedidos históricos (um por N. Pedido), status concluído.
const orders = Object.entries(ordersByNum).map(([num, o]) => ({
  id: randomUUID(),
  phone: o.phone || '',
  customerName: (o.nome || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim().slice(0, 120) || null,
  items: o.items.map(it => ({ produto: it.produto.slice(0, 160), qtd: it.qtd, preco: it.preco })),
  total: +o.total.toFixed(2),
  reference: num,
  placedAt: o.data ? o.data.toISOString() : null,
}));

const db = new sqlite3.Database(DB);
const run = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));

(async () => {
  await run('PRAGMA busy_timeout=8000');
  await run('BEGIN');
  try {
    for (const c of contacts) {
      await run(
        `INSERT OR REPLACE INTO contacts (id, sessionId, phone, name, tags, notes, attributes, status, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?, 'active', datetime('now'), datetime('now'))`,
        [c.id, SESSION, c.phone, c.name, JSON.stringify(c.tags), c.notes, JSON.stringify(c.attributes)],
      );
    }
    await run('DELETE FROM products WHERE sessionId = ?', [SESSION]);
    for (const p of products) {
      await run(
        `INSERT INTO products (id, sessionId, name, description, category, price, tags, keywords, active, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?, 1, datetime('now'), datetime('now'))`,
        [p.id, SESSION, p.name, p.description, p.category, p.price, p.tags, p.keywords],
      );
    }
    // Pedidos históricos (recria os do BI; não toca em pedidos feitos pela conversa).
    await run("DELETE FROM orders WHERE sessionId = ? AND source = 'historico-bi'", [SESSION]);
    for (const o of orders) {
      await run(
        `INSERT INTO orders (id, sessionId, phone, customerName, items, total, status, source, reference, placedAt, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?, 'concluido', 'historico-bi', ?,?, datetime('now'), datetime('now'))`,
        [o.id, SESSION, o.phone, o.customerName, JSON.stringify(o.items), o.total, o.reference, o.placedAt],
      );
    }
    await run('COMMIT');
    console.log(`OK: ${contacts.length} contatos + ${products.length} produtos + ${orders.length} pedidos históricos. Data ref: ${fmtDate(refDate)}.`);
  } catch (e) {
    await run('ROLLBACK');
    console.error('FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
