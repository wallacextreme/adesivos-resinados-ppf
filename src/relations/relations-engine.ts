/**
 * src/relations/relations-engine.ts
 * Motor Determinístico para as 4 Naturezas de Vínculos Técnicos:
 *  - 🔵 EQUIVALENCIA_DIRETA: Substitutos diretos pelo mesmo OEM estrito (bloqueando categorias diferentes!).
 *  - 🟢 COMPATIBILIDADE_ACOPLAMENTO: Peças complementares que montam juntas ("Serve em", ex.: Tampa <-> Reservatório, Soleira <-> Protetor) + Sugestão Transitiva Cross-Brand.
 *  - 🟣 COMPOSICAO_KIT: Kits comerciais e seus componentes filhos.
 *  - ⚫ VARIANTE_PRODUTO: Variações da mesma família base (-S, -F, -C, cores, medidas ou acabamento).
 */

import { normalizeCodeStrict } from '../domain/normalizer';
import type { CatalogProduct, ProductRelationLink, RelationType } from '../domain/types';

export interface ResolvedRelationEntry {
  relationType: RelationType;
  targetProduct: CatalogProduct;
  note: string;
  isTransitiveSuggestion: boolean;
}

export interface GroupedProductRelations {
  EQUIVALENCIA_DIRETA: ResolvedRelationEntry[];
  COMPATIBILIDADE_ACOPLAMENTO: ResolvedRelationEntry[];
  COMPOSICAO_KIT: ResolvedRelationEntry[];
  VARIANTE_PRODUTO: ResolvedRelationEntry[];
}

