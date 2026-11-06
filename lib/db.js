// ────────────────────────────────────────────────────────────
// BANCO DE DADOS (PostgreSQL / Neon) — usado na publicação web (Vercel).
//
// No Vercel o disco é temporário, então o SQLite em arquivo deixou de servir:
// os dados agora ficam num Postgres gerenciado (Neon). A conexão vem da
// variável de ambiente DATABASE_URL (a integração Neon do Vercel já cria).
//
// Tabelas:
//  - historico   : 1 linha por coleta real na NASA
//  - acessos     : 1 linha por visita à página (IP anonimizado — LGPD)
//  - alertas_log : 1 linha por mudança de nível de alerta (auditoria)
//  - feedbacks   : avaliações/ideias enviadas pelo público
//  - cache_focos : último resultado da NASA (substitui o cache.json em disco)
//  - meta        : versão do esquema do banco
// ────────────────────────────────────────────────────────────

const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');

const VERSAO_ESQUEMA = 3;
const DIA_MS = 24 * 60 * 60 * 1000;

let _pool = null;
let _pronto = null;

function urlBanco() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function disponivel() {
  return !!_pool || !!urlBanco();
}

function pool() {
  if (_pool) return _pool;
  const url = urlBanco();
  if (!url) throw new Error('DATABASE_URL não configurada (conecte o banco Neon ao projeto no Vercel).');
  _pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 });
  _pool.on('error', e => console.error('Erro no pool do Postgres:', e.message));
  return _pool;
}

