import { expect, test } from 'bun:test';
import { contextBytes, routeEvidence } from './evidence-routing.js';
import { runExperiment } from './evidence-delta.js';

const request = { intent: 'exact_lookup', requiredIds: [5], maxContextBytes: 256 };

test('compact lookup preserves the corrected revision and escalates after withdrawal', () => {
  const [corrected, withdrawn] = runExperiment();
  const pack = corrected.packs.get(4);
  const result = routeEvidence({ ...request, pack });
  expect(result.evidence).toEqual([{ id: 5, revision: 2, statement: 'Corrected fact' }]);
  expect(result.bytes).toBeLessThan(contextBytes(pack));
  expect(routeEvidence({ ...request, pack: withdrawn.packs.get(4) })).toEqual({
    route: 'review', reason: 'missing_evidence',
  });
});

test('unsupported, ambiguous and oversized requests never use partial compact context', () => {
  const item = { id: 5, revision: 2, statement: '日本語・简体中文' };
  const pack = [item];
  expect(routeEvidence({ ...request, pack, maxContextBytes: NaN }).reason).toBe('invalid_budget');
  expect(routeEvidence({ ...request, pack, intent: 'synthesis' }).reason).toBe('unsupported_intent');
  expect(routeEvidence({ ...request, pack: [item, { ...item, revision: 3 }] }).reason).toBe('ambiguous_evidence');
  expect(routeEvidence({ ...request, pack, requiredIds: [5, 6] }).reason).toBe('missing_evidence');
  expect(routeEvidence({ ...request, pack, maxContextBytes: contextBytes(pack) - 1 })).toEqual({
    route: 'review', reason: 'budget_exceeded',
  });
  expect(routeEvidence({ ...request, pack, maxContextBytes: contextBytes(pack) }).route).toBe('compact');
});
