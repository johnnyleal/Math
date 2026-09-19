from pathlib import Path
import sys,subprocess,json,time,hashlib,platform,datetime
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'vendor'))
import psutil
NODE=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
manifest=json.loads((ROOT/'dados/manifest.json').read_text(encoding='utf8'))
global_start=time.monotonic();runs=[]
methods=[('varredura-1',dict(method='pure',workers=1)),('clusters-1',dict(method='clusters',workers=1)),('clusters-4',dict(method='clusters',workers=4)),('OR-Tools',None)]
output=ROOT/'resultados/benchmark.json'
max_rss=min(1536,psutil.virtual_memory().total/2**20*.25)
metadata=dict(startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),platform=platform.platform(),cpuCount=psutil.cpu_count(),ramMiB=psutil.virtual_memory().total/2**20,maxRssMB=max_rss,perRunSeconds=30,globalSeconds=1200,note='Lote pré-selecionado; 30 s totais por execução, 20 min globais. RSS amostrado a cada 50 ms. Tempos incluem início do processo, leitura, planejamento, comunicação e validação. OR-Tools é heurístico. Nenhum custo CVRP publicado é usado como ótimo da rota única derivada.')
def save():output.write_text(json.dumps({**metadata,'elapsedSeconds':time.monotonic()-global_start,'runs':runs},indent=2,ensure_ascii=False),encoding='utf8')
for item in manifest:
    if item.get('error'):continue
    datafile=ROOT/'dados'/item['file'];data=json.loads(datafile.read_text(encoding='utf8'))
    costs={(a,b):w for a,b,w in data['edges']};costs.update({(b,a):w for a,b,w in data['edges']})
    for method,cfg in methods:
        remaining=1200-(time.monotonic()-global_start)
        if remaining<1:save();sys.exit('Orçamento global atingido')
        limit=min(30,remaining)
        opts={**(cfg or {}),'leafSize':4,'hub':'nenhum','integration':'auto','maxStates':30000,'maxMillis':int(limit*1000),'maxRssMB':max_rss}
        args=[str(NODE),str(ROOT/'runner.cjs'),str(datafile),json.dumps(opts)] if cfg else [sys.executable,str(ROOT/'scripts/baseline.py'),str(datafile),str(max(.1,limit-.75))]
        log=ROOT/'resultados'/f'{item["id"]}--{method}.jsonl'
        started=time.monotonic();peak=0;reason=None
        with log.open('w',encoding='utf8') as f:
            p=subprocess.Popen(args,stdout=f,stderr=subprocess.STDOUT,cwd=ROOT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));proc=psutil.Process(p.pid)
            while p.poll() is None:
                try:
                    rss=proc.memory_info().rss+sum(ch.memory_info().rss for ch in proc.children(recursive=True))
                    peak=max(peak,rss)
                except (psutil.NoSuchProcess,psutil.AccessDenied):pass
                if time.monotonic()-started>=limit or peak>max_rss*2**20:
                    reason='tempo-total' if time.monotonic()-started>=limit else 'memoria-processo';p.kill();break
                time.sleep(.05)
            p.wait()
        wall=(time.monotonic()-started)*1000
        result=None
        for line in log.read_text(encoding='utf8').splitlines():
            try:
                msg=json.loads(line)
                if cfg and msg.get('type')=='result':result=msg['result']
                elif not cfg and 'status' in msg:result=msg
            except (ValueError,TypeError):pass
        if result is None:result=dict(status='INTERROMPIDO' if reason else 'ERRO',cost=None,reason=reason or 'sem-resultado')
        validation='sem rota'
        if result.get('cost') is not None:
            r=result['route'];assert len(r)==data['n']+1 and r[0]==r[-1]==0 and set(r[:-1])==set(range(data['n']))
            assert sum(costs[a,b] for a,b in zip(r,r[1:]))==result['cost']
            validation='rota e custo conferidos em Python'
        row=dict(instance=item['id'],n=data['n'],method=method,config=opts,status=result['status'],cost=result.get('cost'),reason=result.get('reason'),wallMs=wall,rssPeakMB=peak/2**20,peakStates=result.get('peakStates'),width=result.get('width'),work=result.get('work'),communicationBytesV8=result.get('communicationBytesV8'),validation=validation,derived=item.get('derived',False),inputSha256=hashlib.sha256(datafile.read_bytes()).hexdigest(),route=result.get('route'),optimalityCertified=result['status']=='OTIMO',version=result.get('version'))
        runs.append(row);save();print(item['id'],method,row['status'],row['cost'],round(wall),flush=True)
save()
