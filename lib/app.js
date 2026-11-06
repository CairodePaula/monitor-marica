require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');
const pkg = require('../package.json');

let DEMO = null;
try { DEMO = require('../dados/demo.json'); } catch (e) { DEMO = null; }

const app = express();
// Atrás do proxy do Vercel: 1 salto, para req.ip refletir o visitante real.
app.set('trust proxy', 1);

// ────────────────────────────────────────────────────────────
// SEGURANÇA
// ────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org', 'https://*.basemaps.cartocdn.com', 'https://*.basemap.cartocdn.com'],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(cors());
app.use(express.json({ limit: '10kb' }));

// Rate limiting: protege a API contra abuso (60 requisições/min por IP)
const limiteApi = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { erro: 'Muitas requisições. Tente novamente em 1 minuto.' }
});
app.use('/api', limiteApi);

// Execução local: serve a pasta public/. No Vercel, public/ é servida pela CDN.
// (Só public/ é servida — nunca o projeto inteiro.)
app.use(express.static(path.join(__dirname, '..', 'public')));

const AREA_MARICA = '-43.2,-23.1,-42.6,-22.7';
const AREA_RJ = '-44.9,-23.4,-40.9,-20.7';
const VALIDADE_CACHE_MS = 30 * 60 * 1000;
const CACHE_VAZIO = () => ({ data: [], ultimaAtualizacao: null, area: 'Maricá' });

// Rotas assíncronas: qualquer erro vira JSON 500 (sem derrubar a função).
const rota = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
  console.error(`Erro em ${req.method} ${req.path}:`, err.message);
  if (!res.headersSent) res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
});

// Operações de banco "não essenciais" nunca derrubam a resposta principal.
async function seguro(rotulo, fn, padrao = null) {
  try { return await fn(); } catch (err) { console.error(`${rotulo}:`, err.message); return padrao; }
}

async function lerCache() {
  if (!db.disponivel()) return CACHE_VAZIO();
  return (await seguro('Cache indisponível', () => db.lerCache())) || CACHE_VAZIO();
}

// ────────────────────────────────────────────────────────────
// LÓGICA DE NEGÓCIO
// ────────────────────────────────────────────────────────────
function nivel(conf) {
  if (conf >= 80) return 'alto';
  if (conf >= 50) return 'medio';
  return 'baixo';
}

function estatisticas(focos) {
  return {
    total: focos.length,
    alto: focos.filter(f => nivel(f.confidence) === 'alto').length,
    medio: focos.filter(f => nivel(f.confidence) === 'medio').length,
    baixo: focos.filter(f => nivel(f.confidence) === 'baixo').length,
    frpTotal: Math.round(focos.reduce((s, f) => s + (f.frp || 0), 0))
  };
}

// Nível de alerta automático (base para alertas proativos à Defesa Civil)
function calcularAlerta(focos) {
  const e = estatisticas(focos);
  // Pontuação explicável: cada foco pesa, alto risco pesa o dobro, FRP acumulado pesa menos.
  const score = e.total + e.alto * 2 + Math.round(e.frpTotal / 50);

  let codigo, rotulo, mensagem;
  if (e.total === 0) {
    codigo = 'tranquilo';
    rotulo = 'Tranquilo';
    mensagem = 'Nenhum foco ativo detectado na área.';
  } else if (e.alto === 0 && e.total < 5) {
    codigo = 'atencao';
    rotulo = 'Atenção';
    mensagem = `${e.total} foco(s) detectado(s). Monitoramento recomendado.`;
  } else {
    codigo = 'critico';
    rotulo = 'Crítico';
    mensagem = `${e.total} focos (${e.alto} de alto risco). Acionar Defesa Civil.`;
  }
  return { codigo, rotulo, mensagem, score };
}

