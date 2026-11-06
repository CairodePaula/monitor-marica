// Testes automatizados da API (node:test + pg-mem: Postgres em memória).
// Rodar: npm test
const test = require('node:test');
const assert = require('node:assert');
const { newDb } = require('pg-mem');

process.env.NASA_KEY = 'chave-de-teste';
process.env.ADMIN_TOKEN = 'segredo';

const db = require('../lib/db');
const mem = newDb();
const { Pool } = mem.adapters.createPg();
db.usarPool(new Pool());

const axios = require('axios');
const { app, calcularAlerta, nivel } = require('../lib/app');

const CSV = [
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
  '-22.91,-42.82,340,0.4,0.4,2026-10-08,1500,N,VIIRS,h,2.0NRT,300,55.2,D',
  '-22.95,-42.85,300,0.4,0.4,2026-10-08,1505,N,VIIRS,n,2.0NRT,290,12.1,D'
].join('\n');

let server, base;
test.before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const get = (p, opts) => fetch(base + p, opts);

test('regras de negócio: nível e alerta', () => {
  assert.strictEqual(nivel(90), 'alto');
  assert.strictEqual(nivel(50), 'medio');
  assert.strictEqual(nivel(10), 'baixo');
  assert.strictEqual(calcularAlerta([]).codigo, 'tranquilo');
  assert.strictEqual(calcularAlerta([{ confidence: 30, frp: 1 }]).codigo, 'atencao');
  assert.strictEqual(calcularAlerta([{ confidence: 90, frp: 1 }]).codigo, 'critico');
});

test('NASA indisponível e sem cache → dados de demonstração (não grava histórico)', async () => {
  axios.get = async () => { throw new Error('rede fora'); };
  const j = await (await get('/api/focos?forcar=true')).json();
  assert.strictEqual(j.fonte, 'demonstracao');
  assert.ok(j.focos.length > 0);
  const st = await (await get('/api/status')).json();
  assert.strictEqual(st.historicoRegistros, 0);
  assert.strictEqual(st.bancoConectado, true);
});

test('NASA ok → fonte nasa, grava histórico, alerta e cache no banco', async () => {
  axios.get = async () => ({ data: CSV });
  const j = await (await get('/api/focos?forcar=true')).json();
  assert.strictEqual(j.fonte, 'nasa');
  assert.strictEqual(j.total, 2);
  assert.strictEqual(j.estatisticas.alto, 1);
  assert.strictEqual(j.alerta.codigo, 'critico');
  const st = await (await get('/api/status')).json();
  assert.strictEqual(st.historicoRegistros, 1);
  assert.strictEqual(st.cachePersistido, true);
  assert.strictEqual(st.versao, require('../package.json').version);
});

test('segunda chamada usa cache de 30 min', async () => {
  axios.get = async () => { throw new Error('não deveria chamar'); };
  const j = await (await get('/api/focos')).json();
  assert.strictEqual(j.fonte, 'cache');
  assert.strictEqual(j.total, 2);
});

test('NASA cai depois de ter cache → cache-offline, sem apagar o histórico', async () => {
  axios.get = async () => { throw new Error('rede fora'); };
  const j = await (await get('/api/focos?forcar=true')).json();
  assert.strictEqual(j.fonte, 'cache-offline');
  assert.strictEqual(j.total, 2);
  const st = await (await get('/api/status')).json();
  assert.strictEqual(st.historicoRegistros, 1);
});

test('exportação CSV e JSON', async () => {
  const csv = await (await get('/api/historico/exportar?formato=csv')).text();
  assert.ok(csv.includes('data,area,total,alto,medio,baixo,frpTotal,coletado_em'));
  assert.strictEqual(csv.trim().split('\n').length, 2);
  const j = await (await get('/api/historico/exportar?formato=json')).json();
  assert.strictEqual(j.length, 1);
  assert.strictEqual(j[0].total, 2);
  const ruim = await get('/api/historico/exportar?formato=xml');
  assert.strictEqual(ruim.status, 400);
  const h = await (await get('/api/historico?dias=7')).json();
  assert.strictEqual(h.serie.length, 1);
});

test('métricas contam a visita (POST /api/visita) e anonimizam o IP', async () => {
  assert.strictEqual((await get('/api/visita', { method: 'POST' })).status, 204);
  const m = await (await get('/api/metricas')).json();
  assert.ok(m.totalAcessos >= 1);
  assert.strictEqual(m.visitantesUnicos, 1);
  const { rows } = await db.pool().query('SELECT ip FROM acessos LIMIT 1');
  assert.match(rows[0].ip, /^[0-9a-f]{16}$/);
});

test('feedback: valida e grava; exportação exige token', async () => {
  const post = body => get('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.strictEqual((await post({ tipo: 'ideia', nota: 6 })).status, 400);
  assert.strictEqual((await post({ tipo: 'xpto', nota: 3 })).status, 400);
  assert.strictEqual((await post({ tipo: 'ideia', nota: 5, comentario: 'Adicionar bairros' })).status, 201);
  assert.strictEqual((await post({ tipo: 'problema', nota: 3 })).status, 201);
  const m = await (await get('/api/metricas')).json();
  assert.strictEqual(m.feedback.total, 2);
  assert.strictEqual(m.feedback.notaMedia, 4);
  assert.strictEqual((await get('/api/feedback/exportar')).status, 401);
  const ok = await get('/api/feedback/exportar?token=segredo');
  assert.strictEqual(ok.status, 200);
  assert.ok((await ok.text()).includes('Adicionar bairros'));
});

test('segurança: arquivos sensíveis NÃO são servidos', async () => {
  for (const p of ['/.env', '/lib/app.js', '/lib/db.js', '/package.json', '/dados/demo.json', '/vercel.json']) {
    const r = await get(p);
    assert.strictEqual(r.status, 404, `${p} deveria ser 404`);
  }
  const home = await get('/');
  assert.strictEqual(home.status, 200);
  assert.ok(home.headers.get('content-security-policy'));
});
