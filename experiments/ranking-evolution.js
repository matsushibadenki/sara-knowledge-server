import { rank } from './interpretable-ranking.js';

function example(query, relevantInTitle) {
  return {
    query,
    documents: [
      { id: 'distractor', title: relevantInTitle ? 'Index' : query, body: relevantInTitle ? query : 'Index', eligible: true },
      { id: 'relevant', title: relevantInTitle ? query : 'Procedure', body: relevantInTitle ? 'Procedure' : query, eligible: true },
      { id: 'withdrawn', title: query, body: query, eligible: false },
    ],
  };
}

const development = [
  example('監査ログ', false), example('network recovery', false), example('备份恢复', false),
  example('作業手順', true),
];
const evaluation = [
  example('再起動手順', false), example('Ａｃｃｅｓｓ recovery', false), example('恢复指南', false),
  example('点検記録', true), example('Incident response', true), example('配置说明', true),
];

function score(cases, logRatio) {
  let hits = 0;
  let ineligible = 0;
  for (const { query, documents } of cases) {
    const results = rank(query, documents, { title_match: Math.exp(logRatio), body_match: 1 });
    hits += Number(results[0]?.id === 'relevant');
    ineligible += Number(results.some((result) => result.id === 'withdrawn'));
  }
  return { hits, ineligible, cases: cases.length };
}

function seededNormal(seed) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

export function compareRankingSearch(seed = 42) {
  const initial = Math.log(2);
  const sample = seededNormal(seed);
  let center = initial;
  let best = initial;
  let bestHits = score(development, best).hits;
  const generations = 8;
  const population = 8;
  for (let step = 0; step < generations; step++) {
    const trials = Array.from({ length: population }, () => {
      const noise = sample();
      const policy = Math.max(-3, Math.min(3, center + 0.9 * noise));
      const { hits } = score(development, policy);
      if (hits > bestHits) {
        bestHits = hits;
        best = policy;
      }
      return { noise, hits };
    });
    const mean = trials.reduce((sum, trial) => sum + trial.hits, 0) / population;
    const deviation = Math.sqrt(trials.reduce((sum, trial) => sum + (trial.hits - mean) ** 2, 0) / population);
    if (deviation) {
      const direction = trials.reduce((sum, trial) => sum + (trial.hits - mean) * trial.noise, 0) / (population * deviation);
      center = Math.max(-3, Math.min(3, center + 0.3 * direction));
    }
  }

  const grid = [-2, -1, 0, 1, 2].map((ratio) => ({ ratio, hits: score(development, ratio).hits }));
  const gridBest = grid.reduce((a, b) => b.hits > a.hits ? b : a);
  const report = (ratio, tuningEvaluations) => ({
    title_weight: Math.exp(ratio), body_weight: 1, tuning_evaluations: tuningEvaluations,
    held_out: score(evaluation, ratio),
  });
  return { seed, fixed: report(initial, 0), grid: report(gridBest.ratio, grid.length),
    evolution: report(best, generations * population + 1) };
}

if (import.meta.main) console.log(JSON.stringify(compareRankingSearch(), null, 2));
