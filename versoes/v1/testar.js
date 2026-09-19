/* testar.js — verificação do núcleo contra oráculos independentes.
 * Uso: node testar.js
 * Compara Solver.solve com força bruta (Python, fixtures.json), Held-Karp e o resultado
 * já registrado do grafo de 50 cidades (experimento-01/referencia-resultado.json).
 */
const fs = require('fs');
const path = require('path');
const S = require('./solver.js');

const HERE = __dirname;
const fixtures = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures.json'), 'utf8'));
const graph50 = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'dados', 'grafo-50-cidades.json'), 'utf8'));
const ref50 = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'experimento-01', 'referencia-resultado.json'), 'utf8'));

let checks = 0, failures = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('  FALHA: ' + msg); } }
function section(t) { console.log('\n== ' + t); }
const fmt = r => `${r.status.padEnd(12)} custo ${String(r.cost).padStart(5)} | pico ${String(r.peakStates).padStart(7)} | trabalho ${String(r.work).padStart(8)} | ${r.millis.toFixed(0).padStart(5)} ms`;

function randomTree(n, rnd) {
  let nodes = Array.from({ length: n }, (_, i) => ({ v: [i] }));
  while (nodes.length > 1) {
    const i = Math.floor(rnd() * nodes.length); const a = nodes.splice(i, 1)[0];
    const j = Math.floor(rnd() * nodes.length); const b = nodes.splice(j, 1)[0];
    nodes.push({ l: a, r: b });
  }
  return nodes[0];
}
// conjunto de hierarquias e estratégias para um grafo pequeno
function variants(g, xy, seed) {
  const rnd = S.mulberry32(seed);
  const b1 = S.bisect(g, { leafSize: 3, xy });
  const b2 = S.bisect(g, { leafSize: 3, xy, refine: true });
  return [
    ['bissecção/produto', b1.tree, { strategy: 'produto' }],
    ['bissecção/varredura', b1.tree, { strategy: 'varredura' }],
    ['bissecção+refino/auto', b2.tree, { strategy: 'auto', productLimit: 50 }],
    ['cadeia planejada/auto', S.sweepChain(g, b1.leaves, { xy }).tree, {}],
    ['cadeia gulosa/auto', S.chainFromOrigin(g, b1.leaves, 0).tree, {}],
    ['varredura pura', S.singletonChain(g, { xy }).tree, {}],
    ['árvore aleatória/produto', randomTree(g.n, rnd), { strategy: 'produto' }],
    ['árvore aleatória/varredura', randomTree(g.n, rnd), { strategy: 'varredura' }],
    ['folha única', { v: Array.from({ length: g.n }, (_, i) => i) }, {}],
  ];
}

section('1. Grafos aleatórios pequenos × força bruta (Python) e Held-Karp');
{
  let feasible = 0, infeasible = 0, maxPeak = 0, runs = 0;
  fixtures.random.forEach((c, idx) => {
    const g = S.makeGraph(c.n, c.edges);
    ok(S.heldKarp(g).cost === c.optimum, `Held-Karp caso ${idx}`);
    ok(S.bruteForce(g).cost === c.optimum, `força bruta JS caso ${idx}`);
    for (const [name, tree, o] of variants(g, null, 1000 + idx)) {
      const r = S.solve(g, tree, Object.assign({ maxStates: 5e5 }, o)); runs++;
      ok(r.status !== 'INTERROMPIDO', `caso ${idx} ${name} interrompido`);
      ok(r.cost === c.optimum, `caso ${idx} n=${c.n} ${name}: ${r.status} ${r.cost} vs ${c.optimum}`);
      if (r.status === 'OTIMO') ok(r.route.length === c.n + 1 && r.route[0] === 0 && new Set(r.route.slice(0, -1)).size === c.n, `rota caso ${idx} ${name}`);
      for (const m of ['um-caminho', 'sem-conectividade']) {
        const rm = S.solve(g, tree, Object.assign({ maxStates: 5e5, mode: m }, o));
        // modos degradados devolvem circuitos genuínos: nunca abaixo do ótimo, nunca em instância inviável
        ok(rm.cost === null || (c.optimum !== null && rm.cost >= c.optimum), `modo ${m} caso ${idx} ${name}: ${rm.cost} vs ótimo ${c.optimum}`);
      }
      maxPeak = Math.max(maxPeak, r.peakStates);
    }
    if (c.optimum === null) infeasible++; else feasible++;
  });
  console.log(`  ${fixtures.random.length} instâncias (${feasible} com circuito, ${infeasible} sem), ${runs} execuções exatas, pico de estados ${maxPeak}`);
}

