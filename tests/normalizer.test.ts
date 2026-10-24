import { describe, expect, test } from 'bun:test';
import {
  areCodesHomoglyphEquivalent,
  expandCompoundOemCodes,
  normalizeCodeHomoglyph,
  normalizeCodeStrict,
  sanitizeCrossReferenceCodes,
} from '../src/domain/normalizer';

describe('Domain Normalizer — Zeros à Esquerda, Barras e Homóglifos', () => {
  test('normalizeCodeStrict preserva zeros à esquerda e remove pontuação', () => {
    expect(normalizeCodeStrict('  0048-cal/168.a ')).toBe('0048CAL168A');
    expect(normalizeCodeStrict('PPF-0076')).toBe('PPF0076');
    expect(normalizeCodeStrict('0986B00012')).toBe('0986B00012');
  });

  test('expandCompoundOemCodes expande sufixos de letras e números separados por barra', () => {
    expect(expandCompoundOemCodes('1J0.121.403.A/B/C')).toEqual([
      '1J0121403A',
      '1J0121403B',
      '1J0121403C',
    ]);
    expect(expandCompoundOemCodes('93214015/17')).toEqual([
      '93214015',
      '93214017',
    ]);
    expect(expandCompoundOemCodes('5X0121397/98')).toEqual([
      '5X0121397',
      '5X0121398',
    ]);
    expect(expandCompoundOemCodes('CAL168 / CAL132')).toEqual([
      'CAL168',
      'CAL132',
    ]);
  });

  test('normalizeCodeHomoglyph e areCodesHomoglyphEquivalent tratam O<->0 e I<->1', () => {
    expect(normalizeCodeHomoglyph('PPFOO82')).toBe('PPF0082');
    expect(normalizeCodeHomoglyph('CALI35')).toBe('CAL135');
    expect(areCodesHomoglyphEquivalent('PPF0082', 'PPFOO82')).toBe(true);
    expect(areCodesHomoglyphEquivalent('CAL135', 'CALI35')).toBe(true);
    expect(areCodesHomoglyphEquivalent('CAL168', 'CAL132')).toBe(false);
  });

  test('sanitizeCrossReferenceCodes remove rótulos de ruído e deduplica', () => {
    const cleaned = sanitizeCrossReferenceCodes([
      'OEM: 1J0.121.403.A/B',
      'ORIG.: 93214015/17',
      'REF: S/N',
      '1J0121403A',
    ]);
    expect(cleaned).toEqual([
      '1J0121403A',
      '1J0121403B',
      '93214015',
      '93214017',
    ]);
  });
});
