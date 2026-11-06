(() => {
  const $ = id => document.getElementById(id);
  const formatar = valor => Number(valor || 0).toLocaleString('pt-BR');

  async function carregarMetricas() {
    const status = $('metricas-status');
    status.className = 'status';
    status.textContent = 'Carregando métricas…';

    try {
      const metricasResponse = await fetch('/api/metricas?dias=30');
      if (!metricasResponse.ok) throw new Error('Não foi possível consultar as métricas.');

      const metricas = await metricasResponse.json();
      $('m-acessos').textContent = formatar(metricas.totalAcessos);
      $('m-unicos').textContent = formatar(metricas.visitantesUnicos);
      $('m-dias').textContent = formatar(metricas.diasComAcesso);
      $('m-retorno').textContent = `${formatar(metricas.taxaRetorno)}%`;
      status.textContent = 'Métricas atualizadas · últimos 30 dias';

      try {
        const statusResponse = await fetch('/api/status');
        if (statusResponse.ok) {
          const sistema = await statusResponse.json();
          $('versao').textContent = `Monitor de Incêndios · v${sistema.versao} · ${sistema.bancoDeDados}`;
        }
      } catch (statusError) {
        console.warn('Não foi possível consultar a versão do sistema:', statusError);
      }
    } catch (error) {
      console.error('Falha ao carregar métricas:', error);
      status.className = 'status erro';
      status.textContent = 'Não foi possível carregar as métricas. Verifique a conexão com o banco de dados e atualize a página.';
    }
  }

  const dialogo = $('dlg-feedback');
  const formulario = $('form-feedback');
  const mensagem = $('fb-msg');
  const botaoEnviar = $('fb-enviar');

  $('btn-feedback').addEventListener('click', () => {
    mensagem.textContent = '';
    mensagem.className = '';
    dialogo.showModal();
  });

  $('fb-cancelar').addEventListener('click', () => dialogo.close());

  dialogo.addEventListener('click', event => {
    if (event.target === dialogo) dialogo.close();
  });

  formulario.addEventListener('submit', async event => {
    event.preventDefault();
    if (!formulario.reportValidity()) return;

    botaoEnviar.disabled = true;
    botaoEnviar.textContent = 'Enviando…';
    mensagem.textContent = '';
    mensagem.className = '';

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: $('fb-tipo').value,
          nota: Number($('fb-nota').value),
          comentario: $('fb-comentario').value.trim()
        })
      });

      const resultado = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(resultado.erro || 'Não foi possível registrar o feedback.');

      mensagem.className = 'ok';
      mensagem.textContent = 'Obrigado! Seu feedback foi registrado.';
      formulario.reset();
      window.setTimeout(() => dialogo.close(), 1100);
    } catch (error) {
      mensagem.className = 'erro';
      mensagem.textContent = error.message || 'Falha ao enviar. Tente novamente.';
    } finally {
      botaoEnviar.disabled = false;
      botaoEnviar.textContent = 'Enviar feedback';
    }
  });

  // Registra também visitas diretas à página de dados (ela pode ser aberta por link).
  fetch('/api/visita', { method: 'POST' }).catch(() => {});
  carregarMetricas();
})();