section('2. Grades k×k × solver de referência (Python)');
for (const c of fixtures.grids) {
  const g = S.makeGraph(c.n, c.edges), xy = c.xy;
  const h = S.bisect(g, { xy, leafSize: 4 });
  const rows = [
    ['árvore, produto', h.tree, { strategy: 'produto', xy }],
    ['árvore, auto', h.tree, { strategy: 'auto', xy }],
    ['cadeia planejada, auto', S.sweepChain(g, h.leaves, { xy }).tree, { xy }],
    ['cadeia gulosa, auto', S.chainFromOrigin(g, h.leaves, 0).tree, { xy }],
    ['varredura pura', S.singletonChain(g, { xy }).tree, { xy }],
  ];
  for (const [name, tree, o] of rows) {
    const r = S.solve(g, tree, Object.assign({ maxStates: 3e6 }, o));
    ok(r.status !== 'INTERROMPIDO', `grade ${c.k} ${name} interrompida`);
    ok(r.cost === c.optimum, `grade ${c.k} ${name}: ${r.cost} vs ${c.optimum}`);
    console.log(`  grade ${c.k}x${c.k} ${name.padEnd(24)} ${fmt(r)}`);
  }
}

section('3. Grafo de 50 cidades × referência registrada (3031 km)');
{
  const n = graph50.cities.length;
  const g = S.makeGraph(n, graph50.edges.map(e => [e.a, e.b, e.km]), graph50.cities.map(c => c.name));
  const xy = graph50.cities.map(c => [c.fictionalXKm, c.fictionalYKm]);
  ok(ref50.cost === 3031, 'referência registrada é 3031');
  for (const L of [4, 6, 8]) for (const hub of ['nenhum', 'centro', 'quinas']) for (const refine of [false, true]) {
    const cfg = { leafSize: L, hub, refine };
    const h = S.bisect(g, Object.assign({ xy }, cfg));
    const rt = S.solve(g, h.tree, { xy, strategy: 'produto' });
    const rc = S.solve(g, S.sweepChain(g, h.leaves, { xy }).tree, { xy });
    const rg = S.solve(g, S.chainFromOrigin(g, h.leaves, 0).tree, { xy, maxStates: 3e5 });
    for (const [nm, r] of [['árvore', rt], ['cadeia', rc]]) ok(r.cost === 3031, `50 cidades ${nm} ${JSON.stringify(cfg)}: ${r.status} ${r.cost}`);
    // a expansão gulosa pode estourar o orçamento (achado documentado); se termina, tem de ser exata
    ok(rg.status === 'INTERROMPIDO' || rg.cost === 3031, `50 cidades gulosa ${JSON.stringify(cfg)}: ${rg.status} ${rg.cost}`);
    console.log(`  L=${L} hub=${hub.padEnd(6)} refino=${refine ? 'sim' : 'não'} folhas=${String(h.leaves.length).padStart(2)} | árvore: largura ${String(rt.width).padStart(2)} pico ${String(rt.peakStates).padStart(6)} trab ${String(rt.work).padStart(7)} | cadeia: pico ${String(rc.peakStates).padStart(5)} trab ${String(rc.work).padStart(6)} | gulosa: pico ${String(rg.peakStates).padStart(6)} trab ${String(rg.work).padStart(7)}`);
  }
  const rp = S.solve(g, S.singletonChain(g, { xy }).tree, { xy });
  ok(rp.cost === 3031, 'varredura pura 50 cidades');
  console.log(`  varredura pura: ${fmt(rp)}`);
  const h = S.bisect(g, { xy, leafSize: 6 });
  const one = S.solve(g, h.tree, { mode: 'um-caminho', xy });
  console.log(`  modo um-caminho-por-cluster: ${one.status} ${one.cost}`);
  ok(one.cost !== 3031, 'um-caminho não reproduz o ótimo');
  const noPi = S.solve(g, h.tree, { mode: 'sem-conectividade', xy });
  console.log(`  modo sem-conectividade: ${noPi.status} ${noPi.cost}`);
  const r = S.solve(g, h.tree, { xy });
  ok(S.verifyTour(g, r.edgeIds, 0).cost === 3031, 'rota reconstruída soma 3031');
  ok(JSON.stringify(r.edgeIds) === JSON.stringify(ref50.edgeIds), 'mesmas estradas da referência Python');
  console.log('  rota: ' + r.route.map(v => g.names[v]).join(' '));
}