function normalizeCategoryKey(category: string): string {
  return category
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Regra Defensiva Inegociável:
 * Duas peças de categorias funcionais distintas (ex.: TAMPA vs RESERVATÓRIO, ou SOLEIRA vs EMBLEMA DE CALOTA)
 * JAMAIS podem ser classificadas como EQUIVALENCIA_DIRETA, mesmo que compartilhem um código OEM no PDF.
 */
export function canProductsBeDirectEquivalents(
  sourceProduct: CatalogProduct,
  candidateProduct: CatalogProduct
): boolean {
  if (sourceProduct.id === candidateProduct.id) return false;
  const catA = normalizeCategoryKey(sourceProduct.category);
  const catB = normalizeCategoryKey(candidateProduct.category);
  if (!catA || !catB) return false;
  return catA === catB;
}

function extractBaseFamilySku(skuNormalized: string): string {
  // Remove sufixos clássicos de variantes (-S, -F, -C, A, B) mantendo a raiz numérica/alfanumérica
  return skuNormalized.replace(/(?:S|F|C|BR|PR|CR)$/i, '');
}

/**
 * Resolve todos os 4 tipos de vínculos para um produto de origem a partir do catálogo completo,
 * aplicando:
 *  1) Vínculos explícitos registrados em `source.relations` (com bloqueio defensivo de categoria em EQUIVALENCIA_DIRETA).
 *  2) Descoberta automática de `EQUIVALENCIA_DIRETA` por código OEM estrito compartilhado na mesma categoria.
 *  3) Sugestão Transitiva Cross-Brand em `COMPATIBILIDADE_ACOPLAMENTO`:
 *     Se Peça A (ex.: Tampa Click TC-3060) acopla em B (Reservatório Gonel G-1205) e B é equivalente direto
 *     de C (Reservatório Concorrente R-990), então A também sugere compatibilidade transitiva com C!
 *  4) Descoberta automática de `VARIANTE_PRODUTO` por família base de código.
 */
export function resolveProductRelations(
  sourceProduct: CatalogProduct,
  allProducts: CatalogProduct[]
): GroupedProductRelations {
  const activeProducts = allProducts.filter((p) => !p.isTrash);
  const bySkuNorm = new Map<string, CatalogProduct[]>();

  for (const p of activeProducts) {
    const k = normalizeCodeStrict(p.commercialCodeNormalized || p.commercialCodeRaw);
    const list = bySkuNorm.get(k) ?? [];
    list.push(p);
    bySkuNorm.set(k, list);
  }

  const result: GroupedProductRelations = {
    EQUIVALENCIA_DIRETA: [],
    COMPATIBILIDADE_ACOPLAMENTO: [],
    COMPOSICAO_KIT: [],
    VARIANTE_PRODUTO: [],
  };

  const addedTargetIds: Record<RelationType, Set<string>> = {
    EQUIVALENCIA_DIRETA: new Set<string>([sourceProduct.id]),
    COMPATIBILIDADE_ACOPLAMENTO: new Set<string>([sourceProduct.id]),
    COMPOSICAO_KIT: new Set<string>([sourceProduct.id]),
    VARIANTE_PRODUTO: new Set<string>([sourceProduct.id]),
  };

  const addEntry = (
    type: RelationType,
    target: CatalogProduct,
    note: string,
    isTransitive = false
  ): void => {
    if (addedTargetIds[type].has(target.id)) return;

    // Bloqueio defensivo obrigatório: EQUIVALENCIA_DIRETA exige a mesma categoria!
    if (type === 'EQUIVALENCIA_DIRETA' && !canProductsBeDirectEquivalents(sourceProduct, target)) {
      return;
    }

    addedTargetIds[type].add(target.id);
    result[type].push({
      relationType: type,
      targetProduct: target,
      note,
      isTransitiveSuggestion: isTransitive,
    });
  };

  // 1. Processar vínculos explícitos do próprio produto
  for (const rel of sourceProduct.relations || []) {
    const targetCode = normalizeCodeStrict(rel.targetCodeNormalized);
    const candidates = bySkuNorm.get(targetCode) || [];
    for (const candidate of candidates) {
      if (rel.targetBrand && candidate.brandName.toLowerCase() !== rel.targetBrand.toLowerCase()) {
        continue;
      }
      addEntry(
        rel.relationType,
        candidate,
        rel.note || `Vínculo técnico (${rel.relationType})`,
        Boolean(rel.isTransitiveSuggestion)
      );
    }
  }

  // 2. Descoberta automática de EQUIVALENCIA_DIRETA por OEM estrito compartilhado (mesma categoria)
  const sourceOems = new Set(
    (sourceProduct.oemCodes || [])
      .map((o) => normalizeCodeStrict(o.normalizedCode || o.rawCode))
      .filter((code) => code.length >= 3)
  );

  if (sourceOems.size > 0) {
    for (const candidate of activeProducts) {
      if (candidate.id === sourceProduct.id) continue;
      if (!canProductsBeDirectEquivalents(sourceProduct, candidate)) continue;

      const sharedOem = (candidate.oemCodes || []).find((o) =>
        sourceOems.has(normalizeCodeStrict(o.normalizedCode || o.rawCode))
      );
      if (sharedOem) {
        addEntry(
          'EQUIVALENCIA_DIRETA',
          candidate,
          `Mesmo código OEM estrito: ${sharedOem.rawCode}`
        );
      }
    }
  }

  // 3. Sugestão Transitiva Cross-Brand para COMPATIBILIDADE_ACOPLAMENTO
  // Se A acopla diretamente em B, e B possui equivalente direto C (ou mesmo OEM estrito na mesma categoria de B),
  // sugere C como compatibilidade transitiva de acoplamento!
  const directCouplings = [...result.COMPATIBILIDADE_ACOPLAMENTO];
  for (const coupling of directCouplings) {
    const coupledTarget = coupling.targetProduct;
    const coupledOems = new Set(
      (coupledTarget.oemCodes || [])
        .map((o) => normalizeCodeStrict(o.normalizedCode || o.rawCode))
        .filter((c) => c.length >= 3)
    );

    // Procura equivalentes diretos de coupledTarget
    for (const candidate of activeProducts) {
      if (candidate.id === coupledTarget.id || candidate.id === sourceProduct.id) continue;
      if (!canProductsBeDirectEquivalents(coupledTarget, candidate)) continue;

      const hasExplicitEquiv = (coupledTarget.relations || []).some(
        (r) =>
          r.relationType === 'EQUIVALENCIA_DIRETA' &&
          normalizeCodeStrict(r.targetCodeNormalized) === normalizeCodeStrict(candidate.commercialCodeNormalized)
      );
      const hasSharedOem =
        coupledOems.size > 0 &&
        (candidate.oemCodes || []).some((o) =>
          coupledOems.has(normalizeCodeStrict(o.normalizedCode || o.rawCode))
        );

      if (hasExplicitEquiv || hasSharedOem) {
        addEntry(
          'COMPATIBILIDADE_ACOPLAMENTO',
          candidate,
          `Sugestão Transitiva via equivalente ${coupledTarget.commercialCodeRaw} (${coupledTarget.brandName})`,
          true
        );
      }
    }
  }

  // 4. Descoberta automática de VARIANTE_PRODUTO por sufixo de família (-S, -F, -C) na mesma marca e categoria
  const srcSkuNorm = normalizeCodeStrict(sourceProduct.commercialCodeNormalized || sourceProduct.commercialCodeRaw);
  const srcBaseFamily = extractBaseFamilySku(srcSkuNorm);
  if (srcBaseFamily.length >= 4) {
    for (const candidate of activeProducts) {
      if (candidate.id === sourceProduct.id) continue;
      if (candidate.brandName.toLowerCase() !== sourceProduct.brandName.toLowerCase()) continue;
      if (!canProductsBeDirectEquivalents(sourceProduct, candidate)) continue;

      const candSkuNorm = normalizeCodeStrict(candidate.commercialCodeNormalized || candidate.commercialCodeRaw);
      const candBaseFamily = extractBaseFamilySku(candSkuNorm);
      if (candBaseFamily === srcBaseFamily && candSkuNorm !== srcSkuNorm) {
        addEntry(
          'VARIANTE_PRODUTO',
          candidate,
          `Variação da mesma família base (${sourceProduct.commercialCodeRaw} ↔ ${candidate.commercialCodeRaw})`
        );
      }
    }
  }

  return result;
}
