// Uso:  npm run backup   (exige DATABASE_URL)
// O Neon também mantém restauração a um ponto no tempo no próprio painel.
require('dotenv').config();
const path = require('path');
const db = require('../lib/db');
const { executarBackup, RETENCAO } = require('../lib/backup');

const pasta = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

executarBackup({ db, pastaBackups: pasta })
  .then(r => {
    console.log(`✅ Backup criado em: ${r.destino} (${r.tabelas} tabelas)`);
    if (r.removidos) console.log(`🧹 Removidos ${r.removidos} backup(s) antigo(s) (mantendo os ${RETENCAO} mais recentes).`);
  })
  .catch(err => { console.error('❌ Falha no backup:', err.message); process.exitCode = 1; })
  .finally(() => db.fechar());
