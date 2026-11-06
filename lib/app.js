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

const AREA_RJ = '-44.9,-23.4,-40.9,-20.7'; // caixa estadual aproximada; pode incluir pequenas áreas vizinhas
const AREA_MONITORADA = 'RJ';
// Identificador versionado: invalida o cache antigo de apenas um satélite.
const CACHE_IDENTIFICADOR = 'RJ-MULTISSENSOR-24H-V2';
const VALIDADE_CACHE_MS = 15 * 60 * 1000;
const JANELA_DIAS_API = 2; // a API retorna dias UTC completos; filtramos as últimas 24h exatas
const DEMO_ATIVO = process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEMO === 'true';
const SENSORES_FIRMS = [
  { id: 'VIIRS_SNPP_NRT', label: 'VIIRS S-NPP', familia: 'VIIRS', prioridade: 3 },
  { id: 'VIIRS_NOAA20_NRT', label: 'VIIRS NOAA-20', familia: 'VIIRS', prioridade: 3 },
  { id: 'VIIRS_NOAA21_NRT', label: 'VIIRS NOAA-21', familia: 'VIIRS', prioridade: 3 },
  { id: 'MODIS_NRT', label: 'MODIS Aqua/Terra', familia: 'MODIS', prioridade: 1 }
];
const CACHE_VAZIO = () => ({ data: [], fontes: null, janela: null, ultimaAtualizacao: null, area: CACHE_IDENTIFICADOR });
let cacheVolatil = CACHE_VAZIO();

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
  if (!db.disponivel()) return cacheVolatil;
  const persistido = await seguro('Cache indisponível', () => db.lerCache());
  const candidatos = [persistido, cacheVolatil].filter(c => c && c.ultimaAtualizacao);
  if (!candidatos.length) return cacheVolatil;
  return candidatos.sort((a, b) => b.ultimaAtualizacao - a.ultimaAtualizacao)[0];
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
    mensagem = 'Nenhum foco detectado no intervalo consultado pela NASA FIRMS.';
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

// NASA FIRMS usa confidence categórica (l/n/h) no VIIRS e numérica
// (0–100) no MODIS. Convertê-las para uma escala comum evita que o MODIS
// caia incorretamente na categoria "baixo".
function normalizarConfianca(valor) {
  const bruto = String(valor == null ? '' : valor).trim().toLowerCase();
  if (bruto === 'h') return { confidence: 90, confidenceLabel: 'Alta', confidenceRaw: bruto };
  if (bruto === 'n') return { confidence: 65, confidenceLabel: 'Nominal', confidenceRaw: bruto };
  if (bruto === 'l') return { confidence: 30, confidenceLabel: 'Baixa', confidenceRaw: bruto };

  const numero = Number(bruto);
  if (bruto !== '' && Number.isFinite(numero)) {
    if (numero >= 80) return { confidence: 90, confidenceLabel: 'Alta', confidenceRaw: bruto };
    if (numero >= 30) return { confidence: 65, confidenceLabel: 'Nominal', confidenceRaw: bruto };
    return { confidence: 30, confidenceLabel: 'Baixa', confidenceRaw: bruto };
  }
  return { confidence: 50, confidenceLabel: 'Não informada', confidenceRaw: bruto || null };
}

function timestampAquisicaoUtc(data, hora) {
  const dataTexto = String(data || '').trim();
  const horaTexto = String(hora == null ? '' : hora).replace(/\D/g, '').padStart(4, '0').slice(-4);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataTexto);
  if (!m || horaTexto.length !== 4) return null;
  const ano = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
  const hh = Number(horaTexto.slice(0, 2)), mm = Number(horaTexto.slice(2, 4));
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hh > 23 || mm > 59) return null;
  return Date.UTC(ano, mes - 1, dia, hh, mm);
}

function inicioJanelaFirmsUtc(agoraMs = Date.now()) {
  // O mapa FIRMS oferece a camada 24hrs. A API retorna dias UTC completos;
  // consultamos 2 dias e filtramos aqui o intervalo móvel exato de 24 horas.
  return agoraMs - 24 * 60 * 60 * 1000;
}

