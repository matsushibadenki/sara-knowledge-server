import { expect, test } from 'bun:test';
import { boundedLookup } from './evidence-stop.js';
import { routeEvidence } from './evidence-routing.js';
import { runExperiment } from './evidence-delta.js';

const request = { intent: 'exact_lookup', requiredIds: [5, 4, 5], maxContextBytes: 256, maxLookups: 2 };

test('stops after complete scoped lookups and agrees with full scan across correction and withdrawal', () => {
  for (const { packs } of runExperiment().slice(0, 2)) {
    const pack = packs.get(4);
    const visited = [];
    const { lookups, ...actual } = boundedLookup(request, (id) => {
      visited.push(id);
      return pack.filter((item) => item.id === id);
    });
    expect(actual).toEqual(routeEvidence({ ...request, pack }));
    expect(lookups).toBe(visited.length);
    expect(visited).toEqual(pack.some(({ id }) => id === 5) ? [5, 4] : [5]);
  }
});

test('ambiguity or depleted budget cannot produce partial evidence', () => {
  const lookup = (id) => [{ id, revision: 1 }];
  expect(boundedLookup({ ...request, maxLookups: 1 }, lookup)).toEqual({
    route: 'review', reason: 'lookup_budget_exceeded', lookups: 1,
  });
  expect(boundedLookup(request, (id) => [...lookup(id), { id, revision: 2 }])).toEqual({
    route: 'review', reason: 'ambiguous_evidence', lookups: 1,
  });
});
