/**
 * src/search/search-engine.ts
 * Motor de Busca Multi-Token Instantânea Sub-50ms com Ranking Determinístico em 4 Níveis:
 *  - Nível 1 (Tier 1): Match Exato de SKU Comercial, Código OEM ou Código Interno da Loja.
 *  - Nível 2 (Tier 2): Match por Prefixo de Código ou Expansão de Barra ('A/B/C', '15/17').
 *  - Nível 3 (Tier 3): Match Multi-Token (Veículo + Linha + Categoria + Especificação Técnica).
 *  - Nível 4 (Tier 4): Match Aproximado por Homóglifo ('O' <-> '0', 'I' <-> '1') devidamente sinalizado.
 *
 * Suporta todos os filtros combinados de balcão, incluindo o Filtro por Linha (Macro-Linha e Linha Montadora).
 */

import {
  expandCompoundOemCodes,
  normalizeCodeHomoglyph,
  normalizeCodeStrict,
} from '../domain/normalizer';
import type {
  CatalogProduct,
  SearchFilters,
  SearchMatchTier,
  SearchResultItem,
} from '../domain/types';
import { isYearMatchingApplication } from '../domain/units-and-years';

function removeDiacriticsLower(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

interface IndexedProductEntry {
  product: CatalogProduct;
  skuStrict: string;
  skuHomoglyph: string;
  storeCodeStrict: string;
  storeCodeHomoglyph: string;
  oemStrictList: string[];
  oemHomoglyphList: string[];
  searchableText: string;
  macroLineLower: string;
  productLinesLower: string[];
  automakerLower: string;
  brandLower: string;
  categoryLower: string;
  resinFinishLower: string;
  substrateLower: string;
  priceCents: bigint;
}

export class CatalogSearchEngine {
  private index: IndexedProductEntry[] = [];

  public constructor(products: CatalogProduct[] = []) {
    this.rebuildIndex(products);
  }

  public rebuildIndex(products: CatalogProduct[]): void {
    this.index = products.map((product) => {
      const skuStrict = normalizeCodeStrict(
        product.commercialCodeNormalized || product.commercialCodeRaw
      );
      const skuHomoglyph = normalizeCodeHomoglyph(skuStrict);

      const storeCodeStrict = normalizeCodeStrict(
        product.storeInventoryData?.internalStoreCode || ''
      );
      const storeCodeHomoglyph = normalizeCodeHomoglyph(storeCodeStrict);

      const oemStrictList: string[] = [];
      const oemHomoglyphList: string[] = [];

      for (const oem of product.oemCodes || []) {
        const expanded = expandCompoundOemCodes(oem.rawCode || oem.normalizedCode);
        for (const c of expanded) {
          oemStrictList.push(c);
          oemHomoglyphList.push(normalizeCodeHomoglyph(c));
        }
      }

      const appTokens = (product.vehicleApplications || [])
        .map(
          (a) =>
            `${a.automaker} ${a.model} ${a.rawText} ${a.yearStart ?? ''} ${a.yearEnd ?? ''}`
        )
        .join(' ');

      const specs = product.specs;
      const specTokens = `${specs.substrate} ${specs.resinFinish} ${specs.color} ${specs.dimensions} ${specs.packageQty} ${specs.pressureKpa ?? ''} ${specs.nozzlesQty ?? ''}`;
      const lineTokens = `${product.macroLine} ${product.productLine} ${(product.productLines || []).join(' ')}`;

      const searchableText = removeDiacriticsLower(
        `${product.commercialCodeRaw} ${skuStrict} ${storeCodeStrict} ${oemStrictList.join(' ')} ${product.brandName} ${lineTokens} ${product.category} ${product.subCategory} ${product.name} ${product.description} ${product.automaker} ${appTokens} ${specTokens}`
      );

      let priceCents = 0n;
      try {
        priceCents = BigInt(product.storeInventoryData?.priceCentsBigInt || '0');
      } catch {
        priceCents = 0n;
      }

      return {
        product,
        skuStrict,
        skuHomoglyph,
        storeCodeStrict,
        storeCodeHomoglyph,
        oemStrictList,
        oemHomoglyphList,
        searchableText,
        macroLineLower: removeDiacriticsLower(product.macroLine || ''),
        productLinesLower: (product.productLines || [product.productLine]).map((l) =>
          removeDiacriticsLower(l)
        ),
        automakerLower: removeDiacriticsLower(product.automaker || ''),
        brandLower: removeDiacriticsLower(product.brandName || ''),
        categoryLower: removeDiacriticsLower(product.category || ''),
        resinFinishLower: removeDiacriticsLower(product.specs?.resinFinish || ''),
        substrateLower: removeDiacriticsLower(product.specs?.substrate || ''),
        priceCents,
      };
    });
  }

  public static createDefaultFilters(): SearchFilters {
    return {
      query: '',
      macroLine: 'ALL',
      productLine: 'ALL',
      automaker: 'ALL',
      model: '',
      year: null,
      brandName: 'ALL',
      category: 'ALL',
      resinFinish: 'ALL',
      substrate: 'ALL',
      pressureKpa: null,
      nozzlesQty: null,
      hasSensorHole: 'ALL',
      priceStatus: 'ALL',
      includeTrash: false,
    };
  }

  private passesStructuredFilters(
    entry: IndexedProductEntry,
    filters: Partial<SearchFilters>
  ): boolean {
    const p = entry.product;

    if (!filters.includeTrash && p.isTrash) {
      return false;
    }
    if (filters.includeTrash && !p.isTrash) {
      return false;
    }

    // 1. Filtro por Macro-Linha (Linha Leve, Linha Universal, Linha Pesada, Linha Motos, Lançamentos)
    if (filters.macroLine && filters.macroLine !== 'ALL') {
      const targetMacro = removeDiacriticsLower(filters.macroLine);
      if (
        entry.macroLineLower !== targetMacro &&
        !entry.productLinesLower.includes(targetMacro)
      ) {
        return false;
      }
    }

    // 2. Filtro por Linha de Montadora / Aplicação (Linha Alfa Romeo, Linha Audi, Linha Chevrolet, etc.)
    if (filters.productLine && filters.productLine !== 'ALL') {
      const targetLine = removeDiacriticsLower(filters.productLine);
      const matchesLine =
        removeDiacriticsLower(p.productLine) === targetLine ||
        entry.productLinesLower.some((l) => l === targetLine || l.includes(targetLine));
      if (!matchesLine) {
        return false;
      }
    }

    // 3. Filtro por Montadora
    if (filters.automaker && filters.automaker !== 'ALL') {
      const targetAuto = removeDiacriticsLower(filters.automaker);
      const matchesAuto =
        entry.automakerLower === targetAuto ||
        (p.vehicleApplications || []).some(
          (a) => removeDiacriticsLower(a.automaker) === targetAuto
        );
      if (!matchesAuto) {
        return false;
      }
    }

    // 4. Filtro por Modelo Veicular
    if (filters.model && filters.model.trim()) {
      const targetModel = removeDiacriticsLower(filters.model.trim());
      const matchesModel = (p.vehicleApplications || []).some(
        (a) =>
          removeDiacriticsLower(a.model).includes(targetModel) ||
          removeDiacriticsLower(a.rawText).includes(targetModel)
      );
      if (!matchesModel && !entry.searchableText.includes(targetModel)) {
        return false;
      }
    }

    // 5. Filtro por Ano Veicular
    if (filters.year !== undefined && filters.year !== null) {
      const y = filters.year;
      const matchesYear = (p.vehicleApplications || []).some((app) =>
        isYearMatchingApplication(y, {
          yearStart: app.yearStart,
          yearEnd: app.yearEnd,
          isOngoing: app.isOngoing,
        })
      );
      if (!matchesYear) {
        return false;
      }
    }

    // 6. Filtro por Marca do Fabricante
    if (filters.brandName && filters.brandName !== 'ALL') {
      if (entry.brandLower !== removeDiacriticsLower(filters.brandName)) {
        return false;
      }
    }

    // 7. Filtro por Categoria
    if (filters.category && filters.category !== 'ALL') {
      if (entry.categoryLower !== removeDiacriticsLower(filters.category)) {
        return false;
      }
    }

    // 8. Filtro por Acabamento (Resinado vs Sem Resina)
    if (filters.resinFinish && filters.resinFinish !== 'ALL') {
      if (entry.resinFinishLower !== removeDiacriticsLower(filters.resinFinish)) {
        return false;
      }
    }

    // 9. Filtro por Substrato / Papel
    if (filters.substrate && filters.substrate !== 'ALL') {
      if (!entry.substrateLower.includes(removeDiacriticsLower(filters.substrate))) {
        return false;
      }
    }

    // 10. Filtro por Pressão (kPa)
    if (filters.pressureKpa !== undefined && filters.pressureKpa !== null) {
      if (p.specs.pressureKpa !== filters.pressureKpa) {
        return false;
      }
    }

    // 11. Filtro por Quantidade de Bicos
    if (filters.nozzlesQty !== undefined && filters.nozzlesQty !== null) {
      if (p.specs.nozzlesQty !== filters.nozzlesQty) {
        return false;
      }
    }

    // 12. Filtro COM / SEM Furo de Sensor
    if (filters.hasSensorHole && filters.hasSensorHole !== 'ALL') {
      if (filters.hasSensorHole === 'WITH_SENSOR' && p.specs.hasSensorHole !== true) {
        return false;
      }
      if (filters.hasSensorHole === 'WITHOUT_SENSOR' && p.specs.hasSensorHole !== false) {
        return false;
      }
    }

    // 13. Filtro por Status de Preço / Estoque na Loja
    if (filters.priceStatus && filters.priceStatus !== 'ALL') {
      if (filters.priceStatus === 'WITH_PRICE' && entry.priceCents <= 0n) {
        return false;
      }
      if (filters.priceStatus === 'WITHOUT_PRICE' && entry.priceCents > 0n) {
        return false;
      }
      if (filters.priceStatus === 'IN_STOCK' && (p.storeInventoryData?.stockQty || 0) <= 0) {
        return false;
      }
    }

    return true;
  }

  public search(partialFilters: Partial<SearchFilters> = {}): SearchResultItem[] {
    const filters: SearchFilters = {
      ...CatalogSearchEngine.createDefaultFilters(),
      ...partialFilters,
    };

    const rawQuery = (filters.query || '').trim();
    const hasQuery = rawQuery.length > 0;
    const queryStrict = normalizeCodeStrict(rawQuery);
    const queryHomoglyph = normalizeCodeHomoglyph(queryStrict);
    const queryExpandedCodes = expandCompoundOemCodes(rawQuery);
    const queryTokens = removeDiacriticsLower(rawQuery)
      .split(/\s+/)
      .filter(Boolean);

    const results: SearchResultItem[] = [];

    for (let i = 0; i < this.index.length; i++) {
      const entry = this.index[i]!;
      if (!this.passesStructuredFilters(entry, filters)) {
        continue;
      }

      if (!hasQuery) {
        results.push({
          product: entry.product,
          tier: 3,
          score: 100,
          isHomoglyphMatch: false,
          matchedFields: [],
        });
        continue;
      }

      // ----------------------------------------------------------------------
      // TIER 1: Match Exato de SKU, OEM ou Código Interno da Loja
      // ----------------------------------------------------------------------
      if (queryStrict.length >= 2) {
        if (entry.skuStrict === queryStrict) {
          results.push({
            product: entry.product,
            tier: 1,
            score: 1000,
            isHomoglyphMatch: false,
            matchedFields: ['commercialCode'],
          });
          continue;
        }
        if (entry.storeCodeStrict && entry.storeCodeStrict === queryStrict) {
          results.push({
            product: entry.product,
            tier: 1,
            score: 990,
            isHomoglyphMatch: false,
            matchedFields: ['internalStoreCode'],
          });
          continue;
        }
        if (entry.oemStrictList.includes(queryStrict)) {
          results.push({
            product: entry.product,
            tier: 1,
            score: 980,
            isHomoglyphMatch: false,
            matchedFields: ['oemCode'],
          });
          continue;
        }
      }

      // ----------------------------------------------------------------------
      // TIER 2: Match por Prefixo de Código ou Expansão de Barra ('A/B/C')
      // ----------------------------------------------------------------------
      if (queryStrict.length >= 2) {
        const matchesExpanded = queryExpandedCodes.some(
          (code) =>
            entry.skuStrict === code ||
            entry.skuStrict.startsWith(code) ||
            entry.oemStrictList.some((oem) => oem === code || oem.startsWith(code))
        );
        if (
          matchesExpanded ||
          entry.skuStrict.startsWith(queryStrict) ||
          (entry.storeCodeStrict && entry.storeCodeStrict.startsWith(queryStrict))
        ) {
          results.push({
            product: entry.product,
            tier: 2,
            score: 800,
            isHomoglyphMatch: false,
            matchedFields: ['codePrefix'],
          });
          continue;
        }
      }

      // ----------------------------------------------------------------------
      // TIER 3: Match Multi-Token (Veículo + Linha + Categoria + Especificação)
      // ----------------------------------------------------------------------
      if (queryTokens.length > 0) {
        let allTokensMatch = true;
        for (let t = 0; t < queryTokens.length; t++) {
          if (!entry.searchableText.includes(queryTokens[t]!)) {
            allTokensMatch = false;
            break;
          }
        }
        if (allTokensMatch) {
          let bonus = 0;
          if (entry.skuStrict.includes(queryStrict) && queryStrict.length >= 2) {
            bonus += 50;
          }
          results.push({
            product: entry.product,
            tier: 3,
            score: 600 + bonus,
            isHomoglyphMatch: false,
            matchedFields: ['multiToken'],
          });
          continue;
        }
      }

      // ----------------------------------------------------------------------
      // TIER 4: Match Aproximado por Homóglifo (O <-> 0, I <-> 1)
      // ----------------------------------------------------------------------
      if (queryHomoglyph.length >= 3) {
        const isSkuHomo =
          entry.skuHomoglyph === queryHomoglyph ||
          entry.skuHomoglyph.startsWith(queryHomoglyph);
        const isStoreHomo =
          Boolean(entry.storeCodeHomoglyph) &&
          entry.storeCodeHomoglyph === queryHomoglyph;
        const isOemHomo = entry.oemHomoglyphList.some(
          (h) => h === queryHomoglyph || h.startsWith(queryHomoglyph)
        );

        if (isSkuHomo || isStoreHomo || isOemHomo) {
          results.push({
            product: entry.product,
            tier: 4 as SearchMatchTier,
            score: 300,
            isHomoglyphMatch: true,
            matchedFields: ['homoglyph'],
          });
        }
      }
    }

    // Ordenação determinística: menor tier (1 -> 4), maior score, e alfabético por SKU
    results.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (b.score !== a.score) return b.score - a.score;
      return a.product.commercialCodeRaw.localeCompare(b.product.commercialCodeRaw);
    });

    return results;
  }
}
