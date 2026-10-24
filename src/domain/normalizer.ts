/**
 * src/domain/normalizer.ts
 * Regras de Domínio e Normalização Estrita de Códigos Comerciais (SKU) e OEM.
 * - normalizeCodeStrict: Uppercase, sem pontuação/espaços, preservando zeros à esquerda.
 * - expandCompoundOemCodes: Expansão determinística de barras ('A/B/C', '15/17', '397/98').
 * - normalizeCodeHomoglyph: Mapeamento canônico de homóglifos ('O' <-> '0', 'I'/'L' <-> '1', 'Z' <-> '2').
 * - sanitizeCrossReferenceCodes: Limpeza de prefixos de lixo ('OEM:', 'REF:', 'ORIG.', etc.) e deduplicação.
 */

export function normalizeCodeStrict(rawCode: string): string {
  if (!rawCode) return '';
  return rawCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function normalizeCodeLower(rawCode: string): string {
  if (!rawCode) return '';
  return rawCode
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Converte caracteres visualmente ambíguos no balcão (O <-> 0, I <-> 1)
 * para uma forma canônica única permitindo busca tolerante a erro de leitura.
 */
export function normalizeCodeHomoglyph(rawCode: string): string {
  const strict = normalizeCodeStrict(rawCode);
  if (!strict) return '';
  return strict
    .replace(/O/g, '0')
    .replace(/I/g, '1');
}

export function areCodesHomoglyphEquivalent(codeA: string, codeB: string): boolean {
  const strictA = normalizeCodeStrict(codeA);
  const strictB = normalizeCodeStrict(codeB);
  if (!strictA || !strictB) return false;
  return normalizeCodeHomoglyph(strictA) === normalizeCodeHomoglyph(strictB);
}

/**
 * Expande códigos compostos separados por barra muito comuns em catálogos automotivos:
 * Exemplos:
 *  - "1J0121403A/B/C" -> ["1J0121403A", "1J0121403B", "1J0121403C"]
 *  - "93214015/17"    -> ["93214015", "93214017"]
 *  - "5X0121397/98"   -> ["5X0121397", "5X0121398"]
 *  - "CAL168 / CAL132" -> ["CAL168", "CAL132"]
 */
export function expandCompoundOemCodes(rawInput: string): string[] {
  if (!rawInput || !rawInput.trim()) return [];

  const results: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (code: string): void => {
    const norm = normalizeCodeStrict(code);
    if (norm.length >= 2 && !seen.has(norm)) {
      seen.add(norm);
      results.push(norm);
    }
  };

  // Divide inicialmente por vírgula ou ponto-e-vírgula
  const commaChunks = rawInput.split(/[;,]+/).map((c) => c.trim()).filter(Boolean);

  for (const chunk of commaChunks) {
    if (!chunk.includes('/')) {
      pushUnique(chunk);
      continue;
    }

    const slashParts = chunk.split('/').map((p) => p.trim()).filter(Boolean);
    if (slashParts.length === 0) continue;

    const firstRaw = slashParts[0]!;
    const firstNorm = normalizeCodeStrict(firstRaw);
    pushUnique(firstNorm);

    for (let i = 1; i < slashParts.length; i++) {
      const partNorm = normalizeCodeStrict(slashParts[i]!);
      if (!partNorm) continue;

      // Caso 1: O sufixo após a barra já é um código completo (ex.: "CAL168 / CAL132")
      if (partNorm.length >= firstNorm.length || partNorm.length >= 5) {
        pushUnique(partNorm);
        continue;
      }

      // Caso 2: Sufixo de letras (ex.: "1J0121403A/B/C" onde firstNorm termina em letra e partNorm é letra)
      if (/^[A-Z]+$/.test(partNorm) && /[A-Z]+$/.test(firstNorm)) {
        const baseWithoutTrailingLetters = firstNorm.replace(/[A-Z]+$/, '');
        pushUnique(baseWithoutTrailingLetters + partNorm);
        continue;
      }

      // Caso 3: Sufixo numérico curto (ex.: "93214015/17" ou "5X0121397/98")
      if (/^\d+$/.test(partNorm) && /\d+$/.test(firstNorm)) {
        const trailingMatch = firstNorm.match(/(\d+)([A-Z]*)$/);
        if (trailingMatch) {
          const digits = trailingMatch[1]!;
          const trailingLetters = trailingMatch[2] || '';
          if (digits.length >= partNorm.length) {
            const prefixLen = firstNorm.length - digits.length - trailingLetters.length;
            const prefix = firstNorm.slice(0, prefixLen);
            const replacedDigits = digits.slice(0, digits.length - partNorm.length) + partNorm;
            pushUnique(prefix + replacedDigits + trailingLetters);
            continue;
          }
        }
      }

      // Caso 4: Base sem os últimos N caracteres substituídos pelo sufixo
      if (firstNorm.length > partNorm.length) {
        const replaced = firstNorm.slice(0, firstNorm.length - partNorm.length) + partNorm;
        pushUnique(replaced);
      } else {
        pushUnique(partNorm);
      }
    }
  }

  return results;
}

const NOISE_WORDS = new Set([
  'OEM',
  'ORIG',
  'ORIGINAL',
  'REF',
  'REFERENCIA',
  'CODIGO',
  'COD',
  'SIMILAR',
  'SUBSTITUI',
  'APLICA',
  'EM',
  'PARA',
  'S',
  'N',
  'SN',
  'ND',
]);

/**
 * Limpa listas ou strings de códigos de referência cruzada removendo rótulos
 * ("OEM:", "ORIG.:", "S/N") e expandindo barras automaticamente.
 */
export function sanitizeCrossReferenceCodes(rawInput: string | string[]): string[] {
  const inputs = Array.isArray(rawInput) ? rawInput : [rawInput];
  const finalCodes: string[] = [];
  const seen = new Set<string>();

  for (const item of inputs) {
    if (!item) continue;
    // Remove rótulos comuns no início
    const cleaned = item
      .replace(/\b(OEM|ORIG\.?|ORIGINAL|REF\.?|COD\.?|CÓDIGO)\s*[:=-]?/gi, ' ')
      .trim();

    const expanded = expandCompoundOemCodes(cleaned);
    for (const code of expanded) {
      if (code.length < 2) continue;
      if (NOISE_WORDS.has(code)) continue;
      if (!seen.has(code)) {
        seen.add(code);
        finalCodes.push(code);
      }
    }
  }

  return finalCodes;
}
