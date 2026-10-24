/**
 * src/storage/catalog-db.ts
 * Camada de Persistência IndexedDB Versionada + Auto-Sync Incremental Não-Destrutivo.
 * - Fila de Concorrência (WriteQueue) para serializar escritas simultâneas sem race conditions.
 * - Rotina `syncStaticCatalogUpdates`: sincroniza novas fotos multi-ângulos (`staticImageUrls`) e novos
 *   produtos do seed SEM JAMAIS sobrescrever ou apagar `storeInventoryData` (preços, prateleiras e códigos
 *   internos da loja), `imageAssetIds` (fotos manuais subidas pelo lojista) ou `removedStaticUrls`.
 * - Deduplicação automática de imagens manuais no IndexedDB por `hashSha256`.
 * - Backup/Restore completo (`.json` com imagens + verificação de checksum `SHA-256`).
 * - Importação/Exportação CSV de Preços/Estoque e Trilha de Auditoria (`auditLogs`).
 */

import { formatCentsBigIntToBrl, parseBrlToCentsBigInt } from '../domain/currency';
import { normalizeCodeStrict } from '../domain/normalizer';
import { computeSha256Hex } from '../domain/security';
import type {
  AuditLogEntry,
  CatalogBackupBundle,
  CatalogProduct,
  StoreInventoryData,
  StoredImageAsset,
} from '../domain/types';
import { convertImageInputToWebp } from '../media/webp-converter';

const DB_NAME = 'SportinoxCounterCatalogDB';
const DB_VERSION = 4;

const STORE_PRODUCTS = 'products';
const STORE_IMAGE_ASSETS = 'imageAssets';
const STORE_AUDIT_LOGS = 'auditLogs';

/**
 * Fila assíncrona determinística para serializar operações de escrita concorrentes
 * evitando perdas de atualização em cliques rápidos ou importações em lote.
 */
export class AsyncWriteQueue {
  private chain: Promise<unknown> = Promise.resolve();

