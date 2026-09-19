'use strict';
// Shared DAG for one or several actual workers. The exact region kernel is solver.js.
const {Worker}=require('node:worker_threads');
const {serialize}=require('node:v8');
const path=require('node:path');
const S=require('./solver.js');

function plan(graph,cfg={}){
  const started=performance.now();
  const xy=graph.xy;
  let tree,leaves,candidates=[];
  if(cfg.method==='pure'){
    tree=S.singletonChain(graph,{xy}).tree;
    leaves=Array.from({length:graph.n},(_,v)=>({v:[v]}));
  }else{
    const h=S.bisect(graph,{xy,leafSize:cfg.leafSize||4,hub:cfg.hub||'nenhum',refine:!!cfg.refine});
    leaves=h.leaves;
    const chain=S.sweepChain(graph,leaves,{xy}).tree;
    candidates=[{name:'arvore',tree:h.tree},{name:'cadeia',tree:chain}].map(c=>({...c,width:S.treeStats(graph,c.tree).width}));
    tree=cfg.integration==='arvore'?h.tree:cfg.integration==='cadeia'?chain:candidates.sort((a,b)=>a.width-b.width||a.name.localeCompare(b.name))[0].tree;
  }
  let id=0;const jobs=[];
  function walk(t){
    if(t.v){const j={id:id++,v:t.v,vertices:t.v,size:t.v.length,deps:[],kind:'folha'};jobs.push(j);return j;}
    const collect=x=>x.v||collect(x.l).concat(collect(x.r));
    let l=t.l,r=t.r,lv=collect(l),rv=collect(r);
    let lb=S.boundarySet(graph,S.membership(graph.n,lv)).size,rb=S.boundarySet(graph,S.membership(graph.n,rv)).size;
    const reverse=rb+lv.length<lb+rv.length;
    const small=reverse?lv.length:rv.length,sw=Math.min(lb+rv.length,rb+lv.length);
    const scan=cfg.strategy==='varredura'||(cfg.strategy!=='produto'&&small<=4&&sw<=lb+rb&&S.signatureBound(lb)*S.signatureBound(rb)>(cfg.productLimit??150000));
    if(scan&&reverse){[l,r]=[r,l];[lv,rv]=[rv,lv];}
    const a=walk(l),b=scan?null:walk(r);
    const j={id:id++,vertices:lv.concat(rv),size:lv.length+rv.length,deps:b?[a.id,b.id]:[a.id],kind:'uniao',policy:scan?'varredura':'produto',left:lv,right:rv};
    jobs.push(j);return j;
  }
  const root=walk(tree);
  return {jobs,root:root.id,leaves,candidates:candidates.map(({name,width})=>({name,width})),millis:performance.now()-started};
}

