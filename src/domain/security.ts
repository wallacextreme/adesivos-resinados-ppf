/**
 * src/domain/security.ts
 * Segurança Defensiva:
 * - Neutralização de XSS (escapeHtml / sanitizeAttribute).
 * - Validação de Magic Bytes binários (%PDF-, RIFF/WEBP, PNG, JPEG, BMP).
 * - Cálculo de Checksum SHA-256 via Web Crypto API.
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

export function escapeHtml(unsafeText: unknown): string {
  if (unsafeText === null || unsafeText === undefined) return '';
  return String(unsafeText).replace(/[&<>"'`]/g, (ch) => HTML_ESCAPE_MAP[ch] || ch);
}

export type SupportedBinaryFormat = 'PDF' | 'WEBP' | 'PNG' | 'JPEG' | 'BMP' | 'UNKNOWN';

export interface MagicBytesValidationResult {
  isValid: boolean;
  detectedFormat: SupportedBinaryFormat;
  reason?: string;
}

/**
 * Inspeciona os primeiros 16 bytes (Magic Bytes) de um ArrayBuffer ou Uint8Array
 * para impedir que arquivos maliciosos ou corrompidos com extensão renomeada sejam processados.
 */
export function validateBinaryMagicBytes(
  buffer: ArrayBuffer | Uint8Array,
  allowedFormats: SupportedBinaryFormat[] = ['WEBP', 'PNG', 'JPEG', 'BMP', 'PDF']
): MagicBytesValidationResult {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 8) {
    return {
      isValid: false,
      detectedFormat: 'UNKNOWN',
      reason: `Arquivo binário muito curto (${bytes.byteLength} bytes).`,
    };
  }

  let detected: SupportedBinaryFormat = 'UNKNOWN';

  // 1. PDF: "%PDF-" (0x25 0x50 0x44 0x46 0x2D)
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    detected = 'PDF';
  }
  // 2. WEBP: "RIFF" (0..3) + "WEBP" (8..11)
  else if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    detected = 'WEBP';
  }
  // 3. PNG: 89 50 4E 47 0D 0A 1A 0A
  else if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    detected = 'PNG';
  }
  // 4. JPEG: FF D8 FF
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    detected = 'JPEG';
  }
  // 5. BMP: "BM" (0x42 0x4D)
  else if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    detected = 'BMP';
  }

  if (detected === 'UNKNOWN') {
    return {
      isValid: false,
      detectedFormat: 'UNKNOWN',
      reason: 'Assinatura binária (Magic Bytes) não reconhecida.',
    };
  }

  if (!allowedFormats.includes(detected)) {
    return {
      isValid: false,
      detectedFormat: detected,
      reason: `Formato ${detected} não permitido para esta operação.`,
    };
  }

  return {
    isValid: true,
    detectedFormat: detected,
  };
}

export async function computeSha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  let data: Uint8Array;
  if (typeof input === 'string') {
    data = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    data = input;
  } else {
    data = new Uint8Array(input);
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}
