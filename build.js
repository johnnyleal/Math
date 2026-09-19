/* build.js — gera index.html a partir de page.html, embutindo solver.js e o grafo de 50 cidades.
 * Uso: node build.js
 */
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const page = fs.readFileSync(path.join(HERE, 'page.html'), 'utf8');
const solver = fs.readFileSync(path.join(HERE, 'solver.js'), 'utf8');
const graph = fs.readFileSync(path.join(HERE, 'dados', 'grafo-50-cidades.json'), 'utf8');
const compact = JSON.stringify(JSON.parse(graph));
if (!page.includes('<!--SOLVER-->') || !page.includes('<!--GRAPH50-->')) throw new Error('marcadores ausentes em page.html');
const out = page
  .replace('<!--SOLVER-->', () => solver)
  .replace('<!--GRAPH50-->', () => 'const GRAPH50 = ' + compact + ';');
fs.writeFileSync(path.join(HERE, 'index.html'), out);
console.log('index.html gerado:', (out.length / 1024).toFixed(0), 'KB');