async function run(input,cfg={},onProgress=()=>{}){
  const start=performance.now(),deadline=start+(cfg.maxMillis??30000);
  const graph=S.makeGraph(input.n,input.edges,input.names);graph.xy=input.xy;
  const p=plan(graph,cfg),planningMs=performance.now()-start;
  const count=Math.max(1,Math.min(4,cfg.workers||1));
  const maxStates=cfg.maxStates??30000;
  const packets=new Map(),done=new Set(),jobs=p.jobs,active=new Map();
  const traces=[],nodes=[];let bytes=0,peak=0,width=0,work=0,states=0,finished=false;
  const workers=[];let close;
  const ended=new Promise(resolve=>{close=resolve;});
  const summary=()=>({planningMs,totalMs:performance.now()-start,workers:count,peakStates:peak,width,work,statesCreated:states,communicationBytesV8:bytes,tasks:traces,nodes,candidates:p.candidates,leaves:p.leaves});
  function finish(r){if(finished)return;finished=true;clearTimeout(timer);Promise.all(workers.map(w=>w.terminate())).then(()=>close({...summary(),...r,totalMs:performance.now()-start}));}
  const timer=setTimeout(()=>finish({status:'INTERROMPIDO',cost:null,reason:'tempo-total'}),Math.max(1,deadline-performance.now()));
  if(cfg.signal){if(cfg.signal.aborted)finish({status:'CANCELADO',cost:null});else cfg.signal.addEventListener('abort',()=>finish({status:'CANCELADO',cost:null}),{once:true});}
  function progress(e){onProgress({...e,completed:done.size,total:jobs.length});}
  function result(packet){
    const f=packet.table.get('|');
    if(!f)return {status:'INVIAVEL',cost:null};
    const ids=[],stack=[f.tr];while(stack.length){const t=stack.pop();if(!t)continue;if('e'in t){ids.push(t.e);stack.push(t.p);}else stack.push(t.l,t.r);}
    ids.sort((a,b)=>a-b);const v=S.verifyTour(graph,ids,0);
    if(v.cost!==f.cost)throw new Error('Reconstrução diverge do custo');
    return {status:'OTIMO',cost:v.cost,route:v.route,edgeIds:ids};
  }
  function dispatch(w){
    if(finished||!w.ready||w.busy)return;
    const job=jobs.find(j=>!done.has(j.id)&&!active.has(j.id)&&j.deps.every(d=>done.has(d)));
    if(!job)return;
    const children=job.deps.map(d=>packets.get(d));
    if(job.policy==='varredura')children.push({region:S.membership(graph.n,job.right),active:[],table:new Map(),rec:{depth:0}});
    const tree=job.v?{v:job.v}:{l:{v:job.left},r:{v:job.right},plan:job.policy};
    const data={type:'job',id:job.id,tree,children:job.v?null:children,opts:{partial:true,xy:input.xy,maxStates,maxMillis:Math.max(1,deadline-performance.now()),strategy:job.policy||'produto'}};
    bytes+=serialize(data).byteLength;w.busy=true;active.set(job.id,w);
    progress({type:'start',worker:w.number,id:job.id,size:job.size,kind:job.kind});w.postMessage(data);
    // Every region has one consumer. postMessage already cloned the input synchronously.
    for(const d of job.deps)packets.delete(d);
  }
  progress({type:'plan',leaves:p.leaves,candidates:p.candidates});
  for(let i=0;i<count&&!finished;i++){
    const w=new Worker(path.join(__dirname,'worker.cjs'),{resourceLimits:{maxOldGenerationSizeMb:384}});w.number=i;workers.push(w);
    w.on('error',e=>finish({status:'INTERROMPIDO',cost:null,reason:'worker',detail:e.message}));
    w.on('exit',code=>{if(!finished&&code)finish({status:'INTERROMPIDO',cost:null,reason:'worker-exit',detail:String(code)});});
    w.on('message',message=>{
      if(finished)return;
      if(message.type==='ready'){w.ready=true;dispatch(w);return;}
      if(message.error){finish({status:'ERRO',cost:null,detail:message.error});return;}
      const r=message.result;w.busy=false;active.delete(message.id);
      peak=Math.max(peak,r.peakStates||0);width=Math.max(width,r.width||0);work+=r.work||0;states+=r.statesCreated||0;
      nodes.push(...r.nodes.map(n=>({...n,worker:w.number,jobId:message.id})));
      traces.push({id:message.id,worker:w.number,start:message.start,end:message.end,size:jobs[message.id].size});
      if(r.status==='INTERROMPIDO'){finish({status:'INTERROMPIDO',cost:null,reason:r.reason});return;}
      bytes+=serialize(r.packet).byteLength;done.add(message.id);packets.set(message.id,r.packet);
      progress({type:'end',worker:w.number,id:message.id,peak:r.peakStates,width:r.width});
      if(message.id===p.root){try{finish(result(r.packet));}catch(e){finish({status:'ERRO',cost:null,detail:e.message});}return;}
      for(const other of workers)dispatch(other);
    });
    const init={type:'init',input};bytes+=serialize(init).byteLength;w.postMessage(init);
  }
  return ended;
}
module.exports={plan,run};
