'use strict';
const $=id=>document.getElementById(id),fmt=x=>x==null?'—':Number(x).toLocaleString('pt-BR',{maximumFractionDigits:2});
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let input=null,manifest=[],last=null,jobId=null,cursor=0,timer=null,leaves=[],imported=false,loading=0,workerInfo=[];
const labels={OTIMO:'Ótimo certificado',VIAVEL:'Viável · sem certificado',INVIAVEL:'Inviável no modelo',INTERROMPIDO:'Interrompido',CANCELADO:'Cancelado',ERRO:'Erro',SEM_SOLUCAO_NO_PRAZO:'Sem solução no prazo'};
async function api(url,body){const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);const d=await r.json();if(!r.ok)throw new Error(d.error||r.status);return d;}
function status(s){$('status').textContent=s;}
function draw(){
  const canvas=$('map'),rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);if(!input)return;
  const style=getComputedStyle(document.documentElement),ink=style.getPropertyValue('--ink'),line=style.getPropertyValue('--line'),blue=style.getPropertyValue('--blue'),orange=style.getPropertyValue('--orange');
  const xy=input.xy||Array.from({length:input.n},(_,i)=>[Math.cos(2*Math.PI*i/input.n),Math.sin(2*Math.PI*i/input.n)]);
  const xs=xy.map(p=>p[0]),ys=xy.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),pad=25;
  const scale=Math.min((rect.width-2*pad)/Math.max(1e-9,x1-x0),(rect.height-2*pad)/Math.max(1e-9,y1-y0));
  const px=x=>pad+(x-x0)*scale,py=y=>rect.height-pad-(y-y0)*scale;
  ctx.strokeStyle=blue;ctx.globalAlpha=.3;ctx.setLineDash([4,4]);
  for(const l of leaves){if(!l.rect)continue;const [a,b,c,d]=l.rect;ctx.strokeRect(px(a),py(d),(c-a)*scale,(d-b)*scale);}
  ctx.setLineDash([]);ctx.globalAlpha=.5;ctx.strokeStyle=line;
  if(input.edges.length<=3000){ctx.beginPath();for(const [a,b]of input.edges){ctx.moveTo(px(xy[a][0]),py(xy[a][1]));ctx.lineTo(px(xy[b][0]),py(xy[b][1]));}ctx.stroke();}
  ctx.globalAlpha=1;
  if(last?.route){ctx.strokeStyle=orange;ctx.lineWidth=2.5;ctx.beginPath();last.route.forEach((v,i)=>{if(i)ctx.lineTo(px(xy[v][0]),py(xy[v][1]));else ctx.moveTo(px(xy[v][0]),py(xy[v][1]));});ctx.stroke();}
  ctx.lineWidth=1;ctx.fillStyle=ink;
  xy.forEach(([x,y],i)=>{ctx.beginPath();ctx.arc(px(x),py(y),i===0?5:input.n>300?1.6:3,0,7);ctx.fill();});
  $('map-note').textContent=input.xy?'Diagrama das coordenadas da instância, não mapa rodoviário. '+(input.edges.length>3000?'Arestas omitidas para legibilidade; cidades e rota continuam visíveis.':'Azul: tiles; laranja: rota final.'): 'Posições circulares ilustrativas: a entrada não fornece coordenadas.';
}
function setGraph(g){input=g;last=null;leaves=[];$('export').disabled=true;$('graph-name').textContent=g.meta?.name||'Grafo importado';$('graph-size').textContent=`${fmt(g.n)} cidades · ${fmt(g.edges.length)} estradas`;$('source').textContent=`Fonte: ${g.meta?.sourceFamily||g.meta?.source||'arquivo importado'}`;$('model').textContent=g.meta?.derived?'DERIVADA · rota única. Demandas, capacidade e frota removidas; custos e cidades preservados.':'Circuito único · não dirigido · visita cada vértice uma vez.';draw();status('Pronto para executar.');}
async function load(){const token=++loading;$('run').disabled=true;try{const g=await api('/api/data?id='+encodeURIComponent($('instance').value));if(token===loading){imported=false;setGraph(g);}}catch(e){status(e.message);}finally{if(token===loading)$('run').disabled=false;}}
function showWorkers(){ $('workers-live').innerHTML=workerInfo.map((w,i)=>`<div class="worker ${w.active?'active':''}"><b>Trabalhador ${i+1}</b>${escape(w.text)}</div>`).join('');}
function timeline(tasks){
  const svg=$('timeline');if(!tasks?.length){svg.innerHTML='';return;}
  const w=svg.clientWidth,h=125,min=Math.min(...tasks.map(t=>t.start)),max=Math.max(...tasks.map(t=>t.end)),span=Math.max(1,max-min),count=Math.max(...tasks.map(t=>t.worker))+1;
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  svg.innerHTML=Array.from({length:count},(_,i)=>`<text x="0" y="${20+i*23}" fill="currentColor" font-size="12">T${i+1}</text>`).join('')+tasks.map(t=>`<rect x="${30+(w-45)*(t.start-min)/span}" y="${8+t.worker*23}" width="${Math.max(1,(w-45)*(t.end-t.start)/span)}" height="15" fill="var(--blue)"><title>Tarefa ${t.id}: ${t.end-t.start} ms</title></rect>`).join('')+`<text x="30" y="122" fill="currentColor" font-size="12">Intervalo observado: ${fmt(span)} ms · inclui apenas tarefas, não a preparação</text>`;
}
function showResult(r){last=r;$('export').disabled=false;status(`${labels[r.status]||r.status}${r.reason?' · limite: '+r.reason:''}${r.detail?' · '+r.detail:''}`);if(r.leaves)leaves=r.leaves;
  $('metrics').innerHTML=[['Custo',r.cost==null?'—':fmt(r.cost)+' '+(input.meta?.unit||'unidades')],['Tempo completo',fmt(r.totalWallMs??r.totalMs)+' ms'],['RSS observado',r.rssPeakMB==null?'Não medido':fmt(r.rssPeakMB)+' MiB']].map(([name,value])=>`<div><span>${name}</span><strong>${escape(value)}</strong></div>`).join('');
  const {tasks,nodes,leaves:ls,route,edgeIds,...rest}=r;$('details').textContent=JSON.stringify({...rest,route,tasksCompleted:tasks?.length,memoryNote:'RSS amostrado: inclui grafo, runtime, tabelas e trabalhadores; não é pico exato.',communicationNote:'Bytes estimados pelo formato de serialização V8; não medição física do IPC.'},null,2);draw();timeline(tasks);workerInfo=workerInfo.map(w=>({active:false,text:'Encerrado'}));showWorkers();
}
async function poll(){
  try{
    const d=await api(`/api/job?id=${encodeURIComponent(jobId)}&cursor=${cursor}`);cursor=d.cursor;
    for(const e of d.events){if(e.type==='plan'){leaves=e.leaves;draw();}if(e.worker!=null){workerInfo[e.worker]={active:e.type==='start',text:e.type==='start'?`${e.kind} · ${e.size} cidades`:`Tabela concluída · ${fmt(e.peak)} estados`};}$('progress').textContent=`${e.completed} / ${e.total} tarefas concluídas`;}
    showWorkers();if(d.closed){clearInterval(timer);$('run').disabled=false;$('cancel').disabled=true;jobId=null;showResult(d.result);}
  }catch(e){clearInterval(timer);status('Falha ao consultar execução: '+e.message);$('run').disabled=false;}
}
$('run').onclick=async()=>{if(!input)return;$('run').disabled=true;last=null;leaves=[];draw();$('timeline').innerHTML='';status('Preparando grafo e hierarquia…');
  workerInfo=Array.from({length:+$('workers').value},()=>({active:false,text:'Inicializando'}));showWorkers();
  try{const d=await api('/api/run',{id:$('instance').value,input:imported?input:undefined,config:{workers:+$('workers').value,method:$('method').value,leafSize:+$('leaf').value,hub:$('hub').value,integration:$('integration').value,maxMillis:+$('budget').value}});jobId=d.id;cursor=0;$('cancel').disabled=false;timer=setInterval(poll,500);await poll();}catch(e){status(e.message);$('run').disabled=false;}};
