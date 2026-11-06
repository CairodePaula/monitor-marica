# 🔥 Monitor de Incêndios - Maricá — v1.4.2 (publicação web: Vercel + Neon)

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
├── dados/demo.json     focos fictícios para testes locais opcionais
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
| `ENABLE_DEMO` | Opcional: habilita dados fictícios somente em ambiente local (nunca em `NODE_ENV=production`) |

> ⚠️ Nunca publique `.env` nem escreva a chave em documentos.

## ▶️ Rodar no PC (opcional)
```bash
npm install
cp .env.example .env     # preencha NASA_KEY e DATABASE_URL (a do Neon serve)
npm start                # http://localhost:3000
npm test                 # testes automatizados (NASA simulada + PostgreSQL em memória)
npm run backup           # exporta as tabelas para backups/ (mantém 14)
```

## 🔌 Rotas da API
| Rota | O que retorna |
|---|---|
| `GET /api/focos[?forcar=true]` | Focos do RJ via VIIRS S-NPP/NOAA-20/NOAA-21 + MODIS, estatísticas, alerta e estado de cada sensor |
| `GET /api/historico?dias=7` | Série diária para o gráfico |
| `GET /api/historico/exportar?formato=csv\|json` | Histórico para download |
| `POST /api/visita` | Registra uma visita (IP anonimizado) |
| `GET /api/metricas?dias=30` | Acessos, visitantes, retenção, retorno e feedback |
| `POST /api/feedback` | Registra {tipo, nota 1–5, comentario} |
| `GET /api/feedback/exportar?token=…` | CSV dos feedbacks (exige ADMIN_TOKEN) |
| `GET /api/alerta` | Nível de alerta atual |
| `GET /api/status` | Versão, cache, banco e total de coletas |

## Coleta multissensor NASA FIRMS

- Consulta `VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT` e `MODIS_NRT` no retângulo geográfico que abrange o RJ.
- Busca 2 dias UTC completos e filtra o intervalo móvel exato das últimas 24 horas com base no horário de aquisição UTC.
- A deduplicação é conservadora: consolida fontes diferentes quando a detecção ocorre em até 20 minutos e 200 metros; detecções próximas que não satisfazem ambos os critérios ficam preservadas.
- A confiança VIIRS categórica (`l`, `n`, `h`) e a confiança MODIS numérica são normalizadas para os filtros de risco do app; o valor original também é mantido para exibição.
- Falha isolada de sensor gera resposta parcial explícita. Respostas parciais não substituem o cache integral e nunca geram estado `Tranquilo` quando a contagem é zero.
- Falha de todos os sensores sem cache multissensor retorna HTTP 503; a interface informa indisponibilidade, não zero focos. Dados fictícios só são ativados deliberadamente por `ENABLE_DEMO=true`.
- O cache é versionado para descartar dados antigos que consultavam apenas S-NPP, e expira em 15 minutos.
