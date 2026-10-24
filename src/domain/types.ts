export type RelationType =
  | 'EQUIVALENCIA_DIRETA'
  | 'COMPATIBILIDADE_ACOPLAMENTO'
  | 'COMPOSICAO_KIT'
  | 'VARIANTE_PRODUTO';

export interface OemCodeEntry {
  rawCode: string;
  normalizedCode: string;
  automaker?: string;
}

export interface VehicleApplication {
  automaker: string;
  model: string;
  yearStart: number | null;
  yearEnd: number | null;
  isOngoing: boolean;
  engineOrVersion?: string;
  rawText: string;
}

export interface ProductSpecs {
  substrate: string; // Ex.: Cromado, PPF Brilhante, PPF Fosco, Fibra de Carbono, Aço Escovado, Refletivo
  resinFinish: 'Resinado' | 'Sem Resina' | string;
  color: string;
  dimensions: string; // Ex.: 48 mm, 75 x 14 cm
  packageQty: string; // Ex.: 4 un, 1 par, 1 kit(11)
  pressureKpa: number | null;
  nozzlesQty: number | null;
  hasSensorHole: boolean | null;
  voltage: string | null;
}

export interface ProductRelationLink {
  targetCodeNormalized: string;
  targetBrand: string;
  relationType: RelationType;
  note?: string;
  isTransitiveSuggestion?: boolean;
}

export interface StoreInventoryData {
  internalStoreCode: string;
  priceCentsBigInt: string; // Serialized BigInt integer cents (e.g. "4590" = R$ 45,90)
  costCentsBigInt: string;
  stockQty: number;
  minStockQty: number;
  shelfLocation: string;
  supplierNotes: string;
  updatedAt: string;
}

export interface CatalogProduct {
  id: string;
  commercialCodeRaw: string;
  commercialCodeNormalized: string;
  brandName: string;
  macroLine: string; // Ex.: Linha Leve, Linha Universal, Linha Pesada, Linha Motos, Lançamentos
  productLine: string; // Ex.: Linha Alfa Romeo, Linha Audi, Linha BMW, Linha Chevrolet (GM), etc.
  productLines: string[];
  category: string;
  subCategory: string;
  name: string;
  description: string;
  automaker: string;
  oemCodes: OemCodeEntry[];
  vehicleApplications: VehicleApplication[];
  specs: ProductSpecs;
  staticImageUrls: string[];
  removedStaticUrls: string[];
  imageAssetIds: string[];
  coverImageIdentifier: string | null; // Pode ser uma URL estática ou 'asset:{id}'
  relations: ProductRelationLink[];
  storeInventoryData: StoreInventoryData;
  isTrash?: boolean;
  isCustomCreated?: boolean;
  sourcePdf?: string;
  sourcePage?: number;
  updatedAt: string;
}

export interface StoredImageAsset {
  id: string;
  hashSha256: string;
  mimeType: 'image/webp';
  width: number;
  height: number;
  masterSizeBytes: number;
  thumbSizeBytes: number;
  masterBlobBase64: string;
  thumbBlobBase64: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action:
    | 'CREATE_PRODUCT'
    | 'UPDATE_PRODUCT'
    | 'DUPLICATE_PRODUCT'
    | 'TRASH_PRODUCT'
    | 'RESTORE_PRODUCT'
    | 'DELETE_PERMANENT'
    | 'UPLOAD_IMAGE'
    | 'REMOVE_IMAGE'
    | 'IMPORT_CSV'
    | 'BACKUP_EXPORT'
    | 'BACKUP_RESTORE'
    | 'AUTO_SYNC_SEED';
  targetProductId?: string;
  targetSku?: string;
  summary: string;
}

export interface SearchFilters {
  query: string;
  macroLine: string; // 'ALL' | 'Linha Leve' | 'Linha Universal' | 'Linha Pesada' | 'Linha Motos' | 'Lançamentos'
  productLine: string; // 'ALL' | 'Linha Audi' | 'Linha Chevrolet (GM)' | ...
  automaker: string;
  model: string;
  year: number | null;
  brandName: string;
  category: string;
  resinFinish: 'ALL' | 'Resinado' | 'Sem Resina';
  substrate: string;
  pressureKpa: number | null;
  nozzlesQty: number | null;
  hasSensorHole: 'ALL' | 'WITH_SENSOR' | 'WITHOUT_SENSOR';
  priceStatus: 'ALL' | 'WITH_PRICE' | 'WITHOUT_PRICE' | 'IN_STOCK';
  includeTrash?: boolean;
}

export type SearchMatchTier =
  | 1 // Match Exato SKU / OEM / Código Interno da Loja
  | 2 // Prefixo ou Expansão de Barra
  | 3 // Multi-Token Veículo + Linha + Categoria + Especificação
  | 4; // Match Aproximado por Homóglifo (O↔0, I↔1)

export interface SearchResultItem {
  product: CatalogProduct;
  tier: SearchMatchTier;
  score: number;
  isHomoglyphMatch: boolean;
  matchedFields: string[];
}

export interface CatalogBackupBundle {
  bundleVersion: number;
  exportedAt: string;
  checksumSha256: string;
  payload: {
    products: CatalogProduct[];
    imageAssets: StoredImageAsset[];
    auditLogs: AuditLogEntry[];
  };
}
