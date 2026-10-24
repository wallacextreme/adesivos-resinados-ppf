/**
 * src/domain/currency.ts
 * Manipulação Monetária Segura em Centavos Inteiros via BigInt.
 * Jamais utiliza ponto flutuante (IEEE 754 float) para cálculos de preços ou estoque.
 */

export function parseBrlToCentsBigInt(rawInput: string | number | bigint): bigint {
  if (typeof rawInput === 'bigint') {
    return rawInput;
  }
  if (typeof rawInput === 'number') {
    if (!Number.isFinite(rawInput)) return 0n;
    return BigInt(Math.round(rawInput * 100));
  }

  const trimmed = rawInput.trim();
  if (!trimmed) return 0n;

  const isNegative = trimmed.startsWith('-');
  // Remove 'R$', espaços e letras
  const cleaned = trimmed.replace(/[^\d.,]/g, '');
  if (!cleaned) return 0n;

  let integerPart = '0';
  let decimalPart = '00';

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const sepIndex = Math.max(lastComma, lastDot);

  if (sepIndex !== -1) {
    const afterSep = cleaned.slice(sepIndex + 1);
    // Se tiver exatamente 3 dígitos após ponto e nenhum outro separador (ex.: "1.250" sem centavos)
    if (cleaned[sepIndex] === '.' && afterSep.length === 3 && lastComma === -1) {
      integerPart = cleaned.replace(/\./g, '');
      decimalPart = '00';
    } else {
      integerPart = cleaned.slice(0, sepIndex).replace(/[.,]/g, '') || '0';
      decimalPart = (afterSep.replace(/[.,]/g, '') + '00').slice(0, 2);
    }
  } else {
    integerPart = cleaned;
  }

  const totalCents = BigInt(integerPart) * 100n + BigInt(decimalPart);
  return isNegative ? -totalCents : totalCents;
}

export function formatCentsBigIntToBrl(centsInput: bigint | string | number): string {
  let cents: bigint;
  try {
    if (typeof centsInput === 'bigint') {
      cents = centsInput;
    } else if (typeof centsInput === 'string') {
      const clean = centsInput.trim();
      cents = clean && /^-?\d+$/.test(clean) ? BigInt(clean) : parseBrlToCentsBigInt(clean);
    } else {
      cents = BigInt(Math.trunc(centsInput));
    }
  } catch {
    cents = 0n;
  }

  const isNegative = cents < 0n;
  const absCents = isNegative ? -cents : cents;
  const reais = absCents / 100n;
  const centavos = absCents % 100n;

  const reaisFormatted = reais
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavosFormatted = centavos.toString().padStart(2, '0');

  return `${isNegative ? '- ' : ''}R$ ${reaisFormatted},${centavosFormatted}`;
}

export function addCentsBigInt(a: bigint | string, b: bigint | string): bigint {
  const bigA = typeof a === 'bigint' ? a : BigInt(a || '0');
  const bigB = typeof b === 'bigint' ? b : BigInt(b || '0');
  return bigA + bigB;
}

export function multiplyCentsBigIntByQty(cents: bigint | string, quantity: number): bigint {
  const bigCents = typeof cents === 'bigint' ? cents : BigInt(cents || '0');
  const safeQty = BigInt(Math.max(0, Math.trunc(quantity)));
  return bigCents * safeQty;
}

/**
 * Aplica desconto em Basis Points (ex.: 1000 bps = 10.00% de desconto)
 * utilizando aritmética inteira com arredondamento half-up.
 */
export function applyDiscountBasisPointsBigInt(
  cents: bigint | string,
  discountBps: number
): bigint {
  const bigCents = typeof cents === 'bigint' ? cents : BigInt(cents || '0');
  const bps = BigInt(Math.max(0, Math.min(10000, Math.trunc(discountBps))));
  const remainingBps = 10000n - bps;
  return (bigCents * remainingBps + 5000n) / 10000n;
}
