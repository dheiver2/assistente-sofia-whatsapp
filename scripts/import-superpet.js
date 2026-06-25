/* Importa o BI da Super Pet (xlsx) para a plataforma:
   - contatos da sessão super-pet (nome, telefone, tags, notas e histórico de compras em attributes.purchases)
   - catálogo dos produtos mais vendidos (tabela products) para o motor de recomendação casar.
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
const MAX_PRODUCTS = 150;
const MAX_PURCHASES_PER_CUST = 30;

const titleCase = s => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\bE\b/g, 'e').trim();
const digits = s => String(s || '').replace(/\D/g, '');
// Telefone -> formato WhatsApp BR (55 + DDD + número). Evita 55 duplicado.
function toWa(raw) {
  let d = digits(raw);
  if (!d || d.length < 10) return null;
  if (d.startsWith('55') && d.length >= 12) return d;
  return '55' + d;
}
const parsePrice = v => { const n = parseFloat(String(v || '').replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : null; };

const wb = read(fs.readFileSync(XLSX));
const rows = utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

const custs = {}; // phone -> agg
const prods = {}; // produto -> agg
for (const r of rows) {
  const phone = toWa(r['Celular']) || toWa(r['Fone']);
  const nome = String(r['Cliente'] || '').trim();
  const produto = String(r['Produto'] || '').trim();
  const cat = titleCase(r['Grupo Linha']);
  const data = String(r['Data'] || '').trim();
  if (phone && nome) {
    const c = (custs[phone] = custs[phone] || { nome, cod: r['Cod. Cliente.'], bairro: titleCase(r['Bairro']), cats: {}, purchases: [] });
    if (cat) c.cats[cat] = (c.cats[cat] || 0) + 1;
    if (produto) c.purchases.push({ produto, categoria: cat, data, qtd: String(r['Qtd'] || '').trim() });
  }
  if (produto) {
    const p = (prods[produto] = prods[produto] || { cat, sub: titleCase(r['Sub Grupo']), preco: null, n: 0 });
    p.n++;
    const pr = parsePrice(r['Preço Liquido']);
    if (pr != null) p.preco = pr;
  }
}

// Monta contatos
const contacts = Object.entries(custs).map(([phone, c]) => {
  const petMatch = c.nome.match(/\(([^)]+)\)/);
  const pet = petMatch ? petMatch[1].trim() : null;
  const nomeLimpo = c.nome.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const catsOrd = Object.entries(c.cats).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const purchases = c.purchases.slice(-MAX_PURCHASES_PER_CUST);
  const topProds = [...new Set(c.purchases.map(p => p.produto))].slice(0, 6);
  const ultima = c.purchases.length ? c.purchases[c.purchases.length - 1].data : null;
  const tags = ['Cliente Super Pet', ...catsOrd.slice(0, 4)];
  const notes =
    `Cliente Super Pet${pet ? ` — pet: ${pet}` : ''}. ` +
    `${c.purchases.length} itens comprados. ` +
    `Categorias: ${catsOrd.slice(0, 4).join(', ') || '—'}. ` +
    `Já levou: ${topProds.join('; ')}.` +
    (ultima ? ` Última compra: ${ultima}.` : '') +
    (c.bairro ? ` Bairro: ${c.bairro}.` : '');
  const attributes = {
    origem: 'BI Super Pet',
    codCliente: c.cod ? String(c.cod) : null,
    pet,
    bairro: c.bairro || null,
    totalItens: c.purchases.length,
    ultimaCompra: ultima,
    categorias: catsOrd,
    purchases,
  };
  return { id: randomUUID(), phone, name: nomeLimpo.slice(0, 120), tags, notes, attributes };
});

// Monta catálogo (top vendidos)
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

const db = new sqlite3.Database(DB);
const run = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res(this); }));

(async () => {
  await run('PRAGMA busy_timeout=8000');
  await run('BEGIN');
  try {
    // Contatos (substitui por sessionId+phone)
    for (const c of contacts) {
      await run(
        `INSERT OR REPLACE INTO contacts (id, sessionId, phone, name, tags, notes, attributes, status, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?, 'active', datetime('now'), datetime('now'))`,
        [c.id, SESSION, c.phone, c.name, JSON.stringify(c.tags), c.notes, JSON.stringify(c.attributes)],
      );
    }
    // Catálogo: recria os produtos da sessão
    await run('DELETE FROM products WHERE sessionId = ?', [SESSION]);
    for (const p of products) {
      await run(
        `INSERT INTO products (id, sessionId, name, description, category, price, tags, keywords, active, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?, 1, datetime('now'), datetime('now'))`,
        [p.id, SESSION, p.name, p.description, p.category, p.price, p.tags, p.keywords],
      );
    }
    await run('COMMIT');
    console.log(`OK: ${contacts.length} contatos + ${products.length} produtos importados na sessão super-pet.`);
  } catch (e) {
    await run('ROLLBACK');
    console.error('FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
