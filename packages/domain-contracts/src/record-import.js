const recordTypes = new Set([
  'plain_text', 'instruction', 'qa', 'chat', 'sharegpt', 'chatml',
  'dpo', 'rlhf', 'classification', 'image_caption', 'multimodal',
  'event_sequence', 'custom',
]);

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const nonEmpty = rows.filter((values) => values.some((value) => value !== ''));
  if (nonEmpty.length < 2) return [];
  const headers = nonEmpty[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error('CSV headers must not be empty.');
  return nonEmpty.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? '']),
  ));
}

export function parseImportContent(format, content, { maxRows = Number.POSITIVE_INFINITY } = {}) {
  let rows;
  if (format === 'jsonl') {
    rows = content.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
      try { return JSON.parse(line); } catch { throw new Error(`JSONL line ${index + 1} is invalid JSON.`); }
    });
  } else if (format === 'json') {
    const parsed = JSON.parse(content);
    rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [parsed];
  } else if (format === 'csv') rows = parseCsv(content);
  else throw new Error(`Unsupported import format: ${format}`);
  if (rows.length > maxRows) throw new Error(`Import exceeds the ${maxRows} row limit.`);
  return rows;
}

function maybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
}

export function normalizeImportedRecord(row, defaults = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length === 0) {
    throw new Error('Row must be a non-empty object.');
  }
  const recordType = row.record_type || defaults.record_type || (row.instruction !== undefined ? 'instruction' : 'plain_text');
  if (!recordTypes.has(recordType)) throw new Error(`Unsupported record_type: ${recordType}`);
  const status = row.status || defaults.status || 'draft';
  if (status !== 'draft') throw new Error('Imported records must start in draft status.');
  const qualityScore = row.quality_score === '' || row.quality_score == null ? null : Number(row.quality_score);
  const confidence = row.confidence === '' || row.confidence == null ? null : Number(row.confidence);
  if ((qualityScore != null && (!Number.isFinite(qualityScore) || qualityScore < 0 || qualityScore > 1))
    || (confidence != null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1))) {
    throw new Error('quality_score and confidence must be between 0 and 1.');
  }
  return {
    recordType,
    title: row.title || null,
    status,
    languageCode: row.language_code || defaults.language_code || null,
    qualityScore,
    confidence,
    content: row.content === undefined ? row : maybeJson(row.content),
    plainText: row.plain_text || row.text || null,
    schemaVersion: row.schema_version || '1.0',
    metadata: row.metadata && typeof maybeJson(row.metadata) === 'object' ? maybeJson(row.metadata) : {},
  };
}