// Lança erro quando a NASA falha (falha nunca vira "0 focos").
async function buscarFocos(area = AREA_MARICA, dias = 1) {
  const chave = process.env.NASA_KEY;
  if (!chave) throw new Error('NASA_KEY não configurada (variável de ambiente)');
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${chave}/VIIRS_SNPP_NRT/${area}/${dias}`;

  const response = await axios.get(url, { timeout: 10000 });
  const registros = parse(response.data, { columns: true, skip_empty_lines: true });

  return registros.map(r => ({
    lat: parseFloat(r.latitude),
    lng: parseFloat(r.longitude),
    confidence: r.confidence === 'h' ? 90 : r.confidence === 'n' ? 50 : 30,
    frp: parseFloat(r.frp) || 0,
    daynight: r.daynight,
    acq_date: r.acq_date,
    acq_time: r.acq_time,
    brightness: parseFloat(r.bright_ti4) || 0
  }));
}

function respostaFocos(focos, ultimaAtualizacao, area, fonte, extra = {}) {
  return {
    focos,
    total: focos.length,
    ultimaAtualizacao,
    area,
    estatisticas: estatisticas(focos),
    alerta: calcularAlerta(focos),
    fonte,
    ...extra
  };
}

// ────────────────────────────────────────────────────────────
// ROTAS
// ────────────────────────────────────────────────────────────

// Focos + estatísticas + alerta.
// fonte: 'nasa' | 'cache' | 'cache-offline' | 'demonstracao'
app.get('/api/focos', rota(async (req, res) => {
  const agora = Date.now();
  const forcar = req.query.forcar === 'true';
  const cache = await lerCache();
  const idade = agora - (cache.ultimaAtualizacao || 0);
  const cacheValido = cache.ultimaAtualizacao && idade >= 0 && idade < VALIDADE_CACHE_MS;

  if (!forcar && cacheValido) {
    return res.json(respostaFocos(cache.data, cache.ultimaAtualizacao, cache.area, 'cache'));
  }

  try {
    console.log('Buscando dados frescos na NASA...');
    let focos = await buscarFocos(AREA_MARICA, 1);
    let area = 'Maricá';

    // Se Maricá estiver vazia, tenta o RJ inteiro
    if (focos.length === 0) {
      try {
        focos = await buscarFocos(AREA_RJ, 1);
        area = 'RJ';
      } catch (e) {
        console.error('Falha ao consultar RJ (mantendo Maricá com 0 focos):', e.message);
      }
    }

    const novo = { data: focos, ultimaAtualizacao: agora, area };
    const e = estatisticas(focos);
    const alerta = calcularAlerta(focos);
    if (db.disponivel()) {
      await seguro('Falha ao salvar cache', () => db.salvarCache(novo));
      await seguro('Falha ao registrar histórico', () => db.registrarHistorico(area, e));
      await seguro('Falha ao registrar alerta', () => db.registrarAlerta(alerta.codigo, e.total, e.alto));
    }
    return res.json(respostaFocos(focos, agora, area, 'nasa'));
  } catch (err) {
    console.error('NASA FIRMS indisponível:', err.message);

    // Contingência 1: último cache salvo (mesmo vencido) — nada é gravado no histórico
    if (cache.ultimaAtualizacao && cache.ultimaAtualizacao <= agora) {
      return res.json(respostaFocos(cache.data, cache.ultimaAtualizacao, cache.area, 'cache-offline', { aviso: 'NASA FIRMS indisponível — exibindo o último dado salvo.' }));
    }

    // Contingência 2: dados fictícios de demonstração (rotulados; nunca gravados)
    if (DEMO && Array.isArray(DEMO.focos)) {
      return res.json(respostaFocos(DEMO.focos, agora, DEMO.area || 'Maricá', 'demonstracao', { aviso: 'Sem conexão com a NASA FIRMS e sem cache: exibindo DADOS DE DEMONSTRAÇÃO.' }));
    }

    return res.status(503).json({ erro: 'Fonte de dados indisponível e sem cache.', focos: [], total: 0 });
  }
}));

// Histórico agregado por dia — alimenta o gráfico de tendência
app.get('/api/historico', rota(async (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias) || 7, 1), 60);
  const serie = db.disponivel() ? await seguro('Histórico indisponível', () => db.obterHistorico(dias), []) : [];
  res.json({ dias, serie });
}));

// Exportação do histórico (CSV/JSON) — Defesa Civil / prefeitura
app.get('/api/historico/exportar', rota(async (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias) || 60, 1), 60);
  const formato = String(req.query.formato || 'csv').toLowerCase();
  if (formato !== 'csv' && formato !== 'json') {
    return res.status(400).json({ erro: "Formato inválido. Use ?formato=csv ou ?formato=json." });
  }
  const linhas = await db.obterHistoricoCompleto(dias);

  if (formato === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="historico-incendios-marica.json"');
    return res.json(linhas);
  }

  const cabecalho = 'data,area,total,alto,medio,baixo,frpTotal,coletado_em\n';
  const corpo = linhas
    .map(h => `${h.data},${h.area},${h.total},${h.alto},${h.medio},${h.baixo},${h.frpTotal},${new Date(h.timestamp).toISOString()}`)
    .join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="historico-incendios-marica.csv"');
  res.send('\uFEFF' + cabecalho + corpo); // BOM: o Excel abre os acentos corretamente
}));

// Registro de visita: o front chama 1x ao abrir a página (no Vercel o HTML é
// servido pela CDN, então a contagem não pode ficar no servidor de arquivos).
app.post('/api/visita', rota(async (req, res) => {
  if (db.disponivel()) await seguro('Falha ao registrar acesso', () => db.registrarAcesso('/', req.ip));
  res.status(204).end();
}));

// Métricas de engajamento e retenção
app.get('/api/metricas', rota(async (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias) || 30, 1), 90);
  res.json(await db.obterMetricas(dias));
}));

// ────────────────────────────────────────────────────────────
// FEEDBACK DO PÚBLICO — versão digital das fichas "Uso do aplicativo"
// e "Problema ou ideia" do kit de campo. Sem nome e sem dados pessoais.
// ────────────────────────────────────────────────────────────
app.post('/api/feedback', rota(async (req, res) => {
  const { tipo, nota, comentario } = req.body || {};
  const notaNum = Number(nota);

  if (!db.TIPOS_FEEDBACK.includes(tipo)) {
    return res.status(400).json({ erro: `Tipo inválido. Use: ${db.TIPOS_FEEDBACK.join(', ')}.` });
  }
  if (!Number.isInteger(notaNum) || notaNum < 1 || notaNum > 5) {
    return res.status(400).json({ erro: 'A nota deve ser um número inteiro de 1 a 5.' });
  }
  const texto = typeof comentario === 'string' ? comentario.trim().slice(0, 500) : '';

  await db.registrarFeedback({ tipo, nota: notaNum, comentario: texto });
  res.status(201).json({ ok: true });
}));

// Exportação dos feedbacks: protegida por ADMIN_TOKEN (os comentários são livres)
app.get('/api/feedback/exportar', rota(async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return res.status(403).json({ erro: 'Exportação desativada: defina ADMIN_TOKEN nas variáveis de ambiente.' });
  if (req.query.token !== token) return res.status(401).json({ erro: 'Token inválido.' });

  const aspas = s => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
  const linhas = await db.obterFeedbacks();
  const csv = 'data,tipo,nota,comentario\n' +
    linhas.map(f => [f.data, f.tipo, f.nota, aspas(f.comentario)].join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="feedback-monitor-marica.csv"');
  res.send('\uFEFF' + csv);
}));

// Alerta atual (integração com Defesa Civil / push)
app.get('/api/alerta', rota(async (req, res) => {
  const cache = await lerCache();
  res.json({
    ...calcularAlerta(cache.data),
    area: cache.area,
    total: cache.data.length,
    ultimaAtualizacao: cache.ultimaAtualizacao
  });
}));

// Status: saúde da API, última atualização e banco
app.get('/api/status', rota(async (req, res) => {
  const cache = await lerCache();
  let registros = 0;
  let bancoConectado = false;
  if (db.disponivel()) {
    const n = await seguro('Banco indisponível', () => db.contarHistorico());
    if (n != null) { registros = n; bancoConectado = true; }
  }
  res.json({
    status: 'online',
    versao: pkg.version,
    ultimaAtualizacao: cache.ultimaAtualizacao,
    totalFocosEmCache: cache.data.length,
    chaveConfigurada: !!process.env.NASA_KEY,
    cachePersistido: !!cache.ultimaAtualizacao,
    bancoDeDados: bancoConectado ? 'PostgreSQL (Neon)' : 'banco indisponível',
    bancoConectado,
    esquemaBanco: db.VERSAO_ESQUEMA,
    historicoRegistros: registros
  });
}));

function iniciar(porta = process.env.PORT || 3000) {
  return app.listen(porta, () => {
    console.log(`🔥 Monitor de Incêndios - Maricá v${pkg.version} rodando em http://localhost:${porta}`);
    console.log('📡 API: /api/focos · /api/historico · /api/metricas · /api/status');
    if (!process.env.NASA_KEY) console.log('⚠️  NASA_KEY não configurada: o app usará cache/demonstração. Veja .env.example');
    if (!db.disponivel()) console.log('⚠️  DATABASE_URL não configurada: sem histórico, métricas e feedback. Veja .env.example');
  });
}

module.exports = { app, iniciar, nivel, estatisticas, calcularAlerta };
