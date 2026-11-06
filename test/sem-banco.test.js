
// Sem DATABASE_URL o app não pode quebrar nem apresentar focos fictícios.
const test = require('node:test');
const assert = require('node:assert');

delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.NASA_KEY = 'chave-de-teste';

const axios = require('axios');
const { app } = require('../lib/app');

test('sem banco: NASA indisponível retorna 503, status avisa e feedback falha com 500 limpo', async () => {
  axios.get = async () => {
    throw new Error('rede fora');
  };

  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));

  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // Sem NASA e sem cache, não pode inventar dados de demonstração.
    const focosResponse = await fetch(base + '/api/focos?forcar=true');
    assert.strictEqual(focosResponse.status, 503);

    const resposta = await focosResponse.text();
    assert.match(resposta, /NASA FIRMS|ausência de focos/i);

    // O status precisa informar que não existe banco conectado.
    const st = await (await fetch(base + '/api/status')).json();
    assert.strictEqual(st.bancoConectado, false);

    // Registro de visita não deve quebrar a aplicação.
    const visita = await fetch(base + '/api/visita', {
      method: 'POST'
    });
    assert.strictEqual(visita.status, 204);

    // Feedback não pode fingir que foi gravado.
    const fb = await fetch(base + '/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'ideia', nota: 5 })
    });

    assert.strictEqual(fb.status, 500);

  } finally {
    server.close();
  }
});
