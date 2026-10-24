INICIAR PROJETO COMPLETO DE CATÁLOGO ELETRÔNICO SEGUINDO O PADRÃO OFICIAL 10/10 (PYTHON PYMUPDF XREF + PLAYWRIGHT MULTI-ÂNGULOS + CONVERSÃO AUTOMÁTICA WEBP SEM PERDAS + UI-UX-PRO-MAX + PWA & WINDOWS .EXE/.MSI COM 10 QUALITY GATES)

Atue como Arquiteto de Software Sênior, Engenheiro de Dados Especialista em Engenharia Reversa de Catálogos Automotivos (Python `PyMuPDF`/`fitz` + `Pillow` + `Microsoft Playwright`), Especialista em Processamento de Imagens `.WebP` de Alta Fidelidade e Principal UI/UX Designer (`ui-ux-pro-max-skill`).

Sua missão é construir um sistema completo de Catálogo Inteligente de Balcão Offline-First (PWA instalável + Aplicativo Nativo Windows `.exe` e `.msi` via Tauri v2) a partir dos arquivos de catálogo PDF (e/ou catálogos web) presentes nesta pasta, cumprindo rigorosamente os 6 Passos, o Checklist de Testes e os 10 Quality Gates detalhados abaixo.

PRINCÍPIO INEGOCIÁVEL:
SEGURANÇA E INTEGRIDADE DOS DADOS DA LOJA > NITIDEZ VISUAL DAS PEÇAS (WEBP SEM PERDA DE QUALIDADE) > CONFIABILIDADE TÉCNICA DAS APLICAÇÕES E CONVERSÕES > USABILIDADE E LEITURA NO BALCÃO > VELOCIDADE SUB-50MS.

================================================================================
PASSO 1 — AUDITORIA DO AMBIENTE E CONFIGURAÇÃO AUTOMÁTICA DO UI-UX-PRO-MAX
================================================================================
1. Inspecione o diretório atual, identifique todos os arquivos `.pdf` (e eventuais URLs de catálogos web), verifique as ferramentas instaladas (Python, PyMuPDF, Pillow, Playwright, Bun, Rust/Cargo, Git) e inicialize o repositório Git com `.gitignore` adequado.
2. Instale e consulte automaticamente a skill oficial de UI/UX executando:
   `bunx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max`
3. Execute os scripts e consultas da skill (`design_system.py`, `search.py` sobre `colors.csv`, `typography.csv`, `ux-guidelines.csv`, `ui-reasoning.csv` e `stacks/html-tailwind.csv`) para escolher e aplicar automaticamente o melhor Design System para uso em balcão:
   - **Tema Claro Industrial de Alto Contraste (Daylight Counter Mode)** como padrão (`#F8FAFC` fundo / `#FFFFFF` cards / `#E2E8F0` bordas / `#0F172A` texto principal / `#1D4ED8` azul automotivo primário), acompanhado de botão no topo para alternar em 1 clique para o **Modo Escuro Calibrado** (`#0F172A` / `#1E293B`).
   - **Tipografia Escaneável a 1 Metro:** Fonte geométrica limpa (`Inter` / `Plus Jakarta Sans` / `Work Sans`) para descrições e aplicações + fonte monoespaçada de alto destaque (`JetBrains Mono` / `IBM Plex Mono` — `font-mono text-xl font-extrabold`) para Códigos Comerciais (SKUs) e Códigos Originais (OEM).
   - **Proibições Estritas de UI/UX:**
     * **PROIBIDO** usar emojis como ícones (`📥`, `💾`, `🖼️`, `⚡`, `🚀`, `🗑️`). Crie `src/ui/icons.ts` exclusivamente com ícones vetoriais **SVG inline estilo Lucide**.
     * **PROIBIDO** usar gradientes roxos/neon genéricos de IA ou textos cinzas sem contraste.
     * **PROIBIDO** interceptar as setas `ArrowUp` / `ArrowDown` do teclado travando a rolagem natural da página.

