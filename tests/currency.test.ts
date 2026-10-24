import { describe, expect, test } from 'bun:test';
import {
  addCentsBigInt,
  applyDiscountBasisPointsBigInt,
  formatCentsBigIntToBrl,
  multiplyCentsBigIntByQty,
  parseBrlToCentsBigInt,
} from '../src/domain/currency';

describe('Currency — Aritmética Monetária Exata em Centavos via BigInt', () => {
  test('parseBrlToCentsBigInt converte formatos brasileiros sem erro de ponto flutuante', () => {
    expect(parseBrlToCentsBigInt('R$ 45,90')).toBe(4590n);
    expect(parseBrlToCentsBigInt('1.250,50')).toBe(125050n);
    expect(parseBrlToCentsBigInt('0,10')).toBe(10n);
    expect(parseBrlToCentsBigInt('0,20')).toBe(20n);
    // Clássico erro IEEE 754 (0.1 + 0.2 !== 0.30000000000000004) evitado:
    expect(addCentsBigInt(parseBrlToCentsBigInt('0,10'), parseBrlToCentsBigInt('0,20'))).toBe(30n);
  });

  test('formatCentsBigIntToBrl formata valores em Reais com separador de milhar', () => {
    expect(formatCentsBigIntToBrl(4590n)).toBe('R$ 45,90');
    expect(formatCentsBigIntToBrl('125050')).toBe('R$ 1.250,50');
    expect(formatCentsBigIntToBrl(0n)).toBe('R$ 0,00');
  });

  test('multiplyCentsBigIntByQty e applyDiscountBasisPointsBigInt operam em inteiros', () => {
    expect(multiplyCentsBigIntByQty(1990n, 4)).toBe(7960n);
    // 10% de desconto (1000 bps) sobre R$ 100,00 (10000n) = R$ 90,00 (9000n)
    expect(applyDiscountBasisPointsBigInt(10000n, 1000)).toBe(9000n);
  });
});
