# 🔥 Monitor de Incêndios — Maricá

**Sistema de monitoramento geoespacial de focos de calor e incêndios, com dados da NASA FIRMS.**

![Status](https://img.shields.io/badge/status-online-success)
![Version](https://img.shields.io/badge/version-1.4.2-blue)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

O **Monitor de Incêndios — Maricá** é uma aplicação web desenvolvida para facilitar o acesso, a visualização e a interpretação de dados sobre focos de calor e possíveis incêndios florestais.

O sistema utiliza dados disponibilizados pela NASA FIRMS (*Fire Information for Resource Management System*), apresentando informações georreferenciadas em um mapa interativo, indicadores de monitoramento e níveis de alerta.

Inicialmente desenvolvido com foco no município de Maricá/RJ, o projeto evoluiu para permitir o monitoramento de todo o estado do Rio de Janeiro, mantendo Maricá como região de destaque.

---

## 📌 Sobre o projeto

O projeto foi desenvolvido como parte das atividades de Engenharia de Software da Universidade de Vassouras, no contexto da disciplina **Práticas Extensionistas Integradoras VI**.

A proposta surgiu da identificação de uma dificuldade de acesso e interpretação de informações sobre focos de calor e queimadas no município de Maricá.

A aplicação busca aproximar dados geoespaciais de fontes públicas da população, permitindo que moradores, estudantes, visitantes e órgãos de interesse ambiental acompanhem informações sobre ocorrências térmicas.

Além do desenvolvimento tecnológico, o projeto contempla uma ação extensionista presencial, com apresentação do aplicativo, testes de usabilidade e coleta de avaliações da comunidade.

### Identificação acadêmica

| Informação | Descrição |
|---|---|
| Curso | Engenharia de Software |
| Disciplina | Práticas Extensionistas Integradoras VI |
| Instituição | Universidade de Vassouras |
| Campus | Maricá/RJ |
| Semestre | 6º semestre — 2026.2 |
| Docente responsável | Prof.ª Laís C. Bordallo Pinheiro |
| Ação extensionista | 06/11/2026 |
| Versão de referência | 1.4.0 |
| Versão técnica atual | 1.4.2 |

## 🎯 Objetivos

- Facilitar o acesso público a informações sobre focos de calor.
- Disponibilizar visualização geográfica das detecções.
- Apresentar níveis de alerta de maneira simples e compreensível.
- Permitir o acompanhamento de ocorrências em Maricá e no estado do Rio de Janeiro.
- Coletar avaliações e sugestões dos usuários.
- Promover conscientização sobre prevenção de queimadas e preservação ambiental.
- Validar a usabilidade do sistema com pessoas reais da comunidade.

---

## 🛰️ Fonte de dados — NASA FIRMS

A principal fonte de informações é a plataforma **NASA FIRMS**, serviço da NASA que disponibiliza dados de detecção de anomalias térmicas por sensoriamento remoto.

O sistema utiliza quatro produtos de monitoramento:

| Sensor | Satélite | Resolução aproximada |
|---|---|---|
| VIIRS S-NPP | Suomi-NPP | 375 m |
| VIIRS NOAA-20 | NOAA-20 | 375 m |
| VIIRS NOAA-21 | NOAA-21 | 375 m |
| MODIS | Aqua/Terra | 1.000 m |

As consultas são realizadas por meio da API da NASA FIRMS, utilizando os produtos Near Real-Time (NRT).

O sistema consolida os resultados dos sensores, normaliza os níveis de confiança e trata possíveis detecções duplicadas.

### Janela de monitoramento

A aplicação trabalha com uma janela móvel das últimas 24 horas, considerando o horário de aquisição dos registros.

Quando algum sensor apresenta indisponibilidade, o sistema identifica a falha e evita interpretar uma consulta incompleta como ausência de focos.

**Importante:** focos de calor representam anomalias térmicas detectadas por satélite. Uma detecção não confirma, isoladamente, a existência de um incêndio.

Fonte oficial: https://firms.modaps.eosdis.nasa.gov/

Documentação da API: https://firms.modaps.eosdis.nasa.gov/api/

---

## 🗺️ Funcionalidades

### Monitoramento geográfico

- Mapa interativo com localização dos focos detectados.
- Monitoramento de todo o estado do Rio de Janeiro.
- Maricá destacada geograficamente.
- Visualização de ocorrências por localização.
- Mapa de calor para facilitar a identificação de concentrações de focos.

### Indicadores e alertas

- Quantidade de focos identificados.
- Indicadores de monitoramento.
- Classificação por nível de confiança.
- Níveis de alerta.
- Filtros para facilitar a interpretação dos dados.

### Dados e histórico

- Persistência de informações em banco PostgreSQL.
- Histórico de monitoramento.
- Exportação de informações em CSV e JSON.
- Métricas de utilização da aplicação.
- Registro de feedback dos usuários.

### Resiliência e disponibilidade

- Cache de resultados para reduzir consultas desnecessárias.
- Tratamento de indisponibilidade da NASA FIRMS.
- Identificação de falhas parciais dos sensores.
- Proteção contra apresentação de dados fictícios como ocorrências reais.
- Aplicação preparada para funcionar em ambiente de produção na web.

### Feedback da comunidade

O aplicativo disponibiliza um mecanismo de feedback para que os usuários possam registrar:

- Problemas encontrados durante a utilização.
- Sugestões de melhorias.
- Ideias para novas funcionalidades.

---

## 🛠️ Tecnologias utilizadas

| Tecnologia | Aplicação |
|---|---|
| JavaScript | Linguagem principal |
| Node.js | Ambiente de execução |
| Express.js | Backend e API REST |
| HTML5 | Estrutura das páginas |
| CSS3 | Estilização e responsividade |
| Leaflet.js | Mapas interativos |
| NASA FIRMS API | Dados de focos de calor |
| PostgreSQL | Persistência de dados |
| Neon | Banco PostgreSQL gerenciado |
| SQLite | Banco utilizado em versões anteriores |
| Vercel | Hospedagem e publicação |
| Node Test Runner | Testes automatizados |
| Axios | Requisições HTTP |

---

## 🏗️ Arquitetura e armazenamento

O projeto evoluiu de uma arquitetura local com SQLite para uma estrutura preparada para publicação online.

### Evolução do banco de dados

**Versões 1.3.0 e 1.4.0**

Utilização de SQLite para armazenamento local, histórico, métricas e informações da aplicação.

**Publicação online**

Migração para PostgreSQL hospedado no Neon, proporcionando persistência de dados em ambiente de produção.

A aplicação também possui mecanismos de migração de histórico, backup e recuperação de informações.

### Infraestrutura

- Aplicação publicada na Vercel.
- Banco de dados PostgreSQL gerenciado pelo Neon.
- Integração com a API NASA FIRMS.
- Endpoints REST para comunicação entre frontend e backend.

---

## 🔐 Privacidade e segurança — LGPD

O projeto considera a proteção dos dados dos usuários durante a utilização da aplicação e a realização das atividades extensionistas.

Entre as medidas adotadas estão:

- Anonimização de endereços IP nas métricas de utilização.
- Feedback sem exigência de identificação nominal.
- Proteção de endpoints administrativos.
- Validação das informações recebidas pela API.
- Não exposição de credenciais e variáveis sensíveis no frontend.
- Cuidados com registros e armazenamento de informações.

Durante a ação presencial, a coleta de imagens e vídeos com identificação de participantes depende de autorização prévia, incluindo autorização do responsável legal quando aplicável.

---

## 📂 Estrutura do projeto

A estrutura principal do repositório está organizada da seguinte maneira:

```text
Monitor_Marica/
│
├── lib/
│   └── app.js
│
├── public/
│   ├── index.html
│   ├── app.js
│   ├── dados.html
│   ├── dados.js
│   └── vendor/
│       └── leaflet/
│
├── test/
│   ├── api.test.js
│   ├── sem-banco.test.js
│   └── backup-migracao.test.js
│
├── .env.example
├── .gitignore
├── CHANGELOG.md
├── REQUIREMENTS.md
├── package.json
├── package-lock.json
└── README.md
```

*Arquivos e diretórios auxiliares podem variar conforme a versão e a configuração do ambiente.*

---

## 🚀 Instalação e execução local

### Pré-requisitos

- Node.js 20 ou superior.
- npm.
- Chave de acesso da NASA FIRMS.
- Banco PostgreSQL configurado, quando necessário para utilizar a persistência online.

### 1. Clonar o repositório

```bash
git clone https://github.com/CairodePaula/monitor-marica.git
```

### 2. Acessar o diretório

```bash
cd monitor-marica
```

### 3. Instalar as dependências

```bash
npm ci
```

### 4. Configurar as variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto, utilizando `.env.example` como referência.

Exemplo:

```env
NASA_KEY=sua_chave_nasa
DATABASE_URL=sua_url_postgresql
NODE_ENV=development
```

**Atenção:** os valores acima são exemplos. Utilize as variáveis efetivamente exigidas pela versão do projeto. Nunca publique seu arquivo `.env`, senhas ou chaves de API no GitHub.

### 5. Iniciar a aplicação

```bash
npm start
```

O comando de inicialização depende da configuração definida no `package.json`.

---

## ☁️ Publicação na Vercel

O projeto utiliza integração com GitHub e Vercel para automatizar a publicação.

Fluxo de publicação:

1. Realizar alterações no código.
2. Executar os testes localmente.
3. Criar um commit no Git.
4. Enviar as alterações para a branch principal.
5. Aguardar o deploy automático da Vercel.

```bash
git add .
git commit -m "Descrição das alterações"
git push origin main
```

### Variáveis de ambiente

As credenciais devem ser configuradas diretamente nas configurações do projeto na Vercel.

Principais variáveis:

- `NASA_KEY`: chave de acesso à API NASA FIRMS.
- `DATABASE_URL`: conexão com o PostgreSQL do Neon.
- `NODE_ENV`: ambiente de execução.

A disponibilidade do banco pode ser verificada pelo endpoint:

```text
/api/status
```

---

## 🧪 Testes automatizados

O projeto utiliza o test runner nativo do Node.js.

Para executar a suíte:

```bash
npm test
```

Os testes contemplam:

- Regras de negócio e níveis de alerta.
- Normalização de confiança dos sensores.
- Janela temporal de 24 horas.
- Tratamento de respostas inválidas da NASA.
- Consulta multissensor.
- Consolidação de detecções duplicadas.
- Cache e recuperação após indisponibilidade.
- Exportação CSV e JSON.
- Registro de métricas.
- Feedback dos usuários.
- Segurança dos endpoints.
- Migração e backup do histórico.
- Comportamento sem banco de dados.

Os testes devem ser executados após alterações no backend para verificar a integridade das funcionalidades.

---

## 🌱 Ação extensionista — 06/11/2026

A aplicação integra uma atividade extensionista presencial realizada em frente ao Campus Maricá da Universidade de Vassouras.

### Público-alvo

- Moradores de Maricá.
- Estudantes.
- Visitantes.
- Pessoas interessadas em meio ambiente e prevenção de queimadas.

### Objetivos da ação

Apresentar o aplicativo à comunidade, avaliar sua usabilidade e identificar oportunidades de melhoria por meio da interação com participantes reais.

### Metodologia

Cada participante é convidado a realizar três tarefas:

1. Visualizar os focos de calor e o nível de alerta.
2. Filtrar as ocorrências por nível de risco ou alternar para o mapa de calor.
3. Enviar um feedback pelo aplicativo.

Também são aplicados instrumentos de avaliação:

- Ficha de utilização do aplicativo.
- Avaliação anônima da ação, com sete itens em escala de 1 a 7.
- Ficha de problemas e ideias.
- Lista de presença.
- Termos de autorização de imagem e voz, quando aplicáveis.

### Metas quantitativas

| Indicador | Meta |
|---|---:|
| Participantes | Mínimo de 10 |
| Tarefas registradas | 3 por participante |
| Avaliações da ação | 7 itens por participante |
| Feedback | Registro de problemas e ideias |
| Exportação | CSV e JSON disponíveis |

Os resultados da atividade serão tabulados e utilizados na elaboração do Relatório Final e do resumo para a Mostra de Extensão.

---

## ⚠️ Limitações e considerações

- A detecção por satélite não representa confirmação de incêndio.
- A cobertura pode ser afetada por nuvens, fumaça, horário de passagem e características do sensor.
- Os dados NRT podem apresentar atraso em relação ao horário real da ocorrência.
- A área de consulta estadual utiliza uma caixa geográfica retangular, podendo incluir pequenas regiões de estados vizinhos.
- A indisponibilidade da NASA FIRMS pode comprometer temporariamente a atualização dos dados.
- O nível de confiança representa a classificação da detecção pelo sensor, não a gravidade de um incêndio.

O aplicativo tem finalidade informativa e educacional. Não substitui sistemas oficiais de emergência, monitoramento ou atuação da Defesa Civil e do Corpo de Bombeiros.

---

## 👥 Equipe de desenvolvimento

Projeto desenvolvido por estudantes do curso de Engenharia de Software da Universidade de Vassouras.

- **Cairo de Paula Cunha Gomes**
- Jean Antunes Correia
- Juan Antunes Correia
- Lucas Meireles dos Santos
- Luiz Henrique Mendes Barbosa

**Docente responsável:** Prof.ª Laís C. Bordallo Pinheiro.

---

## 📚 Referências

- NASA FIRMS — Fire Information for Resource Management System: https://firms.modaps.eosdis.nasa.gov/
- NASA FIRMS API: https://firms.modaps.eosdis.nasa.gov/api/
- Vercel: https://vercel.com/docs
- Neon PostgreSQL: https://neon.tech/docs
- Leaflet: https://leafletjs.com/
- Node.js: https://nodejs.org/docs/
- Express.js: https://expressjs.com/

---

## 📄 Licença

Este projeto está licenciado sob a **Licença MIT**.

Você pode utilizar, copiar, modificar, distribuir e sublicenciar o código,
inclusive para fins comerciais, desde que mantenha os avisos de copyright
e o texto da licença original.

Consulte o arquivo [LICENSE](LICENSE) para conhecer os termos completos.

A licença MIT se aplica ao código-fonte do projeto. Dados e serviços de
terceiros, como NASA FIRMS, permanecem sujeitos aos respectivos termos
de uso e licenciamento.


---

**Monitor de Incêndios — Maricá**

*Tecnologia, informação e conscientização ambiental a serviço da comunidade.* 🔥🌱