================================================================================
PASSO 2 — MINERAÇÃO BINÁRIA DOS PDFs EM PYTHON (`scripts/extract_catalogs_xref.py`)
================================================================================
Jamais processe ou recorte PDFs em tempo real no navegador do usuário. Construa e execute `scripts/extract_catalogs_xref.py` usando `PyMuPDF` (`fitz`) e `Pillow` (`PIL`):
1. **Filtro Matemático Anti-Ruído (Logos, Selos ISO e Marcas d'Água):**
   - Varra todas as páginas contando a frequência de cada `xref` de imagem: qualquer `xref` presente em **mais de 3 páginas** (logos, selos ISO 9001, cabeçalhos, marcas d'água) ou com dimensão minúscula (`width < 45px` ou `height < 45px`) deve ser automaticamente descartado (`blacklist_xrefs`).
2. **Os 3 Tratamentos de Imagem para Obter Fundo Branco Puro (`#FFFFFF`):**
   - *Cenário A — Transparência Nativa `SMask`:* Se `smask > 0`, extraia o `xref` (RGB) e o `smask` (canal Alpha), compondo a peça sobre um canvas branco puro `Image.new("RGBA", size, (255, 255, 255, 255))` (impedindo fundos pretos).
   - *Cenário B — Costura de Imagens Fatiadas (`Stitching`) e `CMYK -> sRGB`:* Converta qualquer imagem `CMYK` para `sRGB` via `fitz.Pixmap(fitz.csRGB, pix)` e una fatias verticais adjacentes da mesma peça (`abs(rectA.y1 - rectB.y0) < 2.0pt`).
   - *Cenário C — Limpeza de Fundo Colorido de Tabela (`Floodfill`):* Amostre os 4 cantos da imagem; se contiverem cor de fundo de célula de tabela (azul/cinza), aplique `ImageDraw.floodfill` nos cantos (`thresh=25`) convertendo para branco puro `#FFFFFF`.
3. **Associação Espacial por Bounding Box `(x0, y0, x1, y1)` e Merge Multi-Página:**
   - Associe cada imagem ao seu SKU pela coordenada espacial na página (seja em layout tabular de 1 coluna ou grade de cards de 2/3 colunas).
   - Extraia 100% dos produtos, códigos OEM, aplicações veiculares estruturadas (`[yearStart, yearEnd, isOngoing]`), especificações técnicas (pressão em `kPa`, medidas em `mm`/polegadas, bicos, furo de sensor, voltagem) e realize o **Merge Aditivo (Union)** quando o mesmo SKU aparecer repetido em múltiplas páginas sob diferentes montadoras.
   - Extraia também automaticamente os domínios/URLs de catálogos web impressos nos rodapés/capas dos PDFs.

================================================================================
PASSO 3 — SUPER-ENRIQUECIMENTO WEB MULTI-ÂNGULOS COM MICROSOFT PLAYWRIGHT (`scripts/enrich_catalog_playwright.py`)
================================================================================
Quando houver catálogo web oficial acessível para as marcas do projeto (detectado no PDF ou informado pelo usuário):
1. Construa e execute `scripts/enrich_catalog_playwright.py` usando `playwright.async_api` (Headless Chromium):
   - Utilize concorrência controlada (`asyncio.Semaphore(4)`) e salve o progresso incremental em `scripts/.playwright_scrape_cache.json` para retomada instantânea.
   - Acesse as páginas/APIs dos produtos e extraia TODAS as URLs de imagens originais de estúdio em **Alta Definição (full-size / modal de zoom / CDN original)**, ignorando miniaturas reduzidas.
   - Capture **todos os ângulos disponíveis** da peça (vista frontal, superior, traseira, detalhes de bicos, furos de sensor, válvulas e conectores).
   - Descubra e incorpore também eventuais lançamentos ou itens de linha pesada presentes no catálogo web que complementem os vínculos das peças do PDF.
   - **Fallback Defensivo Obrigatório:** Caso algum código antigo do PDF não exista mais no site da marca, preserve intacta a imagem `.webp` extraída via `XREF` do PDF no Passo 2. Nenhuma peça pode ficar sem imagem.

================================================================================
PASSO 4 — DUPLO PIPELINE DE CONVERSÃO AUTOMÁTICA EM `.WEBP` SEM PERDA DE QUALIDADE VISUAL
================================================================================
A qualidade visual das peças (nitidez de bicos, roscas, travas e códigos gravados na peça ao dar zoom de 400%) é requisito crítico. Implemente os **2 conversores automáticos `.webp` sem perda visual**:

4.1 Conversor Automático Build-Time em Python (`scripts/webp_studio_converter.py`):
- Todas as imagens extraídas no Passo 2 (`XREF`) e no Passo 3 (`Playwright`) devem passar por este pipeline antes de serem salvas em `public/catalog-images/{marca_lower}/`:
  * Preserve 100% da resolução original de estúdio (sem nunca reduzir imagens menores e suportando até `1600x1600px` com filtro `Image.Resampling.LANCZOS` quando a fonte for ultra-alta).
  * Aplique trim inteligente apenas de margens vazias excessivas mantendo padding protetor uniforme de `16px` e **100% da proporção original (aspect ratio intocado)**.
  * Para imagens técnicas com textos, diagramas ou gravações finas, utilize `lossless=True`. Para fotografias de estúdio, utilize modo **Near-Lossless de Fidelidade Máxima (`quality=96, method=6, exact=True`)**, garantindo zero artefatos de bloco e preservação absoluta de detalhes no zoom.
  * **Nomenclatura Estritamente Lowercase (Compatibilidade Linux / Firebase Hosting):**
    - 1ª Foto (Capa): `/catalog-images/{marca_lower}/{sku_norm_lower}.webp`
    - Ângulos Extras: `/catalog-images/{marca_lower}/{sku_norm_lower}_2.webp`, `_3.webp`, `_4.webp`, etc.

4.2 Conversor Automático Client-Side no App (`src/media/webp-converter.ts`):
- Crie um módulo dedicado em TypeScript usando HTML5 `Canvas` / `OffscreenCanvas` (`imageSmoothingEnabled = true`, `imageSmoothingQuality = 'high'`) que intercepte **automaticamente** qualquer imagem adicionada pelo usuário no aplicativo:
  * Fotos coladas diretamente da área de transferência com **`Ctrl+V`** (ex.: capturas `Win+Shift+S`, fotos copiadas da web ou WhatsApp).
  * Fotos arrastadas via **Drag & Drop** ou selecionadas em lote (`PNG`, `JPG`, `JPEG`, `BMP`, `WEBP`).
- O conversor deve gerar automaticamente:
  1) `webpMasterBlob`: Imagem em formato `image/webp` com fidelidade máxima (`quality: 0.96`, até `1600px` no lado maior mantendo proporção exata e fundo limpo) sem perda visual.
  2) `webpThumbBlob`: Miniatura rápida em `image/webp` (`quality: 0.90`, `320px`) para renderização instantânea nos cards.
  3) `hashSha256`: Hash criptográfico calculado via Web Crypto API (`crypto.subtle.digest('SHA-256')`) para deduplicação automática no IndexedDB (duas fotos idênticas nunca ocupam espaço duplicado).

