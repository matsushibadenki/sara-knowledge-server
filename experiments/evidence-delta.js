// Offline experiment: fixed dependency sets, no production cache or model calls.
import assert from 'node:assert/strict';

export function compareRefreshes(definitions, initial, batches) {
  const dependents = new Map();
  for (const [pack, ids] of definitions) {
    for (const id of ids) {
      if (!dependents.has(id)) dependents.set(id, new Set());
      dependents.get(id).add(pack);
    }
  }
  // Compile structured evidence separately from any rendering/generation.
  const compile = (state, pack) => definitions.get(pack).flatMap((id) => {
    const source = state.get(id);
    return source?.status === 'verified'
      ? [{ id, revision: source.revision, statement: source.statement }]
      : [];
  });
  let state = new Map(initial);
  const all = [...definitions.keys()];
  const cached = new Map(all.map((pack) => [pack, compile(state, pack)]));
  return batches.map((batch) => {
    const started = performance.now();
    if (batch.uncertain === true) {
      assert.ok(batch.snapshot instanceof Map, 'An uncertain feed requires an authoritative snapshot');
      state = new Map(batch.snapshot);
    }
    const dirty = new Set();
    for (const [id, next] of batch.changes) {
      if (next === null) state.delete(id);
      else state.set(id, next);
      for (const pack of dependents.get(id) ?? []) dirty.add(pack);
    }
    // Without a complete change feed, no cached result can be trusted.
    // On broad changes, avoid enumerating the dirty set again.
    const full = batch.uncertain === true || dirty.size >= all.length / 2;
    const selected = full ? all : dirty;
    for (const pack of selected) cached.set(pack, compile(state, pack));
    const deltaMs = performance.now() - started;
    const baselineStarted = performance.now();
    const expected = new Map(all.map((pack) => [pack, compile(state, pack)]));
    const baselineMs = performance.now() - baselineStarted;
    assert.deepEqual(cached, expected, batch.label);
    return {
      case: batch.label, mode: full ? 'full' : 'delta',
      rebuilt: full ? all.length : dirty.size, baseline: all.length,
      deltaMs, baselineMs,
      packs: new Map(cached),
    };
  });
}

export function runExperiment() {
  const verified = (revision, statement) => ({ revision, statement, status: 'verified' });
  const initial = new Map(Array.from({ length: 1000 }, (_, i) => [i, verified(1, `Fact ${i}`)]));
  // Adjacent packs share evidence. Include dependencies that do not exist yet.
  const definitions = new Map(Array.from({ length: 1000 }, (_, i) => [i, [i, i + 1]]));
  const broad = Array.from({ length: 700 }, (_, i) => [i, verified(3, `Updated fact ${i}`)]);
  const snapshot = new Map([...initial, [1000, verified(1, 'New fact')], ...broad]);
  snapshot.delete(900); // A withdrawal missed by the change feed.
  return compareRefreshes(definitions, initial, [
    { label: 'correction', changes: [[5, verified(2, 'Corrected fact')]] },
    { label: 'withdrawal', changes: [[5, null]] },
    { label: 'verification revoked', changes: [[8, { ...verified(2, 'Fact 8'), status: 'candidate' }]] },
    { label: 'new evidence', changes: [[1000, verified(1, 'New fact')]] },
    { label: 'unrelated change', changes: [[2000, verified(1, 'Unrelated fact')]] },
    { label: 'broad correction', changes: broad },
    { label: 'uncertain feed', uncertain: true, snapshot, changes: [] },
  ]);
}

if (import.meta.main) {
  console.table(runExperiment().map(({ packs, ...metrics }) => metrics));
}
