/**
 * src/domain/units-and-years.ts
 * Conversores determinísticos de unidades técnicas (Pressão Bar/PSI/kPa -> kPa, Medidas mm/cm)
 * e Parser de intervalos de anos veiculares ('97/99', '08/...', '.../92', '>12', '/12', '13/').
 */

export type PressureUnit = 'KPA' | 'BAR' | 'PSI';

export interface ParsedPressure {
  valueKpa: number;
  originalValue: number;
  originalUnit: PressureUnit;
}

/**
 * Converte qualquer especificação de pressão automotiva (Bar, PSI ou kPa) para kPa inteiro:
 * - 1 Bar = 100 kPa (ex.: 1.4 Bar -> 140 kPa)
 * - 1 PSI = 6.894757 kPa (ex.: 20 PSI -> 138 kPa)
 */
export function convertPressureToKpa(rawPressure: string | number, unitHint?: PressureUnit): number | null {
  if (typeof rawPressure === 'number') {
    if (!Number.isFinite(rawPressure) || rawPressure <= 0) return null;
    const unit = unitHint ?? (rawPressure <= 5 ? 'BAR' : 'KPA');
    if (unit === 'BAR') return Math.round(rawPressure * 100);
    if (unit === 'PSI') return Math.round(rawPressure * 6.894757);
    return Math.round(rawPressure);
  }

  const cleaned = rawPressure.trim().toUpperCase().replace(',', '.');
  if (!cleaned) return null;

  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*(KPA|BAR|B|PSI|LB|LIBRAS)?/);
  if (!match) return null;

  const num = parseFloat(match[1]!);
  if (!Number.isFinite(num) || num <= 0) return null;

  const unitToken = match[2] || unitHint || '';
  if (unitToken === 'BAR' || unitToken === 'B') {
    return Math.round(num * 100);
  }
  if (unitToken === 'PSI' || unitToken === 'LB' || unitToken === 'LIBRAS') {
    return Math.round(num * 6.894757);
  }
  if (unitToken === 'KPA') {
    return Math.round(num);
  }

  // Heurística automotiva segura quando a unidade foi omitida: valores <= 4.5 são Bar (ex.: 1.4 -> 140 kPa)
  if (num <= 4.5) {
    return Math.round(num * 100);
  }
  return Math.round(num);
}

export interface ParsedYearRange {
  yearStart: number | null;
  yearEnd: number | null;
  isOngoing: boolean;
}

function expandTwoDigitYear(y: number): number {
  if (y >= 100) return y;
  return y <= 35 ? 2000 + y : 1900 + y;
}

/**
 * Parser determinístico de intervalos de anos veiculares:
 * - "97/99" ou "1997/1999" ou "97 a 99" -> { yearStart: 1997, yearEnd: 1999, isOngoing: false }
 * - "08/..." ou "08/diante" ou "13/" ou ">12" -> { yearStart: 2008/2013/2012, yearEnd: null, isOngoing: true }
 * - ".../92" ou "/12" ou "até 92" -> { yearStart: null, yearEnd: 1992/2012, isOngoing: false }
 * - "2025" -> { yearStart: 2025, yearEnd: 2025, isOngoing: false }
 */
export function parseVehicleYearRange(rawText: string): ParsedYearRange {
  if (!rawText || !rawText.trim()) {
    return { yearStart: null, yearEnd: null, isOngoing: false };
  }

  const s = rawText.trim();

  // 1. Padrão "97/99", "2008/2012", "08/...", "95/EM DIANTE"
  const slashRange = s.match(/(?:^|\s)(\d{2}|\d{4})\s*(?:\/|-|\s+a\s+|\s+até\s+)\s*(\.{2,3}|em\s*diante|atual|\d{2}|\d{4})(?:\b|$|\s)/i);
  if (slashRange) {
    const startRaw = parseInt(slashRange[1]!, 10);
    const endToken = slashRange[2]!.toLowerCase();
    const yStart = expandTwoDigitYear(startRaw);

    if (endToken.startsWith('.') || endToken.includes('diante') || endToken === 'atual') {
      return { yearStart: yStart, yearEnd: null, isOngoing: true };
    }

    const endRaw = parseInt(endToken, 10);
    if (!Number.isNaN(endRaw)) {
      const yEnd = expandTwoDigitYear(endRaw);
      return {
        yearStart: Math.min(yStart, yEnd),
        yearEnd: Math.max(yStart, yEnd),
        isOngoing: false,
      };
    }
  }

  // 2. Padrão ".../92", "ate 92", "/12", "/19"
  const openStart = s.match(/(?:\.{2,3}|at[eé])\s*\/?\s*(\d{2}|\d{4})\b/i) || s.match(/(?:^|\s)\/\s*(\d{2}|\d{4})(?:\b|$)/);
  if (openStart) {
    const yEnd = expandTwoDigitYear(parseInt(openStart[1]!, 10));
    return { yearStart: null, yearEnd: yEnd, isOngoing: false };
  }

  // 3. Padrão ">12", "> 2012", "13/", "2015/"
  const greaterThan = s.match(/>\s*(\d{2}|\d{4})\b/) || s.match(/(?:^|\s)(\d{2}|\d{4})\s*\/(?:\s|$)/);
  if (greaterThan) {
    const yStart = expandTwoDigitYear(parseInt(greaterThan[1]!, 10));
    return { yearStart: yStart, yearEnd: null, isOngoing: true };
  }

  // 4. Ano único de 4 dígitos (ex.: "2025", "1994")
  const singleFourDigit = s.match(/\b(19\d{2}|20[0-3]\d)\b/);
  if (singleFourDigit) {
    const y = parseInt(singleFourDigit[1]!, 10);
    return { yearStart: y, yearEnd: y, isOngoing: false };
  }

  return { yearStart: null, yearEnd: null, isOngoing: false };
}

/**
 * Verifica se um ano consultado no filtro (ex.: 2010) é compatível com o intervalo da aplicação.
 */
export function isYearMatchingApplication(
  queryYear: number,
  range: ParsedYearRange
): boolean {
  if (!Number.isFinite(queryYear)) return true;
  const { yearStart, yearEnd, isOngoing } = range;

  if (yearStart === null && yearEnd === null) {
    // Aplicação universal ou para todos os anos do modelo
    return true;
  }
  if (yearStart !== null && yearEnd !== null) {
    return queryYear >= yearStart && queryYear <= yearEnd;
  }
  if (yearStart !== null && (isOngoing || yearEnd === null)) {
    return queryYear >= yearStart;
  }
  if (yearStart === null && yearEnd !== null) {
    return queryYear <= yearEnd;
  }
  return false;
}
