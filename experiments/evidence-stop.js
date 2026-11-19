// Offline experiment. Each lookup must return the complete set for one ID
// from the same verified, authorized snapshot.
import { routeEvidence } from './evidence-routing.js';

export function boundedLookup({ intent, requiredIds, maxContextBytes, maxLookups }, lookup) {
  let lookups = 0;
  const result = (route) => ({ ...route, lookups });
  const review = (reason) => result({ route: 'review', reason });
  if (intent !== 'exact_lookup' || !Array.isArray(requiredIds) || !requiredIds.length) {
    return review('unsupported_intent');
  }
  if (!Number.isSafeInteger(maxLookups) || maxLookups < 0 ||
      !Number.isSafeInteger(maxContextBytes) || maxContextBytes < 0) {
    return review('invalid_budget');
  }
  const pack = [];
  for (const id of new Set(requiredIds)) {
    if (lookups === maxLookups) return review('lookup_budget_exceeded');
    lookups++;
    const matches = lookup(id);
    if (!Array.isArray(matches) || matches.some((item) => item.id !== id)) return review('invalid_lookup');
    if (matches.length !== 1) return review(matches.length ? 'ambiguous_evidence' : 'missing_evidence');
    pack.push(matches[0]);
  }
  return result(routeEvidence({ intent, requiredIds, maxContextBytes, pack }));
}

if (import.meta.main) {
  const pack = Array.from({ length: 1000 }, (_, id) => ({ id, revision: 1, statement: `Fact ${id}` }));
  const grouped = new Map(pack.map((item) => [item.id, [item]]));
  console.log({ fullScanEntries: pack.length, bounded: boundedLookup({
    intent: 'exact_lookup', requiredIds: [25, 250], maxContextBytes: 256, maxLookups: 4,
  }, (id) => grouped.get(id) ?? []) });
}
