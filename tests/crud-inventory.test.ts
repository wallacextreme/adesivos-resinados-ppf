import { describe, expect, test } from 'bun:test';
import seedCatalogJson from '../src/data/catalog-master-seed.json';
import { escapeHtml, validateBinaryMagicBytes } from '../src/domain/security';
import type { CatalogProduct } from '../src/domain/types';
import { CatalogSearchEngine } from '../src/search/search-engine';
import { CatalogStorageEngine } from '../src/storage/catalog-db';

const seedPayload = seedCatalogJson as unknown as { products: Partial<CatalogProduct>[] };

describe('CRUD, Concorrência, Gate 8 (Isolamento da Loja) e Gate 9 (Segurança, Stress < 50ms e Disaster Recovery)', () => {
  test('CRUD Completo (Criar, Editar, Duplicar, Lixeira, Exclusão Permanente) + Fila de Concorrência', async () => {
    const storage = new CatalogStorageEngine();
    await storage.init();

    // Executa 5 criações simultâneas para validar a AsyncWriteQueue
    const createdList = await Promise.all(
      [1, 2, 3, 4, 5].map((idx) =>
        storage.createProduct({
          commercialCodeRaw: `TEST-00${idx}`,
          name: `Adesivo Teste ${idx}`,
          productLine: 'Linha Audi',
          macroLine: 'Linha Leve',
        })
      )
    );
    expect(createdList).toHaveLength(5);

    const target = createdList[0]!;
    const edited = await storage.updateProduct(target.id, {
      name: 'Adesivo Teste 1 Editado',
      storeInventoryData: {
        ...target.storeInventoryData,
        priceCentsBigInt: '8990',
        stockQty: 15,
        shelfLocation: 'Corredor B-04',
      },
    });
    expect(edited.name).toBe('Adesivo Teste 1 Editado');
    expect(edited.storeInventoryData.priceCentsBigInt).toBe('8990');
    expect(edited.storeInventoryData.shelfLocation).toBe('Corredor B-04');

    const duplicated = await storage.duplicateProduct(target.id, 'TEST-001-DUP');
    expect(duplicated.commercialCodeNormalized).toBe('TEST001DUP');
    expect(duplicated.storeInventoryData.priceCentsBigInt).toBe('8990');

    const trashed = await storage.moveToTrash(duplicated.id);
    expect(trashed.isTrash).toBe(true);

    const restored = await storage.restoreFromTrash(duplicated.id);
    expect(restored.isTrash).toBe(false);

    await storage.deleteProductPermanently(duplicated.id);
    const afterDelete = await storage.getProductById(duplicated.id);
    expect(afterDelete).toBeNull();
  });

  test('Gate 8 — Isolamento Inviolável da Loja & Auto-Sync Incremental Não-Destrutivo', async () => {
    const storage = new CatalogStorageEngine();
    await storage.init();

    // 1. Seed inicial com 1 foto estática
    await storage.syncStaticCatalogUpdates([
      {
        id: 'sportinox-cal168',
        commercialCodeRaw: 'CAL168',
        commercialCodeNormalized: 'CAL168',
        brandName: 'Sportinox',
        macroLine: 'Linha Leve',
        productLine: 'Linha Alfa Romeo',
        category: 'EMBLEMA DE CALOTA',
        name: 'EMBLEMA DE CALOTA ALFA ROMEO',
        staticImageUrls: ['/catalog-images/sportinox/cal168.webp'],
      },
    ]);

    // 2. O lojista cadastra preço, prateleira, código interno, sobe foto manual e oculta 1 foto
    await storage.updateProduct('sportinox-cal168', {
      storeInventoryData: {
        internalStoreCode: 'LOJA-ALFA-01',
        priceCentsBigInt: '5990',
        costCentsBigInt: '2500',
        stockQty: 12,
        minStockQty: 2,
        shelfLocation: 'Prateleira P-09',
        supplierNotes: 'Lote Premium',
        updatedAt: new Date().toISOString(),
      },
      removedStaticUrls: ['/catalog-images/sportinox/cal168_indesejada.webp'],
    });

    const manualPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    ]);
    const { asset } = await storage.attachImageToProduct('sportinox-cal168', manualPng, true);

    // 3. Novo Auto-Sync chega com novas fotos multi-ângulos do Playwright (_2.webp, _3.webp)
    await storage.syncStaticCatalogUpdates([
      {
        id: 'sportinox-cal168',
        commercialCodeRaw: 'CAL168',
        commercialCodeNormalized: 'CAL168',
        brandName: 'Sportinox',
        macroLine: 'Linha Leve',
        productLine: 'Linha Alfa Romeo',
        category: 'EMBLEMA DE CALOTA',
        name: 'EMBLEMA DE CALOTA ALFA ROMEO',
        staticImageUrls: [
          '/catalog-images/sportinox/cal168.webp',
          '/catalog-images/sportinox/cal168_2.webp',
          '/catalog-images/sportinox/cal168_3.webp',
        ],
      },
    ]);

    const synced = await storage.getProductById('sportinox-cal168');
    expect(synced).not.toBeNull();
    // Preço, estoque, prateleira e código interno da loja permanecem 100% intactos!
    expect(synced?.storeInventoryData.priceCentsBigInt).toBe('5990');
    expect(synced?.storeInventoryData.internalStoreCode).toBe('LOJA-ALFA-01');
    expect(synced?.storeInventoryData.shelfLocation).toBe('Prateleira P-09');
    expect(synced?.storeInventoryData.stockQty).toBe(12);
    // Foto manual do lojista permanece intacta!
    expect(synced?.imageAssetIds).toContain(asset.id);
    // Fotos ocultadas permanecem ocultadas!
    expect(synced?.removedStaticUrls).toContain('/catalog-images/sportinox/cal168_indesejada.webp');
    // E os novos ângulos _2.webp e _3.webp foram incorporados!
    expect(synced?.staticImageUrls).toContain('/catalog-images/sportinox/cal168_2.webp');
    expect(synced?.staticImageUrls).toContain('/catalog-images/sportinox/cal168_3.webp');
  });

  test('Gate 9 — Segurança XSS, Validação Magic Bytes, Benchmark < 50ms (3.396 Peças) e Ciclo Backup -> Reset -> Restore SHA-256', async () => {
    // 1. Neutralização de XSS
    const malicious = `<script>alert("xss")</script><img src=x onerror="evil()">`;
    const escaped = escapeHtml(malicious);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');

    // 2. Validação de Magic Bytes binários (%PDF-, RIFF/WEBP, PNG, JPEG)
    const pdfMagic = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const webpMagic = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    const fakeExe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

    expect(validateBinaryMagicBytes(pdfMagic).detectedFormat).toBe('PDF');
    expect(validateBinaryMagicBytes(webpMagic).detectedFormat).toBe('WEBP');
    expect(validateBinaryMagicBytes(fakeExe).isValid).toBe(false);

    // 3. Stress Test de Busca Sub-50ms com todo o catálogo real (3.396 produtos) + Filtro por Linha
    const storage = new CatalogStorageEngine();
    await storage.init();
    await storage.syncStaticCatalogUpdates(seedPayload.products);
    const allProducts = await storage.getAllProducts();
    expect(allProducts.length).toBeGreaterThanOrEqual(3199);

    const engine = new CatalogSearchEngine(allProducts);

    const t0 = performance.now();
    const resLine = engine.search({
      query: 'calota',
      productLine: 'Linha Audi',
    });
    const elapsedMs = performance.now() - t0;

    expect(elapsedMs).toBeLessThan(50);
    expect(resLine.length).toBeGreaterThan(0);
    expect(resLine.every((r) => r.product.productLine === 'Linha Audi')).toBe(true);

    // 4. Ciclo Completo Disaster Recovery: Backup -> Reset -> Restore validado por Checksum SHA-256
    const backupBundle = await storage.exportBackupBundle();
    expect(backupBundle.checksumSha256).toHaveLength(64);

    await storage.resetAllData();
    expect((await storage.getAllProducts()).length).toBe(0);

    // Verifica que um backup adulterado é bloqueado pelo Checksum SHA-256
    const tamperedBundle = structuredClone(backupBundle);
    tamperedBundle.checksumSha256 = '0'.repeat(64);
    await expect(storage.restoreBackupBundle(tamperedBundle)).rejects.toThrow(/SHA-256/);

    // Restaura o backup íntegro
    const restoreStats = await storage.restoreBackupBundle(backupBundle);
    expect(restoreStats.restoredProducts).toBe(allProducts.length);
    expect((await storage.getAllProducts()).length).toBe(allProducts.length);

    const logs = await storage.getAuditLogs();
    expect(logs.length).toBeGreaterThan(0);
  });
});
