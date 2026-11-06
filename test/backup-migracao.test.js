const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');

const db = require('../lib/db');
const { executarBackup } = require('../lib/backup');

const mem = newDb();
const { Pool } = mem.adapters.createPg();
db.usarPool(new Pool());

test('migração: historico.json antigo é importado para o Postgres e guardado como .bak (sem duplicar)', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'migra-'));
  const arq = path.join(pasta, 'historico.json');
  fs.writeFileSync(arq, JSON.stringify([
    { timestamp: Date.now() - 1000, data: '2026-10-07', area: 'Maricá', total: 3, alto: 1, medio: 1, baixo: 1, frpTotal: 40 },
    { timestamp: Date.now(), data: '2026-10-08', area: 'Maricá', total: 5, alto: 2, medio: 2, baixo: 1, frpTotal: 90 }
  ]));
  assert.strictEqual((await db.importarHistoricoJson(arq)).migrados, 2);
  assert.strictEqual(await db.contarHistorico(), 2);
  assert.ok(fs.existsSync(arq + '.bak'));
  assert.strictEqual((await db.importarHistoricoJson(arq)).migrados, 0);
  assert.strictEqual(await db.contarHistorico(), 2);
});

test('backup exporta as tabelas e mantém só os 14 mais recentes', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  for (let i = 1; i <= 20; i++) fs.mkdirSync(path.join(raiz, `2020-01-${String(i).padStart(2, '0')}_00-00-00`), { recursive: true });

  const r = await executarBackup({ db, pastaBackups: raiz });

  const pastas = fs.readdirSync(raiz).sort();
  assert.strictEqual(pastas.length, 14);
  assert.ok(!pastas.includes('2020-01-01_00-00-00'));
  const hist = JSON.parse(fs.readFileSync(path.join(r.destino, 'historico.json'), 'utf-8'));
  assert.strictEqual(hist.length, 2);
  assert.ok(fs.existsSync(path.join(r.destino, 'feedbacks.json')));
});