================================================================================
PASSO 5 — APLICAÇÃO DE BALCÃO OFFLINE-FIRST (BUN + VITE + TS STRICT + TAILWIND + INDEXEDDB + TAURI v2)
================================================================================
1. **Regras de Domínio e Normalização (`src/domain/`):**
   - `normalizeCodeStrict` (uppercase, sem pontuação, preservando zeros à esquerda), `expandCompoundOemCodes` (expansão de barras `A/B/C`, `15/17`, `397/98`), `normalizeCodeHomoglyph` (`O↔0`, `I↔1` para sugestões aproximadas), `sanitizeCrossReferenceCodes`, conversor de pressão (`Bar`/`kPa`/`PSI` $\rightarrow$ `kPa`), parser determinístico de anos (`97/99`, `08/...`, `.../92`, `>12`) e moeda segura em centavos inteiros via `BigInt` (`src/domain/currency.ts`).
2. **Camada IndexedDB Versionada & Auto-Sync Não-Destrutivo (`src/storage/`):**
   - Auto-seed instantâneo a partir de `src/data/catalog-master-seed.json`.
   - Rotina `syncStaticCatalogUpdates`: quando o app iniciar em uma máquina onde o IndexedDB já estava populado, sincronize automaticamente novas fotos multi-ângulos (`staticImageUrls`) e novos produtos do seed **SEM JAMAIS sobrescrever ou apagar** `storeInventoryData` (preços, códigos internos e prateleiras da loja), `imageAssetIds` (fotos manuais subidas pelo lojista) ou `removedStaticUrls`.
