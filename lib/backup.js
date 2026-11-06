// Backup: exporta todas as tabelas para backups/AAAA-MM-DD_HH-MM-SS/*.json
// e mantém só os 14 backups mais recentes.
const fs = require('fs');
const path = require('path');

const RETENCAO = 14;

function carimboData(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function executarBackup({ db, pastaBackups }) {
  const tabelas = await db.exportarTudo();
  const destino = path.join(pastaBackups, carimboData());
  fs.mkdirSync(destino, { recursive: true });

  for (const [nome, linhas] of Object.entries(tabelas)) {
    fs.writeFileSync(path.join(destino, `${nome}.json`), JSON.stringify(linhas, null, 2));
  }

  // Retenção: só os 14 mais recentes (nomes ordenam cronologicamente)
  const pastas = fs.readdirSync(pastaBackups).sort();
  const excesso = pastas.length - RETENCAO;
  let removidos = 0;
  if (excesso > 0) {
    for (const antiga of pastas.slice(0, excesso)) {
      fs.rmSync(path.join(pastaBackups, antiga), { recursive: true, force: true });
      removidos++;
    }
  }
  return { destino, tabelas: Object.keys(tabelas).length, removidos };
}

module.exports = { executarBackup, RETENCAO };
