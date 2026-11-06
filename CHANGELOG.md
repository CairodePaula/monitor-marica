# 📋 CHANGELOG — Monitor de Incêndios - Maricá

## [1.4.2 — janela real de 24h e resiliência multissensor] — 2026-11-06

- Mantém coleta estadual em quatro produtos NASA FIRMS: VIIRS S-NPP, NOAA-20, NOAA-21 e MODIS NRT.
- Corrige a janela temporal para as últimas 24 horas móveis exatas, usando os horários de aquisição UTC; consulta dois dias completos na API e descarta registros fora do intervalo.
- Desativa dados fictícios em produção, mesmo que `ENABLE_DEMO=true` esteja configurado.
- Impede cache HTTP de respostas da API de focos, alerta e status.
- Testa respostas de erro que não sejam CSV, exclusão de dados com mais de 24 horas e falhas parciais de sensores.

## [1.4.1 — correção multissensor NASA FIRMS] — 2026-11-06

- Consulta estadual simultânea de VIIRS S-NPP, VIIRS NOAA-20, VIIRS NOAA-21 e MODIS NRT.
- Consulta dois dias UTC completos, filtrando originalmente desde 00:00 UTC do dia anterior.
- Normalização de confiança VIIRS (`l/n/h`) e MODIS (0–100), com preservação do valor original.
- Deduplicação conservadora entre sensores, mantendo a lista das fontes associadas a cada foco.
- Falhas isoladas de sensor são reportadas como coleta parcial; cache só é atualizado em coleta completa.
- Cache versionado, invalidação do cache de sensor único e validade de 15 minutos.
- Indisponibilidade geral não é exibida como zero focos; demonstração exigia `ENABLE_DEMO=true`.
- Interface diferencia consulta parcial, cache e ausência real de detecções.

## [1.4.0 — publicação web] — 2026-11-05 — Vercel + Neon (PostgreSQL)

Mesma versão funcional 1.4.0, adaptada para rodar online e ser usada pelo público na ação extensionista.

### ☁️ Hospedagem
- Publicação no **Vercel** (função serverless em `api/index.js`; `public/` servida pela CDN; `vercel.json` com rotas, CSP e tempo máximo de 30 s).
- O código do servidor foi para `lib/app.js` e o do banco para `lib/db.js` (o Vercel não deve encontrar um `server.js` na raiz).

### 🗄️ Banco de dados
- **SQLite em arquivo → PostgreSQL gerenciado (Neon)**, porque o disco do Vercel é temporário e apagaria feedbacks, métricas e histórico.
- Conexão por `DATABASE_URL` (a integração Neon do Vercel cria sozinha). Esquema versão 3; nova tabela `cache_focos` substitui o `cache.json` em disco.
- Se o banco ou a `NASA_KEY` faltarem, o app continua abrindo (demonstração) e o `/api/status` informa `bancoConectado: false`.

### 👥 Métricas
- A contagem de visitas passou a ser `POST /api/visita`, chamada pela página ao abrir (o HTML agora é servido pela CDN, não pelo Express).

### 💾 Backup
- `npm run backup` agora exporta as tabelas para `backups/AAAA-MM-DD_HH-MM-SS/*.json` (mantém 14). O Neon também oferece restauração a um ponto no tempo.
- O importador do `historico.json` legado virou função (`db.importarHistoricoJson`), sem rodar no boot.

### 🧪 Testes
- 12 testes automatizados (`npm test`) usando `pg-mem` (Postgres em memória), incluindo o caso "sem banco configurado".

## [1.4.0] — 2026-10-08 — Pronto para campo: resiliência, segurança, feedback e testes

Versão preparada para a ação extensionista com a comunidade de Maricá.

### 🛡️ Resiliência
- Falha da NASA FIRMS não vira mais "0 focos": o app responde com o último cache
  (`fonte: "cache-offline"`) ou, sem cache, com dados de demonstração rotulados
  (`dados/demo.json`, `fonte: "demonstracao"`). Nada disso é gravado no histórico
  (antes, uma queda de rede apagava o cache e gravava um falso "Tranquilo").
- Sem `NASA_KEY` o app continua abrindo (cache/demonstração) e avisa no console.
- Cache com data no futuro (hack de demonstração antigo) passa a ser tratado como vencido.