3. **Motor de Busca Sub-50ms & Os 4 Tipos de Relacionamento (`src/search/` & `src/relations/`):**
   - Busca multi-token instantânea (`< 50ms`) com ranking em 4 níveis (1º Match Exato SKU/OEM/Loja > 2º Prefixo/Barra > 3º Multi-Token Veículo+Tipo+Spec > 4º Homóglifo sinalizado) e filtros combinados (Montadora, Modelo, Ano, Marca, Categoria, Pressão, Bicos, COM/SEM Furo de Sensor, Status de Preço).
   - Painel visual separando rigorosamente as **4 Naturezas de Vínculos**:
     * 🔵 `EQUIVALENCIA_DIRETA`: Substitutos entre marcas concorrentes pelo mesmo OEM estrito *(bloqueando categorias diferentes)*.
     * 🟢 `COMPATIBILIDADE_ACOPLAMENTO`: Peças complementares que montam juntas ("Serve em", ex.: Tampa $\leftrightarrow$ Reservatório) + **Sugestão Transitiva Cross-Brand**.
     * 🟣 `COMPOSICAO_KIT`: Kits comerciais e seus componentes filhos.
     * ⚫ `VARIANTE_PRODUTO`: Variações da mesma família base (`-S`, `-F`, `-C`).
4. **Galeria Híbrida Multi-Ângulos & Lightbox com Zoom 400% (`src/ui/image-gallery.ts` & `lightbox.ts`):**
   - Exibe tanto as fotos estáticas (`staticImageUrls`) quanto as fotos manuais (`imageAssetIds`), com carrossel de ângulos (`←` / `→`), seleção de **Foto de Capa Principal**, reordenação de ângulos, ocultação de fotos de fábrica indesejadas (`removedStaticUrls`), gerenciador `ObjectUrlManager` (zero memory leaks) e Lightbox com zoom de 50% a 400% e pan por arrasto.
5. **Modal Completo de Gestão Manual (`src/ui/product-form-modal.ts`) & Operação de Balcão:**
   - CRUD completo em modal limpo: Criar produto, Editar todos os campos técnicos/loja/fotos/OEMs dinâmicos/aplicações dinâmicas/vínculos, **Duplicar Produto**, mover para Lixeira ou **Excluir Definitivamente**.
   - Barra superior enxuta com:
     * Botão **"Ocultar / Mostrar Preços (Modo Cliente)"** (ícone de olho SVG que esconde preços em toda a tela).
     * Botão **"Copiar p/ WhatsApp"** em cada card (copia resumo técnico formatado, omitindo o preço se o Modo Cliente estiver ativo).
     * Painel de Gestão com **Backup/Restore completo (`.json` com imagens + verificação de checksum `SHA-256`)**, **Importação/Exportação CSV de Preços/Estoque** e **Trilha de Auditoria (`auditLogs`)**.
6. **PWA Instalável & Empacotamento Windows Nativo (`.exe` e `.msi` via Tauri v2):**
   - Configure `public/manifest.webmanifest` e `public/sw.js` (Cache-First com versionamento automático).
   - Configure `src-tauri/` completo (`tauri.conf.json`, `Cargo.toml`, `capabilities/default.json` e geração de ícones `.ico` e `.png` binários válidos via script) pronto para compilar `.exe` e `.msi` nativos do Windows.

================================================================================
PASSO 6 — OS 10 QUALITY GATES OBRIGATÓRIOS E SUÍTE DE TESTES
================================================================================
Nenhuma entrega será aceita sem aprovar com status `PASS` e evidência literal de terminal todos os **10 Quality Gates** abaixo:

1. **Gate 1 — Design System (`ui-ux-pro-max`):** Skill instalada e consultada; Daylight Counter Mode + Dark Mode ativos; zero emojis na interface (100% ícones vetoriais SVG Lucide); rolagem de página livre.
2. **Gate 2 — Mineração Python XREF & Integridade de Pixels:** 100% dos produtos extraídos dos PDFs; auditoria automática de pixels comprovando **0 imagens com fundo preto** (`SMask` tratada) e cantos em branco puro `#FFFFFF`.
3. **Gate 3 — Enriquecimento Playwright Multi-Ângulos & Case-Sensitivity:** Captura de múltiplos ângulos (`_2.webp`, `_3.webp`) quando houver catálogo web; 100% dos nomes de arquivos e caminhos em `staticImageUrls` estritamente em `lowercase` (compatível com Linux/Firebase); fallback seguro para a foto do PDF.
4. **Gate 4 — Conversão Automática `.WebP` Sem Perda Visual (Build-Time + Client-Side):** Validação do conversor Python (`lossless=True` / `quality=96, method=6`) e do conversor TypeScript (`src/media/webp-converter.ts` para `Ctrl+V` e uploads manuais com deduplicação `SHA-256` e `ObjectUrlManager`).
5. **Gate 5 — Tipagem Estrita TypeScript:** Execução limpa de `bun x tsc --noEmit` com `Exit Code 0` (`strict: true`, zero `any` implícito ou `@ts-ignore`).
6. **Gate 6 — Integração Real no `src/main.ts` (Anti-Código Fantasma):** Execução de `bun run build` comprovando que todos os módulos criados estão importados no ponto de entrada e operacionais na interface real.
7. **Gate 7 — Suíte Completa de Testes Automatizados (`bun test`):** 100% dos testes passando cobrindo:
   - `normalizer.test.ts` (zeros à esquerda, barras `A/B/C`, homóglifos `O↔0`/`I↔1`, sanitização).
   - `units-and-years.test.ts` (pressões `Bar/kPa/PSI` e intervalos de anos `97/99`, `08/...`).
   - `currency.test.ts` (centavos inteiros via `BigInt` sem ponto flutuante).
   - `crud-inventory.test.ts` (criar, editar completo, duplicar, lixeira, exclusão permanente e fila de concorrência).
   - `relations-engine.test.ts` (4 tipos de vínculos, sugestão transitiva e bloqueio defensivo entre categorias distintas).
   - `image-gallery.test.ts` (conversão WebP, múltiplos ângulos, capa, `removedStaticUrls` e revogação de URLs).
8. **Gate 8 — Isolamento Inviolável da Loja & Auto-Sync Incremental:** Teste automatizado provando que sincronizar novas fotos multi-ângulos do Playwright ou atualizar dados de fábrica no seed **JAMAIS** apaga ou altera `storeInventoryData` (preços e prateleiras) nem `imageAssetIds` manuais.
9. **Gate 9 — Segurança Defensiva, Benchmark `< 50ms` (1.000+ Peças) e Disaster Recovery:** Neutralização de XSS (`escapeHtml`), validação de *Magic Bytes* binários (`%PDF-`, `RIFF/WEBP`, `PNG`, `JPEG`), trilha `auditLogs`, Stress Test de busca `< 50ms` com 1.000+ produtos e ciclo completo de Backup $\rightarrow$ Reset $\rightarrow$ Restore validado por checksum `SHA-256`.
10. **Gate 10 — Homologação PWA Offline & Instaladores Windows (`.exe` / `.msi`):** Validação do Service Worker offline e verificação de compilação nativa Rust/Tauri v2 (`cargo check` / `tauri build`) com binários e ícones válidos.

Ao concluir a execução, faça o commit de todos os arquivos e apresente o **Relatório Final de Engenharia** contendo as métricas exatas de produtos e imagens `.webp` geradas e a tabela de aprovação dos **10 Quality Gates**.