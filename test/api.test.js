// Testes da API (node:test + pg-mem: PostgreSQL em memória).
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
const {
  app, calcularAlerta, nivel, normalizarConfianca,
  timestampAquisicaoUtc, inicioJanelaFirmsUtc, buscarFocos, SENSORES_FIRMS
} = require('../lib/app');

function instanteAquisicao(minutosAtras = 45) {
  const d = new Date(Date.now() - minutosAtras * 60 * 1000);
  return {
    data: d.toISOString().slice(0, 10),
    hora: `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`
  };
}

function csvSensor(sensor, options = {}) {
  const { data, hora } = instanteAquisicao(options.minutosAtras ?? 45);
  const lat = options.lat ?? -22.91;
  const lng = options.lng ?? -42.82;
  const confianca = options.confidence ?? ({
    VIIRS_SNPP_NRT: 'h', VIIRS_NOAA20_NRT: 'n', VIIRS_NOAA21_NRT: 'l', MODIS_NRT: '85'
  }[sensor]);
  if (sensor === 'MODIS_NRT') {
    return [
      'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight',
      `${lat},${lng},340,1,1,${data},${hora},A,MODIS,${confianca},6.1NRT,300,55.2,D`
    ].join('\n');
  }
  const satellite = ({ VIIRS_SNPP_NRT: 'N', VIIRS_NOAA20_NRT: 'N20', VIIRS_NOAA21_NRT: 'N21' })[sensor];
  return [
    'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
    `${lat},${lng},340,0.4,0.4,${data},${hora},${satellite},VIIRS,${confianca},2.0NRT,300,55.2,D`
  ].join('\n');
}

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

test('normaliza confiança VIIRS categórica e MODIS numérica', () => {
  assert.strictEqual(normalizarConfianca('h').confidenceLabel, 'Alta');
  assert.strictEqual(normalizarConfianca('n').confidenceLabel, 'Nominal');
  assert.strictEqual(normalizarConfianca('l').confidenceLabel, 'Baixa');
  assert.strictEqual(normalizarConfianca('85').confidenceLabel, 'Alta');
  assert.strictEqual(normalizarConfianca('55').confidenceLabel, 'Nominal');
  assert.strictEqual(normalizarConfianca('15').confidenceLabel, 'Baixa');
});

test('janela FIRMS cobre exatamente as últimas 24 horas', () => {
  const agora = Date.UTC(2026, 10, 6, 18, 33, 0);
  assert.strictEqual(new Date(inicioJanelaFirmsUtc(agora)).toISOString(), '2026-11-05T18:33:00.000Z');
  assert.strictEqual(timestampAquisicaoUtc('2026-11-06', '1533'), Date.UTC(2026, 10, 6, 15, 33));
});

test('descarta registros fora da janela móvel de 24 horas', async () => {
  axios.get = async url => {
    const sensor = SENSORES_FIRMS.find(s => url.includes(`/${s.id}/`));
    const dentro = csvSensor(sensor.id, { minutosAtras: 60 });
    const fora = csvSensor(sensor.id, { minutosAtras: 25 * 60 }).split('\n')[1];
    return { data: `${dentro}\n${fora}` };
  };
  const resultado = await buscarFocos(undefined, 2, Date.now());
  assert.strictEqual(resultado.focos.length, 1);
  assert.strictEqual(resultado.focos[0].timestamp >= Date.now() - 24 * 60 * 60 * 1000, true);
});

test('resposta que não é CSV válido da NASA é tratada como falha, não como zero focos', async () => {
  axios.get = async () => ({ data: 'Internal Server Error' });
  await assert.rejects(() => buscarFocos(undefined, 2, Date.now()), /Todos os sensores NASA FIRMS falharam/);
});

test('NASA indisponível sem cache → 503, nunca anuncia zero focos', async () => {
  axios.get = async () => { throw new Error('rede fora'); };
  const r = await get('/api/focos?forcar=true');
  const j = await r.json();
  assert.strictEqual(r.status, 503);
  assert.strictEqual(j.fonte, 'indisponivel');
  assert.match(j.alerta.mensagem, /não significa que não existam focos/i);
});

test('consulta 4 sensores, consulta 2 dias e consolida detecção duplicada', async () => {
  const urls = [];
  axios.get = async url => {
    urls.push(url);
    const sensor = SENSORES_FIRMS.find(s => url.includes(`/${s.id}/`));
    return { data: csvSensor(sensor.id) };
  };
  const r = await get('/api/focos?forcar=true');
  const j = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(urls.length, 4);
  for (const source of ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT']) {
    assert.ok(urls.some(url => url.includes(`/${source}/-44.9,-23.4,-40.9,-20.7/2`)), `consulta ausente: ${source}`);
  }
  assert.strictEqual(j.area, 'RJ');
  assert.strictEqual(j.fonte, 'nasa');
  assert.strictEqual(j.fontes.filter(f => f.ok).length, 4);
  assert.strictEqual(j.sensoresEsperados, 4);
  assert.strictEqual(j.total, 1);
  assert.strictEqual(j.focos[0].sourceCount, 4);
  assert.strictEqual(j.focos[0].confidenceLabel, 'Alta');
  assert.strictEqual(j.estatisticas.alto, 1);
  assert.strictEqual(j.alerta.codigo, 'critico');
  assert.strictEqual(j.janela.descricao, 'Últimas 24 horas (horários de aquisição em UTC)');
  const st = await (await get('/api/status')).json();
  assert.strictEqual(st.cachePersistido, true);
});

