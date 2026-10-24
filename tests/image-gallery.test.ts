import { describe, expect, test } from 'bun:test';
import { convertImageInputToWebp } from '../src/media/webp-converter';
import { CatalogStorageEngine, normalizeSeedProductToCatalogProduct } from '../src/storage/catalog-db';
import { ObjectUrlManager, resolveProductGalleryItems } from '../src/ui/image-gallery';

function createSamplePngBytes(seedByte = 10): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    seedByte, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  ]);
}

describe('Image Gallery & Client-Side WebP Converter — Multi-Ângulos, Deduplicação SHA-256 e ObjectUrlManager', () => {
  test('convertImageInputToWebp gera Master/Thumb WebP e hash SHA-256 determinístico', async () => {
    const pngBytes = createSamplePngBytes(42);
    const out1 = await convertImageInputToWebp(pngBytes);
    const out2 = await convertImageInputToWebp(pngBytes);

    expect(out1.webpMasterBlob.type).toBe('image/webp');
    expect(out1.webpThumbBlob.type).toBe('image/webp');
    expect(out1.hashSha256).toHaveLength(64);
    expect(out1.hashSha256).toBe(out2.hashSha256);
  });

  test('Deduplicação SHA-256 no IndexedDB, múltiplos ângulos, Foto de Capa, removedStaticUrls e revogação de ObjectURLs', async () => {
    const storage = new CatalogStorageEngine();
    await storage.init();

    const prod = await storage.createProduct({
      commercialCodeRaw: 'ADS758',
      name: 'EMBLEMA TRACK RESINADO GOL G6',
      staticImageUrls: [
        '/catalog-images/sportinox/ads758.webp',
        '/catalog-images/sportinox/ads758_2.webp',
        '/catalog-images/sportinox/ads758_3.webp',
      ],
    });

    // Faz upload da mesma imagem 2 vezes -> deve deduplicar por SHA-256 no banco
    const imgBytes = createSamplePngBytes(99);
    const firstUpload = await storage.attachImageToProduct(prod.id, imgBytes, true);
    const secondUpload = await storage.attachImageToProduct(prod.id, imgBytes, false);

    expect(firstUpload.deduplicated).toBe(false);
    expect(secondUpload.deduplicated).toBe(true);

    const allAssets = await storage.getAllImageAssets();
    expect(allAssets.length).toBe(1);

    // Oculta o ângulo 2 de fábrica (/catalog-images/sportinox/ads758_2.webp)
    const afterRemove = await storage.removeImageFromProduct(
      prod.id,
      '/catalog-images/sportinox/ads758_2.webp'
    );
    expect(afterRemove.removedStaticUrls).toContain('/catalog-images/sportinox/ads758_2.webp');

    const urlManager = new ObjectUrlManager();
    const assetsMap = new Map(allAssets.map((a) => [a.id, a]));
    const gallery = resolveProductGalleryItems(afterRemove, assetsMap, urlManager);

    // 1 foto manual (capa) + 2 fotos estáticas restantes (ads758.webp e ads758_3.webp) = 3 ângulos
    expect(gallery.length).toBe(3);
    expect(gallery[0]?.isCover).toBe(true);
    expect(gallery[0]?.identifier).toBe(`asset:${firstUpload.asset.id}`);
    expect(gallery.map((g) => g.identifier)).not.toContain(
      '/catalog-images/sportinox/ads758_2.webp'
    );

    expect(urlManager.getActiveUrlCount()).toBeGreaterThan(0);
    urlManager.revokeAll();
    expect(urlManager.getActiveUrlCount()).toBe(0);
  });
});
