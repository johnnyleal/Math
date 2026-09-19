const S=require('./solver.js'),E=require('./engine.cjs'),assert=require('node:assert/strict'),fs=require('node:fs');
const cases=require('../auditoria-plano-fronteiras/casos-proprios.json');
(async()=>{
  let checks=0;const check=(a,b)=>{assert.deepEqual(a,b);checks++;};
  for(const [i,c] of cases.filter(c=>c.n<=8).slice(0,24).entries()){
    const graph={n:c.n,edges:c.edges,xy:c.xy},g=S.makeGraph(c.n,c.edges);
    for(const strategy of ['produto','varredura','auto']){
      const h=S.bisect(g,{xy:c.xy,leafSize:3});
      const r=S.solve(g,h.tree,{xy:c.xy,strategy,productLimit:1});check(r.cost,c.optimum);
      if(r.status==='OTIMO')check(S.verifyTour(g,r.edgeIds,0).cost,c.optimum);
      check(r.peakStates<=S.signatureBound(r.width),true);
    }
    for(const workers of [1,2]){
      const r=await E.run(graph,{workers,leafSize:3,strategy:i%2?'produto':'varredura',maxMillis:10000});
      check(r.status,c.optimum===null?'INVIAVEL':'OTIMO');check(r.cost,c.optimum);
    }
  }
  const d=require('./dados/grafo-50-cidades.json'),input={n:50,edges:d.edges.map(e=>[e.a,e.b,e.km]),xy:d.cities.map(c=>[c.fictionalXKm,c.fictionalYKm])};
  const sample=[];
  for(const hub of ['centro','quinas'])for(const leafSize of [4,8]){
    const r=await E.run(input,{workers:2,hub,leafSize,maxMillis:10000});check(r.cost,3031);sample.push({hub,leafSize,cost:r.cost,totalMs:r.totalMs,width:r.width,peak:r.peakStates});
  }
  const one=await E.run(input,{workers:1,integration:'arvore',strategy:'produto'}),many=await E.run(input,{workers:4,integration:'arvore',strategy:'produto'});
  check(one.cost,many.cost);check(one.work,many.work);check(one.peakStates,many.peakStates);
  check(new Set(many.tasks.map(t=>t.worker)).size>1,true);
  const zero={n:4,edges:[[0,1,0],[1,2,0],[2,3,0],[3,0,0],[0,2,1]]};
  check((await E.run(zero,{workers:2})).cost,0);
  for(const input of [[3,[[0,1,NaN]]],[3,[[0,5,1]]],[3,[[0,1,.5]]]]){assert.throws(()=>S.makeGraph(...input));checks++;}
  const ctl=new AbortController();const promise=E.run(input,{workers:2,signal:ctl.signal});ctl.abort();check((await promise).status,'CANCELADO');
  const limit=await E.run(input,{workers:2,maxStates:1});check(limit.status,'INTERROMPIDO');
  const result={checks,failures:0,sample,parallel:{workersUsed:[...new Set(many.tasks.map(t=>t.worker))],tasks:many.tasks,work:many.work,peak:many.peakStates}};
  fs.writeFileSync(require('path').join(__dirname,'resultados/test-v2.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({checks,failures:0,sample,workersUsed:result.parallel.workersUsed}));
})().catch(e=>{console.error(e);process.exitCode=1;});