test('segunda chamada usa cache multissensor por 15 minutos', async () => {
  axios.get = async () => { throw new Error('não deveria chamar'); };
  const j = await (await get('/api/focos')).json();
  assert.strictEqual(j.fonte, 'cache');
  assert.strictEqual(j.total, 1);
  assert.strictEqual(j.fontes.length, 4);
});

test('falha isolada de sensor retorna parcial com aviso, sem gravar cache completo', async () => {
  axios.get = async url => {
    if (url.includes('/VIIRS_NOAA21_NRT/')) throw new Error('sensor temporariamente indisponível');
    const sensor = SENSORES_FIRMS.find(s => url.includes(`/${s.id}/`));
    return { data: csvSensor(sensor.id) };
  };
  const j = await (await get('/api/focos?forcar=true')).json();
  assert.strictEqual(j.fonte, 'nasa');
  assert.strictEqual(j.fontes.filter(f => f.ok).length, 3);
  assert.strictEqual(j.falhasFontes.length, 1);
  assert.match(j.aviso, /consulta parcial/i);
});

test('resposta parcial sem detecções não classifica a área como tranquila', async () => {
  axios.get = async url => {
    if (url.includes('/VIIRS_NOAA21_NRT/')) throw new Error('sensor indisponível');
    const sensor = SENSORES_FIRMS.find(s => url.includes(`/${s.id}/`));
    const header = sensor.id === 'MODIS_NRT'
      ? 'latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight'
      : 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
    return { data: header + '\n' };
  };
  const j = await (await get('/api/focos?forcar=true')).json();
  assert.strictEqual(j.total, 0);
  assert.strictEqual(j.alerta.codigo, 'indisponivel');
  assert.match(j.alerta.mensagem, /não é possível concluir/i);
});

test('NASA cai depois de ter cache estadual → cache-offline', async () => {
  axios.get = async () => { throw new Error('rede fora'); };
  const j = await (await get('/api/focos?forcar=true')).json();
  assert.strictEqual(j.fonte, 'cache-offline');
  assert.strictEqual(j.total, 1);
  assert.strictEqual(j.fontes.length, 4);
});

test('exportação CSV e JSON', async () => {
  const csv = await (await get('/api/historico/exportar?formato=csv')).text();
  assert.ok(csv.includes('data,area,total,alto,medio,baixo,frpTotal,coletado_em'));
  assert.strictEqual(csv.trim().split('\n').length, 2);
  const j = await (await get('/api/historico/exportar?formato=json')).json();
  assert.strictEqual(j.length, 1);
  assert.strictEqual(j[0].total, 1);
  const ruim = await get('/api/historico/exportar?formato=xml');
  assert.strictEqual(ruim.status, 400);
  const h = await (await get('/api/historico?dias=7')).json();
  assert.strictEqual(h.serie.length, 1);
});

test('métricas registram visita e anonimizam IP', async () => {
  assert.strictEqual((await get('/api/visita', { method: 'POST' })).status, 204);
  const m = await (await get('/api/metricas')).json();
  assert.ok(m.totalAcessos >= 1);
  assert.strictEqual(m.visitantesUnicos, 1);
  const { rows } = await db.pool().query('SELECT ip FROM acessos LIMIT 1');
  assert.match(rows[0].ip, /^[0-9a-f]{16}$/);
});

test('feedback valida e grava; exportação exige token', async () => {
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

test('segurança: arquivos sensíveis não são servidos', async () => {
  for (const p of ['/.env', '/lib/app.js', '/lib/db.js', '/package.json', '/dados/demo.json', '/vercel.json']) {
    const r = await get(p);
    assert.strictEqual(r.status, 404, `${p} deveria ser 404`);
  }
  const home = await get('/');
  assert.strictEqual(home.status, 200);
  assert.ok(home.headers.get('content-security-policy'));
});

test('cache antigo de uma fonte é ignorado e a coleta multissensor é refeita', async () => {
  await db.salvarCache({
    data: [{ lat: -22.92, lng: -42.82, confidence: 90, frp: 10 }],
    ultimaAtualizacao: Date.now(),
    area: 'RJ'
  });
  let chamadas = 0;
  axios.get = async url => {
    chamadas += 1;
    const sensor = SENSORES_FIRMS.find(s => url.includes(`/${s.id}/`));
    return { data: csvSensor(sensor.id) };
  };
  const j = await (await get('/api/focos')).json();
  assert.strictEqual(chamadas, 4);
  assert.strictEqual(j.area, 'RJ');
  assert.strictEqual(j.fonte, 'nasa');
  assert.strictEqual(j.fontes.filter(f => f.ok).length, 4);
});
