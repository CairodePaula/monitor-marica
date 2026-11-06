// Ponto de entrada da função serverless do Vercel: expõe o app Express.
// O vercel.json reescreve /api/* para esta função.
module.exports = require('../lib/app').app;
