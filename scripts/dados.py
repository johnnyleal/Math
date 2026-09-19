"""Acquisition and strict TSPLIB/VRPLIB parsing. No weights are sparsified or symmetrised."""
from pathlib import Path
import urllib.request,json,gzip,hashlib,math,datetime
ROOT=Path(__file__).resolve().parents[1]
RAW=ROOT/'dados'/'fontes';RAW.mkdir(exist_ok=True)
# Chosen before running the candidate solvers; do not select by their outcomes.
SOURCES=[
 ('berlin52','https://raw.githubusercontent.com/mastqe/tsplib/master/berlin52.tsp','TSPLIB'),
 ('kroA100','https://raw.githubusercontent.com/mastqe/tsplib/master/kroA100.tsp','TSPLIB'),
 ('pr226','https://raw.githubusercontent.com/mastqe/tsplib/master/pr226.tsp','TSPLIB'),
 ('rat575','https://raw.githubusercontent.com/mastqe/tsplib/master/rat575.tsp','TSPLIB'),
 ('Loggi-n401-k23','https://galgos.inf.puc-rio.br/cvrplib/en/download/instance/268','Loggi'),
 ('Loggi-n1001-k31','https://galgos.inf.puc-rio.br/cvrplib/en/download/instance/273','Loggi'),
 ('ORTEC-n242-k12','https://galgos.inf.puc-rio.br/cvrplib/en/download/instance/274','ORTEC'),
 ('ORTEC-n701-k64','https://galgos.inf.puc-rio.br/cvrplib/en/download/instance/279','ORTEC'),
]
def parse(text):
    header={};sections={};section=None
    for line in text.splitlines():
        line=line.strip()
        if not line or line=='EOF':continue
        if line.endswith('_SECTION'):
            section=line;sections[section]=[];continue
        if section:sections[section].append(line)
        else:
            key,sep,value=line.partition(':')
            if sep:header[key.strip()]=value.strip()
    n=int(header['DIMENSION']);coords={}
    for line in sections.get('NODE_COORD_SECTION',[]):
        p=line.split();coords[int(p[0])-1]=[float(p[1]),float(p[2])]
    xy=[coords[i] for i in range(n)] if len(coords)==n else None
    typ=header['EDGE_WEIGHT_TYPE'];edges=[]
    if typ=='EUC_2D':
        if xy is None:raise ValueError('missing coordinates')
        for a in range(n):
            for b in range(a+1,n):edges.append([a,b,int(math.floor(math.hypot(xy[a][0]-xy[b][0],xy[a][1]-xy[b][1])+.5))])
    elif typ=='EXPLICIT':
        values=[int(w) for line in sections['EDGE_WEIGHT_SECTION'] for w in line.split()]
        fmt=header['EDGE_WEIGHT_FORMAT']
        if fmt=='LOWER_ROW':
            if len(values)!=n*(n-1)//2:raise ValueError('incorrect LOWER_ROW length')
            k=0
            for b in range(n):
                for a in range(b):edges.append([a,b,values[k]]);k+=1
        elif fmt=='FULL_MATRIX':
            if len(values)!=n*n:raise ValueError('incorrect FULL_MATRIX length')
            for a in range(n):
                if values[a*n+a]!=0:raise ValueError('nonzero diagonal')
                for b in range(a+1,n):
                    if values[a*n+b]!=values[b*n+a]:raise ValueError('asymmetric matrix unsupported')
                    edges.append([a,b,values[a*n+b]])
        else:raise ValueError('unsupported weight format '+fmt)
    else:raise ValueError('unsupported weight type '+typ)
    if any(w<0 for _,_,w in edges):raise ValueError('negative weight')
    return dict(n=n,edges=edges,xy=xy),header

def main():
    manifest=[]
    sample=json.loads((ROOT/'dados/grafo-50-cidades.json').read_text(encoding='utf8'))
    graph=dict(n=len(sample['cities']),edges=[[e['a'],e['b'],e['km']] for e in sample['edges']],xy=[[c['fictionalXKm'],c['fictionalYKm']] for c in sample['cities']],names=[c['name'] for c in sample['cities']],meta=dict(name='Cidades-50',source='Grafo fictício do projeto',unit='km',derived=False,model='circuito hamiltoniano não dirigido',reference=3031,referenceType='ótimo conferido por implementação independente'))
    (ROOT/'dados/Cidades-50.json').write_text(json.dumps(graph),encoding='utf8')
    manifest.append(dict(id='Cidades-50',file='Cidades-50.json',n=graph['n'],m=len(graph['edges']),**graph['meta']))
    for name,url,family in SOURCES:
        dest=RAW/(name+'.txt')
        try:
            if not dest.exists():
                req=urllib.request.Request(url,headers={'User-Agent':'Research benchmark download'})
                with urllib.request.urlopen(req,timeout=30) as r:payload=r.read()
                dest.write_bytes(payload)
            payload=dest.read_bytes();g,h=parse(payload.decode('utf-8-sig'))
            if h['NAME']!=name:raise ValueError('source name mismatch')
            derived=h['TYPE']=='CVRP'
            g['meta']=dict(name=name+(' — rota única derivada' if derived else ''),source=url,sourceFamily=family,sourceSha256=hashlib.sha256(payload).hexdigest(),retrievedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),unit='unidades da instância',derived=derived,originalModel=h['TYPE'],model='circuito hamiltoniano não dirigido',transformation='Removidas demandas, capacidade e frota; mantidos todos os vértices e custos originais.' if derived else 'EUC_2D: arredondamento TSPLIB floor(distância+0,5).' if h['EDGE_WEIGHT_TYPE']=='EUC_2D' else 'Matriz simétrica original.',reference=None,referenceType='nenhuma referência de ótimo adotada para esta entrada',comment=h.get('COMMENT',''))
            file=name+'.json';(ROOT/'dados'/file).write_text(json.dumps(g,separators=(',',':')),encoding='utf8')
            manifest.append(dict(id=name,file=file,n=g['n'],m=len(g['edges']),**g['meta']))
            print(name,g['n'],len(g['edges']),flush=True)
        except Exception as e:
            manifest.append(dict(id=name,source=url,error=str(e)));print(name,'ERROR',e,flush=True)
    (ROOT/'dados/manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf8')
if __name__=='__main__':main()
