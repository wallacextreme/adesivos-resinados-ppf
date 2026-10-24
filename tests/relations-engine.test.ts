import { describe, expect, test } from 'bun:test';
import type { CatalogProduct } from '../src/domain/types';
import {
  canProductsBeDirectEquivalents,
  resolveProductRelations,
} from '../src/relations/relations-engine';
import { normalizeSeedProductToCatalogProduct } from '../src/storage/catalog-db';

describe('Relations Engine — 4 Naturezas de Vínculos, Sugestão Transitiva e Bloqueio de Categoria', () => {
  const makeProd = (partial: Partial<CatalogProduct>): CatalogProduct =>
    normalizeSeedProductToCatalogProduct(partial);

  test('Bloqueia EQUIVALENCIA_DIRETA entre produtos de categorias distintas mesmo com OEM igual', () => {
    const soleira = makeProd({
      id: 'p-soleira',
      commercialCodeRaw: 'AD001H4P',
      category: 'SOLEIRA DA PORTA',
      brandName: 'Sportinox',
      oemCodes: [{ rawCode: 'OEM-9999', normalizedCode: 'OEM9999' }],
    });

    const emblemaCalota = makeProd({
      id: 'p-calota',
      commercialCodeRaw: 'CAL168',
      category: 'EMBLEMA DE CALOTA',
      brandName: 'ConcorrenteX',
      oemCodes: [{ rawCode: 'OEM-9999', normalizedCode: 'OEM9999' }],
    });

    expect(canProductsBeDirectEquivalents(soleira, emblemaCalota)).toBe(false);
    const resolved = resolveProductRelations(soleira, [soleira, emblemaCalota]);
    expect(resolved.EQUIVALENCIA_DIRETA.length).toBe(0);
  });

  test('Resolve os 4 tipos de vínculos e gera Sugestão Transitiva Cross-Brand em COMPATIBILIDADE_ACOPLAMENTO', () => {
    const protetorMacaneta = makeProd({
      id: 'p-prot',
      commercialCodeRaw: 'PROT474',
      category: 'PROTETOR DE MACANETA',
      brandName: 'Sportinox',
      relations: [
        {
          targetCodeNormalized: 'PPF0076',
          targetBrand: 'Sportinox',
          relationType: 'COMPATIBILIDADE_ACOPLAMENTO',
          note: 'Acopla no mesmo pacote de proteção Tiggo 7 Pro',
        },
        {
          targetCodeNormalized: 'KIT1191',
          targetBrand: 'Sportinox',
          relationType: 'COMPOSICAO_KIT',
          note: 'Pertence ao Kit Completo',
        },
      ],
    });

    const protetorVariante = makeProd({
      id: 'p-prot-var',
      commercialCodeRaw: 'PROT474S',
      category: 'PROTETOR DE MACANETA',
      brandName: 'Sportinox',
    });

    const ppfSportinox = makeProd({
      id: 'p-ppf-1',
      commercialCodeRaw: 'PPF0076',
      category: 'PELICULA DE PROTECAO',
      brandName: 'Sportinox',
      oemCodes: [{ rawCode: 'CHERY-PPF-7', normalizedCode: 'CHERYPPF7' }],
    });

    const ppfEquivalenteCrossBrand = makeProd({
      id: 'p-ppf-2',
      commercialCodeRaw: 'PPF-9000',
      category: 'PELICULA DE PROTECAO',
      brandName: 'ShieldPro',
      oemCodes: [{ rawCode: 'CHERY-PPF-7', normalizedCode: 'CHERYPPF7' }],
    });

    const kitCompleto = makeProd({
      id: 'p-kit',
      commercialCodeRaw: 'KIT1191',
      category: 'KIT DE PROTECAO',
      brandName: 'Sportinox',
    });

    const all = [
      protetorMacaneta,
      protetorVariante,
      ppfSportinox,
      ppfEquivalenteCrossBrand,
      kitCompleto,
    ];

    const grouped = resolveProductRelations(protetorMacaneta, all);

    // 1. Variante de família (-S)
    expect(grouped.VARIANTE_PRODUTO.map((r) => r.targetProduct.commercialCodeRaw)).toContain(
      'PROT474S'
    );

    // 2. Composição de Kit
    expect(grouped.COMPOSICAO_KIT.map((r) => r.targetProduct.commercialCodeRaw)).toContain(
      'KIT1191'
    );

    // 3. Compatibilidade de Acoplamento Direta + Sugestão Transitiva Cross-Brand (PPF-9000 via PPF0076)
    const couplingCodes = grouped.COMPATIBILIDADE_ACOPLAMENTO.map(
      (r) => r.targetProduct.commercialCodeRaw
    );
    expect(couplingCodes).toContain('PPF0076');
    expect(couplingCodes).toContain('PPF-9000');

    const transitiveItem = grouped.COMPATIBILIDADE_ACOPLAMENTO.find(
      (r) => r.targetProduct.commercialCodeRaw === 'PPF-9000'
    );
    expect(transitiveItem?.isTransitiveSuggestion).toBe(true);

    // 4. Equivalência Direta entre PPF0076 e PPF-9000 (mesma categoria e mesmo OEM)
    const ppfRelations = resolveProductRelations(ppfSportinox, all);
    expect(
      ppfRelations.EQUIVALENCIA_DIRETA.map((r) => r.targetProduct.commercialCodeRaw)
    ).toContain('PPF-9000');
  });
});
