import { expect, test } from 'bun:test';
import { normalizeImportedRecord, parseImportContent } from '../src/record-import.js';

test('record import parser gives sync API and Worker the same JSONL and CSV behavior', () => {
  expect(parseImportContent('jsonl', '{"text":"one"}\n{"text":"two"}\n', { maxRows: 2 })).toHaveLength(2);
  expect(parseImportContent('csv', 'record_type,content\nplain_text,"hello, world"\n')).toEqual([
    { record_type: 'plain_text', content: 'hello, world' },
  ]);
  expect(() => parseImportContent('json', '[{},{}]', { maxRows: 1 })).toThrow('1 row limit');
});

test('record import normalization enforces draft-only and bounded scores in every path', () => {
  expect(normalizeImportedRecord({ instruction: 'ping', quality_score: '0.8' })).toMatchObject({
    recordType: 'instruction', status: 'draft', qualityScore: 0.8,
  });
  expect(() => normalizeImportedRecord({ text: 'x', status: 'approved' })).toThrow('draft status');
  expect(() => normalizeImportedRecord({ text: 'x', confidence: 2 })).toThrow('between 0 and 1');
});
