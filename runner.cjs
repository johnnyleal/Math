// One isolated benchmark process. The parent enforces the total deadline.
const E=require('./engine.cjs');
const fs=require('node:fs');
const cfg=JSON.parse(process.argv[3]||'{}');
const started=performance.now(),rss0=process.memoryUsage().rss;
let rssPeak=rss0;
const monitor=setInterval(()=>{rssPeak=Math.max(rssPeak,process.memoryUsage().rss);if(rssPeak>(cfg.maxRssMB||1536)*1024*1024){console.log(JSON.stringify({type:'result',result:{status:'INTERROMPIDO',cost:null,reason:'memoria-processo',totalMs:performance.now()-started,rssPeakMB:rssPeak/2**20}}));process.exit(0);}},100);
const file=process.argv[2];
try{
  const input=JSON.parse(fs.readFileSync(file,'utf8'));
  E.run(input,cfg,e=>console.log(JSON.stringify({type:'progress',event:e}))).then(result=>{
    clearInterval(monitor);rssPeak=Math.max(rssPeak,process.memoryUsage().rss);
    console.log(JSON.stringify({type:'result',result:{...result,engineTotalMs:result.totalMs,totalMs:performance.now()-started,rssPeakMB:rssPeak/2**20,rssStartMB:rss0/2**20}}));
  }).catch(e=>{clearInterval(monitor);console.log(JSON.stringify({type:'result',result:{status:'ERRO',cost:null,detail:e.stack}}));});
}catch(e){clearInterval(monitor);console.log(JSON.stringify({type:'result',result:{status:'ERRO',cost:null,detail:e.stack}}));}
