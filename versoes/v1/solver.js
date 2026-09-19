/* solver.js — núcleo exato de rota por fronteiras.
 * Programação dinâmica por estados de fronteira sobre uma hierarquia de regiões.
 * O mesmo arquivo roda no Node (testar.js) e no navegador (index.html).
 *
 * Estado sobre o conjunto ativo A (vértices que ainda podem receber estradas):
 *   d[i] ∈ {0,1,2}  estradas já escolhidas no vértice A[i]
 *   m[i]            se d[i]==1, índice do outro extremo do caminho que começa em A[i]; senão -1
 * Dois estados com a mesma chave (d, m) são intercambiáveis para qualquer continuação:
 * guarda-se apenas o mais barato. Um vértice sai do conjunto ativo (é "esquecido")
 * assim que não tem mais estrada pendente; nesse momento precisa ter d = 2.
 *
 * Integração de duas regiões P e Q:
 *   'produto'   — combina as tabelas dos dois filhos (custo |T_P|·|T_Q|), depois varre as estradas cruzadas
 *   'varredura' — parte da tabela de P e varre as estradas de Q uma a uma (ignora a tabela de Q)
 *   'auto'      — produto quando |T_P|·|T_Q| cabe no limite, senão varredura
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Solver = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ---------------------------------------------------------------- grafo
  function makeGraph(n, edgeList, names) {
    if (n < 3) throw new Error('o modelo exige pelo menos 3 cidades');
    const edges = edgeList.map(([a, b, w], id) => ({ a, b, w, id }));
    const adj = Array.from({ length: n }, () => []);
    const seenPair = new Set();
    for (const e of edges) {
      if (e.a === e.b) throw new Error('laço em ' + e.a);
      if (!(e.w > 0)) throw new Error('custo não positivo na estrada ' + e.id);
      const pair = Math.min(e.a, e.b) + '-' + Math.max(e.a, e.b);
      if (seenPair.has(pair)) throw new Error('estradas paralelas entre ' + e.a + ' e ' + e.b + ': cadastre só a mais barata');
      seenPair.add(pair);
      adj[e.a].push({ to: e.b, w: e.w, id: e.id });
      adj[e.b].push({ to: e.a, w: e.w, id: e.id });
    }
    return { n, edges, adj, names: names || Array.from({ length: n }, (_, i) => String(i)) };
  }

  // fronteira global de um subconjunto S (Uint8Array de pertinência): vértices de S com vizinho fora de S
  function boundarySet(graph, inS) {
    const B = new Set();
    for (const e of graph.edges) {
      if (inS[e.a] && !inS[e.b]) B.add(e.a);
      else if (inS[e.b] && !inS[e.a]) B.add(e.b);
    }
    return B;
  }
  function membership(n, ids) { const m = new Uint8Array(n); for (const v of ids) m[v] = 1; return m; }

  // ------------------------------------------------------------ contagem
  // Número de assinaturas possíveis sobre b vértices ativos:
  //   Σ_{j par} C(b,j) · 2^(b−j) · (j−1)!!   (j vértices com d=1 emparelhados; os outros com d∈{0,2})
  function signatureBound(b) {
    const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); };
    const dfact = j => { let r = 1; for (let i = j - 1; i > 0; i -= 2) r *= i; return r; };
    let total = 0;
    for (let j = 0; j <= b; j += 2) total += C(b, j) * Math.pow(2, b - j) * dfact(j);
    return total;
  }

  // ------------------------------------------------------------- ordens
  // Cuthill–McKee: busca em largura visitando vizinhos por grau crescente; produz ordem de banda pequena
  function cuthillMcKee(count, neighbors, start) {
    const order = [], seen = new Uint8Array(count);
    const degree = i => neighbors(i).length;
    const seeds = Array.from({ length: count }, (_, i) => i).sort((a, b) => degree(a) - degree(b) || a - b);
    if (start != null) seeds.unshift(start);
    for (const s of seeds) {
      if (seen[s]) continue;
      seen[s] = 1; const queue = [s];
      while (queue.length) {
        const v = queue.shift(); order.push(v);
        const nb = [...new Set(neighbors(v))].filter(u => !seen[u]).sort((a, b) => degree(a) - degree(b) || a - b);
        for (const u of nb) { seen[u] = 1; queue.push(u); }
      }
    }
    return order;
  }

  // ordem de varredura dos vértices: eixo geométrico mais longo (com origem no início) ou Cuthill–McKee
  function vertexOrder(graph, opts) {
    opts = opts || {};
    const n = graph.n, start = opts.start || 0;
    if (opts.order) return opts.order.slice();
    if (opts.xy) {
      const xs = opts.xy.map(p => p[0]), ys = opts.xy.map(p => p[1]);
      const axis = (Math.max(...xs) - Math.min(...xs)) >= (Math.max(...ys) - Math.min(...ys)) ? 0 : 1;
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => opts.xy[a][axis] - opts.xy[b][axis] || opts.xy[a][1 - axis] - opts.xy[b][1 - axis] || a - b);
      if (order.indexOf(start) > n / 2) order.reverse();
      return order;
    }
    return cuthillMcKee(n, v => graph.adj[v].map(x => x.to), start);
  }

  // ---------------------------------------------------------------- núcleo
  // tree: folha = {v:[ids]} ; nó interno = {l:tree, r:tree}
  // opts: {maxStates, mode:'exato'|'um-caminho'|'sem-conectividade', strategy:'auto'|'produto'|'varredura',
  //        productLimit, start, xy, order}
  function solve(graph, tree, opts) {
    opts = opts || {};
    const n = graph.n;
    const mode = opts.mode || 'exato';
    const strategy = opts.strategy || 'auto';
    const productLimit = opts.productLimit || 150000;
    const maxStates = opts.maxStates || 5e5;      // pico de estados vivos (memória)
    const maxWork = opts.maxWork || Infinity;     // transições totais (trabalho)
    const maxMillis = opts.maxMillis || Infinity; // tempo de parede
    const start = opts.start || 0;
    const t0 = now();
    let created = 0, transitions = 0, peak = 0, interrupted = false, reason = null;
    const nodes = [];
    function guard() {
      if (transitions > maxWork) { interrupted = true; reason = 'trabalho'; throw new Error('INTERROMPIDO'); }
      if (now() - t0 > maxMillis) { interrupted = true; reason = 'tempo'; throw new Error('INTERROMPIDO'); }
    }

    const order = vertexOrder(graph, opts);
    const rank = new Int32Array(n); order.forEach((v, i) => { rank[v] = i; });
    const byRank = list => list.slice().sort((e, f) =>
      Math.max(rank[e.a], rank[e.b]) - Math.max(rank[f.a], rank[f.b]) ||
      Math.min(rank[e.a], rank[e.b]) - Math.min(rank[f.a], rank[f.b]) || e.id - f.id);

    const key = (d, m) => { let s = ''; for (let i = 0; i < d.length; i++) s += d[i]; s += '|'; for (let i = 0; i < m.length; i++) s += m[i] + ','; return s; };
    const keyD = d => { let s = ''; for (let i = 0; i < d.length; i++) s += d[i]; return s + '|'; };

    function insert(map, d, m, cost, tr, dropPi) {
      const k = dropPi ? keyD(d) : key(d, m);
      const cur = map.get(k);
      if (cur === undefined) { created++; map.set(k, { d, m, cost, tr }); }
      else if (cost < cur.cost) map.set(k, { d, m, cost, tr });
    }
    function check(map) {
      if (map.size > peak) peak = map.size;
      if (peak > maxStates) { interrupted = true; reason = 'estados'; throw new Error('INTERROMPIDO'); }
      guard();
    }

    // acrescenta uma estrada (ia,ib): ramo "não usa" e ramo "usa"
    function introduce(states, ia, ib, w, eid, isRoot) {
      const next = new Map();
      for (const s of states.values()) {
        transitions++;
        if ((transitions & 8191) === 0) { if (next.size > peak) peak = next.size; if (peak > maxStates) { interrupted = true; reason = 'estados'; throw new Error('INTERROMPIDO'); } guard(); }
        insert(next, s.d, s.m, s.cost, s.tr, false);
        const da = s.d[ia], db = s.d[ib];
        if (da >= 2 || db >= 2) continue;
        const d = s.d.slice(), m = s.m.slice();
        if (da === 1 && db === 1) {
          if (m[ia] === ib) {
            // fecharia um ciclo: só vale na raiz e só se todo o resto já estiver completo
            if (!isRoot) continue;
            let ok = true;
            for (let j = 0; j < d.length; j++) if (j !== ia && j !== ib && d[j] !== 2) { ok = false; break; }
            if (!ok) continue;
            d[ia] = 2; d[ib] = 2; m[ia] = -1; m[ib] = -1;
          } else {
            const x = m[ia], y = m[ib];
            d[ia] = 2; d[ib] = 2; m[ia] = -1; m[ib] = -1; m[x] = y; m[y] = x;
          }
        } else if (da === 1) { const x = m[ia]; d[ia] = 2; m[ia] = -1; d[ib] = 1; m[ib] = x; m[x] = ib; }
        else if (db === 1) { const y = m[ib]; d[ib] = 2; m[ib] = -1; d[ia] = 1; m[ia] = y; m[y] = ia; }
        else { d[ia] = 1; d[ib] = 1; m[ia] = ib; m[ib] = ia; }
        insert(next, d, m, s.cost + w, { e: eid, p: s.tr }, false);
      }
      check(next);
      return next;
    }

    // remove do conjunto ativo os vértices fora de keep; eles precisam estar completos (d=2)
    function forget(states, active, keep, leafFinal) {
      const keepIdx = [];
      for (let i = 0; i < active.length; i++) if (keep.has(active[i])) keepIdx.push(i);
      if (keepIdx.length === active.length && mode === 'exato') return { states, active };
      const newIndex = new Int32Array(active.length).fill(-1);
      keepIdx.forEach((i, k) => { newIndex[i] = k; });
      const next = new Map();
      const dropPi = mode === 'sem-conectividade';
      outer: for (const s of states.values()) {
        for (let i = 0; i < active.length; i++) if (newIndex[i] < 0 && s.d[i] !== 2) continue outer;
        if (mode === 'um-caminho' && leafFinal && keepIdx.length > 0) {
          // leitura literal de "um caminho por cluster": exatamente dois extremos, nenhum vértice intocado
          let ones = 0, zeros = 0;
          for (let k = 0; k < keepIdx.length; k++) { const x = s.d[keepIdx[k]]; if (x === 1) ones++; else if (x === 0) zeros++; }
          if (zeros > 0 || ones !== 2) continue;
        }
        const d = new Uint8Array(keepIdx.length), m = new Int16Array(keepIdx.length);
        for (let k = 0; k < keepIdx.length; k++) {
          const i = keepIdx[k]; d[k] = s.d[i];
          if (s.m[i] < 0) m[k] = -1;
          else { const j = newIndex[s.m[i]]; if (j < 0) throw new Error('parceiro esquecido com d=1'); m[k] = j; }
        }
        insert(next, d, m, s.cost, s.tr, dropPi);
      }
      check(next);
      return { states: next, active: keepIdx.map(i => active[i]) };
    }

    function leavingCount(inR) {
      const c = new Int32Array(n);
      for (const e of graph.edges) { if (inR[e.a] && !inR[e.b]) c[e.a]++; else if (inR[e.b] && !inR[e.a]) c[e.b]++; }
      return c;
    }

    // varre uma lista de estradas sobre o conjunto ativo, esquecendo vértices assim que ficam sem pendência
    function sweep(states, active, edges, inR, isRoot, isLeaf) {
      const leave = leavingCount(inR);
      const pending = new Map(active.map(v => [v, leave[v]]));
      for (const e of edges) { pending.set(e.a, pending.get(e.a) + 1); pending.set(e.b, pending.get(e.b) + 1); }
      let act = active, pos = new Map(act.map((v, i) => [v, i])), localPeak = states.size;
      for (const e of edges) {
        const ia = pos.get(e.a), ib = pos.get(e.b);
        if (ia === undefined || ib === undefined) throw new Error('estrada fora do conjunto ativo');
        states = introduce(states, ia, ib, e.w, e.id, isRoot);
        if (states.size > localPeak) localPeak = states.size;
        pending.set(e.a, pending.get(e.a) - 1); pending.set(e.b, pending.get(e.b) - 1);
        if (pending.get(e.a) === 0 || pending.get(e.b) === 0) {
          const f = forget(states, act, new Set(act.filter(v => pending.get(v) > 0)), false);
          states = f.states; act = f.active; pos = new Map(act.map((v, i) => [v, i]));
        }
      }
      const f = forget(states, act, boundarySet(graph, inR), isLeaf);
      return { states: f.states, active: f.active, peak: localPeak };
    }

    // descarta estados que não conseguem completar o grau 2 com as estradas ainda disponíveis
    function feasible(table, active, avail) {
      const out = new Map();
      outer: for (const [k, s] of table) {
        for (let i = 0; i < active.length; i++) if (s.d[i] + avail[active[i]] < 2) continue outer;
        out.set(k, s);
      }
      return out;
    }

    // produto das tabelas dos dois filhos (regiões disjuntas)
    function join(activeP, tableP, activeQ, tableQ) {
      const active = activeP.concat(activeQ).sort((a, b) => a - b);
      const pos = new Map(active.map((v, i) => [v, i]));
      const mapP = activeP.map(v => pos.get(v)), mapQ = activeQ.map(v => pos.get(v));
      const next = new Map();
      for (const sp of tableP.values()) for (const sq of tableQ.values()) {
        transitions++;
        if ((transitions & 8191) === 0) { if (next.size > peak) peak = next.size; if (peak > maxStates) { interrupted = true; reason = 'estados'; throw new Error('INTERROMPIDO'); } guard(); }
        const d = new Uint8Array(active.length), m = new Int16Array(active.length).fill(-1);
        for (let i = 0; i < mapP.length; i++) { d[mapP[i]] = sp.d[i]; if (sp.m[i] >= 0) m[mapP[i]] = mapP[sp.m[i]]; }
        for (let i = 0; i < mapQ.length; i++) { d[mapQ[i]] = sq.d[i]; if (sq.m[i] >= 0) m[mapQ[i]] = mapQ[sq.m[i]]; }
        insert(next, d, m, sp.cost + sq.cost, { l: sp.tr, r: sq.tr }, false);
      }
      check(next);
      return { states: next, active };
    }

    // estende os estados de P com os vértices de Q (todos com d=0) para a varredura
    function extend(tableP, activeP, active) {
      const pos = new Map(active.map((v, i) => [v, i]));
      const mapP = activeP.map(v => pos.get(v));
      const out = new Map();
      for (const s of tableP.values()) {
        const d = new Uint8Array(active.length), m = new Int16Array(active.length).fill(-1);
        for (let i = 0; i < mapP.length; i++) { d[mapP[i]] = s.d[i]; if (s.m[i] >= 0) m[mapP[i]] = mapP[s.m[i]]; }
        insert(out, d, m, s.cost, s.tr, false);
      }
      return out;
    }

    function run(node, level) {
      const tStart = now(), trans0 = transitions;
      if (node.v) {
        const active = node.v.slice().sort((a, b) => a - b);
        const inR = membership(n, active);
        const isRoot = active.length === n;
        let states = new Map();
        insert(states, new Uint8Array(active.length), new Int16Array(active.length).fill(-1), 0, null, false);
        const internal = byRank(graph.edges.filter(e => inR[e.a] && inR[e.b]));
        const sw = sweep(states, active, internal, inR, isRoot, true);
        const rec = { kind: 'folha', level, size: active.length, activeIn: active.length, boundaryOut: sw.active.length,
          edges: internal.length, peak: sw.peak, out: sw.states.size, work: transitions - trans0, millis: now() - tStart,
          vertices: active, strategy: 'folha' };
        rec.depth = rec.work;
        nodes.push(rec);
        return { region: inR, active: sw.active, table: sw.states, rec };
      }
      const P = run(node.l, level + 1), Q = run(node.r, level + 1);
      const tMerge = now(), transM = transitions;
      const inR = new Uint8Array(n); let size = 0;
      for (let v = 0; v < n; v++) { inR[v] = P.region[v] | Q.region[v]; size += inR[v]; }
      const isRoot = size === n;
      const cross = graph.edges.filter(e => (P.region[e.a] && Q.region[e.b]) || (P.region[e.b] && Q.region[e.a]));
      const avail = leavingCount(inR);
      for (const e of cross) { avail[e.a]++; avail[e.b]++; }
      const TP = feasible(P.table, P.active, avail), TQ = feasible(Q.table, Q.active, avail);
      let strat = strategy;
      if (strat === 'auto') strat = TP.size * TQ.size <= productLimit ? 'produto' : 'varredura';
      let states, active, edges;
      if (strat === 'produto') {
        const j = join(P.active, TP, Q.active, TQ); states = j.states; active = j.active; edges = byRank(cross);
      } else {
        const qv = []; for (let v = 0; v < n; v++) if (Q.region[v]) qv.push(v);
        active = P.active.concat(qv).sort((a, b) => a - b);
        states = extend(TP, P.active, active);
        edges = byRank(graph.edges.filter(e => (Q.region[e.a] && Q.region[e.b])).concat(cross));
      }
      const sw = sweep(states, active, edges, inR, isRoot, false);
      const rec = { kind: 'união', level, size, activeIn: active.length, boundaryOut: sw.active.length, edges: edges.length,
        tableP: TP.size, tableQ: TQ.size, strategy: strat, peak: sw.peak, out: sw.states.size,
        work: transitions - transM, millis: now() - tMerge, children: [P.rec, Q.rec] };
      rec.depth = rec.work + Math.max(P.rec.depth, Q.rec.depth);
      nodes.push(rec);
      return { region: inR, active: sw.active, table: sw.states, rec };
    }

    // valida a hierarquia: partição exata de V
    (function validate(t) {
      const seen = new Uint8Array(n);
      (function walk(x) {
        if (x.v) { for (const v of x.v) { if (v < 0 || v >= n || seen[v]) throw new Error('hierarquia inválida no vértice ' + v); seen[v] = 1; } }
        else { walk(x.l); walk(x.r); }
      })(t);
      for (let v = 0; v < n; v++) if (!seen[v]) throw new Error('vértice ' + v + ' fora da hierarquia');
    })(tree);

    let rootResult = null;
    try { rootResult = run(tree, 0); }
    catch (err) { if (!interrupted) throw err; }

    const widthProduct = nodes.filter(r => r.strategy !== 'varredura').reduce((w, r) => Math.max(w, r.activeIn), 0);
    const base = { mode, strategy, nodes, width: widthProduct, staticWidth: treeStats(graph, tree).width, work: transitions,
      depth: rootResult ? rootResult.rec.depth : nodes.reduce((w, r) => Math.max(w, r.depth), 0),
      peakStates: peak, statesCreated: created, millis: now() - t0, signatureBound: signatureBound(widthProduct),
      leafWork: nodes.filter(r => r.kind === 'folha').reduce((s, r) => s + r.work, 0) };
    if (interrupted) return Object.assign(base, { status: 'INTERROMPIDO', cost: null, reason });
    const final = rootResult.table.get('|');
    if (!final) return Object.assign(base, { status: 'INVIAVEL', cost: null });
    const edgeIds = [];
    (function collect(tr) { if (!tr) return; if ('e' in tr) { edgeIds.push(tr.e); collect(tr.p); } else { collect(tr.l); collect(tr.r); } })(final.tr);
    edgeIds.sort((a, b) => a - b);
    const ver = verifyTour(graph, edgeIds, start);
    if (ver.cost !== final.cost) throw new Error('custo reconstruído difere da tabela');
    // um modo degradado devolve um circuito válido, mas sem direito ao rótulo de ótimo
    return Object.assign(base, { status: mode === 'exato' ? 'OTIMO' : 'CIRCUITO', cost: final.cost, edgeIds, route: ver.route });
  }

  // confere que as estradas formam um único ciclo por todos os vértices; devolve a ordem a partir de start
  function verifyTour(graph, edgeIds, start) {
    const n = graph.n, deg = new Int32Array(n), nb = Array.from({ length: n }, () => []);
    let cost = 0;
    if (edgeIds.length !== n) throw new Error('circuito com ' + edgeIds.length + ' estradas para ' + n + ' cidades');
    for (const id of edgeIds) { const e = graph.edges[id]; deg[e.a]++; deg[e.b]++; nb[e.a].push(e.b); nb[e.b].push(e.a); cost += e.w; }
    for (let v = 0; v < n; v++) if (deg[v] !== 2) throw new Error('grau ' + deg[v] + ' na cidade ' + v);
    const route = [start]; let prev = -1, cur = start;
    for (let i = 0; i < n; i++) { const nx = nb[cur][0] === prev ? nb[cur][1] : nb[cur][0]; route.push(nx); prev = cur; cur = nx; }
    if (route[n] !== start || new Set(route.slice(0, n)).size !== n) throw new Error('as estradas não formam um único ciclo');
    return { cost, route };
  }

  // -------------------------------------------------------- hierarquias
  // Bissecção recursiva. opts: {leafSize, xy, refine, hub:'nenhum'|'centro'|'quinas', hubWeight, balance}
  function bisect(graph, opts) {
    opts = opts || {};
    const n = graph.n, leafSize = opts.leafSize || 6, xy = opts.xy || null;
    const balance = opts.balance == null ? 0.25 : opts.balance;
    const hub = opts.hub || 'nenhum', hubWeight = opts.hubWeight == null ? 0.8 : opts.hubWeight;
    const degree = new Int32Array(n); for (const e of graph.edges) { degree[e.a]++; degree[e.b]++; }
    const leaves = [], cuts = [];

    // conjunto ativo da união: |B(a)| + |B(b)| com fronteiras globais (regiões disjuntas)
    function mergeWidth(inA, inB) { return boundarySet(graph, inA).size + boundarySet(graph, inB).size; }
    function hubScore(ids, rect) {
      if (hub === 'nenhum' || !xy) return 0;
      let best = ids[0]; for (const v of ids) if (degree[v] > degree[best] || (degree[v] === degree[best] && v < best)) best = v;
      const [x0, y0, x1, y1] = rect, u = (xy[best][0] - x0) / Math.max(1e-9, x1 - x0), w = (xy[best][1] - y0) / Math.max(1e-9, y1 - y0);
      if (hub === 'centro') return (u - .5) ** 2 + (w - .5) ** 2;
      let m = Infinity; for (const a of [0, 1]) for (const b of [0, 1]) m = Math.min(m, (u - a) ** 2 + (w - b) ** 2);
      return m;
    }
    function refineCut(a, b) {
      const inA = membership(n, a), inB = membership(n, b);
      let cur = mergeWidth(inA, inB), moved = 0;
      const minSide = Math.max(1, Math.floor(balance * (a.length + b.length)));
      for (let round = 0; round < 40; round++) {
        let improved = false;
        for (const [from, to, inF, inT] of [[a, b, inA, inB], [b, a, inB, inA]]) {
          if (from.length - 1 < minSide) continue;
          for (let i = 0; i < from.length; i++) {
            const v = from[i];
            if (!graph.adj[v].some(x => inT[x.to])) continue;
            inF[v] = 0; inT[v] = 1;
            const w = mergeWidth(inA, inB);
            const better = w < cur || (w === cur && Math.abs(from.length - 1 - (to.length + 1)) < Math.abs(from.length - to.length));
            if (better) { from.splice(i, 1); to.push(v); cur = w; moved++; improved = true; break; }
            inF[v] = 1; inT[v] = 0;
          }
          if (improved) break;
        }
        if (!improved) break;
      }
      return { a, b, moved, width: cur };
    }
    function split(ids, rect, level) {
      if (ids.length <= leafSize) { const leaf = { v: ids.slice().sort((p, q) => p - q), rect }; leaves.push(leaf); return { v: leaf.v }; }
      const minSide = Math.max(1, Math.floor(balance * ids.length));
      const cands = [];
      if (xy) {
        for (const axis of [0, 1]) {
          const vals = [...new Set(ids.map(v => xy[v][axis]))].sort((p, q) => p - q);
          for (let i = 0; i + 1 < vals.length; i++) {
            const cut = (vals[i] + vals[i + 1]) / 2;
            const a = ids.filter(v => xy[v][axis] < cut), b = ids.filter(v => xy[v][axis] >= cut);
            if (Math.min(a.length, b.length) < minSide) continue;
            const ra = rect.slice(), rb = rect.slice(); ra[axis + 2] = cut; rb[axis] = cut;
            const w = mergeWidth(membership(n, a), membership(n, b));
            const score = w + 0.35 * Math.abs(a.length - b.length) / ids.length + hubWeight * (hubScore(a, ra) + hubScore(b, rb));
            cands.push({ score, axis, cut, a, b, ra, rb, w });
          }
        }
      } else {
        const inR = membership(n, ids);
        const order = cuthillMcKee(n, v => inR[v] ? graph.adj[v].map(x => x.to).filter(u => inR[u]) : [], ids[0]).filter(v => inR[v]);
        for (let k = minSide; k <= ids.length - minSide; k++) {
          const a = order.slice(0, k), b = order.slice(k);
          const w = mergeWidth(membership(n, a), membership(n, b));
          cands.push({ score: w + 0.35 * Math.abs(a.length - b.length) / ids.length, axis: -1, cut: k, a, b, ra: rect, rb: rect, w });
        }
      }
      if (!cands.length) { const leaf = { v: ids.slice().sort((p, q) => p - q), rect }; leaves.push(leaf); return { v: leaf.v }; }
      cands.sort((p, q) => p.score - q.score || p.axis - q.axis || p.cut - q.cut);
      let best = cands[0], moved = 0;
      if (opts.refine) { const r = refineCut(best.a.slice(), best.b.slice()); best = Object.assign({}, best, { a: r.a, b: r.b, w: r.width }); moved = r.moved; }
      cuts.push({ level, size: ids.length, axis: best.axis, cut: best.cut, width: best.w, moved, rect });
      return { l: split(best.a, best.ra, level + 1), r: split(best.b, best.rb, level + 1) };
    }
    let rect = [0, 0, 1, 1];
    if (xy) {
      const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
      rect = [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1];
    }
    const tree = split(Array.from({ length: n }, (_, i) => i), rect, 0);
    return { tree, leaves, cuts };
  }

  // Cadeia de varredura: as folhas são coladas uma a uma numa ordem planejada (eixo geométrico mais longo,
  // ou Cuthill–McKee sobre o grafo das folhas), começando pela folha da origem quando isso não dobra a frente.
  function sweepChain(graph, leaves, opts) {
    opts = opts || {};
    const start = opts.start || 0, L = leaves.length;
    const first = leaves.findIndex(l => l.v.includes(start));
    if (first < 0) throw new Error('origem fora das folhas');
    let order;
    if (opts.xy) {
      const centers = leaves.map(l => [l.v.reduce((s, v) => s + opts.xy[v][0], 0) / l.v.length, l.v.reduce((s, v) => s + opts.xy[v][1], 0) / l.v.length]);
      const xs = opts.xy.map(p => p[0]), ys = opts.xy.map(p => p[1]);
      const axis = (Math.max(...xs) - Math.min(...xs)) >= (Math.max(...ys) - Math.min(...ys)) ? 0 : 1;
      order = Array.from({ length: L }, (_, i) => i).sort((a, b) => centers[a][axis] - centers[b][axis] || centers[a][1 - axis] - centers[b][1 - axis] || a - b);
      if (order.indexOf(first) > L / 2) order.reverse();
    } else {
      const owner = new Int32Array(graph.n); leaves.forEach((l, i) => l.v.forEach(v => { owner[v] = i; }));
      const nb = Array.from({ length: L }, () => new Set());
      for (const e of graph.edges) if (owner[e.a] !== owner[e.b]) { nb[owner[e.a]].add(owner[e.b]); nb[owner[e.b]].add(owner[e.a]); }
      order = cuthillMcKee(L, i => [...nb[i]], first);
    }
    let tree = { v: leaves[order[0]].v };
    for (let i = 1; i < L; i++) tree = { l: tree, r: { v: leaves[order[i]].v } };
    return { tree, order };
  }

  // Expansão gulosa a partir da origem (leitura literal do passo 5): a cada passo cola a folha vizinha
  // que minimiza o conjunto ativo da união, sem planejar a ordem global.
  function chainFromOrigin(graph, leaves, start) {
    const n = graph.n;
    const first = leaves.findIndex(L => L.v.includes(start));
    if (first < 0) throw new Error('origem fora das folhas');
    const used = new Set([first]); const region = membership(n, leaves[first].v);
    let tree = { v: leaves[first].v }; const order = [first];
    while (used.size < leaves.length) {
      let best = null;
      for (let i = 0; i < leaves.length; i++) {
        if (used.has(i)) continue;
        const inL = membership(n, leaves[i].v);
        const adjacent = graph.edges.some(e => (region[e.a] && inL[e.b]) || (region[e.b] && inL[e.a]));
        const union = new Uint8Array(n); for (let v = 0; v < n; v++) union[v] = region[v] | inL[v];
        const cand = { i, adjacent, activeIn: boundarySet(graph, region).size + boundarySet(graph, inL).size, after: boundarySet(graph, union).size };
        if (!best || (cand.adjacent && !best.adjacent) || (cand.adjacent === best.adjacent && (cand.activeIn < best.activeIn || (cand.activeIn === best.activeIn && cand.after < best.after)))) best = cand;
      }
      used.add(best.i); order.push(best.i);
      for (const v of leaves[best.i].v) region[v] = 1;
      tree = { l: tree, r: { v: leaves[best.i].v } };
    }
    return { tree, order };
  }

  // varredura pura: cadeia de folhas unitárias na ordem de varredura dos vértices
  function singletonChain(graph, opts) {
    const order = vertexOrder(graph, opts);
    let tree = { v: [order[0]] };
    for (let i = 1; i < order.length; i++) tree = { l: tree, r: { v: [order[i]] } };
    return { tree, order };
  }

  // estatísticas estáticas de uma hierarquia (sem rodar o solver): conjunto ativo do produto em cada união
  function treeStats(graph, tree) {
    const n = graph.n, out = [];
    function walk(node, level) {
      if (node.v) { const inR = membership(n, node.v); out.push({ kind: 'folha', level, size: node.v.length, activeIn: node.v.length, boundaryOut: boundarySet(graph, inR).size }); return inR; }
      const P = walk(node.l, level + 1), Q = walk(node.r, level + 1);
      const inR = new Uint8Array(n); let size = 0; for (let v = 0; v < n; v++) { inR[v] = P[v] | Q[v]; size += inR[v]; }
      out.push({ kind: 'união', level, size, activeIn: boundarySet(graph, P).size + boundarySet(graph, Q).size, boundaryOut: boundarySet(graph, inR).size });
      return inR;
    }
    walk(tree, 0);
    const width = out.reduce((w, r) => Math.max(w, r.activeIn), 0);
    return { nodes: out, width, signatureBound: signatureBound(width), leaves: out.filter(r => r.kind === 'folha').length };
  }

  // ------------------------------------------------- oráculos de comparação
  function heldKarp(graph, opts) {
    opts = opts || {};
    const n = graph.n, limit = opts.maxN || 16;
    if (n > limit) return { status: 'RECUSADO', cost: null, reason: 'n > ' + limit };
    const t0 = now(), INF = Infinity, dist = new Float64Array(n * n).fill(INF);
    for (const e of graph.edges) { dist[e.a * n + e.b] = Math.min(dist[e.a * n + e.b], e.w); dist[e.b * n + e.a] = dist[e.a * n + e.b]; }
    const full = 1 << n, dp = new Float64Array(full * n).fill(INF), par = new Int16Array(full * n).fill(-1);
    dp[1 * n + 0] = 0;
    for (let mask = 1; mask < full; mask += 2) {
      for (let j = 0; j < n; j++) {
        const cur = dp[mask * n + j]; if (cur === INF) continue;
        for (let k = 1; k < n; k++) {
          if (mask & (1 << k)) continue; const w = dist[j * n + k]; if (w === INF) continue;
          const nm = mask | (1 << k), idx = nm * n + k;
          if (cur + w < dp[idx]) { dp[idx] = cur + w; par[idx] = j; }
        }
      }
    }
    let best = INF, last = -1;
    for (let j = 1; j < n; j++) { const c = dp[(full - 1) * n + j] + dist[j * n + 0]; if (c < best) { best = c; last = j; } }
    if (best === INF) return { status: 'INVIAVEL', cost: null, millis: now() - t0, cells: full * n };
    const route = [0]; let mask = full - 1, j = last; const rev = [];
    while (j !== 0) { rev.push(j); const p = par[mask * n + j]; mask ^= (1 << j); j = p; }
    rev.reverse(); route.push(...rev, 0);
    return { status: 'OTIMO', cost: best, route, millis: now() - t0, cells: full * n };
  }

  function bruteForce(graph, opts) {
    opts = opts || {};
    const n = graph.n; if (n > (opts.maxN || 10)) return { status: 'RECUSADO', cost: null };
    const t0 = now(), INF = Infinity, dist = new Float64Array(n * n).fill(INF);
    for (const e of graph.edges) { dist[e.a * n + e.b] = Math.min(dist[e.a * n + e.b], e.w); dist[e.b * n + e.a] = dist[e.a * n + e.b]; }
    let best = INF, bestRoute = null;
    const perm = Array.from({ length: n - 1 }, (_, i) => i + 1);
    function rec(k, cost, last) {
      if (cost >= best) return;
      if (k === perm.length) { const c = cost + dist[last * n + 0]; if (c < best) { best = c; bestRoute = [0, ...perm, 0]; } return; }
      for (let i = k; i < perm.length; i++) {
        [perm[k], perm[i]] = [perm[i], perm[k]];
        const w = dist[last * n + perm[k]];
        if (w !== INF) rec(k + 1, cost + w, perm[k]);
        [perm[k], perm[i]] = [perm[i], perm[k]];
      }
    }
    rec(0, 0, 0);
    return best === INF ? { status: 'INVIAVEL', cost: null, millis: now() - t0 } : { status: 'OTIMO', cost: best, route: bestRoute, millis: now() - t0 };
  }

  // ---------------------------------------------------------- geradores
  function mulberry32(seed) { let a = seed >>> 0; return function () { a += 0x6D2B79F5; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function randomGraph(n, density, seed, ring) {
    const rnd = mulberry32(seed), edges = [];
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const onRing = ring && (b === a + 1 || (a === 0 && b === n - 1));
      if (onRing || rnd() < density) edges.push([a, b, 1 + Math.floor(rnd() * 60)]);
    }
    return edges;
  }
  function completeGraph(n, seed) { const rnd = mulberry32(seed), edges = []; for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) edges.push([a, b, 10 + Math.floor(rnd() * 90)]); return edges; }
  function gridGraph(k, seed) {
    const rnd = mulberry32(seed), edges = [], xy = [];
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      const v = i * k + j; xy.push([j, i]);
      if (j + 1 < k) edges.push([v, v + 1, 10 + Math.floor(rnd() * 90)]);
      if (i + 1 < k) edges.push([v, v + k, 10 + Math.floor(rnd() * 90)]);
    }
    return { edges, xy };
  }

  return { makeGraph, boundarySet, membership, signatureBound, cuthillMcKee, vertexOrder, solve, verifyTour,
    bisect, sweepChain, chainFromOrigin, singletonChain, treeStats, heldKarp, bruteForce, randomGraph, completeGraph, gridGraph, mulberry32 };
});
