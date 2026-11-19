// Offline analogue of structured pruning: never modify the original pack.
import { contextBytes, routeEvidence } from './evidence-routing.js';
import { createHash } from 'node:crypto';

// Identity of the full paired experiment, not just its successful examples.
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function evaluatePruning(pack, keepIds, validation) {
  const candidate = pack.filter(({ id }) => keepIds.has(id));
  const baselineBytes = contextBytes(pack);
  const candidateBytes = contextBytes(candidate);
  const regressions = [];
  const labels = validation.map(({ label }) => label);
  if (labels.some((label) => typeof label !== 'string' || !label.trim()) || new Set(labels).size !== labels.length) {
    throw new Error('Validation labels must be nonempty and unique.');
  }
  const manifest = {
    protocol: 'evidence-pruning-paired-v1',
    baseline: pack, candidate, validation,
    maxContextBytes: Number.MAX_SAFE_INTEGER,
  };
  const cases = [];
  for (const { label, ...request } of validation) {
    const evaluate = (evidence) => routeEvidence({
      ...request, pack: evidence, maxContextBytes: Number.MAX_SAFE_INTEGER,
    });
    const baseline = evaluate(pack);
    const proposed = evaluate(candidate);
    const matched = JSON.stringify(baseline) === JSON.stringify(proposed);
    if (!matched) regressions.push(label);
    cases.push({ label, baseline, candidate: proposed, matched });
  }
  // A set containing only rejected/unsupported lookups cannot establish usefulness.
  const reason = !cases.some(({ baseline }) => baseline.route === 'compact') ? 'no_supported_validation'
    : regressions.length ? 'regression'
    : candidateBytes >= baselineBytes ? 'no_size_reduction' : 'passed';
  const accepted = reason === 'passed';
  return {
    accepted, reason, baselineBytes, candidateBytes, regressions,
    evaluationHash: fingerprint(manifest), cases,
    pack: accepted ? candidate : pack,
  };
}

export function pruningExperiment() {
  const pack = ['操作手順', 'Recovery procedure', '恢复流程', 'Unused example', 'Unused note', 'Unused appendix']
    .map((statement, id) => ({ id, revision: 1, statement }));
  const discovery = [[0], [1], [2], [0, 2]];
  const validation = [
    { label: 'ja+en', intent: 'exact_lookup', requiredIds: [0, 1] },
    { label: 'zh+en', intent: 'exact_lookup', requiredIds: [2, 1] },
    { label: 'missing', intent: 'exact_lookup', requiredIds: [10] },
  ];
  return {
    coverage: evaluatePruning(pack, new Set(discovery.flat()), validation),
    // Fixed, equal-width control independent of the discovery cases.
    control: evaluatePruning(pack, new Set([0, 1, 3]), validation),
  };
}

if (import.meta.main) {
  const reports = pruningExperiment();
  if (process.argv.includes('--json')) console.log(JSON.stringify(reports, null, 2));
  else console.table(Object.entries(reports).map(([strategy, { pack, cases, ...metrics }]) => ({
      strategy, retained: pack.length, ...metrics, regressions: metrics.regressions.join(', '),
    })));
}