// Usado nos testes (pg-mem) para trocar o pool.
function usarPool(p) {
  _pool = p;
  _pronto = null;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS historico (
    id SERIAL PRIMARY KEY,
    ts BIGINT NOT NULL,
    data TEXT NOT NULL,
    area TEXT NOT NULL,
    total INTEGER NOT NULL,
    alto INTEGER NOT NULL,
    medio INTEGER NOT NULL,
    baixo INTEGER NOT NULL,
    frp_total DOUBLE PRECISION NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS acessos (
    id SERIAL PRIMARY KEY,
    ts BIGINT NOT NULL,
    data TEXT NOT NULL,
    rota TEXT NOT NULL,
    ip TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS alertas_log (
    id SERIAL PRIMARY KEY,
    ts BIGINT NOT NULL,
    codigo TEXT NOT NULL,
    total INTEGER NOT NULL,
    alto INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS feedbacks (
    id SERIAL PRIMARY KEY,
    ts BIGINT NOT NULL,
    data TEXT NOT NULL,
    tipo TEXT NOT NULL,
    nota INTEGER NOT NULL,
    comentario TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS cache_focos (
    id INTEGER PRIMARY KEY,
    ultima_atualizacao BIGINT NOT NULL,
    area TEXT NOT NULL,
    dados TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_historico_ts ON historico(ts)`,
  `CREATE INDEX IF NOT EXISTS idx_acessos_ts ON acessos(ts)`,
  `CREATE INDEX IF NOT EXISTS idx_feedbacks_ts ON feedbacks(ts)`
];

function garantirEsquema() {
  if (!_pronto) {
    _pronto = (async () => {
      const p = pool();
      for (const sql of DDL) await p.query(sql);
      await p.query(
        `INSERT INTO meta (chave, valor) VALUES ('versao_esquema', $1)
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
        [String(VERSAO_ESQUEMA)]
      );
    })().catch(e => { _pronto = null; throw e; });
  }
  return _pronto;
}

async function q(texto, params = []) {
  await garantirEsquema();
  return pool().query(texto, params);
}

const hoje = () => new Date().toISOString().slice(0, 10);

// ────────────────────────────────────────────────────────────
// Cache da NASA (sobrevive a reinício/cold start e serve de contingência)
// ────────────────────────────────────────────────────────────
async function lerCache() {
  const { rows } = await q('SELECT ultima_atualizacao, area, dados FROM cache_focos WHERE id = 1');
  if (!rows.length) return null;
  return {
    data: JSON.parse(rows[0].dados),
    ultimaAtualizacao: Number(rows[0].ultima_atualizacao),
    area: rows[0].area
  };
}

async function salvarCache(cache) {
  await q(
    `INSERT INTO cache_focos (id, ultima_atualizacao, area, dados) VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET ultima_atualizacao = EXCLUDED.ultima_atualizacao, area = EXCLUDED.area, dados = EXCLUDED.dados`,
    [cache.ultimaAtualizacao, cache.area, JSON.stringify(cache.data)]
  );
}

// ────────────────────────────────────────────────────────────
// Histórico
// ────────────────────────────────────────────────────────────
async function registrarHistorico(area, e) {
  const agora = Date.now();
  await q(
    `INSERT INTO historico (ts, data, area, total, alto, medio, baixo, frp_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [agora, hoje(), area, e.total, e.alto, e.medio, e.baixo, e.frpTotal]
  );
  // Mantém só os últimos 60 dias
  await q('DELETE FROM historico WHERE ts < $1', [agora - 60 * DIA_MS]);
}

const linhaHistorico = r => ({
  id: r.id,
  timestamp: Number(r.ts),
  data: r.data,
  area: r.area,
  total: Number(r.total),
  alto: Number(r.alto),
  medio: Number(r.medio),
  baixo: Number(r.baixo),
  frpTotal: Number(r.frp_total)
});

async function obterHistoricoCompleto(dias = 60) {
  const corte = Date.now() - dias * DIA_MS;
  const { rows } = await q('SELECT * FROM historico WHERE ts >= $1 ORDER BY ts ASC', [corte]);
  return rows.map(linhaHistorico);
}

async function obterHistorico(dias = 7) {
  const linhas = await obterHistoricoCompleto(dias);
  // Agrega por dia: pico de focos no dia + pico de alto risco
  const porDia = {};
  for (const h of linhas) {
    if (!porDia[h.data]) porDia[h.data] = { data: h.data, total: 0, alto: 0, frpTotal: 0 };
    porDia[h.data].total = Math.max(porDia[h.data].total, h.total);
    porDia[h.data].alto = Math.max(porDia[h.data].alto, h.alto);
    porDia[h.data].frpTotal = Math.max(porDia[h.data].frpTotal, h.frpTotal);
  }
  return Object.values(porDia).sort((a, b) => a.data.localeCompare(b.data));
}

async function contarHistorico() {
  const { rows } = await q('SELECT COUNT(*) AS n FROM historico');
  return Number(rows[0].n);
}

// ────────────────────────────────────────────────────────────
// Acessos (LGPD: nunca guardamos o IP puro — só um hash com sal)
// ────────────────────────────────────────────────────────────
function anonimizarIp(ip) {
  if (!ip) return null;
  const sal = process.env.IP_SALT || 'monitor-marica';
  return crypto.createHash('sha256').update(sal + '|' + ip).digest('hex').slice(0, 16);
}

async function registrarAcesso(rota, ip) {
  await q('INSERT INTO acessos (ts, data, rota, ip) VALUES ($1, $2, $3, $4)',
    [Date.now(), hoje(), rota, anonimizarIp(ip)]);
}

async function registrarAlerta(codigo, total, alto) {
  // Só registra se mudou desde o último log (evita poluir a tabela)
  const { rows } = await q('SELECT codigo FROM alertas_log ORDER BY ts DESC, id DESC LIMIT 1');
  if (rows.length && rows[0].codigo === codigo) return;
  await q('INSERT INTO alertas_log (ts, codigo, total, alto) VALUES ($1, $2, $3, $4)',
    [Date.now(), codigo, total, alto]);
}

// ────────────────────────────────────────────────────────────
// Feedback do público
// ────────────────────────────────────────────────────────────
const TIPOS_FEEDBACK = ['elogio', 'problema', 'ideia'];

async function registrarFeedback({ tipo, nota, comentario }) {
  await q('INSERT INTO feedbacks (ts, data, tipo, nota, comentario) VALUES ($1, $2, $3, $4, $5)',
    [Date.now(), hoje(), tipo, nota, comentario || null]);
}

async function obterFeedbacks(dias = 365) {
  const corte = Date.now() - dias * DIA_MS;
  const { rows } = await q('SELECT * FROM feedbacks WHERE ts >= $1 ORDER BY ts ASC', [corte]);
  return rows.map(f => ({ id: f.id, timestamp: Number(f.ts), data: f.data, tipo: f.tipo, nota: Number(f.nota), comentario: f.comentario }));
}

async function resumoFeedbacks(dias = 365) {
  const corte = Date.now() - dias * DIA_MS;
  const { rows } = await q('SELECT COUNT(*) AS total, AVG(nota) AS media FROM feedbacks WHERE ts >= $1', [corte]);
  const media = rows[0].media == null ? null : Number(rows[0].media);
  return { total: Number(rows[0].total), notaMedia: media == null ? null : Math.round(media * 10) / 10 };
}

// ────────────────────────────────────────────────────────────
// Métricas de engajamento e retenção
// ────────────────────────────────────────────────────────────
async function obterMetricas(dias = 30) {
  const corte = Date.now() - dias * DIA_MS;

  const tot = (await q('SELECT COUNT(*) AS acessos, COUNT(DISTINCT ip) AS unicos FROM acessos WHERE ts >= $1', [corte])).rows[0];
  const totalAcessos = Number(tot.acessos);
  const visitantesUnicos = Number(tot.unicos);

  const acessosPorDia = (await q(
    `SELECT data, COUNT(*) AS visitas, COUNT(DISTINCT ip) AS unicos
     FROM acessos WHERE ts >= $1 GROUP BY data ORDER BY data ASC`, [corte]
  )).rows.map(r => ({ data: r.data, visitas: Number(r.visitas), unicos: Number(r.unicos) }));

  // Engajamento: dias com pelo menos 1 acesso vs total de dias do período
  const diasComAcesso = acessosPorDia.length;
  const taxaRetencaoDias = dias > 0 ? Math.round((diasComAcesso / dias) * 100) : 0;

  // Retenção real: visitantes que voltaram em mais de um dia distinto
  const pares = (await q('SELECT DISTINCT ip, data FROM acessos WHERE ts >= $1 AND ip IS NOT NULL', [corte])).rows;
  const diasPorIp = {};
  for (const p of pares) (diasPorIp[p.ip] = diasPorIp[p.ip] || new Set()).add(p.data);
  const visitantesRecorrentes = Object.values(diasPorIp).filter(s => s.size > 1).length;
  const taxaRetorno = visitantesUnicos > 0 ? Math.round((visitantesRecorrentes / visitantesUnicos) * 100) : 0;

  const alertasRecentes = (await q(
    'SELECT * FROM alertas_log WHERE ts >= $1 ORDER BY ts DESC, id DESC LIMIT 20', [corte]
  )).rows.map(a => ({ id: a.id, timestamp: Number(a.ts), codigo: a.codigo, total: Number(a.total), alto: Number(a.alto) }));

  return {
    periodo_dias: dias,
    totalAcessos,
    visitantesUnicos,
    diasComAcesso,
    taxaRetencaoDias,
    visitantesRecorrentes,
    taxaRetorno,
    feedback: await resumoFeedbacks(dias),
    acessosPorDia,
    alertasRecentes
  };
}

// ────────────────────────────────────────────────────────────
// Backup (exportação completa das tabelas) e importação do JSON legado
// ────────────────────────────────────────────────────────────
async function exportarTudo() {
  const tabelas = ['historico', 'acessos', 'alertas_log', 'feedbacks', 'cache_focos', 'meta'];
  const saida = {};
  for (const t of tabelas) saida[t] = (await q(`SELECT * FROM ${t}`)).rows;
  return saida;
}

// Importa o antigo historico.json (versões 1.0–1.2) se a tabela estiver vazia.
async function importarHistoricoJson(arquivo) {
  if ((await contarHistorico()) > 0 || !fs.existsSync(arquivo)) return { migrados: 0 };
  const antigo = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
  fs.copyFileSync(arquivo, arquivo + '.bak');
  for (const h of antigo) {
    await q(
      `INSERT INTO historico (ts, data, area, total, alto, medio, baixo, frp_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [h.timestamp, h.data, h.area, h.total, h.alto, h.medio, h.baixo, h.frpTotal || 0]
    );
  }
  return { migrados: antigo.length };
}

async function fechar() {
  if (_pool) { await _pool.end(); _pool = null; _pronto = null; }
}

module.exports = {
  disponivel,
  pool,
  usarPool,
  lerCache,
  salvarCache,
  registrarHistorico,
  obterHistorico,
  obterHistoricoCompleto,
  contarHistorico,
  registrarAcesso,
  registrarAlerta,
  registrarFeedback,
  obterFeedbacks,
  resumoFeedbacks,
  obterMetricas,
  exportarTudo,
  importarHistoricoJson,
  anonimizarIp,
  fechar,
  TIPOS_FEEDBACK,
  VERSAO_ESQUEMA
};
