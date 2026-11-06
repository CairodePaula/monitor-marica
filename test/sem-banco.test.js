// Sem DATABASE_URL o app não pode quebrar: abre com demonstração e avisa no status.
const test = require('node:test');
const assert = require('node:assert');

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.NASA_KEY = 'chave-de-teste';

const axios = require('axios');
const { app } = require('../lib/app');

test('sem banco: /api/focos responde (demonstração), status avisa e feedback falha com 500 limpo', async () => {
  axios.get = async () => { throw new Error('rede fora'); };
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const j = await (await fetch(base + '/api/focos?forcar=true')).json();
    assert.strictEqual(j.fonte, 'demonstracao');
    const st = await (await fetch(base + '/api/status')).json();
    assert.strictEqual(st.bancoConectado, false);
    assert.strictEqual((await fetch(base + '/api/visita', { method: 'POST' })).status, 204);
    const fb = await fetch(base + '/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo: 'ideia', nota: 5 }) });
    assert.strictEqual(fb.status, 500);
  } finally {
    server.close();
  }
});