function normalizarRegistroFirms(r, sensor) {
  const lat = Number(r.latitude);
  const lng = Number(r.longitude);
  const timestamp = timestampAquisicaoUtc(r.acq_date, r.acq_time);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || timestamp == null) return null;

  const confianca = normalizarConfianca(r.confidence);
  const sat = String(r.satellite || '').trim().toUpperCase();
  let satelliteLabel = sensor.label;
  if (sensor.familia === 'MODIS') {
    satelliteLabel = sat === 'A' ? 'MODIS Aqua' : sat === 'T' ? 'MODIS Terra' : 'MODIS Aqua/Terra';
  } else if (sat === 'N20') satelliteLabel = 'VIIRS NOAA-20';
  else if (sat === 'N21') satelliteLabel = 'VIIRS NOAA-21';
  else if (sat === 'N') satelliteLabel = 'VIIRS S-NPP';

  const brightness = Number(r.bright_ti4 ?? r.bright_t31 ?? r.brightness);
  return {
    lat, lng,
    ...confianca,
    frp: Number(r.frp) || 0,
    daynight: String(r.daynight || '').toUpperCase(),
    acq_date: String(r.acq_date),
    acq_time: String(r.acq_time).padStart(4, '0'),
    timestamp,
    brightness: Number.isFinite(brightness) ? brightness : 0,
    satellite: sat || sensor.id,
    sourceId: sensor.id,
    sourceLabel: satelliteLabel,
    familiaSensor: sensor.familia,
    fontes: [sensor.id],
    satellites: [satelliteLabel]
  };
}

