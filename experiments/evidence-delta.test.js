import { expect, test } from 'bun:test';
import { runExperiment } from './evidence-delta.js';

test('delta refresh equals full refresh across corrections, withdrawal, and fallback', () => {
  const [corrected, withdrawn, revoked, added, unrelated, broad, uncertain] = runExperiment();
  expect([corrected.rebuilt, withdrawn.rebuilt, revoked.rebuilt, added.rebuilt, unrelated.rebuilt]).toEqual([2, 2, 2, 1, 0]);
  for (const pack of [4, 5]) {
    expect(corrected.packs.get(pack)).toContainEqual({ id: 5, revision: 2, statement: 'Corrected fact' });
    expect(withdrawn.packs.get(pack).some(({ id }) => id === 5)).toBe(false);
  }
  expect(revoked.packs.get(8).some(({ id }) => id === 8)).toBe(false);
  expect(added.packs.get(999).some(({ id }) => id === 1000)).toBe(true);
  expect(uncertain.packs.get(900).some(({ id }) => id === 900)).toBe(false);
  for (const result of [broad, uncertain]) {
    expect(result.mode).toBe('full');
    expect(result.rebuilt).toBe(result.baseline);
  }
});
