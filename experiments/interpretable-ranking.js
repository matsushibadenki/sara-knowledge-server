// Offline G2 experiment inspired by iWSP's explicit computation and reconstruction audit.
import assert from 'node:assert/strict';

export const policy = Object.freeze({ title_match: 2, body_match: 1 });
const normalize = (text) => text.normalize('NFKC').toLowerCase();

export function rank(query, documents, weights = policy) {
  const terms = [...new Set(normalize(query).trim().split(/\s+/u).filter(Boolean))];
  if (!terms.length) return [];
  return documents.flatMap(({ id, title, body, eligible }) => {
    if (eligible !== true) return [];
    const fields = [normalize(title), normalize(body)];
    if (!terms.every((term) => fields.some((field) => field.includes(term)))) return [];
    const features = {
      title_match: terms.filter((term) => fields[0].includes(term)).length,
      body_match: terms.filter((term) => fields[1].includes(term)).length,
    };
    const contributions = Object.fromEntries(Object.entries(features).map(([key, value]) => [key, value * weights[key]]));
    return [{ id, contributions, score: contributions.title_match + contributions.body_match }];
  }).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function evaluateRanking() {
  const fixtures = ['再起動', 'Recovery', '恢复指南'].map((query) => ({
    query,
    documents: [
      { id: 'a', title: 'Log', body: query, eligible: true },
      { id: 'b', title: query, body: 'Procedure', eligible: true },
      { id: 'c', title: query, body: query, eligible: false },
    ],
  }));
  const report = fixtures.map(({ query, documents }) => {
    const baseline = rank(query, documents, { title_match: 0, body_match: 0 });
    const proposed = rank(query, documents);
    // Manually reconstructed from the specification, independently of rank().
    const rebuilt = documents.filter((d) => d.eligible).map((d) => ({
      id: d.id,
      score: (normalize(d.title).includes(normalize(query)) ? 2 : 0) +
        (normalize(d.body).includes(normalize(query)) ? 1 : 0),
    })).sort((a, b) => b.score - a.score);
    assert.deepEqual(proposed.map(({ id, score }) => ({ id, score })), rebuilt);
    return { query, baseline_top: baseline[0].id, proposed_top: proposed[0].id, expected_top: 'b', proposed };
  });
  return report;
}

if (import.meta.main) console.log(JSON.stringify(evaluateRanking(), null, 2));
