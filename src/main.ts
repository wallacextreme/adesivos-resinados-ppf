/**
 * src/main.ts
 * Ponto de Entrada Principal — Catálogo Inteligente de Balcão Offline-First Sportinox.
 * - Integra 100% dos módulos de domínio, persistência IndexedDB, busca sub-50ms,
 *   conversor WebP client-side, 4 naturezas de vínculos, galeria multi-ângulos e Lightbox 400%.
 * - Destaca o Filtro Rápido por Linha (Macro-Linha + Linha por Montadora) solicitado pelo usuário.
 * - Cumpre rigorosamente o Design System `ui-ux-pro-max` (Daylight Counter Mode + Dark Mode Calibrado,
 *   zero emojis, 100% ícones vetoriais SVG Lucide, rolagem de página livre).
 */

import './styles.css';
import seedCatalogJson from './data/catalog-master-seed.json';
import { formatCentsBigIntToBrl } from './domain/currency';
import { escapeHtml } from './domain/security';
import type {
  CatalogBackupBundle,
  CatalogProduct,
  SearchFilters,
  SearchResultItem,
  StoredImageAsset,
} from './domain/types';
import { resolveProductRelations } from './relations/relations-engine';
import { CatalogSearchEngine } from './search/search-engine';
import { CatalogStorageEngine } from './storage/catalog-db';
import { renderSvgIcon } from './ui/icons';
import { ObjectUrlManager, resolveProductGalleryItems } from './ui/image-gallery';
import { StudioLightbox } from './ui/lightbox';
import { ProductFormModal } from './ui/product-form-modal';

interface SeedCatalogFileStructure {
  products: Partial<CatalogProduct>[];
  availableMacroLines?: string[];
  availableProductLines?: string[];
  availableCategories?: string[];
  availableAutomakers?: string[];
}

const seedPayload = seedCatalogJson as unknown as SeedCatalogFileStructure;

class SportinoxCounterCatalogApp {
  private storage = new CatalogStorageEngine();
  private searchEngine = new CatalogSearchEngine();
  private lightbox = new StudioLightbox();
  private productModal = new ProductFormModal(this.storage);
  private urlManager = new ObjectUrlManager();

  private allProducts: CatalogProduct[] = [];
  private imageAssetsMap = new Map<string, StoredImageAsset>();
  private filteredResults: SearchResultItem[] = [];
  private filters: SearchFilters = CatalogSearchEngine.createDefaultFilters();

  private isDarkMode = false;
  private isClientModeHidePrices = false;
  private visibleLimit = 48;
  private lastSearchDurationMs = 0;

  // Controle de ângulo ativo por card (productId -> angleIdx)
  private activeCardAngleIndex = new Map<string, number>();
  // Produto atualmente selecionado para exibir o gaveteiro dos 4 Tipos de Vínculos
  private selectedRelationsProduct: CatalogProduct | null = null;
  // Modal de Gestão / Auditoria aberto
  private isManagementPanelOpen = false;
  private statusToastMessage = '';

  public async bootstrap(): Promise<void> {
    this.registerServiceWorker();
    await this.storage.init();

    // Auto-Sync Incremental Não-Destrutivo com o seed extraído dos PDFs + Playwright
    await this.storage.syncStaticCatalogUpdates(seedPayload.products || []);
    await this.reloadCatalogState();
    this.renderAppShell();
  }

