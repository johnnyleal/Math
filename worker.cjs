const {parentPort}=require('node:worker_threads');
const S=require('./solver.js');let graph;
parentPort.on('message',m=>{
  try{
    if(m.type==='init'){graph=S.makeGraph(m.input.n,m.input.edges,m.input.names);parentPort.postMessage({type:'ready'});return;}
    const start=Date.now(),result=S.solve(graph,m.tree,{...m.opts,children:m.children});
    parentPort.postMessage({id:m.id,result,start,end:Date.now()});
  }catch(e){parentPort.postMessage({error:e.stack});}
});