$('cancel').onclick=async()=>{if(jobId){$('cancel').disabled=true;await api('/api/cancel',{id:jobId});status('Cancelando trabalhadores…');}};
$('instance').onchange=()=>{if(jobId)return;load();};
$('method').onchange=()=>{$('cluster-controls').hidden=$('method').value==='pure';};
$('import').onchange=async()=>{if(jobId){status('Aguarde ou cancele antes de importar.');return;}try{const f=$('import').files[0];if(!f)return;if(f.size>24*1024*1024)throw new Error('Limite de 24 MB');const g=JSON.parse(await f.text());if(!Number.isInteger(g.n)||g.n<3||g.n>1500||!Array.isArray(g.edges))throw new Error('Formato inválido: confira n e edges');if(g.xy&&(g.xy.length!==g.n||g.xy.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))))throw new Error('Coordenadas inválidas');imported=true;setGraph(g);}catch(e){status('Importação recusada: '+e.message);}};
$('export').onclick=()=>{if(!last)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({inputMeta:input.meta,result:last},null,2)],{type:'application/json'}));a.download='rota-fronteiras-resultado.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
async function results(){try{const d=await api('/api/results');$('results').innerHTML=d.runs.map(r=>`<tr><td>${escape(r.instance)}</td><td>${fmt(r.n)}</td><td>${escape(r.method)}</td><td class="${r.status==='OTIMO'?'good':'warn'}">${escape(labels[r.status]||r.status)}${r.reason?' · '+escape(r.reason):''}</td><td>${fmt(r.cost)}</td><td>${fmt(r.wallMs)} ms</td><td>${fmt(r.rssPeakMB)} MiB</td></tr>`).join('')||'<tr><td colspan="7">Nenhuma bateria registrada.</td></tr>';$('benchmark-note').textContent=d.note||'A bateria será carregada quando concluída.';}catch(e){$('benchmark-note').textContent=e.message;}}
$('refresh').onclick=results;
new ResizeObserver(draw).observe($('map'));
(async()=>{try{manifest=await api('/api/manifest');$('instance').innerHTML=manifest.filter(x=>!x.error).map(x=>`<option value="${escape(x.id)}">${escape(x.id)} · ${x.n} cidades${x.derived?' · derivada':''}</option>`).join('');await load();await results();}catch(e){status('Inicie o laboratório com INICIAR.ps1 e abra http://127.0.0.1:8765. '+e.message);$('run').disabled=true;}})();
