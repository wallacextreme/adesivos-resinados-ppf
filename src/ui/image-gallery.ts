/**
 * src/ui/image-gallery.ts
 * Galeria Híbrida Multi-Ângulos (`staticImageUrls` + `imageAssetIds`) & Gerenciador `ObjectUrlManager`.
 * - Zero Memory Leaks: revoga automaticamente todas as Object URLs criadas via `URL.createObjectURL`.
 * - Suporta múltiplos ângulos (_2.webp, _3.webp), seleção de Foto de Capa Principal,
 *   reordenação e ocultação de fotos de fábrica indesejadas (`removedStaticUrls`).
 */

import type { CatalogProduct, StoredImageAsset } from '../domain/types';
import { base64ToBlob } from '../media/webp-converter';

export interface GalleryImageEntry {
  identifier: string; // Ex.: '/catalog-images/sportinox/cal168.webp' ou 'asset:img-123'
  displayUrl: string;
  thumbUrl: string;
  isStaticFactory: boolean;
  isCover: boolean;
  angleIndex: number;
}

export class ObjectUrlManager {
  private activeUrls = new Set<string>();
  private assetCache = new Map<string, string>();

  public createTrackedObjectUrl(blob: Blob, cacheKey?: string): string {
    if (cacheKey && this.assetCache.has(cacheKey)) {
      return this.assetCache.get(cacheKey)!;
    }
    const url = URL.createObjectURL(blob);
    this.activeUrls.add(url);
    if (cacheKey) {
      this.assetCache.set(cacheKey, url);
    }
    return url;
  }

  public revokeUrl(url: string): void {
    if (this.activeUrls.has(url)) {
      URL.revokeObjectURL(url);
      this.activeUrls.delete(url);
      for (const [k, v] of this.assetCache.entries()) {
        if (v === url) this.assetCache.delete(k);
      }
    }
  }

  public revokeAll(): void {
    for (const url of this.activeUrls) {
      URL.revokeObjectURL(url);
    }
    this.activeUrls.clear();
    this.assetCache.clear();
  }

  public getActiveUrlCount(): number {
    return this.activeUrls.size;
  }
}

/**
 * Resolve a lista ordenada de imagens ativas de um produto mesclando
 * as fotos estáticas de fábrica (filtradas por `removedStaticUrls`) e as fotos
 * manuais subidas pelo lojista (`imageAssetIds`), posicionando a Foto de Capa em 1º lugar.
 */
export function resolveProductGalleryItems(
  product: CatalogProduct,
  assetsMap: Map<string, StoredImageAsset>,
  urlManager: ObjectUrlManager
): GalleryImageEntry[] {
  const removedSet = new Set(
    (product.removedStaticUrls || []).map((u) => u.trim().toLowerCase())
  );

  const rawEntries: Omit<GalleryImageEntry, 'angleIndex'>[] = [];

  // 1. Fotos manuais subidas pelo lojista no IndexedDB
  for (const assetId of product.imageAssetIds || []) {
    const asset = assetsMap.get(assetId);
    if (!asset) continue;
    const identifier = `asset:${asset.id}`;
    const masterBlob = base64ToBlob(asset.masterBlobBase64, asset.mimeType);
    const thumbBlob = base64ToBlob(asset.thumbBlobBase64 || asset.masterBlobBase64, asset.mimeType);

    const displayUrl = urlManager.createTrackedObjectUrl(masterBlob, `${asset.id}:master`);
    const thumbUrl = urlManager.createTrackedObjectUrl(thumbBlob, `${asset.id}:thumb`);

    rawEntries.push({
      identifier,
      displayUrl,
      thumbUrl,
      isStaticFactory: false,
      isCover: product.coverImageIdentifier === identifier,
    });
  }

  // 2. Fotos estáticas multi-ângulos de fábrica (XREF PDF + Playwright Web)
  for (const staticUrl of product.staticImageUrls || []) {
    const cleanUrl = staticUrl.trim().toLowerCase();
    if (!cleanUrl || removedSet.has(cleanUrl)) {
      continue;
    }
    rawEntries.push({
      identifier: cleanUrl,
      displayUrl: cleanUrl,
      thumbUrl: cleanUrl,
      isStaticFactory: true,
      isCover: product.coverImageIdentifier?.toLowerCase() === cleanUrl,
    });
  }

  // Se nenhuma estiver marcada como capa, define a primeira disponível como capa
  if (rawEntries.length > 0 && !rawEntries.some((e) => e.isCover)) {
    rawEntries[0]!.isCover = true;
  }

  // Ordena garantido que a Foto de Capa Principal venha em 1º lugar (índice 0)
  rawEntries.sort((a, b) => (a.isCover === b.isCover ? 0 : a.isCover ? -1 : 1));

  return rawEntries.map((entry, idx) => ({
    ...entry,
    angleIndex: idx + 1,
  }));
}
