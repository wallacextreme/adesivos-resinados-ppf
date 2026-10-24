/**
 * src/ui/product-form-modal.ts
 * Modal Completo de Gestão Manual de Balcão (CRUD + Fotos WebP Ctrl+V / Drag&Drop + Estoque/Preços BigInt).
 */

import { formatCentsBigIntToBrl, parseBrlToCentsBigInt } from '../domain/currency';
import { normalizeCodeStrict, sanitizeCrossReferenceCodes } from '../domain/normalizer';
import { escapeHtml } from '../domain/security';
import type {
  CatalogProduct,
  OemCodeEntry,
  ProductRelationLink,
  RelationType,
  StoredImageAsset,
  VehicleApplication,
} from '../domain/types';
import { parseVehicleYearRange } from '../domain/units-and-years';
import type { CatalogStorageEngine } from '../storage/catalog-db';
import { renderSvgIcon } from './icons';
import { ObjectUrlManager, resolveProductGalleryItems } from './image-gallery';

export interface ProductModalCallbacks {
  onSaved: (product: CatalogProduct) => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
}

export class ProductFormModal {
  private modalEl: HTMLElement | null = null;
  private storage: CatalogStorageEngine;
  private urlManager = new ObjectUrlManager();
  private pasteHandler: ((ev: ClipboardEvent) => void) | null = null;

  public constructor(storage: CatalogStorageEngine) {
    this.storage = storage;
  }

