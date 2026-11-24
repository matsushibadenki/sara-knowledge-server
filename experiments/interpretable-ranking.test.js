import { expect, test } from 'bun:test';
import { evaluateRanking, rank } from './interpretable-ranking.js';

test('fixed multilingual cases reproduce the ranking and reject ineligible perfect matches', () => {
  for (const result of evaluateRanking()) {
    expect(result.baseline_top).toBe('a');
    expect(result.proposed_top).toBe(result.expected_top);
    expect(result.proposed.map(({ id }) => id)).toEqual(['b', 'a']);
  }
  expect(rank('ＲＥＣＯＶＥＲＹ 恢复指南', [
    { id: 'complete', title: 'Recovery', body: '恢复指南', eligible: true },
    { id: 'partial', title: 'Recovery', body: '', eligible: true },
  ])).toEqual([{ id: 'complete', score: 3, contributions: { title_match: 2, body_match: 1 } }]);
});