### 📴 Funciona sem internet (exceto os tiles do mapa)
- Leaflet 1.9.4 e Leaflet.heat 0.2.0 agora ficam em `public/vendor/leaflet/` (antes vinham do unpkg).
  Se a rede cair no local da ação, a interface, o painel, o feedback e os marcadores continuam funcionando;
  só o desenho das ruas do mapa (OpenStreetMap/Carto) depende de internet.

### 🔒 Segurança e privacidade (LGPD)
- **Correção:** o servidor servia a pasta inteira do projeto (expunha `.env`, `server.js`
  e `data/monitor.db`). Agora só `public/` é servida (`index.html` e `app.js` foram movidos para lá).
- IP dos visitantes é anonimizado (SHA-256 com sal `IP_SALT`, 16 caracteres) antes de gravar.
- `upgrade-insecure-requests` do CSP desativado, para o app funcionar via http na rede local.
- REQUIREMENTS.md não contém mais a chave da NASA; use `.env.example`. **Gere uma nova chave.**

### 💬 Feedback do público
- `POST /api/feedback` (tipo: elogio/problema/ideia, nota 1–5, comentário até 500 caracteres, sem nome).
- Formulário no painel "Dados e uso"; `GET /api/feedback/exportar?token=…` (exige `ADMIN_TOKEN`).
- Nova tabela `feedbacks` e tabela `meta` (versão do esquema = 2).

### 📊 Métricas e exportação
- `/api/metricas` ganha `visitantesRecorrentes`, `taxaRetorno` e resumo do feedback.
- CSV com coluna `coletado_em`, BOM para o Excel e erro 400 para formato inválido.
- Interface: painel "Dados e uso", botões Exportar CSV/JSON e indicação da fonte dos dados.

### 📱 Ajustes de usabilidade (achados do teste simulado com IA)
- Cabeçalho no celular passava da largura da tela (layout de 458 px em tela de 390 px): agora quebra em linhas.
- Alvos de toque (botões, filtros, seletores) com no mínimo 44 px em telas de toque.
- O diálogo de feedback agora cabe em qualquer tela (rolagem interna quando necessário).

### 🧪 Qualidade
- 11 testes automatizados com `node:test` (`npm test`): regras de alerta, fallback, cache,
  exportação, métricas/IP anonimizado, feedback, bloqueio de arquivos sensíveis, migração e backup.
- Migração do `historico.json` em transação, com cópia `.bak`, sem duplicar.
- `server.js` exporta `app` (testável); `DB_PATH`, `DATA_DIR` e `BACKUP_DIR` permitem apontar outros caminhos.

### 📝 Documentação
- Corrigido: o código usa **CommonJS** (`require`), não ES Modules como constava na documentação anterior.

## [1.3.0] — 2026-06-19 — Banco de dados, métricas e backup