  public async open(
    productToEdit: CatalogProduct | null,
    availableLines: string[],
    availableCategories: string[],
    callbacks: ProductModalCallbacks
  ): Promise<void> {
    this.close();
    if (typeof document === 'undefined') return;

    const isEditing = Boolean(productToEdit);
    let workingProduct: CatalogProduct = productToEdit
      ? structuredClone(productToEdit)
      : {
          id: `custom-${Date.now()}`,
          commercialCodeRaw: '',
          commercialCodeNormalized: '',
          brandName: 'Sportinox',
          macroLine: 'Linha Leve',
          productLine: availableLines[0] || 'Linha Universal',
          productLines: ['Linha Leve', availableLines[0] || 'Linha Universal'],
          category: availableCategories[0] || 'ADESIVO RESINADO',
          subCategory: '',
          name: '',
          description: '',
          automaker: 'UNIVERSAL',
          oemCodes: [],
          vehicleApplications: [
            {
              automaker: 'UNIVERSAL',
              model: 'Todos os Veículos',
              yearStart: null,
              yearEnd: null,
              isOngoing: false,
              rawText: 'UNIVERSAL - Todos os Veículos',
            },
          ],
          specs: {
            substrate: 'Cromado',
            resinFinish: 'Resinado',
            color: 'Padrão',
            dimensions: '48 mm',
            packageQty: '1 un',
            pressureKpa: null,
            nozzlesQty: null,
            hasSensorHole: null,
            voltage: null,
          },
          staticImageUrls: [],
          removedStaticUrls: [],
          imageAssetIds: [],
          coverImageIdentifier: null,
          relations: [],
          storeInventoryData: {
            internalStoreCode: '',
            priceCentsBigInt: '0',
            costCentsBigInt: '0',
            stockQty: 0,
            minStockQty: 0,
            shelfLocation: '',
            supplierNotes: '',
            updatedAt: new Date().toISOString(),
          },
          isCustomCreated: true,
          updatedAt: new Date().toISOString(),
        };

    const allAssets = await this.storage.getAllImageAssets();
    const assetsMap = new Map<string, StoredImageAsset>(allAssets.map((a) => [a.id, a]));

    const overlay = document.createElement('div');
    overlay.className =
      'fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto';

    const renderModalContent = (): void => {
      const galleryEntries = resolveProductGalleryItems(
        workingProduct,
        assetsMap,
        this.urlManager
      );
      const formattedPrice = formatCentsBigIntToBrl(
        workingProduct.storeInventoryData.priceCentsBigInt
      ).replace(/^R\$\s*/, '');
      const oemString = (workingProduct.oemCodes || []).map((o) => o.rawCode).join(', ');
      const app = workingProduct.vehicleApplications[0] || {
        automaker: workingProduct.automaker,
        model: '',
        yearStart: null,
        yearEnd: null,
        isOngoing: false,
        rawText: '',
      };
      const yearStr =
        app.yearStart && app.yearEnd
          ? `${app.yearStart}/${app.yearEnd}`
          : app.yearStart && app.isOngoing
            ? `${app.yearStart}/...`
            : app.yearEnd
              ? `.../${app.yearEnd}`
              : '';

      overlay.innerHTML = `
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden text-slate-900 dark:text-slate-100">
          <!-- Cabeçalho -->
          <div class="flex items-center justify-between px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
            <div class="flex items-center gap-3">
              <span class="p-2 rounded-lg bg-blue-700 text-white">
                ${renderSvgIcon(isEditing ? 'edit' : 'plus', 'w-5 h-5')}
              </span>
              <div>
                <h2 class="text-lg font-bold">
                  ${isEditing ? `Editar Produto — ${escapeHtml(workingProduct.commercialCodeRaw)}` : 'Cadastrar Novo Produto no Catálogo'}
                </h2>
                <p class="text-xs text-slate-600 dark:text-slate-300">
                  Dados da Loja (Preços, Prateleira e Fotos Manuais) são isolados e protegidos no IndexedDB.
                </p>
              </div>
            </div>
            <button type="button" data-modal-close class="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer">
              ${renderSvgIcon('x', 'w-5 h-5')}
            </button>
          </div>

          <!-- Corpo com Rolagem Livre -->
          <form id="product-crud-form" class="flex-1 overflow-y-auto p-6 space-y-6">
            <!-- Seção 1: Identificação Comercial e Linha -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Código Comercial (SKU) *
                </label>
                <input
                  type="text"
                  name="commercialCodeRaw"
                  required
                  value="${escapeHtml(workingProduct.commercialCodeRaw)}"
                  placeholder="Ex: CAL168, PPF0076"
                  class="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-mono text-base font-extrabold uppercase"
                />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Segmento (Macro-Linha)
                </label>
                <select
                  name="macroLine"
                  class="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-semibold"
                >
                  ${['Linha Leve', 'Linha Universal', 'Linha Pesada', 'Linha Motos', 'Lançamentos']
                    .map(
                      (ml) =>
                        `<option value="${escapeHtml(ml)}" ${workingProduct.macroLine === ml ? 'selected' : ''}>${escapeHtml(ml)}</option>`
                    )
                    .join('')}
                </select>
              </div>
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Linha por Montadora *
                </label>
                <input
                  type="text"
                  name="productLine"
                  list="datalist-lines"
                  required
                  value="${escapeHtml(workingProduct.productLine)}"
                  placeholder="Ex: Linha Audi, Linha Chevrolet (GM)"
                  class="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-semibold"
                />
                <datalist id="datalist-lines">
                  ${availableLines.map((l) => `<option value="${escapeHtml(l)}"></option>`).join('')}
                </datalist>
              </div>
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Categoria *
                </label>
                <input
                  type="text"
                  name="category"
                  list="datalist-categories"
                  required
                  value="${escapeHtml(workingProduct.category)}"
                  class="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-semibold uppercase"
                />
                <datalist id="datalist-categories">
                  ${availableCategories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}
                </datalist>
              </div>
            </div>

            <!-- Nome, Aplicação e Especificações -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div class="md:col-span-2">
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Nome / Descrição Comercial *
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  value="${escapeHtml(workingProduct.name)}"
                  placeholder="Ex: EMBLEMA DE CALOTA AUDI PRETO 48MM"
                  class="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-semibold"
                />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1">
                  Códigos OEM / Referência Cruzada
                </label>
                <input
                  type="text"
                  name="oemCodesRaw"
                  value="${escapeHtml(oemString)}"
                  placeholder="Ex: SPX-CAL168, 1J0121403A/B"
                  class="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-mono text-sm"
                />
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <div>
                <label class="block text-xs font-bold uppercase text-slate-700 dark:text-slate-300 mb-1">
                  Montadora
                </label>
                <input
                  type="text"
                  name="automaker"
                  value="${escapeHtml(workingProduct.automaker)}"
                  class="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-700 dark:text-slate-300 mb-1">
                  Modelo / Aplicação
                </label>
                <input
                  type="text"
                  name="vehicleModel"
                  value="${escapeHtml(app.model)}"
                  class="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-700 dark:text-slate-300 mb-1">
                  Intervalo de Anos
                </label>
                <input
                  type="text"
                  name="yearRangeRaw"
                  value="${escapeHtml(yearStr)}"
                  placeholder="Ex: 09/13, 13/, /12, 2025"
                  class="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-mono text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-700 dark:text-slate-300 mb-1">
                  Acabamento Resina
                </label>
                <select
                  name="resinFinish"
                  class="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                >
                  <option value="Resinado" ${workingProduct.specs.resinFinish === 'Resinado' ? 'selected' : ''}>Resinado (PU Alto Brilho)</option>
                  <option value="Sem Resina" ${workingProduct.specs.resinFinish === 'Sem Resina' ? 'selected' : ''}>Sem Resina (Plano / PPF)</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-700 dark:text-slate-300 mb-1">
                  Papel / Substrato
                </label>
                <input
                  type="text"
                  name="substrate"
                  value="${escapeHtml(workingProduct.specs.substrate)}"
                  placeholder="Cromado, PPF Brilhante, Fibra..."
                  class="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-700 dark:text-slate-300 mb-1">
                  Cor Principal
                </label>
                <input
                  type="text"
                  name="color"
                  value="${escapeHtml(workingProduct.specs.color)}"
                  class="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-700 dark:text-slate-300 mb-1">
                  Medidas (mm / cm)
                </label>
                <input
                  type="text"
                  name="dimensions"
                  value="${escapeHtml(workingProduct.specs.dimensions)}"
                  class="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-mono text-sm"
                />
              </div>
              <div>
                <label class="block text-xs font-bold uppercase text-slate-700 dark:text-slate-300 mb-1">
                  Embalagem / Quantidade
                </label>
                <input
                  type="text"
                  name="packageQty"
                  value="${escapeHtml(workingProduct.specs.packageQty)}"
                  class="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
                />
              </div>
            </div>

            <!-- Seção 2: Dados Isolados da Loja (Preço BigInt, Código Interno, Estoque, Prateleira) -->
            <div class="p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 space-y-3">
              <div class="flex items-center gap-2 text-blue-900 dark:text-blue-200 font-bold text-xs uppercase tracking-wider">
                ${renderSvgIcon('shieldCheck', 'w-4 h-4')}
                <span>Dados Exclusivos da Loja (Protegidos contra Sobrescrita no Auto-Sync)</span>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Preço de Venda (R$)
                  </label>
                  <input
                    type="text"
                    name="priceBrl"
                    value="${escapeHtml(formattedPrice)}"
                    placeholder="0,00"
                    class="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-mono font-bold text-base text-emerald-700 dark:text-emerald-400"
                  />
                </div>
                <div>
                  <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Código Interno da Loja
                  </label>
                  <input
                    type="text"
                    name="internalStoreCode"
                    value="${escapeHtml(workingProduct.storeInventoryData.internalStoreCode)}"
                    placeholder="Ex: INT-0042"
                    class="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-mono text-sm uppercase"
                  />
                </div>
                <div>
                  <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Qtd. em Estoque
                  </label>
                  <input
                    type="number"
                    name="stockQty"
                    value="${workingProduct.storeInventoryData.stockQty}"
                    min="0"
                    class="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-mono text-sm font-bold"
                  />
                </div>
                <div>
                  <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Corredor / Prateleira / Gaveta
                  </label>
                  <input
                    type="text"
                    name="shelfLocation"
                    value="${escapeHtml(workingProduct.storeInventoryData.shelfLocation)}"
                    placeholder="Ex: Gaveta A-12"
                    class="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm font-semibold"
                  />
                </div>
              </div>
            </div>

            <!-- Seção 3: Galeria Multi-Ângulos & Conversor WebP Automático (Ctrl+V / Drag & Drop) -->
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <label class="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  ${renderSvgIcon('image', 'w-4 h-4')}
                  <span>Galeria Multi-Ângulos (.WebP Sem Perda Visual — Cole com Ctrl+V ou Arraste)</span>
                </label>
                <label class="px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                  ${renderSvgIcon('upload', 'w-4 h-4')}
                  <span>Adicionar Fotos (PNG/JPG/WEBP)</span>
                  <input type="file" data-file-input accept="image/*" multiple class="hidden" />
                </label>
              </div>

              <div
                data-dropzone
                class="p-4 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50/50 dark:bg-slate-800/40 text-center text-xs text-slate-600 dark:text-slate-300"
              >
                Pressione <kbd class="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono font-bold">Ctrl+V</kbd> com esta janela aberta para colar uma captura de tela ou arraste fotos para cá. Conversão automática para <strong>.WebP Studio (quality 96% + deduplicação SHA-256)</strong>.
              </div>

              <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                ${galleryEntries
                  .map(
                    (g) => `
                  <div class="p-2 rounded-xl border ${
                    g.isCover
                      ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                  } flex flex-col items-center gap-2">
                    <div class="w-full h-24 bg-white rounded-lg flex items-center justify-center p-1 border border-slate-100">
                      <img src="${escapeHtml(g.thumbUrl)}" alt="Ângulo ${g.angleIndex}" class="max-h-full max-w-full object-contain" />
                    </div>
                    <div class="flex items-center justify-between w-full text-[11px]">
                      <span class="font-mono font-bold flex items-center gap-1 ${g.isCover ? 'text-blue-700 dark:text-blue-400' : 'text-slate-500'}">
                        ${g.isCover ? `${renderSvgIcon('star', 'w-3 h-3')} CAPA` : `Ângulo ${g.angleIndex}`}
                      </span>
                      <div class="flex items-center gap-1">
                        ${
                          !g.isCover
                            ? `<button type="button" data-set-cover="${escapeHtml(g.identifier)}" class="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 hover:bg-blue-600 hover:text-white text-[10px] font-bold cursor-pointer" title="Definir como Capa">Capa</button>`
                            : ''
                        }
                        <button type="button" data-remove-img="${escapeHtml(g.identifier)}" class="p-1 rounded text-red-600 hover:bg-red-100 dark:hover:bg-red-950/50 cursor-pointer" title="Ocultar / Remover este ângulo">
                          ${renderSvgIcon('trash', 'w-3.5 h-3.5')}
                        </button>
                      </div>
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </div>
          </form>

          <!-- Rodapé de Ações -->
          <div class="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700">
            <div class="flex items-center gap-2">
              ${
                isEditing
                  ? `
                <button type="button" data-btn-duplicate class="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                  ${renderSvgIcon('copy', 'w-4 h-4')}
                  <span>Duplicar Produto</span>
                </button>
                <button type="button" data-btn-trash class="px-3 py-2 rounded-lg border border-amber-300 text-amber-800 dark:text-amber-300 hover:bg-amber-100/60 text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                  ${renderSvgIcon('trash', 'w-4 h-4')}
                  <span>${workingProduct.isTrash ? 'Restaurar da Lixeira' : 'Mover p/ Lixeira'}</span>
                </button>
                <button type="button" data-btn-delete-perm class="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                  ${renderSvgIcon('trash', 'w-4 h-4')}
                  <span>Excluir Definitivamente</span>
                </button>
              `
                  : ''
              }
            </div>
            <div class="flex items-center gap-3">
              <button type="button" data-modal-close class="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-bold cursor-pointer">
                Cancelar
              </button>
              <button type="submit" form="product-crud-form" class="px-5 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                ${renderSvgIcon('check', 'w-4 h-4')}
                <span>Salvar Alterações</span>
              </button>
            </div>
          </div>
        </div>
      `;

      this.bindInternalEvents(overlay, workingProduct, isEditing, assetsMap, renderModalContent, callbacks);
    };

    renderModalContent();
    document.body.appendChild(overlay);
    this.modalEl = overlay;
  }

  private bindInternalEvents(
    overlay: HTMLElement,
    workingProduct: CatalogProduct,
    isEditing: boolean,
    assetsMap: Map<string, StoredImageAsset>,
    rerender: () => void,
    callbacks: ProductModalCallbacks
  ): void {
    overlay.querySelectorAll('[data-modal-close]').forEach((btn) => {
      btn.addEventListener('click', () => this.close());
    });

    const handleFilesUpload = async (files: FileList | File[]): Promise<void> => {
      const list = Array.from(files);
      for (const file of list) {
        if (!isEditing) {
          // Salva o produto provisoriamente caso ainda não exista no banco
          workingProduct = await this.storage.createProduct({
            ...workingProduct,
            commercialCodeRaw: workingProduct.commercialCodeRaw || `NOVO-${Date.now()}`,
            name: workingProduct.name || 'Novo Produto',
          });
          isEditing = true;
        }
        const { product, asset } = await this.storage.attachImageToProduct(workingProduct.id, file);
        workingProduct = product;
        assetsMap.set(asset.id, asset);
      }
      rerender();
    };

    const fileInput = overlay.querySelector<HTMLInputElement>('[data-file-input]');
    fileInput?.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        void handleFilesUpload(fileInput.files);
      }
    });

    const dropzone = overlay.querySelector<HTMLElement>('[data-dropzone]');
    dropzone?.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      dropzone.classList.add('border-blue-600');
    });
    dropzone?.addEventListener('dragleave', () => {
      dropzone.classList.remove('border-blue-600');
    });
    dropzone?.addEventListener('drop', (ev) => {
      ev.preventDefault();
      dropzone.classList.remove('border-blue-600');
      if (ev.dataTransfer?.files && ev.dataTransfer.files.length > 0) {
        void handleFilesUpload(ev.dataTransfer.files);
      }
    });

    if (this.pasteHandler) {
      window.removeEventListener('paste', this.pasteHandler);
    }
    this.pasteHandler = (ev: ClipboardEvent) => {
      const items = ev.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        ev.preventDefault();
        void handleFilesUpload(files);
      }
    };
    window.addEventListener('paste', this.pasteHandler);

    overlay.querySelectorAll<HTMLElement>('[data-set-cover]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const imgId = btn.getAttribute('data-set-cover') || '';
        if (isEditing) {
          workingProduct = await this.storage.setProductCoverImage(workingProduct.id, imgId);
        } else {
          workingProduct.coverImageIdentifier = imgId;
        }
        rerender();
      });
    });

    overlay.querySelectorAll<HTMLElement>('[data-remove-img]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const imgId = btn.getAttribute('data-remove-img') || '';
        if (isEditing) {
          workingProduct = await this.storage.removeImageFromProduct(workingProduct.id, imgId);
        }
        rerender();
      });
    });

    overlay.querySelector('[data-btn-duplicate]')?.addEventListener('click', async () => {
      const dup = await this.storage.duplicateProduct(workingProduct.id);
      await callbacks.onSaved(dup);
      this.close();
    });

    overlay.querySelector('[data-btn-trash]')?.addEventListener('click', async () => {
      const updated = workingProduct.isTrash
        ? await this.storage.restoreFromTrash(workingProduct.id)
        : await this.storage.moveToTrash(workingProduct.id);
      await callbacks.onSaved(updated);
      this.close();
    });

    overlay.querySelector('[data-btn-delete-perm]')?.addEventListener('click', async () => {
      await this.storage.deleteProductPermanently(workingProduct.id);
      await callbacks.onDeleted();
      this.close();
    });

    const form = overlay.querySelector<HTMLFormElement>('#product-crud-form');
    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const skuRaw = String(fd.get('commercialCodeRaw') || '').trim();
      const macroLine = String(fd.get('macroLine') || 'Linha Leve').trim();
      const productLine = String(fd.get('productLine') || 'Linha Universal').trim();
      const category = String(fd.get('category') || 'ADESIVO RESINADO').trim().toUpperCase();
      const name = String(fd.get('name') || '').trim();
      const automaker = String(fd.get('automaker') || 'UNIVERSAL').trim().toUpperCase();
      const vehicleModel = String(fd.get('vehicleModel') || 'Todos os Veículos').trim();
      const yearRangeRaw = String(fd.get('yearRangeRaw') || '').trim();
      const parsedYears = parseVehicleYearRange(yearRangeRaw);

      const oemRawInput = String(fd.get('oemCodesRaw') || '').trim();
      const sanitizedOems = sanitizeCrossReferenceCodes(oemRawInput);
      const oemCodes: OemCodeEntry[] = sanitizedOems.map((c) => ({
        rawCode: c,
        normalizedCode: normalizeCodeStrict(c),
        automaker,
      }));

      const priceCents = parseBrlToCentsBigInt(String(fd.get('priceBrl') || '0')).toString();
      const internalStoreCode = String(fd.get('internalStoreCode') || '').trim().toUpperCase();
      const stockQty = parseInt(String(fd.get('stockQty') || '0'), 10) || 0;
      const shelfLocation = String(fd.get('shelfLocation') || '').trim();

      const patch: Partial<CatalogProduct> = {
        commercialCodeRaw: skuRaw,
        commercialCodeNormalized: normalizeCodeStrict(skuRaw),
        macroLine,
        productLine,
        productLines: Array.from(new Set([macroLine, productLine])),
        category,
        name,
        automaker,
        oemCodes,
        vehicleApplications: [
          {
            automaker,
            model: vehicleModel,
            yearStart: parsedYears.yearStart,
            yearEnd: parsedYears.yearEnd,
            isOngoing: parsedYears.isOngoing,
            rawText: `${automaker} - ${vehicleModel} ${yearRangeRaw}`.trim(),
          },
        ],
        specs: {
          ...workingProduct.specs,
          resinFinish: String(fd.get('resinFinish') || 'Resinado'),
          substrate: String(fd.get('substrate') || 'Cromado'),
          color: String(fd.get('color') || 'Padrão'),
          dimensions: String(fd.get('dimensions') || 'Padrão'),
          packageQty: String(fd.get('packageQty') || '1 un'),
        },
        storeInventoryData: {
          ...workingProduct.storeInventoryData,
          priceCentsBigInt: priceCents,
          internalStoreCode,
          stockQty,
          shelfLocation,
          updatedAt: new Date().toISOString(),
        },
      };

      const saved = isEditing
        ? await this.storage.updateProduct(workingProduct.id, patch)
        : await this.storage.createProduct({
            ...workingProduct,
            ...patch,
            commercialCodeRaw: skuRaw,
            name,
          });

      await callbacks.onSaved(saved);
      this.close();
    });
  }

  public close(): void {
    if (this.pasteHandler && typeof window !== 'undefined') {
      window.removeEventListener('paste', this.pasteHandler);
      this.pasteHandler = null;
    }
    this.urlManager.revokeAll();
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }
}
