'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const S=require('./solver.js'),root=__dirname,jobs=new Map();let running=null;
const port=8765;
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){let size=0,parts=[];for await(const b of req){size+=b.length;if(size>24*1024*1024)throw new Error('Arquivo excede 24 MB');parts.push(b);}return JSON.parse(Buffer.concat(parts).toString());}
function catalog(){return JSON.parse(fs.readFileSync(path.join(root,'dados/manifest.json'),'utf8'));}
function spawnRun(file,cfg){
  const id=crypto.randomUUID(),job={id,events:[],result:null};jobs.set(id,job);running=id;
  const child=spawn(process.execPath,[path.join(root,'runner.cjs'),file,JSON.stringify(cfg)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});job.child=child;const started=performance.now();
  const timer=setTimeout(()=>{job.result={status:'INTERROMPIDO',cost:null,reason:'tempo-total',totalMs:performance.now()-started};child.kill();},cfg.maxMillis);
  let pending='',stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4000);});
  child.stdout.on('data',b=>{pending+=b;let p;while((p=pending.indexOf('\n'))>=0){const line=pending.slice(0,p);pending=pending.slice(p+1);try{const m=JSON.parse(line);if(m.type==='progress')job.events.push(m.event);else if(m.type==='result'&&!job.result)job.result=m.result;}catch(e){stderr+=e.message;}}});
  child.on('error',e=>{job.result={status:'ERRO',cost:null,detail:e.message};});
  child.on('close',()=>{clearTimeout(timer);if(!job.result)job.result={status:'ERRO',cost:null,detail:stderr||'Processo encerrado sem resultado'};job.result.totalWallMs=performance.now()-started;job.child=null;if(running===id)running=null;fs.writeFileSync(path.join(root,'resultados','ultima-execucao.json'),JSON.stringify({id,cfg,result:job.result},null,2));});
  return id;
}
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    if(req.method==='POST'){
      if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return json(res,403,{error:'Origem não permitida'});
      const data=await body(req);
      if(url.pathname==='/api/cancel'){
        const j=jobs.get(data.id);if(j?.child){j.result={status:'CANCELADO',cost:null};j.child.kill();}return json(res,200,{ok:true});
      }
      if(url.pathname==='/api/run'){
        if(running)return json(res,409,{error:'Já existe uma execução ativa. Cancele ou aguarde.'});
        let file;
        if(data.input){
          const g=data.input;if(!Number.isInteger(g.n)||g.n>1500)throw new Error('Importação: limite de 1.500 cidades');
          S.makeGraph(g.n,g.edges);if(g.xy&&(!Array.isArray(g.xy)||g.xy.length!==g.n||g.xy.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))))throw new Error('Coordenadas inválidas');
          file=path.join(root,'dados','importado.json');fs.writeFileSync(file,JSON.stringify(g));
        }else{const item=catalog().find(x=>x.id===data.id&&!x.error);if(!item)throw new Error('Instância desconhecida');file=path.join(root,'dados',item.file);}
        const c=data.config||{};
        const cfg={workers:[1,2,4].includes(+c.workers)?+c.workers:2,method:c.method==='pure'?'pure':'clusters',leafSize:[4,6,8].includes(+c.leafSize)?+c.leafSize:4,hub:['nenhum','centro','quinas'].includes(c.hub)?c.hub:'nenhum',integration:['arvore','cadeia'].includes(c.integration)?c.integration:'auto',strategy:'auto',maxStates:30000,maxRssMB:1536,maxMillis:Math.max(1000,Math.min(30000,Number(c.maxMillis)||10000))};
        return json(res,200,{id:spawnRun(file,cfg)});
      }
      return json(res,404,{error:'Rota desconhecida'});
    }
    if(req.method!=='GET')return json(res,405,{error:'Método não permitido'});
    if(url.pathname==='/api/manifest')return json(res,200,catalog());
    if(url.pathname==='/api/data'){const item=catalog().find(x=>x.id===url.searchParams.get('id')&&!x.error);if(!item)return json(res,404,{error:'Instância desconhecida'});res.setHeader('Content-Type','application/json');return fs.createReadStream(path.join(root,'dados',item.file)).pipe(res);}
    if(url.pathname==='/api/job'){const j=jobs.get(url.searchParams.get('id'));if(!j)return json(res,404,{error:'Execução desconhecida'});const cursor=Math.max(0,Number(url.searchParams.get('cursor'))||0);return json(res,200,{events:j.events.slice(cursor),cursor:j.events.length,result:j.result,closed:!j.child});}
    if(url.pathname==='/api/results'){const f=path.join(root,'resultados/benchmark.json');return json(res,200,fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):{runs:[]});}
    const files={'/':'laboratorio.html','/laboratorio.html':'laboratorio.html','/lab.js':'lab.js','/lab.css':'lab.css','/index.html':'index.html'};
    const f=files[url.pathname];if(!f)return json(res,404,{error:'Arquivo desconhecido'});
    res.writeHead(200,{'Content-Type':f.endsWith('.js')?'text/javascript; charset=utf-8':f.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store'});fs.createReadStream(path.join(root,f)).pipe(res);
  }catch(e){json(res,400,{error:e.message});}
}).listen(port,'127.0.0.1',()=>console.log(`Laboratório: http://127.0.0.1:${port}`));
process.on('SIGINT',()=>{for(const j of jobs.values())j.child?.kill();process.exit();});
