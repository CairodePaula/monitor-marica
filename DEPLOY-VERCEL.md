# Publicar no Vercel + Neon (passo a passo)

1. **GitHub:** crie um repositório e envie esta pasta (sem `node_modules` e sem `.env`; o `.gitignore` já cuida disso).
2. **Vercel:** *Add New → Project* → importe o repositório. Não precisa mexer em Build/Output (deixe "Other" e tudo vazio). Clique em *Deploy*.
3. **Neon:** no projeto do Vercel, aba **Storage → Create Database → Neon (Postgres)** → conecte ao projeto. Isso cria `DATABASE_URL` sozinho.
4. **NASA:** gere a chave nova em https://firms.modaps.eosdis.nasa.gov/api/map_key/ e cadastre em *Settings → Environment Variables* como `NASA_KEY`. Cadastre também `ADMIN_TOKEN` (uma senha sua) e `IP_SALT` (qualquer texto longo).
5. **Redeploy:** *Deployments → ⋯ → Redeploy* (as variáveis só valem em um deploy novo).
6. **Teste:** abra `https://SEU-PROJETO.vercel.app/api/status` — deve mostrar `"bancoConectado": true` e `"chaveConfigurada": true`. Depois abra a página inicial no celular.
7. **Exportar os feedbacks (para o relatório):** `https://SEU-PROJETO.vercel.app/api/feedback/exportar?token=SEU_ADMIN_TOKEN`