function distanciaMetros(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad, lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Deduplicação conservadora: só une sensores diferentes com horário próximo
// e centros a até 200 m. Detecções vizinhas legítimas continuam separadas.
function removerDuplicatas(focos) {
  const ordenados = [...focos].sort((a, b) => a.timestamp - b.timestamp);
  const resultado = [];
  for (const foco of ordenados) {
    const duplicado = resultado.find(existente => {
      const plataformas = existente.satellites || [existente.sourceLabel || existente.satellite];
      const plataformaNova = (foco.satellites || [foco.sourceLabel || foco.satellite])[0];
      const fonteDiferente = existente.sourceId !== foco.sourceId || !plataformas.includes(plataformaNova);
      return fonteDiferente &&
        Math.abs(existente.timestamp - foco.timestamp) <= 20 * 60 * 1000 &&
        distanciaMetros(existente, foco) <= 200;
    });
    if (!duplicado) {
      resultado.push({
        ...foco,
        fontes: [...(foco.fontes || [foco.sourceId])],
        satellites: [...(foco.satellites || [foco.sourceLabel || foco.satellite])]
      });
      continue;
    }

    const fontes = new Set([...(duplicado.fontes || []), ...(foco.fontes || [foco.sourceId])]);
    const satellites = new Set([...(duplicado.satellites || [duplicado.sourceLabel || duplicado.satellite]), ...(foco.satellites || [foco.sourceLabel || foco.satellite])]);
    const preferirNovo = (foco.familiaSensor === 'VIIRS' && duplicado.familiaSensor !== 'VIIRS') ||
      (foco.familiaSensor === duplicado.familiaSensor && foco.confidence > duplicado.confidence);
    if (preferirNovo) {
      Object.assign(duplicado, foco);
    }
    duplicado.fontes = [...fontes];
    duplicado.satellites = [...satellites];
    duplicado.sourceCount = duplicado.satellites.length;
  }
  return resultado.sort((a, b) => b.timestamp - a.timestamp);
}

// Consulta as quatro famílias de produto usadas no mapa oficial para VIIRS e
// MODIS. Uma falha isolada não apaga os dados dos outros sensores.
async function buscarFocos(area = AREA_RJ, dias = JANELA_DIAS_API, agoraMs = Date.now()) {
  const chave = process.env.NASA_KEY;
  if (!chave) throw new Error('NASA_KEY não configurada (variável de ambiente)');

  const inicioJanela = inicioJanelaFirmsUtc(agoraMs);
  const fimJanela = agoraMs + 5 * 60 * 1000;
  const resultados = await Promise.allSettled(SENSORES_FIRMS.map(async sensor => {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${chave}/${sensor.id}/${area}/${dias}`;
    const response = await axios.get(url, { timeout: 15000 });
    const csv = String(response.data || '');
    const cabecalho = (csv.split(/\r?\n/, 1)[0] || '').replace(/^\uFEFF/, '').split(',').map(v => v.trim().toLowerCase());
    const obrigatorias = ['latitude', 'longitude', 'acq_date', 'acq_time', 'confidence', 'frp'];
    if (!obrigatorias.every(campo => cabecalho.includes(campo))) {
      throw new Error('Resposta da NASA não contém o cabeçalho CSV esperado. Verifique a chave e a disponibilidade do produto.');
    }
    const registros = parse(csv, { columns: true, skip_empty_lines: true, bom: true });
    const focos = registros
      .map(r => normalizarRegistroFirms(r, sensor))
      .filter(f => f && f.timestamp >= inicioJanela && f.timestamp <= fimJanela);
    return { sensor, registrosRecebidos: registros.length, focos };
  }));

  const fontes = [];
  const focosBrutos = [];
  const falhas = [];
  resultados.forEach((resultado, i) => {
    const sensor = SENSORES_FIRMS[i];
    if (resultado.status === 'fulfilled') {
      fontes.push({ id: sensor.id, nome: sensor.label, ok: true, registros: resultado.value.focos.length });
      focosBrutos.push(...resultado.value.focos);
    } else {
      const mensagem = resultado.reason && resultado.reason.message ? resultado.reason.message : 'falha desconhecida';
      falhas.push({ id: sensor.id, nome: sensor.label, erro: mensagem });
      fontes.push({ id: sensor.id, nome: sensor.label, ok: false, registros: 0 });
      console.error(`NASA FIRMS ${sensor.id}:`, mensagem);
    }
  });

  if (fontes.every(f => !f.ok)) {
    throw new Error(`Todos os sensores NASA FIRMS falharam: ${falhas.map(f => `${f.id}: ${f.erro}`).join('; ')}`);
  }

  const focos = removerDuplicatas(focosBrutos).map(f => ({ ...f, sourceCount: f.sourceCount || (f.satellites || []).length || 1 }));
  const janela = {
    inicioUtc: new Date(inicioJanela).toISOString(),
    fimUtc: new Date(agoraMs).toISOString(),
    descricao: 'Últimas 24 horas (horários de aquisição em UTC)'
  };
  return { focos, fontes, falhas, janela, completo: falhas.length === 0 };
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
  res.set('Cache-Control', 'no-store, max-age=0');
  const agora = Date.now();
  const forcar = req.query.forcar === 'true';
  const cache = await lerCache();
  const idade = agora - (cache.ultimaAtualizacao || 0);
  const cacheValido = cache.ultimaAtualizacao && idade >= 0 && idade < VALIDADE_CACHE_MS;
  // O identificador versionado invalida caches do coletor antigo (S-NPP apenas).
  const cacheCompativel = cache.area === CACHE_IDENTIFICADOR;

  if (!forcar && cacheValido && cacheCompativel) {
    return res.json(respostaFocos(cache.data, cache.ultimaAtualizacao, AREA_MONITORADA, 'cache', {
      fontes: cache.fontes || SENSORES_FIRMS.map(s => ({ id: s.id, nome: s.label, ok: true })),
      janela: cache.janela || null,
      sensoresEsperados: SENSORES_FIRMS.length
    }));
  }

  try {
    console.log('Consultando NASA FIRMS: RJ inteiro, VIIRS S-NPP/NOAA-20/NOAA-21 e MODIS...');
    const consulta = await buscarFocos(AREA_RJ, JANELA_DIAS_API, agora);
    const focos = consulta.focos;
    const e = estatisticas(focos);
    const alerta = calcularAlerta(focos);
    const extras = {
      fontes: consulta.fontes,
      falhasFontes: consulta.falhas,
      janela: consulta.janela,
      sensoresEsperados: SENSORES_FIRMS.length,
      aviso: consulta.completo ? null : `Consulta parcial: ${consulta.falhas.map(f => f.nome).join(', ')} indisponível(is).`,
      alerta: consulta.completo ? alerta : (focos.length === 0
        ? { codigo: 'indisponivel', rotulo: 'Dados parciais', mensagem: `Nenhum foco nos sensores que responderam, mas ${consulta.falhas.length} sensor(es) não respondeu(ram). Não é possível concluir que não há focos na área.` }
        : { ...alerta, codigo: alerta.codigo === 'critico' ? 'critico' : 'atencao', rotulo: alerta.codigo === 'critico' ? 'Crítico' : 'Atenção', mensagem: `${alerta.mensagem} Consulta parcial: ${consulta.falhas.map(f => f.nome).join(', ')} indisponível(is).` })
    };

    // Só persistimos um cache completo: um retorno parcial não deve parecer
    // uma fotografia integral do estado nas próximas chamadas.
    if (consulta.completo) {
      const novo = {
        data: focos,
        fontes: consulta.fontes,
        janela: consulta.janela,
        ultimaAtualizacao: agora,
        area: CACHE_IDENTIFICADOR
      };
      // Cache em memória também protege execuções locais sem PostgreSQL.
      cacheVolatil = novo;
      if (db.disponivel()) {
        await seguro('Falha ao salvar cache', () => db.salvarCache(novo));
        await seguro('Falha ao registrar histórico', () => db.registrarHistorico(AREA_MONITORADA, e));
        await seguro('Falha ao registrar alerta', () => db.registrarAlerta(alerta.codigo, e.total, e.alto));
      }
    }
    return res.json(respostaFocos(focos, agora, AREA_MONITORADA, 'nasa', extras));
  } catch (err) {
    console.error('NASA FIRMS indisponível:', err.message);

    if (cacheCompativel && cache.ultimaAtualizacao && cache.ultimaAtualizacao <= agora) {
      return res.json(respostaFocos(cache.data, cache.ultimaAtualizacao, AREA_MONITORADA, 'cache-offline', {
        fontes: cache.fontes || SENSORES_FIRMS.map(s => ({ id: s.id, nome: s.label, ok: true })),
        janela: cache.janela || null,
        sensoresEsperados: SENSORES_FIRMS.length,
        aviso: 'NASA FIRMS indisponível — exibindo o último conjunto multissensor estadual salvo.'
      }));
    }

    // Demonstração só pode ser ativada explicitamente. Nunca converter falha
    // da NASA em zero focos ou em dados fictícios sem sinalização.
    if (DEMO_ATIVO && DEMO && Array.isArray(DEMO.focos)) {
      return res.json(respostaFocos(DEMO.focos, agora, DEMO.area || 'Demonstração', 'demonstracao', {
        aviso: 'DADOS DE DEMONSTRAÇÃO — não representam focos atuais.'
      }));
    }

    return res.status(503).json({
      erro: 'NASA FIRMS indisponível e sem cache estadual multissensor compatível.',
      fonte: 'indisponivel',
      area: AREA_MONITORADA,
      focos: [],
      total: 0,
      ultimaAtualizacao: null,
      sensoresEsperados: SENSORES_FIRMS.length,
      alerta: { codigo: 'indisponivel', rotulo: 'Sem dados', mensagem: 'Não foi possível consultar a NASA FIRMS. Não interprete isso como ausência de focos.' }
    });
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
  res.set('Cache-Control', 'no-store, max-age=0');
  const cache = await lerCache();
  if (cache.area !== CACHE_IDENTIFICADOR || !cache.ultimaAtualizacao) {
    return res.status(503).json({ codigo: 'indisponivel', rotulo: 'Sem dados', mensagem: 'Ainda não há uma coleta estadual multissensor válida.' });
  }
  res.json({
    ...calcularAlerta(cache.data),
    area: cache.area === CACHE_IDENTIFICADOR ? AREA_MONITORADA : cache.area,
    total: cache.data.length,
    ultimaAtualizacao: cache.ultimaAtualizacao
  });
}));

// Status: saúde da API, última atualização e banco
app.get('/api/status', rota(async (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
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
    cachePersistido: bancoConectado && !!cache.ultimaAtualizacao && cache.area === CACHE_IDENTIFICADOR,
    cacheEmMemoria: !!cache.ultimaAtualizacao && cache.area === CACHE_IDENTIFICADOR,
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
    if (!process.env.NASA_KEY) console.log('⚠️  NASA_KEY não configurada: novas consultas à NASA não funcionarão; apenas cache estadual compatível poderá ser exibido. Veja .env.example');
    if (!db.disponivel()) console.log('⚠️  DATABASE_URL não configurada: sem histórico, métricas e feedback. Veja .env.example');
  });
}

module.exports = { app, iniciar, nivel, estatisticas, calcularAlerta, normalizarConfianca, timestampAquisicaoUtc, inicioJanelaFirmsUtc, removerDuplicatas, buscarFocos, SENSORES_FIRMS };
