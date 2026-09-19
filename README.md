Rota por Fronteiras — laboratório local v2

Abra INICIAR.ps1 no PowerShell e acesse http://127.0.0.1:8765. Alternativa: `node server.cjs` nesta pasta. O processo escuta somente 127.0.0.1. Ctrl+C encerra o serviço. O arquivo index.html contém a arquitetura didática; laboratorio.html depende desse serviço local para calcular e importar dados. Nenhuma publicação externa foi feita.

**O que mudou**

- O núcleo mantém graus e emparelhamentos na fronteira. Workers reais executam folhas e uniões independentes de uma DAG; cada assinatura permanece exata. O integrador pode varrer uma região sem calcular sua tabela previamente.
- Configurações sequencial e paralela usam o mesmo plano e a mesma implementação. A execução com um trabalhador também usa o canal de mensagens: isso isola o efeito do número de trabalhadores, sem favorecer o sequencial com uma API diferente.
- Plano compara árvore e cadeia para a mesma partição, pela largura estática, ou permite escolher uma delas. Não procura a melhor decomposição global. Hubs são desempate lexicográfico depois da largura. Tamanhos 4, 6 e 8 são variantes experimentais, não regras universais.
- Escolha automática de varredura é uma heurística prévia: região pequena, largura prevista não superior à do produto e limite estimado de produto ultrapassado. Não garante a integração mais rápida. A tabela do lado varrido não é calculada.
- Width agora considera todos os estados efetivamente inseridos, inclusive varreduras. Pico de estados mede uma tabela; RSS amostrado mede o processo inteiro, incluindo trabalhadores. CommunicationBytesV8 conta tamanhos no formato de serialização V8, não bytes físicos de IPC.
- Custos zero são aceitos porque existem nas matrizes públicas. A entrada exige inteiros não negativos com soma segura, grafo simples não dirigido e IDs válidos. Nenhuma matriz é silenciosamente simetrizada ou esparsificada.
- A versão v1 foi preservada em versoes/v1. Fontes e hashes dos dados estão em dados/manifest.json.

**Limites e interpretação**

Até 30 segundos totais por execução no lote, 30 mil estados por tabela e teto de RSS do processo de no máximo 1,5 GiB (ou 25% da RAM, se menor). O supervisor do lote mede RSS a cada 50 ms; o limite pode ser ultrapassado entre amostras e não é uma reserva física rígida. Cada Worker também tem limite de heap V8. Interrupções preservam motivo e não viram resposta de inviabilidade.

O lote usa o grafo fictício de 50 cidades e oito entradas públicas preselecionadas: berlin52, kroA100, pr226, rat575, Loggi-n401-k23, Loggi-n1001-k31, ORTEC-n242-k12, ORTEC-n701-k64. pr226 substituiu o nome inexistente pr239 antes de rodar os solvers. TSPLIB foi obtida de espelho público, identificado no manifesto. Loggi/ORTEC vieram da CVRPLIB oficial.

As instâncias CVRP foram DERIVADAS para rota única, removendo demandas, capacidade e frota, preservando todas as cidades e custos. Seus valores publicados de CVRP não são referências de ótimo para essa transformação. As matrizes são completas; esse é um teste deliberado da perda de fronteiras pequenas. Coordenadas servem ao desenho e à partição; o custo vem da matriz. O painel é um diagrama, não um mapa de ruas.

OR-Tools usa PATH_CHEAPEST_ARC + GUIDED_LOCAL_SEARCH para exatamente um veículo, mesmos vértices e mesmas arestas permitidas. É heurístico, sem certificado de ótimo. Não comparar seu tempo de rota viável como se fosse tempo de prova de ótimo. Todas as rotas produzidas no lote são conferidas por um verificador separado em Python.

**Reprodução**

1. `python scripts/dados.py`: baixar e converter os dados, reaproveitando fontes já salvas; registrar hashes. Download não é necessário para usar os dados presentes.
2. Dependências externas do comparador estão somente em vendor; a interface e o solver Node não exigem pacotes adicionais. Instalação inicial: `python -m pip install --target vendor ortools==9.15.6755 psutil==7.2.2`.
3. `node test-v2.cjs`: validações de custo, paralelismo, interrupção e pesos zero.
4. `python scripts/benchmark.py`: lote serial entre métodos, máximo global de 20 minutos, registro progressivo em resultados/benchmark.json e logs por execução. Este comando refaz o lote; não roda automaticamente ao abrir o painel.
5. `node build.js`: atualizar index.html a partir de page.html e solver.js.

Resultados finitos são evidência experimental. A revisão aqui é interna, com implementações de referência separadas; não é revisão independente por especialistas nem verificação formal. Não há alegação de novidade ou de resolução de P versus NP.
