# 🔥 Monitor de Incêndios - Maricá — v1.4.0 (publicação web: Vercel + Neon)

## 📦 O que é preciso
- Conta no **Vercel** (grátis) e no **GitHub**.
- Banco **Neon** (PostgreSQL grátis), conectado pelo próprio Vercel.
- Chave da **NASA FIRMS** (grátis): https://firms.modaps.eosdis.nasa.gov/api/map_key/
- Para rodar no PC (opcional): Node.js 20 ou superior.

## 📁 Estrutura
```
monitor-marica/
├── api/index.js        entrada da função serverless do Vercel
├── lib/app.js          API REST, cache, alertas, contingência
├── lib/db.js           PostgreSQL (Neon): tabelas, métricas, feedback
├── lib/backup.js       lógica do backup
├── public/             index.html e app.js (servidos pela CDN)
├── dados/demo.json     focos fictícios do modo demonstração
├── scripts/            backup.js e servidor-local.js
├── test/               testes automatizados (npm test)
├── vercel.json         rotas, CSP e tempo máximo da função
├── .env.example        variáveis de ambiente
```

## 🔑 Variáveis de ambiente (Vercel → Settings → Environment Variables)
| Variável | Para quê |
|---|---|
| `NASA_KEY` | Chave da NASA FIRMS (obrigatória para dados reais) |
| `DATABASE_URL` | Criada sozinha pela integração Neon |
| `ADMIN_TOKEN` | Opcional: libera `/api/feedback/exportar?token=...` |
| `IP_SALT` | Opcional: sal para anonimizar o IP (LGPD) |

> ⚠️ Nunca publique `.env` nem escreva a chave em documentos.

## ▶️ Rodar no PC (opcional)
```bash
npm install
cp .env.example .env     # preencha NASA_KEY e DATABASE_URL (a do Neon serve)
npm start                # http://localhost:3000
npm test                 # 12 testes (não precisam de internet nem de banco)
npm run backup           # exporta as tabelas para backups/ (mantém 14)
```

## 🔌 Rotas da API
| Rota | O que retorna |
|---|---|
| `GET /api/focos[?forcar=true]` | Focos, estatísticas, alerta e `fonte` (nasa, cache, cache-offline, demonstracao) |
| `GET /api/historico?dias=7` | Série diária para o gráfico |
| `GET /api/historico/exportar?formato=csv\|json` | Histórico para download |
| `POST /api/visita` | Registra uma visita (IP anonimizado) |
| `GET /api/metricas?dias=30` | Acessos, visitantes, retenção, retorno e feedback |
| `POST /api/feedback` | Registra {tipo, nota 1–5, comentario} |
| `GET /api/feedback/exportar?token=…` | CSV dos feedbacks (exige ADMIN_TOKEN) |
| `GET /api/alerta` | Nível de alerta atual |
| `GET /api/status` | Versão, cache, banco e total de coletas |