  private registerServiceWorker(): void {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {
          // Modo desenvolvimento local
        });
      });
    }
  }

  private async reloadCatalogState(): Promise<void> {
    this.allProducts = await this.storage.getAllProducts();
    const assets = await this.storage.getAllImageAssets();
    this.imageAssetsMap = new Map(assets.map((a) => [a.id, a]));
    this.searchEngine.rebuildIndex(this.allProducts);
    this.executeSub50msSearch();
  }

  private executeSub50msSearch(): void {
    const t0 = performance.now();
    this.filteredResults = this.searchEngine.search(this.filters);
    this.lastSearchDurationMs = Number((performance.now() - t0).toFixed(2));
  }

  private showToast(msg: string): void {
    this.statusToastMessage = msg;
    const toastEl = document.querySelector<HTMLElement>('[data-toast-banner]');
    if (toastEl) {
      toastEl.textContent = msg;
      toastEl.classList.remove('hidden');
      setTimeout(() => {
        toastEl.classList.add('hidden');
      }, 3200);
    }
  }

  private getAvailableProductLines(): string[] {
    const linesSet = new Set<string>();
    for (const p of this.allProducts) {
      if (p.isTrash) continue;
      if (p.productLine) linesSet.add(p.productLine);
      for (const pl of p.productLines || []) {
        if (pl.startsWith('Linha ') && !['Linha Leve', 'Linha Pesada'].includes(pl)) {
          linesSet.add(pl);
        }
      }
    }
    return Array.from(linesSet).sort((a, b) => a.localeCompare(b));
  }

  private getAvailableCategories(): string[] {
    const set = new Set<string>();
    for (const p of this.allProducts) {
      if (!p.isTrash && p.category) set.add(p.category);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  private getAvailableAutomakers(): string[] {
    const set = new Set<string>();
    for (const p of this.allProducts) {
      if (!p.isTrash && p.automaker) set.add(p.automaker);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  private getAvailableSubstrates(): string[] {
    const set = new Set<string>();
    for (const p of this.allProducts) {
      if (!p.isTrash && p.specs?.substrate) set.add(p.specs.substrate);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  private formatWhatsAppSummary(product: CatalogProduct): string {
    const lines = [
      `*SPORTINOX — CATÁLOGO DE BALCÃO*`,
      `Código SKU: *${product.commercialCodeRaw}*`,
      `Peça: ${product.name}`,
      `Linha: ${product.productLine} (${product.macroLine})`,
      `Aplicação: ${product.vehicleApplications.map((a) => a.rawText).join(' | ')}`,
      `Especificação: Papel ${product.specs.substrate} | ${product.specs.resinFinish} | Cor ${product.specs.color} | Medida ${product.specs.dimensions} (${product.specs.packageQty})`,
    ];

    if (!this.isClientModeHidePrices) {
      const priceCents = BigInt(product.storeInventoryData?.priceCentsBigInt || '0');
      if (priceCents > 0n) {
        lines.push(`Preço: *${formatCentsBigIntToBrl(priceCents)}*`);
      }
      if (product.storeInventoryData?.shelfLocation) {
        lines.push(`Localização: ${product.storeInventoryData.shelfLocation}`);
      }
    }

    return lines.join('\n');
  }

  public renderAppShell(): void {
    const root = document.getElementById('app');
    if (!root) return;

    document.documentElement.classList.toggle('dark', this.isDarkMode);

    const productLines = this.getAvailableProductLines();
    const categories = this.getAvailableCategories();
    const automakers = this.getAvailableAutomakers();
    const substrates = this.getAvailableSubstrates();

    const macroCounts: Record<string, number> = {
      ALL: 0,
      'Linha Leve': 0,
      'Linha Universal': 0,
      'Linha Pesada': 0,
      'Linha Motos': 0,
      Lançamentos: 0,
    };

    for (const p of this.allProducts) {
      if (p.isTrash) continue;
      macroCounts.ALL = (macroCounts.ALL || 0) + 1;
      for (const ml of ['Linha Leve', 'Linha Universal', 'Linha Pesada', 'Linha Motos', 'Lançamentos']) {
        if (p.macroLine === ml || (p.productLines || []).includes(ml)) {
          macroCounts[ml] = (macroCounts[ml] || 0) + 1;
        }
      }
    }

    root.innerHTML = `
      <div class="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-[#0F172A] text-[#0F172A] dark:text-[#F8FAFC] transition-colors duration-150">
        <!-- Notificação Toast Flutuante -->
        <div
          data-toast-banner
          class="${this.statusToastMessage ? '' : 'hidden'} fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl bg-blue-700 text-white font-semibold text-xs shadow-xl border border-blue-500"
        >
          ${escapeHtml(this.statusToastMessage)}
        </div>

        <!-- BARRA SUPERIOR DE BALCÃO (HIGH CONTRAST) -->
        <header class="sticky top-0 z-30 bg-white dark:bg-[#1E293B] border-b border-[#E2E8F0] dark:border-slate-700 shadow-xs">
          <div class="max-w-[1600px] mx-auto px-4 lg:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <!-- Identidade Visual Sportinox -->
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-[#1D4ED8] text-white flex items-center justify-center font-mono font-extrabold text-lg shadow-xs">
                SX
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h1 class="text-base lg:text-lg font-extrabold tracking-tight text-[#0F172A] dark:text-white">
                    SPORTINOX — CATÁLOGO DE BALCÃO
                  </h1>
                  <span class="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950 text-[#1D4ED8] dark:text-blue-300 font-mono text-[11px] font-bold">
                    OFFLINE-FIRST WEBP HD
                  </span>
                </div>
                <p class="text-xs text-slate-600 dark:text-slate-300">
                  Adesivos Resinados, Emblemas, Soleiras, Faixas Decorativas e Películas PPF separados por Linha
                </p>
              </div>
            </div>

            <!-- Controles Rápidos de Balcão -->
            <div class="flex flex-wrap items-center gap-2">
              <!-- Indicador de Performance Sub-50ms -->
              <div class="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>${this.filteredResults.length} itens</span>
                <span class="text-slate-400">|</span>
                <span class="font-bold text-emerald-700 dark:text-emerald-400">${this.lastSearchDurationMs}ms</span>
              </div>

              <!-- Botão Ocultar / Mostrar Preços (Modo Cliente) -->
              <button
                type="button"
                data-toggle-client-mode
                class="px-3 py-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 cursor-pointer transition ${
                  this.isClientModeHidePrices
                    ? 'bg-amber-600 border-amber-600 text-white'
                    : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700'
                }"
                title="Esconde preços e custos da tela para atendimento conjunto com o cliente no balcão"
              >
                ${renderSvgIcon(this.isClientModeHidePrices ? 'eyeOff' : 'eye', 'w-4 h-4')}
                <span>${this.isClientModeHidePrices ? 'Modo Cliente (Preços Ocultos)' : 'Ocultar Preços (Modo Cliente)'}</span>
              </button>

              <!-- Botão Novo Produto Manual -->
              <button
                type="button"
                data-btn-new-product
                class="px-3.5 py-2 rounded-lg bg-[#1D4ED8] hover:bg-blue-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                ${renderSvgIcon('plus', 'w-4 h-4')}
                <span>Novo Produto</span>
              </button>

              <!-- Botão Painel de Gestão (Backup SHA-256 / CSV / Auditoria) -->
              <button
                type="button"
                data-toggle-management
                class="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                ${renderSvgIcon('database', 'w-4 h-4')}
                <span>Gestão &amp; Backup</span>
              </button>

              <!-- Alternador 1-Clique Daylight Counter Mode / Dark Mode Calibrado -->
              <button
                type="button"
                data-toggle-theme
                class="p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 cursor-pointer"
                title="Alternar Tema Claro Industrial (Daylight) / Modo Escuro Calibrado"
              >
                ${renderSvgIcon(this.isDarkMode ? 'sun' : 'moon', 'w-4 h-4')}
              </button>
            </div>
          </div>

          <!-- BARRA DE NAVEGAÇÃO DIRETA POR MACRO-LINHA (IGUAL AO SITE SPORTINOX) -->
          <div class="bg-slate-100/90 dark:bg-slate-900/90 border-t border-[#E2E8F0] dark:border-slate-800">
            <div class="max-w-[1600px] mx-auto px-4 lg:px-6 py-2 flex items-center gap-2 overflow-x-auto">
              <span class="text-[11px] font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1 shrink-0 mr-1">
                ${renderSvgIcon('layers', 'w-3.5 h-3.5')}
                <span>Segmento por Linha:</span>
              </span>
              ${[
                { id: 'ALL', label: 'Todas as Linhas', icon: 'layers' as const },
                { id: 'Linha Leve', label: 'Catálogo Linha Leve', icon: 'car' as const },
                { id: 'Linha Universal', label: 'Catálogo Linha Universal', icon: 'star' as const },
                { id: 'Linha Pesada', label: 'Catálogo Linha Pesada (Caminhões)', icon: 'truck' as const },
                { id: 'Linha Motos', label: 'Catálogo Linha Motos', icon: 'bike' as const },
                { id: 'Lançamentos', label: 'Lançamentos', icon: 'tag' as const },
              ]
                .map((tab) => {
                  const active = this.filters.macroLine === tab.id;
                  const count = macroCounts[tab.id] ?? 0;
                  return `
                    <button
                      type="button"
                      data-macro-line="${escapeHtml(tab.id)}"
                      class="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer transition ${
                        active
                          ? 'bg-[#1D4ED8] text-white shadow-xs'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-blue-500'
                      }"
                    >
                      ${renderSvgIcon(tab.icon, 'w-3.5 h-3.5')}
                      <span>${escapeHtml(tab.label)}</span>
                      <span class="px-1.5 py-0.2 rounded text-[10px] font-mono ${
                        active
                          ? 'bg-blue-900/60 text-white'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }">${count}</span>
                    </button>
                  `;
                })
                .join('')}
            </div>
          </div>
        </header>

        <!-- PAINEL EXPANSÍVEL DE GESTÃO (BACKUP SHA-256 / CSV / AUDITORIA) -->
        ${this.isManagementPanelOpen ? this.renderManagementDrawerHtml() : ''}

        <!-- CONTEÚDO PRINCIPAL: FILTRO RÁPIDO POR LINHA + BUSCA MULTI-TOKEN + GRADE -->
        <main class="flex-1 max-w-[1600px] w-full mx-auto px-4 lg:px-6 py-5 space-y-5">
          <!-- SEÇÃO DE BUSCA E FILTRO POR LINHA MONTADORA -->
          <section class="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 rounded-2xl p-4 lg:p-5 shadow-xs space-y-4">
            <!-- Barra de Pesquisa Instantânea Sub-50ms + Seletor Direto de Linha -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div class="lg:col-span-6 relative">
                <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  ${renderSvgIcon('search', 'w-5 h-5')}
                </span>
                <input
                  type="search"
                  id="catalog-search-input"
                  value="${escapeHtml(this.filters.query)}"
                  placeholder="Buscar por Código (CAL168, PPF0076, ADS4126), Linha, Veículo (Gol, Hilux, BMW 320, Tiggo) ou Medida..."
                  class="w-full pl-11 pr-4 py-2.5 rounded-xl border-2 border-slate-300 dark:border-slate-600 focus:border-[#1D4ED8] focus:outline-none bg-[#F8FAFC] dark:bg-slate-900 text-sm font-medium"
                />
              </div>

              <!-- Filtro Principal por Linha (Mandatório do Usuário) -->
              <div class="lg:col-span-3">
                <select
                  id="filter-product-line"
                  aria-label="Filtrar por Linha"
                  class="w-full px-3.5 py-2.5 rounded-xl border-2 border-blue-600 dark:border-blue-500 bg-blue-50/50 dark:bg-slate-900 text-sm font-bold text-[#0F172A] dark:text-white cursor-pointer"
                >
                  <option value="ALL">Filtrar por Linha: Todas as Linhas (${productLines.length})</option>
                  ${productLines
                    .map(
                      (line) =>
                        `<option value="${escapeHtml(line)}" ${this.filters.productLine === line ? 'selected' : ''}>${escapeHtml(line)}</option>`
                    )
                    .join('')}
                </select>
              </div>

              <!-- Filtro por Categoria -->
              <div class="lg:col-span-3">
                <select
                  id="filter-category"
                  aria-label="Filtrar por Categoria"
                  class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm font-semibold cursor-pointer"
                >
                  <option value="ALL">Todas as Categorias (${categories.length})</option>
                  ${categories
                    .map(
                      (cat) =>
                        `<option value="${escapeHtml(cat)}" ${this.filters.category === cat ? 'selected' : ''}>${escapeHtml(cat)}</option>`
                    )
                    .join('')}
                </select>
              </div>
            </div>

            <!-- CHIPS RÁPIDOS DE LINHA (IGUAL AO MENU LATERAL DO INDUSTRIASPORTINOX.COM) -->
            <div class="pt-1">
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1">
                  ${renderSvgIcon('filter', 'w-3.5 h-3.5')}
                  <span>Acesso Rápido por Linha Automotiva (1 Clique):</span>
                </span>
                ${
                  this.hasActiveFilters()
                    ? `
                  <button
                    type="button"
                    data-reset-filters
                    class="text-xs font-bold text-blue-700 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    ${renderSvgIcon('refresh', 'w-3.5 h-3.5')}
                    <span>Limpar Todos os Filtros</span>
                  </button>
                `
                    : ''
                }
              </div>
              <div class="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                <button
                  type="button"
                  data-line-chip="ALL"
                  class="px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition ${
                    this.filters.productLine === 'ALL'
                      ? 'bg-[#1D4ED8] text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }"
                >
                  Todas
                </button>
                ${productLines
                  .map((line) => {
                    const isSelected = this.filters.productLine === line;
                    const shortLabel = line.replace(/^Linha\s+/i, '');
                    return `
                      <button
                        type="button"
                        data-line-chip="${escapeHtml(line)}"
                        class="px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition ${
                          isSelected
                            ? 'bg-[#1D4ED8] text-white font-bold shadow-2xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-slate-700 border border-slate-200/80 dark:border-slate-700'
                        }"
                      >
                        Linha ${escapeHtml(shortLabel)}
                      </button>
                    `;
                  })
                  .join('')}
              </div>
            </div>

            <!-- Filtros Técnicos Combinados de Balcão -->
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div>
                <label class="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">Montadora</label>
                <select id="filter-automaker" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-semibold">
                  <option value="ALL">Todas (${automakers.length})</option>
                  ${automakers
                    .map(
                      (a) =>
                        `<option value="${escapeHtml(a)}" ${this.filters.automaker === a ? 'selected' : ''}>${escapeHtml(a)}</option>`
                    )
                    .join('')}
                </select>
              </div>

              <div>
                <label class="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">Modelo do Veículo</label>
                <input
                  type="text"
                  id="filter-model"
                  value="${escapeHtml(this.filters.model)}"
                  placeholder="Ex: Gol, S10, Ranger..."
                  class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs"
                />
              </div>

              <div>
                <label class="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">Ano do Veículo</label>
                <input
                  type="number"
                  id="filter-year"
                  value="${this.filters.year ?? ''}"
                  placeholder="Ex: 2025, 2014"
                  min="1950"
                  max="2035"
                  class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 font-mono text-xs"
                />
              </div>

              <div>
                <label class="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">Acabamento</label>
                <select id="filter-resin" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-semibold">
                  <option value="ALL" ${this.filters.resinFinish === 'ALL' ? 'selected' : ''}>Todos (Resinado + Sem Resina)</option>
                  <option value="Resinado" ${this.filters.resinFinish === 'Resinado' ? 'selected' : ''}>Resinado PU</option>
                  <option value="Sem Resina" ${this.filters.resinFinish === 'Sem Resina' ? 'selected' : ''}>Sem Resina / PPF</option>
                </select>
              </div>

              <div>
                <label class="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">Papel / Material</label>
                <select id="filter-substrate" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-semibold">
                  <option value="ALL">Todos (${substrates.length})</option>
                  ${substrates
                    .map(
                      (s) =>
                        `<option value="${escapeHtml(s)}" ${this.filters.substrate === s ? 'selected' : ''}>${escapeHtml(s)}</option>`
                    )
                    .join('')}
                </select>
              </div>

              <div>
                <label class="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">Status Loja / Lixeira</label>
                <select id="filter-price-status" class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-semibold">
                  <option value="ALL" ${!this.filters.includeTrash && this.filters.priceStatus === 'ALL' ? 'selected' : ''}>Catálogo Ativo Completo</option>
                  <option value="WITH_PRICE" ${this.filters.priceStatus === 'WITH_PRICE' ? 'selected' : ''}>Com Preço Cadastrado</option>
                  <option value="IN_STOCK" ${this.filters.priceStatus === 'IN_STOCK' ? 'selected' : ''}>Em Estoque (&gt; 0)</option>
                  <option value="TRASH" ${this.filters.includeTrash ? 'selected' : ''}>Ver Lixeira</option>
                </select>
              </div>
            </div>
          </section>

          <!-- PAINEL DE VÍNCULOS TÉCNICOS (4 NATUREZAS DE RELACIONAMENTO) SE ATIVO -->
          ${this.selectedRelationsProduct ? this.renderRelationsPanelHtml(this.selectedRelationsProduct) : ''}

          <!-- GRADE DE CARDS DE PRODUTOS DE BALCÃO -->
          <section id="catalog-grid-container">
            ${this.renderProductGridHtml()}
          </section>
        </main>
      </div>
    `;

    this.bindMainEvents();
  }

  private hasActiveFilters(): boolean {
    return (
      Boolean(this.filters.query.trim()) ||
      this.filters.macroLine !== 'ALL' ||
      this.filters.productLine !== 'ALL' ||
      this.filters.automaker !== 'ALL' ||
      Boolean(this.filters.model.trim()) ||
      this.filters.year !== null ||
      this.filters.category !== 'ALL' ||
      this.filters.resinFinish !== 'ALL' ||
      this.filters.substrate !== 'ALL' ||
      this.filters.priceStatus !== 'ALL' ||
      Boolean(this.filters.includeTrash)
    );
  }

  private renderProductGridHtml(): string {
    if (this.filteredResults.length === 0) {
      return `
        <div class="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 rounded-2xl p-12 text-center space-y-3">
          <div class="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 mx-auto flex items-center justify-center">
            ${renderSvgIcon('search', 'w-6 h-6')}
          </div>
          <h3 class="text-base font-bold">Nenhuma peça encontrada para os filtros selecionados</h3>
          <p class="text-xs text-slate-600 dark:text-slate-300 max-w-md mx-auto">
            Tente limpar o filtro de Linha ou pesquisar por parte do código comercial (ex.: CAL, PPF, ADS, PROT) ou modelo do veículo.
          </p>
          <button
            type="button"
            data-reset-filters
            class="px-4 py-2 rounded-lg bg-[#1D4ED8] text-white text-xs font-bold cursor-pointer"
          >
            Mostrar Todo o Catálogo (${this.allProducts.length} peças)
          </button>
        </div>
      `;
    }

    const visibleItems = this.filteredResults.slice(0, this.visibleLimit);
    const hasMore = this.filteredResults.length > this.visibleLimit;

    return `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        ${visibleItems.map((item) => this.renderSingleProductCardHtml(item)).join('')}
      </div>
      ${
        hasMore
          ? `
        <div class="mt-6 flex flex-col items-center justify-center gap-2">
          <button
            type="button"
            data-load-more
            class="px-6 py-2.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-slate-700 border-2 border-[#1D4ED8] text-[#1D4ED8] dark:text-blue-400 font-bold text-xs cursor-pointer shadow-xs"
          >
            Carregar Mais Peças (Exibindo ${visibleItems.length} de ${this.filteredResults.length})
          </button>
        </div>
      `
          : ''
      }
    `;
  }

  private renderSingleProductCardHtml(item: SearchResultItem): string {
    const p = item.product;
    const gallery = resolveProductGalleryItems(p, this.imageAssetsMap, this.urlManager);
    const activeIdx = Math.min(
      this.activeCardAngleIndex.get(p.id) ?? 0,
      Math.max(0, gallery.length - 1)
    );
    const currentImg = gallery[activeIdx] || null;

    let priceCents = 0n;
    try {
      priceCents = BigInt(p.storeInventoryData?.priceCentsBigInt || '0');
    } catch {
      priceCents = 0n;
    }

    const app = p.vehicleApplications[0] || {
      automaker: p.automaker,
      model: 'Todos os Veículos',
      yearStart: null,
      yearEnd: null,
      isOngoing: false,
      rawText: p.automaker,
    };

    const yearBadge =
      app.yearStart && app.yearEnd
        ? app.yearStart === app.yearEnd
          ? `${app.yearStart}`
          : `${app.yearStart}/${app.yearEnd}`
        : app.yearStart && app.isOngoing
          ? `${app.yearStart}/...`
          : app.yearEnd
            ? `até ${app.yearEnd}`
            : '';

    return `
      <article
        data-product-card="${escapeHtml(p.id)}"
        class="bg-white dark:bg-[#1E293B] border border-[#E2E8F0] dark:border-slate-700 rounded-2xl shadow-xs hover:shadow-md transition flex flex-col overflow-hidden"
      >
        <!-- Topo do Card: Código SKU Monospace (Escaneável a 1 Metro) + Linha -->
        <div class="px-4 py-3 bg-slate-50/90 dark:bg-slate-800/70 border-b border-[#E2E8F0] dark:border-slate-700 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="font-mono text-xl font-extrabold tracking-tight text-[#1D4ED8] dark:text-blue-400">
              ${escapeHtml(p.commercialCodeRaw)}
            </span>
            ${
              item.isHomoglyphMatch
                ? `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-mono text-[10px] font-bold" title="Busca aproximada O↔0 / I↔1">Aprox. Homóglifo</span>`
                : ''
            }
          </div>
          <button
            type="button"
            data-filter-by-line="${escapeHtml(p.productLine)}"
            class="px-2.5 py-1 rounded-md bg-blue-100/80 dark:bg-blue-950/80 hover:bg-blue-200 text-[#1D4ED8] dark:text-blue-300 text-[11px] font-bold truncate max-w-[165px] cursor-pointer"
            title="Filtrar por ${escapeHtml(p.productLine)}"
          >
            ${escapeHtml(p.productLine)}
          </button>
        </div>

        <!-- Galeria de Imagem .WebP Fundo Branco Puro (#FFFFFF) + Carrossel Multi-Ângulos -->
        <div class="relative bg-white p-4 h-44 flex items-center justify-center border-b border-slate-100 group">
          ${
            currentImg
              ? `
            <img
              src="${escapeHtml(currentImg.displayUrl)}"
              alt="${escapeHtml(p.name)}"
              loading="lazy"
              data-open-lightbox="${escapeHtml(p.id)}"
              data-angle-index="${activeIdx}"
              class="max-h-36 max-w-full object-contain cursor-zoom-in transition-transform duration-150 group-hover:scale-105"
            />
          `
              : `
            <div class="text-xs text-slate-400 flex flex-col items-center gap-1">
              ${renderSvgIcon('image', 'w-8 h-8')}
              <span>Sem Foto</span>
            </div>
          `
          }

          <!-- Badge de Acabamento (Resinado vs Sem Resina / PPF) -->
          <span class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
            p.specs.resinFinish === 'Resinado'
              ? 'bg-emerald-700 text-white'
              : 'bg-slate-800 text-white'
          }">
            ${escapeHtml(p.specs.resinFinish)}
          </span>

          <!-- Botão Zoom 400% -->
          <button
            type="button"
            data-open-lightbox="${escapeHtml(p.id)}"
            data-angle-index="${activeIdx}"
            class="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-slate-900/75 hover:bg-[#1D4ED8] text-white opacity-85 group-hover:opacity-100 cursor-pointer transition"
            title="Abrir Zoom 400% HD"
          >
            ${renderSvgIcon('maximize', 'w-4 h-4')}
          </button>

          ${
            gallery.length > 1
              ? `
            <button
              type="button"
              data-card-angle-prev="${escapeHtml(p.id)}"
              class="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-slate-900/75 hover:bg-[#1D4ED8] text-white cursor-pointer"
              title="Ângulo anterior"
            >
              ${renderSvgIcon('chevronLeft', 'w-4 h-4')}
            </button>
            <button
              type="button"
              data-card-angle-next="${escapeHtml(p.id)}"
              class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-slate-900/75 hover:bg-[#1D4ED8] text-white cursor-pointer"
              title="Próximo ângulo"
            >
              ${renderSvgIcon('chevronRight', 'w-4 h-4')}
            </button>
            <span class="absolute bottom-2 right-2.5 px-2 py-0.5 rounded-full bg-blue-700 text-white font-mono text-[10px] font-bold">
              Ângulo ${activeIdx + 1}/${gallery.length} HD
            </span>
          `
              : ''
          }
        </div>

        <!-- Corpo Técnico do Card -->
        <div class="p-4 flex-1 flex flex-col justify-between space-y-3">
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-1">
              <span class="text-[11px] font-extrabold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                ${escapeHtml(p.category)}
              </span>
              <span class="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                ${escapeHtml(p.macroLine)}
              </span>
            </div>

            <h2 class="text-sm font-bold text-[#0F172A] dark:text-white leading-snug">
              ${escapeHtml(p.name)}
            </h2>

            <!-- Aplicação Veicular -->
            <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700 text-xs space-y-1">
              <div class="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                <span class="flex items-center gap-1">
                  ${renderSvgIcon('car', 'w-3.5 h-3.5')}
                  <span>${escapeHtml(app.automaker)}</span>
                </span>
                ${
                  yearBadge
                    ? `<span class="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-[10px]">${escapeHtml(yearBadge)}</span>`
                    : ''
                }
              </div>
              <p class="text-slate-600 dark:text-slate-300 text-xs truncate" title="${escapeHtml(app.model)}">
                ${escapeHtml(app.model)}
              </p>
            </div>

            <!-- Especificações Técnicas (Papel, Cor, Medidas, Embalagem) -->
            <div class="grid grid-cols-2 gap-1.5 text-[11px]">
              <div class="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">
                <span class="text-slate-500 dark:text-slate-400">Papel:</span>
                <strong class="text-slate-800 dark:text-slate-200"> ${escapeHtml(p.specs.substrate)}</strong>
              </div>
              <div class="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">
                <span class="text-slate-500 dark:text-slate-400">Cor:</span>
                <strong class="text-slate-800 dark:text-slate-200"> ${escapeHtml(p.specs.color)}</strong>
              </div>
              <div class="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 font-mono">
                <span class="text-slate-500 dark:text-slate-400">Medida:</span>
                <strong class="text-slate-900 dark:text-white"> ${escapeHtml(p.specs.dimensions)}</strong>
              </div>
              <div class="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">
                <span class="text-slate-500 dark:text-slate-400">Emb.:</span>
                <strong class="text-slate-800 dark:text-slate-200"> ${escapeHtml(p.specs.packageQty)}</strong>
              </div>
            </div>
          </div>

          <!-- Preço / Estoque da Loja (Oculto automaticamente quando Modo Cliente está ativo) -->
          <div class="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2.5">
            ${
              !this.isClientModeHidePrices
                ? `
              <div class="flex items-center justify-between text-xs">
                <div>
                  ${
                    priceCents > 0n
                      ? `<span class="font-mono text-base font-extrabold text-emerald-700 dark:text-emerald-400">${escapeHtml(formatCentsBigIntToBrl(priceCents))}</span>`
                      : `<span class="text-slate-400 italic">Preço sob consulta</span>`
                  }
                </div>
                <div class="flex items-center gap-2 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  ${
                    p.storeInventoryData?.shelfLocation
                      ? `<span class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">Local: ${escapeHtml(p.storeInventoryData.shelfLocation)}</span>`
                      : ''
                  }
                  <span>Est: <strong>${p.storeInventoryData?.stockQty ?? 0}</strong></span>
                </div>
              </div>
            `
                : ''
            }

            <!-- Ações Rápidas do Card: Vínculos, WhatsApp e Editar -->
            <div class="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                data-open-relations="${escapeHtml(p.id)}"
                class="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-blue-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer"
                title="Ver Variantes, Kits e Peças Complementares do Veículo"
              >
                ${renderSvgIcon('link', 'w-3.5 h-3.5')}
                <span>Vínculos (${(p.relations || []).length})</span>
              </button>

              <button
                type="button"
                data-copy-whatsapp="${escapeHtml(p.id)}"
                class="px-2 py-1.5 rounded-lg border border-emerald-600/40 bg-emerald-50/70 dark:bg-emerald-950/40 hover:bg-emerald-600 hover:text-white text-emerald-800 dark:text-emerald-300 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition"
                title="Copiar ficha técnica formatada para WhatsApp"
              >
                ${renderSvgIcon('shareWhatsApp', 'w-3.5 h-3.5')}
                <span>WhatsApp</span>
              </button>

              <button
                type="button"
                data-edit-product="${escapeHtml(p.id)}"
                class="px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-[#1D4ED8] hover:text-white text-slate-800 dark:text-slate-200 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition"
                title="Editar Produto, Preço, Prateleira ou Colar Fotos WebP"
              >
                ${renderSvgIcon('edit', 'w-3.5 h-3.5')}
                <span>Editar</span>
              </button>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  private renderRelationsPanelHtml(source: CatalogProduct): string {
    const grouped = resolveProductRelations(source, this.allProducts);

    const sections = [
      {
        key: 'VARIANTE_PRODUTO' as const,
        title: 'Variantes da Mesma Família (Cor / Medida / Acabamento)',
        badgeClass: 'bg-slate-800 text-white',
        borderClass: 'border-slate-300 dark:border-slate-600',
        items: grouped.VARIANTE_PRODUTO,
      },
      {
        key: 'COMPATIBILIDADE_ACOPLAMENTO' as const,
        title: 'Peças Complementares do Mesmo Veículo / Sugestão Transitiva',
        badgeClass: 'bg-emerald-700 text-white',
        borderClass: 'border-emerald-300 dark:border-emerald-700',
        items: grouped.COMPATIBILIDADE_ACOPLAMENTO,
      },
      {
        key: 'COMPOSICAO_KIT' as const,
        title: 'Composição de Kit & Peças Relacionadas',
        badgeClass: 'bg-purple-700 text-white',
        borderClass: 'border-purple-300 dark:border-purple-700',
        items: grouped.COMPOSICAO_KIT,
      },
      {
        key: 'EQUIVALENCIA_DIRETA' as const,
        title: 'Equivalência Direta (Mesmo OEM Estrito e Mesma Categoria)',
        badgeClass: 'bg-blue-700 text-white',
        borderClass: 'border-blue-300 dark:border-blue-700',
        items: grouped.EQUIVALENCIA_DIRETA,
      },
    ];

    return `
      <section class="bg-white dark:bg-[#1E293B] border-2 border-[#1D4ED8] rounded-2xl p-5 shadow-lg space-y-4">
        <div class="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
          <div class="flex items-center gap-3">
            <span class="px-3 py-1 rounded-lg bg-[#1D4ED8] text-white font-mono font-extrabold text-sm">
              ${escapeHtml(source.commercialCodeRaw)}
            </span>
            <div>
              <h3 class="text-sm font-extrabold">
                Painel das 4 Naturezas de Vínculos Técnicos — ${escapeHtml(source.name)}
              </h3>
              <p class="text-xs text-slate-500 dark:text-slate-400">
                Clique em qualquer peça vinculada para localizá-la imediatamente no balcão.
              </p>
            </div>
          </div>
          <button
            type="button"
            data-close-relations
            class="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-red-600 hover:text-white cursor-pointer"
          >
            ${renderSvgIcon('x', 'w-5 h-5')}
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          ${sections
            .map(
              (sec) => `
            <div class="p-3.5 rounded-xl border ${sec.borderClass} bg-slate-50/60 dark:bg-slate-900/50 space-y-2.5">
              <div class="flex items-center justify-between">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${sec.badgeClass}">
                  ${escapeHtml(sec.key.replace(/_/g, ' '))}
                </span>
                <span class="font-mono text-xs font-bold">${sec.items.length}</span>
              </div>
              <p class="text-xs font-bold text-slate-700 dark:text-slate-200">${escapeHtml(sec.title)}</p>
              <div class="space-y-2 max-h-48 overflow-y-auto pr-1">
                ${
                  sec.items.length === 0
                    ? `<p class="text-xs text-slate-400 italic">Nenhum vínculo registrado nesta natureza.</p>`
                    : sec.items
                        .map(
                          (rel) => `
                        <button
                          type="button"
                          data-jump-to-sku="${escapeHtml(rel.targetProduct.commercialCodeRaw)}"
                          class="w-full text-left p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-blue-600 flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <div class="min-w-0">
                            <div class="font-mono text-xs font-extrabold text-[#1D4ED8] dark:text-blue-400">
                              ${escapeHtml(rel.targetProduct.commercialCodeRaw)}
                              ${
                                rel.isTransitiveSuggestion
                                  ? `<span class="ml-1 px-1 py-0.2 rounded bg-amber-100 text-amber-900 text-[9px]">Transitiva</span>`
                                  : ''
                              }
                            </div>
                            <div class="text-[11px] font-semibold truncate">${escapeHtml(rel.targetProduct.name)}</div>
                            <div class="text-[10px] text-slate-500 truncate">${escapeHtml(rel.note)}</div>
                          </div>
                          ${renderSvgIcon('chevronRight', 'w-4 h-4 shrink-0')}
                        </button>
                      `
                        )
                        .join('')
                }
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </section>
    `;
  }

  private renderManagementDrawerHtml(): string {
    return `
      <div class="bg-slate-900 text-slate-100 border-b border-slate-700">
        <div class="max-w-[1600px] mx-auto px-4 lg:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div class="space-y-1">
            <div class="flex items-center gap-2 text-sm font-bold text-white">
              ${renderSvgIcon('shieldCheck', 'w-4 h-4 text-emerald-400')}
              <span>Central de Segurança, Backup SHA-256 e Estoque CSV</span>
            </div>
            <p class="text-xs text-slate-300">
              Exporte ou restaure backups completos com validação de integridade SHA-256 ou atualize preços em lote via CSV.
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              data-btn-export-backup
              class="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              ${renderSvgIcon('download', 'w-4 h-4')}
              <span>Exportar Backup (.JSON + SHA-256)</span>
            </button>

            <label class="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
              ${renderSvgIcon('upload', 'w-4 h-4')}
              <span>Restaurar Backup (.JSON)</span>
              <input type="file" data-input-restore-backup accept=".json,application/json" class="hidden" />
            </label>

            <button
              type="button"
              data-btn-export-csv
              class="px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              ${renderSvgIcon('download', 'w-4 h-4')}
              <span>Exportar Preços (.CSV)</span>
            </button>

            <label class="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
              ${renderSvgIcon('upload', 'w-4 h-4')}
              <span>Importar Preços (.CSV)</span>
              <input type="file" data-input-import-csv accept=".csv,text/csv" class="hidden" />
            </label>
          </div>
        </div>
      </div>
    `;
  }

  private bindMainEvents(): void {
    // 1. Busca em tempo real Sub-50ms (sem recarregar todo o shell para manter foco do teclado)
    const searchInput = document.getElementById('catalog-search-input') as HTMLInputElement | null;
    searchInput?.addEventListener('input', () => {
      this.filters.query = searchInput.value;
      this.visibleLimit = 48;
      this.executeSub50msSearch();
      const gridContainer = document.getElementById('catalog-grid-container');
      if (gridContainer) {
        gridContainer.innerHTML = this.renderProductGridHtml();
        this.bindGridCardEvents();
      }
    });

    // 2. Filtro por Macro-Linha (Abas superiores)
    document.querySelectorAll<HTMLElement>('[data-macro-line]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ml = btn.getAttribute('data-macro-line') || 'ALL';
        this.filters.macroLine = ml;
        this.visibleLimit = 48;
        this.executeSub50msSearch();
        this.renderAppShell();
      });
    });

    // 3. Filtro por Linha (Select e Chips Rápidos)
    const lineSelect = document.getElementById('filter-product-line') as HTMLSelectElement | null;
    lineSelect?.addEventListener('change', () => {
      this.filters.productLine = lineSelect.value;
      this.visibleLimit = 48;
      this.executeSub50msSearch();
      this.renderAppShell();
    });

    document.querySelectorAll<HTMLElement>('[data-line-chip]').forEach((chip) => {
      chip.addEventListener('click', () => {
        this.filters.productLine = chip.getAttribute('data-line-chip') || 'ALL';
        this.visibleLimit = 48;
        this.executeSub50msSearch();
        this.renderAppShell();
      });
    });

    // 4. Demais filtros combinados
    const catSelect = document.getElementById('filter-category') as HTMLSelectElement | null;
    catSelect?.addEventListener('change', () => {
      this.filters.category = catSelect.value;
      this.visibleLimit = 48;
      this.executeSub50msSearch();
      this.renderAppShell();
    });

    const autoSelect = document.getElementById('filter-automaker') as HTMLSelectElement | null;
    autoSelect?.addEventListener('change', () => {
      this.filters.automaker = autoSelect.value;
      this.visibleLimit = 48;
      this.executeSub50msSearch();
      this.renderAppShell();
    });

    const modelInput = document.getElementById('filter-model') as HTMLInputElement | null;
    modelInput?.addEventListener('input', () => {
      this.filters.model = modelInput.value;
      this.visibleLimit = 48;
      this.executeSub50msSearch();
      const gridContainer = document.getElementById('catalog-grid-container');
      if (gridContainer) {
        gridContainer.innerHTML = this.renderProductGridHtml();
        this.bindGridCardEvents();
      }
    });

    const yearInput = document.getElementById('filter-year') as HTMLInputElement | null;
    yearInput?.addEventListener('change', () => {
      const val = parseInt(yearInput.value, 10);
      this.filters.year = Number.isFinite(val) ? val : null;
      this.visibleLimit = 48;
      this.executeSub50msSearch();
      this.renderAppShell();
    });

    const resinSelect = document.getElementById('filter-resin') as HTMLSelectElement | null;
    resinSelect?.addEventListener('change', () => {
      this.filters.resinFinish = resinSelect.value as SearchFilters['resinFinish'];
      this.visibleLimit = 48;
      this.executeSub50msSearch();
      this.renderAppShell();
    });

    const subSelect = document.getElementById('filter-substrate') as HTMLSelectElement | null;
    subSelect?.addEventListener('change', () => {
      this.filters.substrate = subSelect.value;
      this.visibleLimit = 48;
      this.executeSub50msSearch();
      this.renderAppShell();
    });

    const statusSelect = document.getElementById('filter-price-status') as HTMLSelectElement | null;
    statusSelect?.addEventListener('change', () => {
      const val = statusSelect.value;
      if (val === 'TRASH') {
        this.filters.includeTrash = true;
        this.filters.priceStatus = 'ALL';
      } else {
        this.filters.includeTrash = false;
        this.filters.priceStatus = val as SearchFilters['priceStatus'];
      }
      this.visibleLimit = 48;
      this.executeSub50msSearch();
      this.renderAppShell();
    });

    document.querySelectorAll('[data-reset-filters]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.filters = CatalogSearchEngine.createDefaultFilters();
        this.visibleLimit = 48;
        this.executeSub50msSearch();
        this.renderAppShell();
      });
    });

    // 5. Controles da Barra Superior
    document.querySelector('[data-toggle-theme]')?.addEventListener('click', () => {
      this.isDarkMode = !this.isDarkMode;
      this.renderAppShell();
    });

    document.querySelector('[data-toggle-client-mode]')?.addEventListener('click', () => {
      this.isClientModeHidePrices = !this.isClientModeHidePrices;
      this.renderAppShell();
    });

    document.querySelector('[data-toggle-management]')?.addEventListener('click', () => {
      this.isManagementPanelOpen = !this.isManagementPanelOpen;
      this.renderAppShell();
    });

    document.querySelector('[data-btn-new-product]')?.addEventListener('click', () => {
      void this.productModal.open(
        null,
        this.getAvailableProductLines(),
        this.getAvailableCategories(),
        {
          onSaved: async () => {
            await this.reloadCatalogState();
            this.renderAppShell();
            this.showToast('Produto salvo com sucesso no catálogo da loja.');
          },
          onDeleted: async () => {
            await this.reloadCatalogState();
            this.renderAppShell();
          },
        }
      );
    });

    // 6. Eventos de Backup / Restore SHA-256 e CSV
    document.querySelector('[data-btn-export-backup]')?.addEventListener('click', async () => {
      const bundle = await this.storage.exportBackupBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sportinox-backup-sha256-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast(`Backup exportado (SHA-256: ${bundle.checksumSha256.slice(0, 12)}...).`);
    });

    const restoreInput = document.querySelector<HTMLInputElement>('[data-input-restore-backup]');
    restoreInput?.addEventListener('change', async () => {
      const file = restoreInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const bundle = JSON.parse(text) as CatalogBackupBundle;
        const res = await this.storage.restoreBackupBundle(bundle);
        await this.reloadCatalogState();
        this.renderAppShell();
        this.showToast(`Backup restaurado: ${res.restoredProducts} produtos validados por SHA-256.`);
      } catch (err) {
        this.showToast(`Erro na restauração: ${(err as Error).message}`);
      }
    });

    document.querySelector('[data-btn-export-csv]')?.addEventListener('click', async () => {
      const csv = await this.storage.exportInventoryCsv();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sportinox-estoque-precos-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Planilha CSV de preços e estoque exportada.');
    });

    const csvInput = document.querySelector<HTMLInputElement>('[data-input-import-csv]');
    csvInput?.addEventListener('change', async () => {
      const file = csvInput.files?.[0];
      if (!file) return;
      const text = await file.text();
      const res = await this.storage.importInventoryCsv(text);
      await this.reloadCatalogState();
      this.renderAppShell();
      this.showToast(`${res.updatedCount} produtos atualizados via planilha CSV.`);
    });

    // 7. Painel de Vínculos Técnicos
    document.querySelector('[data-close-relations]')?.addEventListener('click', () => {
      this.selectedRelationsProduct = null;
      this.renderAppShell();
    });

    document.querySelectorAll<HTMLElement>('[data-jump-to-sku]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sku = btn.getAttribute('data-jump-to-sku') || '';
        this.filters = {
          ...CatalogSearchEngine.createDefaultFilters(),
          query: sku,
        };
        this.selectedRelationsProduct = null;
        this.executeSub50msSearch();
        this.renderAppShell();
      });
    });

    this.bindGridCardEvents();
  }

  private bindGridCardEvents(): void {
    document.querySelector('[data-load-more]')?.addEventListener('click', () => {
      this.visibleLimit += 48;
      const gridContainer = document.getElementById('catalog-grid-container');
      if (gridContainer) {
        gridContainer.innerHTML = this.renderProductGridHtml();
        this.bindGridCardEvents();
      }
    });

    document.querySelectorAll<HTMLElement>('[data-filter-by-line]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const line = btn.getAttribute('data-filter-by-line') || 'ALL';
        this.filters.productLine = line;
        this.visibleLimit = 48;
        this.executeSub50msSearch();
        this.renderAppShell();
      });
    });

    document.querySelectorAll<HTMLElement>('[data-open-lightbox]').forEach((el) => {
      el.addEventListener('click', () => {
        const prodId = el.getAttribute('data-open-lightbox') || '';
        const angleIdx = parseInt(el.getAttribute('data-angle-index') || '0', 10);
        const prod = this.allProducts.find((p) => p.id === prodId);
        if (!prod) return;
        const gallery = resolveProductGalleryItems(prod, this.imageAssetsMap, this.urlManager);
        this.lightbox.open(gallery, angleIdx, prod.commercialCodeRaw, prod.name);
      });
    });

    document.querySelectorAll<HTMLElement>('[data-card-angle-prev]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const prodId = btn.getAttribute('data-card-angle-prev') || '';
        const prod = this.allProducts.find((p) => p.id === prodId);
        if (!prod) return;
        const gallery = resolveProductGalleryItems(prod, this.imageAssetsMap, this.urlManager);
        const curr = this.activeCardAngleIndex.get(prodId) ?? 0;
        const next = (curr - 1 + gallery.length) % gallery.length;
        this.activeCardAngleIndex.set(prodId, next);
        const gridContainer = document.getElementById('catalog-grid-container');
        if (gridContainer) {
          gridContainer.innerHTML = this.renderProductGridHtml();
          this.bindGridCardEvents();
        }
      });
    });

    document.querySelectorAll<HTMLElement>('[data-card-angle-next]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const prodId = btn.getAttribute('data-card-angle-next') || '';
        const prod = this.allProducts.find((p) => p.id === prodId);
        if (!prod) return;
        const gallery = resolveProductGalleryItems(prod, this.imageAssetsMap, this.urlManager);
        const curr = this.activeCardAngleIndex.get(prodId) ?? 0;
        const next = (curr + 1) % gallery.length;
        this.activeCardAngleIndex.set(prodId, next);
        const gridContainer = document.getElementById('catalog-grid-container');
        if (gridContainer) {
          gridContainer.innerHTML = this.renderProductGridHtml();
          this.bindGridCardEvents();
        }
      });
    });

    document.querySelectorAll<HTMLElement>('[data-open-relations]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prodId = btn.getAttribute('data-open-relations') || '';
        const prod = this.allProducts.find((p) => p.id === prodId) || null;
        this.selectedRelationsProduct = prod;
        this.renderAppShell();
      });
    });

    document.querySelectorAll<HTMLElement>('[data-copy-whatsapp]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const prodId = btn.getAttribute('data-copy-whatsapp') || '';
        const prod = this.allProducts.find((p) => p.id === prodId);
        if (!prod) return;
        const summary = this.formatWhatsAppSummary(prod);
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(summary);
        }
        this.showToast(`Resumo de ${prod.commercialCodeRaw} copiado para o WhatsApp!`);
      });
    });

    document.querySelectorAll<HTMLElement>('[data-edit-product]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const prodId = btn.getAttribute('data-edit-product') || '';
        const prod = this.allProducts.find((p) => p.id === prodId);
        if (!prod) return;
        void this.productModal.open(
          prod,
          this.getAvailableProductLines(),
          this.getAvailableCategories(),
          {
            onSaved: async (saved) => {
              await this.reloadCatalogState();
              this.renderAppShell();
              this.showToast(`Produto ${saved.commercialCodeRaw} atualizado com sucesso.`);
            },
            onDeleted: async () => {
              await this.reloadCatalogState();
              this.renderAppShell();
              this.showToast('Produto excluído definitivamente.');
            },
          }
        );
      });
    });
  }
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  const app = new SportinoxCounterCatalogApp();
  void app.bootstrap();
}

export { SportinoxCounterCatalogApp };
