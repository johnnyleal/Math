"""External heuristic baseline: uncapacitated one-vehicle OR-Tools, same allowed edges."""
from pathlib import Path
import sys,time,json
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'vendor'))
started=time.perf_counter()
from ortools.constraint_solver import pywrapcp,routing_enums_pb2
import ortools
data=json.loads(Path(sys.argv[1]).read_text(encoding='utf8'))
n=data['n'];adj=[{} for _ in range(n)]
for a,b,w in data['edges']:adj[a][b]=w;adj[b][a]=w
manager=pywrapcp.RoutingIndexManager(n,1,0)
routing=pywrapcp.RoutingModel(manager)
cb=routing.RegisterTransitCallback(lambda i,j:adj[manager.IndexToNode(i)].get(manager.IndexToNode(j),0))
routing.SetArcCostEvaluatorOfAllVehicles(cb)
for a in range(n):
    idx=manager.NodeToIndex(a)
    for b in range(n):
        if b==a:continue
        if b not in adj[a]:routing.NextVar(idx).RemoveValue(routing.End(0) if b==0 else manager.NodeToIndex(b))
params=pywrapcp.DefaultRoutingSearchParameters()
params.first_solution_strategy=routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
params.local_search_metaheuristic=routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
seconds=float(sys.argv[2]) if len(sys.argv)>2 else 30
remaining=max(.001,seconds-(time.perf_counter()-started))
params.time_limit.FromMilliseconds(int(remaining*1000))
solution=routing.SolveWithParameters(params)
result=dict(status='SEM_SOLUCAO_NO_PRAZO',cost=None,version=ortools.__version__,algorithm='PATH_CHEAPEST_ARC + GUIDED_LOCAL_SEARCH',optimalityCertified=False)
if solution:
    route=[];idx=routing.Start(0)
    while not routing.IsEnd(idx):
        route.append(manager.IndexToNode(idx));idx=solution.Value(routing.NextVar(idx))
    route.append(manager.IndexToNode(idx))
    if len(route)!=n+1 or len(set(route[:-1]))!=n or route[0]!=route[-1]:raise ValueError('invalid route')
    cost=sum(adj[a][b] for a,b in zip(route,route[1:]))
    if cost!=solution.ObjectiveValue():raise ValueError('objective mismatch')
    result.update(status='VIAVEL',cost=cost,route=route)
result['totalMs']=(time.perf_counter()-started)*1000
print(json.dumps(result))