section('4. Contraexemplos didáticos');
{
  const g = S.makeGraph(4, [[0, 1, 2], [0, 2, 3], [0, 3, 3], [1, 2, 3], [1, 3, 3], [2, 3, 6]]);
  const r = S.solve(g, { l: { v: [0, 1] }, r: { v: [2, 3] } });
  ok(r.cost === 12 && !r.edgeIds.includes(0), 'K4: ótimo 12 sem a estrada mais barata');
  const g2 = S.makeGraph(6, [[0, 3, 1], [1, 2, 1], [0, 1, 3], [2, 3, 3], [1, 4, 1], [4, 2, 1], [3, 5, 1], [5, 0, 1]], ['A', 'B', 'C', 'D', 'E', 'F']);
  const t2 = { l: { v: [0, 1, 2, 3] }, r: { v: [4, 5] } };
  const ex = S.solve(g2, t2), np = S.solve(g2, t2, { mode: 'sem-conectividade' });
  ok(ex.cost === 10, 'ABCD-EF exato = 10');
  ok(np.cost !== 10, 'ABCD-EF sem conectividade erra: ' + np.status + ' ' + np.cost);
  console.log(`  K4: ótimo ${r.cost}, usa estrada 0-1? ${r.edgeIds.includes(0)} | ABCD-EF: exato ${ex.cost}, sem-π ${np.status} ${np.cost}`);
}

section('5. Parede: grafos completos K_n (pico de 3e5 estados ou 20 s) e grades (varredura)');
for (let n = 6; n <= 14; n++) {
  const g = S.makeGraph(n, S.completeGraph(n, 99 + n));
  const r = S.solve(g, S.singletonChain(g, {}).tree, { maxStates: 3e5, maxMillis: 20000 });
  const hk = S.heldKarp(g);
  if (r.status === 'OTIMO') ok(r.cost === hk.cost, `K${n}: fronteira ${r.cost} vs Held-Karp ${hk.cost}`);
  console.log(`  K${n}: ${fmt(r)}${r.reason ? ' (' + r.reason + ')' : ''} | Held-Karp ${hk.cost} ${hk.millis.toFixed(0)} ms`);
  if (r.status === 'INTERROMPIDO') break;
}
for (const k of [10, 12]) {
  const gg = S.gridGraph(k, 300 + k), g = S.makeGraph(k * k, gg.edges);
  const r = S.solve(g, S.singletonChain(g, { xy: gg.xy }).tree, { xy: gg.xy, maxStates: 3e5, maxMillis: 20000 });
  console.log(`  grade ${k}x${k}: ${fmt(r)}${r.reason ? ' (' + r.reason + ')' : ''}`);
}

section('6. Aleatórios médios (n=10..13) × Held-Karp');
{
  let compared = 0, interrupted = 0;
  for (let n = 10; n <= 13; n++) for (let s = 0; s < 6; s++) {
    const g = S.makeGraph(n, S.randomGraph(n, [0.3, 0.45, 0.6][s % 3], 5000 + n * 10 + s, s % 2 === 0));
    const hk = S.heldKarp(g);
    for (const [nm, tree] of [['árvore', S.bisect(g, { leafSize: 4, refine: true }).tree], ['varredura', S.singletonChain(g, {}).tree]]) {
      const r = S.solve(g, tree, { maxStates: 1e6 });
      if (r.status === 'INTERROMPIDO') { interrupted++; continue; }
      ok(r.cost === hk.cost, `n=${n} s=${s} ${nm}: ${r.cost} vs HK ${hk.cost}`); compared++;
    }
  }
  console.log(`  ${compared} comparados, ${interrupted} interrompidos por orçamento`);
}

section('7. Limite de assinaturas e ordens');
{
  const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(b => S.signatureBound(b));
  console.log('  S(b) para b=1..10: ' + vals.join(', '));
  ok(vals[0] === 2 && vals[1] === 5 && vals[2] === 14 && vals[3] === 43, 'S(1..4) = 2, 5, 14, 43');
  const g = S.makeGraph(6, [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1], [5, 0, 1]]);
  const cm = S.cuthillMcKee(6, v => g.adj[v].map(x => x.to), 0);
  ok(cm.length === 6 && new Set(cm).size === 6 && cm[0] === 0, 'Cuthill–McKee é permutação a partir da origem');
}

console.log(`\n${checks} verificações, ${failures} falhas`);
process.exit(failures ? 1 : 0);
