const rotuloFonte=f=>({nasa:'NASA ao vivo',cache:'cache local','cache-offline':'cache — NASA indisponível',demonstracao:'dados de demonstração'}[f]||f);
function nivel(c){return c>=80?'alto':c>=50?'medio':'baixo'}
  function cor(c){return c>=80?'#ff3b30':c>=50?'#ff9f0a':'#ffd60a'}

  const CENTRO_MARICA = [-22.92,-42.82];
  const LIMITES_RJ = [[-23.4,-44.9],[-20.7,-40.9]];
  const LIMITES_MARICA = [[-23.1,-43.2],[-22.7,-42.6]];
  const map=L.map('map',{zoomControl:true}).setView(CENTRO_MARICA,12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© OpenStreetMap | NASA FIRMS',maxZoom:19
  }).addTo(map);

  // Destaque permanente de Maricá enquanto a consulta e o mapa abrangem o RJ.
  const destaqueMarica = L.rectangle(LIMITES_MARICA,{
    color:'#ff5a1f',weight:2,opacity:.95,fillColor:'#ff5a1f',fillOpacity:.08,dashArray:'6 4'
  }).addTo(map);
  destaqueMarica.bindTooltip('MARICÁ',{
    permanent:true,direction:'center',className:'marica-label',opacity:1
  }).openTooltip();
  let enquadramentoRJDefinido=false;
  let focosAtuais=[],marcadores=[],camadaCalor=null,modoVisu='marcadores',filtroNivel='todos';
  const limparMarc=()=>{marcadores.forEach(m=>map.removeLayer(m));marcadores=[]};
  const limparCalor=()=>{if(camadaCalor){map.removeLayer(camadaCalor);camadaCalor=null}};
  const filtrados=()=>filtroNivel==='todos'?focosAtuais:focosAtuais.filter(f=>nivel(f.confidence)===filtroNivel);

  function renderizar(){
    limparMarc();limparCalor();
    const focos=filtrados();
    const lista=document.getElementById('foco-list');
    document.getElementById('lista-count').textContent=focos.length;
    lista.innerHTML='';
    if(focos.length===0){lista.innerHTML='<div class="vazio">Nenhum foco para este filtro.</div>';return}

    if(modoVisu==='calor'){
      const pts=focos.map(f=>[f.lat,f.lng,Math.min(1,(f.confidence/100)+(f.frp/100))]);
      camadaCalor=L.heatLayer(pts,{radius:30,blur:22,maxZoom:15,gradient:{0.3:'#ffd60a',0.6:'#ff9f0a',1.0:'#ff3b30'}}).addTo(map);
    }else{
      focos.forEach(f=>{
        const mk=L.circleMarker([f.lat,f.lng],{radius:9+(f.frp/12),fillColor:cor(f.confidence),color:'#fff',weight:1.2,opacity:.9,fillOpacity:.8}).addTo(map);
        mk.bindPopup('<b>🔥 Foco detectado</b><hr>Confiança: <b>'+f.confidence+'%</b><br>Potência: <b>'+f.frp+' MW</b><br>Período: <b>'+(f.daynight==='D'?'☀️ Diurno':'🌙 Noturno')+'</b><br>Data: <b>'+f.acq_date+'</b><br>Hora: <b>'+f.acq_time+' UTC</b>');
        marcadores.push(mk);
      });
    }
    focos.forEach(f=>{
      const it=document.createElement('div');
      it.className='foco-item '+nivel(f.confidence);
      it.innerHTML='<div class="ti">'+f.acq_date+' · '+f.acq_time+' UTC</div><div class="su">'+(f.daynight==='D'?'☀️ Diurno':'🌙 Noturno')+' &nbsp;·&nbsp; FRP '+f.frp+' MW</div><div class="cf '+nivel(f.confidence)+'">Confiança '+f.confidence+'% — '+nivel(f.confidence).toUpperCase()+'</div>';
      it.addEventListener('click',()=>{map.setView([f.lat,f.lng],15);const m=marcadores.find(mk=>{const l=mk.getLatLng();return l.lat===f.lat&&l.lng===f.lng});if(m)m.openPopup()});
      lista.appendChild(it);
    });
  }

  function atualizarAlerta(a){
    const el=document.getElementById('alerta');
    const ico={tranquilo:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',atencao:'<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',critico:'<path d="M12 8v5M12 17h.01"/><circle cx="12" cy="12" r="9"/>'};
    el.className='alerta '+(a.codigo||'tranquilo');
    document.getElementById('alerta-ico').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+(ico[a.codigo]||ico.tranquilo)+'</svg>';
    document.getElementById('alerta-rot').textContent=a.rotulo||'—';
    document.getElementById('alerta-msg').textContent=a.mensagem||'';
  }

  function renderHist(serie){
    const c=document.getElementById('barras');
    if(!serie||!serie.length){c.innerHTML='<div class="vazio">Sem histórico ainda. Os dados aparecem após as primeiras coletas.</div>';return}
    const max=Math.max(1,...serie.map(d=>d.total));
    c.innerHTML='';
    serie.forEach(d=>{
      const col=document.createElement('div');col.className='bcol';
      const h=Math.max(3,Math.round((d.total/max)*88));
      const dia=d.data.slice(8,10)+'/'+d.data.slice(5,7);
      col.innerHTML='<div class="bwrap"><div class="bar" style="height:'+h+'px" title="'+d.total+' focos ('+d.alto+' alto)"><span class="v">'+d.total+'</span></div></div><div class="blbl">'+dia+'</div>';
      c.appendChild(col);
    });
  }

  async function carregarHist(){try{const r=await fetch('/api/historico?dias=7');const j=await r.json();renderHist(j.serie)}catch(e){console.error(e)}}

  async function carregarFocos(forcar){
    const pill=document.getElementById('status-pill'),txt=document.getElementById('status-txt'),bt=document.getElementById('btn-atualizar');
    bt.disabled=true;
    try{
      const r=await fetch('/api/focos'+(forcar?'?forcar=true':''));
      const j=await r.json();
      focosAtuais=j.focos||[];
      const consultaEstadual=j.area==='RJ';
      pill.className='pill live';txt.textContent='NASA FIRMS · '+(consultaEstadual?'RJ inteiro':(j.area||'Maricá'));
      document.getElementById('map-area').textContent=consultaEstadual?'RJ inteiro · Maricá destacada':'Área: '+(j.area||'Maricá');
      if(consultaEstadual&&!enquadramentoRJDefinido){
        map.fitBounds(LIMITES_RJ,{padding:[18,18]});
        enquadramentoRJDefinido=true;
      }
      atualizarAlerta(j.alerta||{});
      const e=j.estatisticas||{total:0,alto:0,medio:0,baixo:0};
      document.getElementById('s-total').textContent=e.total;
      document.getElementById('s-alto').textContent=e.alto;
      document.getElementById('s-medio').textContent=e.medio;
      document.getElementById('s-baixo').textContent=e.baixo;
      renderizar();
      const ag=new Date(j.ultimaAtualizacao);
      document.getElementById('src').textContent='Fonte: NASA FIRMS · VIIRS S-NPP — atualizado '+ag.toLocaleTimeString('pt-BR')+' ('+rotuloFonte(j.fonte)+')'+(j.aviso?' — '+j.aviso:'');
      if(j.fonte==='demonstracao'||j.fonte==='cache-offline'){pill.className='pill erro';txt.textContent=(j.fonte==='demonstracao'?'DEMONSTRAÇÃO':'Offline (cache)')+' · '+(j.area||'Maricá')}
      carregarHist();
    }catch(err){
      console.error(err);
      pill.className='pill erro';txt.textContent='Erro de conexão';
      document.getElementById('foco-list').innerHTML='<div class="vazio" style="color:#ff8a82">Erro ao conectar com o servidor.<br>Verifique sua internet e toque em <b>Atualizar</b>.</div>';
    }finally{bt.disabled=false}
  }

  // Eventos
  document.getElementById('btn-atualizar').addEventListener('click',()=>carregarFocos(true));
  document.querySelectorAll('#seg-visu button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('#seg-visu button').forEach(x=>x.classList.remove('ativo'));b.classList.add('ativo');modoVisu=b.dataset.modo;renderizar()}));
  document.querySelectorAll('#filtros .chip').forEach(c=>c.addEventListener('click',()=>{document.querySelectorAll('#filtros .chip').forEach(x=>x.classList.remove('ativo'));c.classList.add('ativo');filtroNivel=c.dataset.nivel;renderizar()}));

  // Relógio
  setInterval(()=>{document.getElementById('clock').textContent=new Date().toLocaleTimeString('pt-BR')},1000);

  carregarFocos();
  setInterval(()=>carregarFocos(),30*60*1000);
  setTimeout(()=>map.invalidateSize(),300);
  window.addEventListener('resize',()=>setTimeout(()=>map.invalidateSize(),120));
  window.addEventListener('pageshow',()=>setTimeout(()=>map.invalidateSize(),120));

  // v1.4.0 (web): registra a visita 1x ao abrir (o HTML é servido pela CDN do Vercel)
  fetch('/api/visita',{method:'POST'}).catch(()=>{});