Fecha o requisito formal da Avaliação 3 ("MVP com backend e banco de
dados") e os pontos de "retenção, engajamento, abandono" e "políticas
de backup" da Avaliação P2.

### 🗄️ Banco de dados
- O histórico agora vive em **SQLite real** (`data/monitor.db`), usando o
  módulo nativo `node:sqlite` do Node 22 — sem dependências externas e
  sem risco de erro de compilação no dia da apresentação.
- Migração automática: se já existir um `historico.json` da versão
  anterior, ele é importado para o banco na primeira inicialização.
- Nova tabela `alertas_log`: registra toda mudança de nível de alerta
  (Tranquilo → Atenção → Crítico), servindo de auditoria.

### 📊 Métricas de engajamento (`GET /api/metricas`)
- Total de acessos, visitantes únicos, dias com acesso e uma taxa de
  retenção simples (dias ativos ÷ dias do período).
- Resolve diretamente o item "retenção, engajamento do usuário,
  abandono" pedido nas métricas pós-venda.

### 📤 Exportação de dados (`GET /api/historico/exportar`)
- Suporta `?formato=csv` (padrão) e `?formato=json`.
- Permite que Defesa Civil/prefeitura baixem o histórico para
  relatórios próprios — funcionalidade de valor real para o usuário final.

### 💾 Backup (`npm run backup`)
- Script `scripts/backup.js`: copia `data/` (banco + cache) para
  `backups/AAAA-MM-DD_HH-MM-SS/`.
- Mantém automaticamente só os 14 backups mais recentes.
- Recomendado agendar 1x por dia (cron / Agendador de Tarefas do Windows).

## [1.1.0] — 2026-06-19 — Melhorias do MVP

Esta versão fecha as principais fraquezas levantadas na análise SWOT e
adianta itens dos "Próximos Passos" da apresentação.

### ✨ Novidades (back-end)
- **Persistência em disco** (`data/cache.json`): o cache agora sobrevive ao
  reinício do servidor — resolve a fraqueza "cache em memória (volátil)".
- **Histórico de focos** (`data/historico.json` + rota `GET /api/historico`):
  registra cada coleta e agrega por dia para gráficos de tendência.
- **Nível de alerta automático** (rota `GET /api/alerta`): classifica a área em
  Tranquilo / Atenção / Crítico — base para alertas proativos à Defesa Civil.
- **Segurança**: `Helmet.js` (Content Security Policy + headers) e
  `express-rate-limit` (60 req/min por IP) nas rotas `/api`.
- `GET /api/focos` agora retorna `estatisticas` e `alerta` prontos.
- Parâmetro `?forcar=true` para ignorar o cache (botão "Atualizar agora").

### ✨ Novidades (front-end)
- **Mapa de calor real** com Leaflet.heat — antes a apresentação prometia
  "camadas de calor" mas o app só tinha marcadores. Agora é verdade.
- **Banner de alerta** no topo, colorido conforme o nível.
- **Filtros por nível de risco** (Todos / Alto / Médio / Baixo).
- **Gráfico de tendência de 7 dias** na barra lateral.
- **Botão "Atualizar agora"** para forçar coleta sem esperar os 30 min.

### 📦 Novas dependências
- `helmet` ^8.0.0
- `express-rate-limit` ^7.4.0

### 🗂️ Boas práticas de versionamento adicionadas
- `.gitignore` (ignora node_modules, .env, data/)
- `.env.example` (modelo seguro, sem expor a chave real)

## [1.2.0] — 2026-06-19 — Redesign visual

### 🎨 Design
- Interface redesenhada no estilo **dark admin dashboard** (preto minimalista,
  profissional): rail de ícones à esquerda, topbar com status ao vivo e relógio,
  cards de estatística com ícones coloridos por nível de risco.
- **Basemap escuro** (CARTO dark) substituindo o mapa claro — combina com o tema.
- Popups, scrollbars e controles do Leaflet estilizados para o tema escuro.
- Layout responsivo (empilha no mobile), foco visível e `prefers-reduced-motion`.

### 🔒 Ajuste
- CSP do Helmet liberado para os tiles `basemap.cartocdn.com`.

## [1.2.1] — 2026-06-19 — Correção (CSP × script inline)

### 🐛 Correção
- O JavaScript foi movido do `index.html` (inline) para um arquivo **`app.js`**
  separado. O CSP do Helmet (`script-src 'self'`) bloqueava scripts inline, o que
  travava a página em "Carregando". Agora o `app.js` é servido pelo próprio
  servidor e o CSP continua estrito (sem `unsafe-inline`).

## [1.2.2] — 2026-06-19 — Mapa via OpenStreetMap

### 🐛 Correção
- Tiles do mapa trocados de **CARTO** (`basemap.cartocdn.com`, que não resolvia
  em algumas redes) para **OpenStreetMap** — servidor de tiles muito mais
  amplamente acessível. O visual escuro foi mantido aplicando um filtro CSS
  (invert + hue-rotate) sobre os tiles, sem afetar marcadores nem mapa de calor.

## Monitoramento estadual (RJ)

- A consulta NASA FIRMS passa a usar a área estadual em todas as coletas, sem depender de Maricá estar sem focos.
- Cache só é reutilizado quando foi gerado para o escopo estadual; cache antigo de Maricá é ignorado.
- Mapa abre enquadrado no RJ e mantém Maricá destacada com contorno e rótulo.
- A área NASA é um retângulo de coordenadas aproximado do estado e pode incluir pequenas áreas vizinhas.
