import { expect, test } from 'bun:test';
import { evaluatePruning, pruningExperiment } from './evidence-pruning.js';

test('held-out cross-language regression rejects equal-width pruning and restores the full pack', () => {
  const { coverage, control } = pruningExperiment();
  expect(coverage.accepted).toBe(true);
  expect(coverage.pack.map(({ id }) => id)).toEqual([0, 1, 2]);
  expect(coverage.candidateBytes).toBeLessThan(coverage.baselineBytes);
  expect(control.accepted).toBe(false);
  expect(control.regressions).toEqual(['zh+en']);
  expect(control.pack).toHaveLength(6);
});

test('empty validation cannot approve pruning and pruning cannot hide ambiguity', () => {
  const pack = [{ id: 1, revision: 1 }, { id: 1, revision: 2 }, { id: 2, revision: 1 }];
  expect(evaluatePruning(pack, new Set([1]), []).pack).toBe(pack);
  const result = evaluatePruning(pack, new Set([2]), [
    { label: 'ambiguous', intent: 'exact_lookup', requiredIds: [1] },
  ]);
  expect(result.regressions).toEqual(['ambiguous']);
  expect(result.pack).toBe(pack);
});

test('paired reports retain rejected cases and bind source revisions and validation requests', () => {
  const pack = [
    { id: 1, revision: 1, statement: '日本語' },
    { id: 2, revision: 1, statement: 'English' },
    { id: 3, revision: 1, statement: '简体中文' },
  ];
  const validation = [
    { label: 'ja', intent: 'exact_lookup', requiredIds: [1] },
    { label: 'zh', intent: 'exact_lookup', requiredIds: [3] },
  ];
  const run = (p = pack, v = validation) => evaluatePruning(p, new Set([1]), v);
  const report = run();
  expect(report.reason).toBe('regression');
  expect(report.cases.map(({ label, matched }) => [label, matched])).toEqual([['ja', true], ['zh', false]]);
  expect(report.cases[1].baseline.route).toBe('compact');
  expect(report.cases[1].candidate.reason).toBe('missing_evidence');
  expect(report.evaluationHash).toMatch(/^[a-f0-9]{64}$/);
  expect(run().evaluationHash).toBe(report.evaluationHash);
  expect(run(pack.map((item) => ({ ...item, revision: 2 }))).evaluationHash).not.toBe(report.evaluationHash);
  expect(run(pack, validation.slice(0, 1)).evaluationHash).not.toBe(report.evaluationHash);
  expect(report.pack).toBe(pack);
});

test('rejected-only validation cannot approve a smaller candidate and duplicate labels fail', () => {
  const pack = [{ id: 1, revision: 1 }, { id: 2, revision: 1 }];
  const invalid = { label: 'not-supported', intent: 'synthesis', requiredIds: [1] };
  const report = evaluatePruning(pack, new Set([1]), [invalid]);
  expect(report.accepted).toBe(false);
  expect(report.reason).toBe('no_supported_validation');
  expect(report.pack).toBe(pack);
  expect(() => evaluatePruning(pack, new Set([1]), [invalid, invalid])).toThrow('unique');
});
