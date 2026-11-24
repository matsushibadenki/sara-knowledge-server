import { createHash } from 'node:crypto';

export const ENCODER = 'char-ngram-hash/1';
export const DIMENSIONS = 256;
export const MAX_RECORD_CHARS = 32_768;

export function encodeSearchText(text) {
  const points = Array.from(text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' '));
  const vector = Array(DIMENSIONS).fill(0);
  for (let i = 0; i < points.length; i++) {
    for (let width = 1; width <= 3 && i + width <= points.length; width++) {
      const gram = points.slice(i, i + width).join('');
      if (!/[\p{L}\p{N}\p{M}]/u.test(gram)) continue;
      const hash = createHash('sha256').update(gram).digest();
      vector[hash[0]] += hash[1] & 1 ? -1 : 1;
    }
  }
  const norm = Math.hypot(...vector);
  return norm ? vector.map((value) => value / norm) : null;
}

export function chunkSearchText(text) {
  const points = Array.from(text);
  if (points.length > MAX_RECORD_CHARS) throw new RangeError('Record search text exceeds 32768 characters.');
  const chunks = [];
  for (let i = 0; i < points.length; i += 768) {
    const content = points.slice(i, i + 896).join('');
    const embedding = encodeSearchText(content);
    if (embedding) chunks.push({ ordinal: i / 768, content, embedding });
    if (i + 896 >= points.length) break;
  }
  return chunks;
}