  public enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

export function createDefaultStoreInventory(): StoreInventoryData {
  return {
    internalStoreCode: '',
    priceCentsBigInt: '0',
    costCentsBigInt: '0',
    stockQty: 0,
    minStockQty: 0,
    shelfLocation: '',
    supplierNotes: '',
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeSeedProductToCatalogProduct(raw: Partial<CatalogProduct>): CatalogProduct {
  const skuRaw = String(raw.commercialCodeRaw || '').trim();
  const skuNorm = normalizeCodeStrict(raw.commercialCodeNormalized || skuRaw);
  const id = raw.id || `sportinox-${skuNorm.toLowerCase()}`;
  const staticUrls = (raw.staticImageUrls || []).map((u) => String(u).toLowerCase());
  const macroLine = raw.macroLine || 'Linha Leve';
  const productLine = raw.productLine || 'Linha Universal';
  const productLines = Array.from(
    new Set([macroLine, productLine, ...(raw.productLines || [])].filter(Boolean))
  );

  return {
    id,
    commercialCodeRaw: skuRaw,
    commercialCodeNormalized: skuNorm,
    brandName: raw.brandName || 'Sportinox',
    macroLine,
    productLine,
    productLines,
    category: raw.category || 'ADESIVO RESINADO',
    subCategory: raw.subCategory || '',
    name: raw.name || `${raw.category || 'ADESIVO'} ${skuRaw}`.trim(),
    description: raw.description || '',
    automaker: raw.automaker || 'UNIVERSAL',
    oemCodes: Array.isArray(raw.oemCodes) ? raw.oemCodes.map((o) => ({ ...o })) : [],
    vehicleApplications: Array.isArray(raw.vehicleApplications)
      ? raw.vehicleApplications.map((a) => ({ ...a }))
      : [],
    specs: {
      substrate: raw.specs?.substrate ?? 'Cromado',
      resinFinish: raw.specs?.resinFinish ?? 'Resinado',
      color: raw.specs?.color ?? 'Padrão',
      dimensions: raw.specs?.dimensions ?? 'Padrão',
      packageQty: raw.specs?.packageQty ?? '1 un',
      pressureKpa: raw.specs?.pressureKpa ?? null,
      nozzlesQty: raw.specs?.nozzlesQty ?? null,
      hasSensorHole: raw.specs?.hasSensorHole ?? null,
      voltage: raw.specs?.voltage ?? null,
    },
    staticImageUrls: staticUrls,
    removedStaticUrls: Array.isArray(raw.removedStaticUrls) ? [...raw.removedStaticUrls] : [],
    imageAssetIds: Array.isArray(raw.imageAssetIds) ? [...raw.imageAssetIds] : [],
    coverImageIdentifier: raw.coverImageIdentifier ?? (staticUrls[0] || null),
    relations: Array.isArray(raw.relations) ? raw.relations.map((r) => ({ ...r })) : [],
    storeInventoryData: raw.storeInventoryData
      ? { ...createDefaultStoreInventory(), ...raw.storeInventoryData }
      : createDefaultStoreInventory(),
    isTrash: Boolean(raw.isTrash),
    isCustomCreated: Boolean(raw.isCustomCreated),
    sourcePdf: raw.sourcePdf,
    sourcePage: raw.sourcePage,
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

export class CatalogStorageEngine {
  private writeQueue = new AsyncWriteQueue();
  private idbDatabase: IDBDatabase | null = null;
  private useMemoryFallback = false;

  // Fallback em memória para ambientes de teste (Bun test) ou modos restritos
  private memProducts = new Map<string, CatalogProduct>();
  private memImageAssets = new Map<string, StoredImageAsset>();
  private memAuditLogs: AuditLogEntry[] = [];

  public async init(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      this.useMemoryFallback = true;
      return;
    }

    if (this.idbDatabase) return;

    try {
      this.idbDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
            db.createObjectStore(STORE_PRODUCTS, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_IMAGE_ASSETS)) {
            const imgStore = db.createObjectStore(STORE_IMAGE_ASSETS, { keyPath: 'id' });
            imgStore.createIndex('byHashSha256', 'hashSha256', { unique: false });
          }
          if (!db.objectStoreNames.contains(STORE_AUDIT_LOGS)) {
            db.createObjectStore(STORE_AUDIT_LOGS, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch {
      this.useMemoryFallback = true;
    }
  }

  private async putRecord<T>(storeName: string, record: T): Promise<void> {
    await this.init();
    if (this.useMemoryFallback || !this.idbDatabase) {
      if (storeName === STORE_PRODUCTS) {
        const p = record as unknown as CatalogProduct;
        this.memProducts.set(p.id, structuredClone(p));
      } else if (storeName === STORE_IMAGE_ASSETS) {
        const a = record as unknown as StoredImageAsset;
        this.memImageAssets.set(a.id, structuredClone(a));
      } else if (storeName === STORE_AUDIT_LOGS) {
        const l = record as unknown as AuditLogEntry;
        this.memAuditLogs.unshift(structuredClone(l));
      }
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const tx = this.idbDatabase!.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async deleteRecord(storeName: string, key: string): Promise<void> {
    await this.init();
    if (this.useMemoryFallback || !this.idbDatabase) {
      if (storeName === STORE_PRODUCTS) this.memProducts.delete(key);
      if (storeName === STORE_IMAGE_ASSETS) this.memImageAssets.delete(key);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const tx = this.idbDatabase!.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getAllProducts(): Promise<CatalogProduct[]> {
    await this.init();
    if (this.useMemoryFallback || !this.idbDatabase) {
      return Array.from(this.memProducts.values()).map((p) => structuredClone(p));
    }

    return await new Promise<CatalogProduct[]>((resolve, reject) => {
      const tx = this.idbDatabase!.transaction(STORE_PRODUCTS, 'readonly');
      const req = tx.objectStore(STORE_PRODUCTS).getAll();
      req.onsuccess = () => resolve((req.result as CatalogProduct[]) || []);
      req.onerror = () => reject(req.error);
    });
  }

  public async getProductById(id: string): Promise<CatalogProduct | null> {
    await this.init();
    if (this.useMemoryFallback || !this.idbDatabase) {
      const found = this.memProducts.get(id);
      return found ? structuredClone(found) : null;
    }

    return await new Promise<CatalogProduct | null>((resolve, reject) => {
      const tx = this.idbDatabase!.transaction(STORE_PRODUCTS, 'readonly');
      const req = tx.objectStore(STORE_PRODUCTS).get(id);
      req.onsuccess = () => resolve((req.result as CatalogProduct) || null);
      req.onerror = () => reject(req.error);
    });
  }

  public async getAllImageAssets(): Promise<StoredImageAsset[]> {
    await this.init();
    if (this.useMemoryFallback || !this.idbDatabase) {
      return Array.from(this.memImageAssets.values()).map((a) => structuredClone(a));
    }

    return await new Promise<StoredImageAsset[]>((resolve, reject) => {
      const tx = this.idbDatabase!.transaction(STORE_IMAGE_ASSETS, 'readonly');
      const req = tx.objectStore(STORE_IMAGE_ASSETS).getAll();
      req.onsuccess = () => resolve((req.result as StoredImageAsset[]) || []);
      req.onerror = () => reject(req.error);
    });
  }

  public async getImageAssetById(assetId: string): Promise<StoredImageAsset | null> {
    await this.init();
    if (this.useMemoryFallback || !this.idbDatabase) {
      const found = this.memImageAssets.get(assetId);
      return found ? structuredClone(found) : null;
    }

    return await new Promise<StoredImageAsset | null>((resolve, reject) => {
      const tx = this.idbDatabase!.transaction(STORE_IMAGE_ASSETS, 'readonly');
      const req = tx.objectStore(STORE_IMAGE_ASSETS).get(assetId);
      req.onsuccess = () => resolve((req.result as StoredImageAsset) || null);
      req.onerror = () => reject(req.error);
    });
  }

  public async getAuditLogs(limit = 200): Promise<AuditLogEntry[]> {
    await this.init();
    if (this.useMemoryFallback || !this.idbDatabase) {
      return this.memAuditLogs.slice(0, limit).map((l) => structuredClone(l));
    }

    return await new Promise<AuditLogEntry[]>((resolve, reject) => {
      const tx = this.idbDatabase!.transaction(STORE_AUDIT_LOGS, 'readonly');
      const req = tx.objectStore(STORE_AUDIT_LOGS).getAll();
      req.onsuccess = () => {
        const list = ((req.result as AuditLogEntry[]) || []).sort((a, b) =>
          b.timestamp.localeCompare(a.timestamp)
        );
        resolve(list.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  }

  private async appendAuditLog(
    action: AuditLogEntry['action'],
    summary: string,
    targetProductId?: string,
    targetSku?: string
  ): Promise<void> {
    const entry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      action,
      targetProductId,
      targetSku,
      summary,
    };
    await this.putRecord(STORE_AUDIT_LOGS, entry);
  }

  /**
   * ROTINA INEGOCIÁVEL DE ISOLAMENTO DA LOJA (`syncStaticCatalogUpdates`):
   * Sincroniza produtos novos e novas fotos estáticas multi-ângulos (`staticImageUrls`) do seed
   * SEM JAMAIS sobrescrever ou apagar:
   *  - `storeInventoryData` (preços, custos, estoque, código interno da loja e prateleira)
   *  - `imageAssetIds` (fotos manuais subidas ou coladas com Ctrl+V pelo lojista)
   *  - `removedStaticUrls` (fotos de fábrica ocultadas pelo lojista)
   *  - `coverImageIdentifier` (se o lojista já definiu uma capa customizada)
   */
  public async syncStaticCatalogUpdates(
    seedRawProducts: Partial<CatalogProduct>[]
  ): Promise<{ inserted: number; updatedStatic: number; total: number }> {
    return await this.writeQueue.enqueue(async () => {
      const existingProducts = await this.getAllProducts();
      const existingById = new Map<string, CatalogProduct>();
      const existingBySku = new Map<string, CatalogProduct>();

      for (const p of existingProducts) {
        existingById.set(p.id, p);
        existingBySku.set(normalizeCodeStrict(p.commercialCodeNormalized || p.commercialCodeRaw), p);
      }

      let inserted = 0;
      let updatedStatic = 0;

      for (const rawSeed of seedRawProducts) {
        const seedProd = normalizeSeedProductToCatalogProduct(rawSeed);
        const existing =
          existingById.get(seedProd.id) || existingBySku.get(seedProd.commercialCodeNormalized);

        if (!existing) {
          await this.putRecord(STORE_PRODUCTS, seedProd);
          existingById.set(seedProd.id, seedProd);
          inserted++;
          continue;
        }

        // Produto já existe no IndexedDB da loja:
        // Preserva 100% de storeInventoryData, imageAssetIds e removedStaticUrls!
        const removedSet = new Set(existing.removedStaticUrls.map((u) => u.toLowerCase()));
        const mergedStaticUrls: string[] = [...existing.staticImageUrls];

        let addedNewAngle = false;
        for (const seedUrl of seedProd.staticImageUrls) {
          const lowerUrl = seedUrl.toLowerCase();
          if (!mergedStaticUrls.includes(lowerUrl)) {
            mergedStaticUrls.push(lowerUrl);
            addedNewAngle = true;
          }
        }

        // Mescla linhas de produto aditivamente
        const mergedLines = Array.from(
          new Set([...(existing.productLines || []), ...(seedProd.productLines || [])])
        );

        // Determina a capa visível respeitando removedStaticUrls e escolha manual do lojista
        let coverId = existing.coverImageIdentifier;
        if (!coverId || removedSet.has(coverId.toLowerCase())) {
          const firstManual = existing.imageAssetIds[0]
            ? `asset:${existing.imageAssetIds[0]}`
            : null;
          const firstActiveStatic =
            mergedStaticUrls.find((u) => !removedSet.has(u.toLowerCase())) || null;
          coverId = firstManual || firstActiveStatic;
        }

        if (addedNewAngle || mergedLines.length !== (existing.productLines || []).length) {
          const updatedRecord: CatalogProduct = {
            ...existing,
            macroLine: existing.macroLine || seedProd.macroLine,
            productLine: existing.productLine || seedProd.productLine,
            productLines: mergedLines,
            staticImageUrls: mergedStaticUrls,
            // Invioláveis:
            storeInventoryData: { ...existing.storeInventoryData },
            imageAssetIds: [...existing.imageAssetIds],
            removedStaticUrls: [...existing.removedStaticUrls],
            coverImageIdentifier: coverId,
            relations:
              existing.relations && existing.relations.length > 0
                ? existing.relations
                : seedProd.relations,
          };
          await this.putRecord(STORE_PRODUCTS, updatedRecord);
          updatedStatic++;
        }
      }

      if (inserted > 0 || updatedStatic > 0) {
        await this.appendAuditLog(
          'AUTO_SYNC_SEED',
          `Auto-Sync concluído: ${inserted} novos produtos, ${updatedStatic} atualizados com novas fotos/linhas sem alterar dados da loja.`
        );
      }

      const finalCount = (await this.getAllProducts()).length;
      return { inserted, updatedStatic, total: finalCount };
    });
  }

  public async createProduct(
    input: Partial<CatalogProduct> & { commercialCodeRaw: string; name: string }
  ): Promise<CatalogProduct> {
    return await this.writeQueue.enqueue(async () => {
      const skuNorm = normalizeCodeStrict(input.commercialCodeRaw);
      if (!skuNorm) {
        throw new Error('O Código Comercial (SKU) é obrigatório.');
      }

      const newProduct = normalizeSeedProductToCatalogProduct({
        ...input,
        id: input.id || `custom-${skuNorm.toLowerCase()}-${Date.now()}`,
        commercialCodeNormalized: skuNorm,
        isCustomCreated: true,
        updatedAt: new Date().toISOString(),
      });

      await this.putRecord(STORE_PRODUCTS, newProduct);
      await this.appendAuditLog(
        'CREATE_PRODUCT',
        `Produto criado manualmente: ${newProduct.commercialCodeRaw} (${newProduct.name})`,
        newProduct.id,
        newProduct.commercialCodeRaw
      );
      return newProduct;
    });
  }

  public async updateProduct(
    productId: string,
    patch: Partial<CatalogProduct>
  ): Promise<CatalogProduct> {
    return await this.writeQueue.enqueue(async () => {
      const existing = await this.getProductById(productId);
      if (!existing) {
        throw new Error(`Produto não encontrado (${productId}).`);
      }

      const rawCode =
        patch.commercialCodeRaw !== undefined
          ? patch.commercialCodeRaw.trim()
          : existing.commercialCodeRaw;
      const skuNorm = normalizeCodeStrict(rawCode);

      const updated: CatalogProduct = {
        ...existing,
        ...patch,
        id: existing.id,
        commercialCodeRaw: rawCode,
        commercialCodeNormalized: skuNorm,
        specs: patch.specs ? { ...existing.specs, ...patch.specs } : existing.specs,
        storeInventoryData: patch.storeInventoryData
          ? {
              ...existing.storeInventoryData,
              ...patch.storeInventoryData,
              updatedAt: new Date().toISOString(),
            }
          : existing.storeInventoryData,
        updatedAt: new Date().toISOString(),
      };

      await this.putRecord(STORE_PRODUCTS, updated);
      await this.appendAuditLog(
        'UPDATE_PRODUCT',
        `Produto atualizado: ${updated.commercialCodeRaw}`,
        updated.id,
        updated.commercialCodeRaw
      );
      return updated;
    });
  }

  public async duplicateProduct(
    sourceProductId: string,
    newCommercialCodeRaw?: string
  ): Promise<CatalogProduct> {
    return await this.writeQueue.enqueue(async () => {
      const source = await this.getProductById(sourceProductId);
      if (!source) {
        throw new Error(`Produto de origem não encontrado (${sourceProductId}).`);
      }

      const newSkuRaw = (newCommercialCodeRaw || `${source.commercialCodeRaw}-COPIA`).trim();
      const newSkuNorm = normalizeCodeStrict(newSkuRaw);

      const duplicated: CatalogProduct = {
        ...structuredClone(source),
        id: `dup-${newSkuNorm.toLowerCase()}-${Date.now()}`,
        commercialCodeRaw: newSkuRaw,
        commercialCodeNormalized: newSkuNorm,
        name: `${source.name} (Cópia)`,
        isCustomCreated: true,
        isTrash: false,
        updatedAt: new Date().toISOString(),
      };

      await this.putRecord(STORE_PRODUCTS, duplicated);
      await this.appendAuditLog(
        'DUPLICATE_PRODUCT',
        `Produto duplicado de ${source.commercialCodeRaw} para ${duplicated.commercialCodeRaw}`,
        duplicated.id,
        duplicated.commercialCodeRaw
      );
      return duplicated;
    });
  }

  public async moveToTrash(productId: string): Promise<CatalogProduct> {
    return await this.writeQueue.enqueue(async () => {
      const existing = await this.getProductById(productId);
      if (!existing) throw new Error('Produto não encontrado.');
      existing.isTrash = true;
      existing.updatedAt = new Date().toISOString();
      await this.putRecord(STORE_PRODUCTS, existing);
      await this.appendAuditLog(
        'TRASH_PRODUCT',
        `Produto movido para a lixeira: ${existing.commercialCodeRaw}`,
        existing.id,
        existing.commercialCodeRaw
      );
      return existing;
    });
  }

  public async restoreFromTrash(productId: string): Promise<CatalogProduct> {
    return await this.writeQueue.enqueue(async () => {
      const existing = await this.getProductById(productId);
      if (!existing) throw new Error('Produto não encontrado.');
      existing.isTrash = false;
      existing.updatedAt = new Date().toISOString();
      await this.putRecord(STORE_PRODUCTS, existing);
      await this.appendAuditLog(
        'RESTORE_PRODUCT',
        `Produto restaurado da lixeira: ${existing.commercialCodeRaw}`,
        existing.id,
        existing.commercialCodeRaw
      );
      return existing;
    });
  }

  public async deleteProductPermanently(productId: string): Promise<void> {
    await this.writeQueue.enqueue(async () => {
      const existing = await this.getProductById(productId);
      await this.deleteRecord(STORE_PRODUCTS, productId);
      await this.appendAuditLog(
        'DELETE_PERMANENT',
        `Produto excluído definitivamente: ${existing?.commercialCodeRaw || productId}`,
        productId,
        existing?.commercialCodeRaw
      );
    });
  }

  /**
   * Converte uma imagem em `.webp` (Master + Thumb) com hash `SHA-256`,
   * deduplica automaticamente no IndexedDB (duas fotos idênticas nunca ocupam espaço duplicado)
   * e vincula ao produto.
   */
  public async attachImageToProduct(
    productId: string,
    imageInput: Blob | File | ArrayBuffer | Uint8Array,
    setAsCover = false
  ): Promise<{ product: CatalogProduct; asset: StoredImageAsset; deduplicated: boolean }> {
    const converted = await convertImageInputToWebp(imageInput);

    return await this.writeQueue.enqueue(async () => {
      const product = await this.getProductById(productId);
      if (!product) {
        throw new Error(`Produto não encontrado (${productId}).`);
      }

      const allAssets = await this.getAllImageAssets();
      let asset = allAssets.find((a) => a.hashSha256 === converted.hashSha256) || null;
      let deduplicated = false;

      if (asset) {
        deduplicated = true;
      } else {
        asset = {
          id: `img-${converted.hashSha256.slice(0, 16).toLowerCase()}`,
          hashSha256: converted.hashSha256,
          mimeType: 'image/webp',
          width: converted.width,
          height: converted.height,
          masterSizeBytes: converted.masterSizeBytes,
          thumbSizeBytes: converted.thumbSizeBytes,
          masterBlobBase64: converted.masterBase64,
          thumbBlobBase64: converted.thumbBase64,
          createdAt: new Date().toISOString(),
        };
        await this.putRecord(STORE_IMAGE_ASSETS, asset);
      }

      if (!product.imageAssetIds.includes(asset.id)) {
        product.imageAssetIds.push(asset.id);
      }

      if (setAsCover || !product.coverImageIdentifier) {
        product.coverImageIdentifier = `asset:${asset.id}`;
      }

      product.updatedAt = new Date().toISOString();
      await this.putRecord(STORE_PRODUCTS, product);
      await this.appendAuditLog(
        'UPLOAD_IMAGE',
        `Foto WebP vinculada ao produto ${product.commercialCodeRaw} (SHA-256: ${asset.hashSha256.slice(0, 12)}..., deduplicada: ${deduplicated})`,
        product.id,
        product.commercialCodeRaw
      );

      return { product, asset, deduplicated };
    });
  }

  /**
   * Remove uma foto manual (`asset:{id}`) ou oculta uma foto estática de fábrica
   * adicionando-a em `removedStaticUrls` (para que o Auto-Sync jamais a reative!).
   */
  public async removeImageFromProduct(
    productId: string,
    imageIdentifier: string
  ): Promise<CatalogProduct> {
    return await this.writeQueue.enqueue(async () => {
      const product = await this.getProductById(productId);
      if (!product) throw new Error('Produto não encontrado.');

      if (imageIdentifier.startsWith('asset:')) {
        const assetId = imageIdentifier.replace(/^asset:/, '');
        product.imageAssetIds = product.imageAssetIds.filter((id) => id !== assetId);
      } else {
        const lowerUrl = imageIdentifier.toLowerCase();
        if (!product.removedStaticUrls.map((u) => u.toLowerCase()).includes(lowerUrl)) {
          product.removedStaticUrls.push(lowerUrl);
        }
      }

      if (product.coverImageIdentifier === imageIdentifier) {
        const removedSet = new Set(product.removedStaticUrls.map((u) => u.toLowerCase()));
        const nextManual = product.imageAssetIds[0] ? `asset:${product.imageAssetIds[0]}` : null;
        const nextStatic =
          product.staticImageUrls.find((u) => !removedSet.has(u.toLowerCase())) || null;
        product.coverImageIdentifier = nextManual || nextStatic;
      }

      product.updatedAt = new Date().toISOString();
      await this.putRecord(STORE_PRODUCTS, product);
      await this.appendAuditLog(
        'REMOVE_IMAGE',
        `Imagem ${imageIdentifier} removida/ocultada do produto ${product.commercialCodeRaw}`,
        product.id,
        product.commercialCodeRaw
      );
      return product;
    });
  }

  public async setProductCoverImage(
    productId: string,
    imageIdentifier: string
  ): Promise<CatalogProduct> {
    return await this.writeQueue.enqueue(async () => {
      const product = await this.getProductById(productId);
      if (!product) throw new Error('Produto não encontrado.');
      product.coverImageIdentifier = imageIdentifier;
      product.updatedAt = new Date().toISOString();
      await this.putRecord(STORE_PRODUCTS, product);
      return product;
    });
  }

  /**
   * Exporta Backup Completo (`.json` com produtos, fotos WebP em Base64, logs de auditoria
   * e Checksum Criptográfico `SHA-256` para Disaster Recovery).
   */
  public async exportBackupBundle(): Promise<CatalogBackupBundle> {
    const products = await this.getAllProducts();
    const imageAssets = await this.getAllImageAssets();
    const auditLogs = await this.getAuditLogs(500);

    const payload = {
      products,
      imageAssets,
      auditLogs,
    };

    const canonicalPayloadJson = JSON.stringify(payload);
    const checksumSha256 = await computeSha256Hex(canonicalPayloadJson);

    await this.appendAuditLog(
      'BACKUP_EXPORT',
      `Backup completo exportado (${products.length} produtos, ${imageAssets.length} imagens WebP, SHA-256: ${checksumSha256.slice(0, 16)}...)`
    );

    return {
      bundleVersion: 4,
      exportedAt: new Date().toISOString(),
      checksumSha256,
      payload,
    };
  }

  /**
   * Restaura um Backup Completo após validar o Checksum Criptográfico `SHA-256`.
   * Rejeita imediatamente backups adulterados ou corrompidos.
   */
  public async restoreBackupBundle(bundle: CatalogBackupBundle): Promise<{
    restoredProducts: number;
    restoredImages: number;
  }> {
    if (!bundle || !bundle.payload || !Array.isArray(bundle.payload.products)) {
      throw new Error('Estrutura de arquivo de backup inválida.');
    }

    const canonicalPayloadJson = JSON.stringify(bundle.payload);
    const calculatedHash = await computeSha256Hex(canonicalPayloadJson);

    if (calculatedHash !== bundle.checksumSha256.toUpperCase()) {
      throw new Error(
        `Falha de integridade no Backup: Checksum SHA-256 divergente (esperado ${bundle.checksumSha256}, calculado ${calculatedHash}).`
      );
    }

    return await this.writeQueue.enqueue(async () => {
      await this.clearAllDataInternal();

      for (const asset of bundle.payload.imageAssets || []) {
        await this.putRecord(STORE_IMAGE_ASSETS, asset);
      }
      for (const prod of bundle.payload.products) {
        await this.putRecord(STORE_PRODUCTS, prod);
      }
      for (const log of bundle.payload.auditLogs || []) {
        await this.putRecord(STORE_AUDIT_LOGS, log);
      }

      await this.appendAuditLog(
        'BACKUP_RESTORE',
        `Backup restaurado com sucesso (${bundle.payload.products.length} produtos, checksum SHA-256 validado).`
      );

      return {
        restoredProducts: bundle.payload.products.length,
        restoredImages: (bundle.payload.imageAssets || []).length,
      };
    });
  }

  public async resetAllData(): Promise<void> {
    await this.writeQueue.enqueue(async () => {
      await this.clearAllDataInternal();
    });
  }

  private async clearAllDataInternal(): Promise<void> {
    await this.init();
    if (this.useMemoryFallback || !this.idbDatabase) {
      this.memProducts.clear();
      this.memImageAssets.clear();
      this.memAuditLogs = [];
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const tx = this.idbDatabase!.transaction(
        [STORE_PRODUCTS, STORE_IMAGE_ASSETS, STORE_AUDIT_LOGS],
        'readwrite'
      );
      tx.objectStore(STORE_PRODUCTS).clear();
      tx.objectStore(STORE_IMAGE_ASSETS).clear();
      tx.objectStore(STORE_AUDIT_LOGS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Exporta planilha CSV de Preços, Código Interno, Estoque e Localização de Prateleira.
   */
  public async exportInventoryCsv(): Promise<string> {
    const products = await this.getAllProducts();
    const header = [
      'SKU_COMERCIAL',
      'LINHA',
      'CATEGORIA',
      'CODIGO_INTERNO_LOJA',
      'PRECO_BRL',
      'ESTOQUE_QTD',
      'PRATELEIRA_LOCAL',
    ].join(';');

    const rows = products
      .filter((p) => !p.isTrash)
      .map((p) => {
        const inv = p.storeInventoryData || createDefaultStoreInventory();
        const priceFormatted = formatCentsBigIntToBrl(inv.priceCentsBigInt);
        return [
          p.commercialCodeRaw,
          p.productLine,
          p.category,
          inv.internalStoreCode || '',
          priceFormatted,
          String(inv.stockQty ?? 0),
          inv.shelfLocation || '',
        ]
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(';');
      });

    return [header, ...rows].join('\n');
  }

  /**
   * Importa planilha CSV de Preços e Estoque atualizando apenas `storeInventoryData`
   * de forma segura via `BigInt` centavos.
   */
  public async importInventoryCsv(csvText: string): Promise<{ updatedCount: number }> {
    return await this.writeQueue.enqueue(async () => {
      const lines = csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length <= 1) return { updatedCount: 0 };

      const products = await this.getAllProducts();
      const bySku = new Map<string, CatalogProduct>();
      for (const p of products) {
        bySku.set(normalizeCodeStrict(p.commercialCodeNormalized || p.commercialCodeRaw), p);
      }

      let updatedCount = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i]!
          .split(';')
          .map((c) => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
        if (cols.length < 5) continue;

        const skuNorm = normalizeCodeStrict(cols[0] || '');
        const prod = bySku.get(skuNorm);
        if (!prod) continue;

        const internalCode = cols[3] || prod.storeInventoryData.internalStoreCode;
        const priceCents = parseBrlToCentsBigInt(cols[4] || '0').toString();
        const stockQty = parseInt(cols[5] || '0', 10) || 0;
        const shelfLocation = cols[6] ?? prod.storeInventoryData.shelfLocation;

        prod.storeInventoryData = {
          ...prod.storeInventoryData,
          internalStoreCode: internalCode,
          priceCentsBigInt: priceCents,
          stockQty,
          shelfLocation,
          updatedAt: new Date().toISOString(),
        };
        await this.putRecord(STORE_PRODUCTS, prod);
        updatedCount++;
      }

      if (updatedCount > 0) {
        await this.appendAuditLog(
          'IMPORT_CSV',
          `Importação CSV concluída: ${updatedCount} produtos tiveram preços/estoque atualizados.`
        );
      }

      return { updatedCount };
    });
  }
}
