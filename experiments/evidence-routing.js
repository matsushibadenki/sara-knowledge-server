// Offline routing policy for exact evidence lookups, not a model difficulty classifier.
import { runExperiment } from './evidence-delta.js';

const encoder = new TextEncoder();
export const contextBytes = (items) => encoder.encode(JSON.stringify(items)).length;

export function routeEvidence({ intent, requiredIds, pack, maxContextBytes }) {
  if (intent !== 'exact_lookup' || !requiredIds?.length) {
    return { route: 'review', reason: 'unsupported_intent' };
  }
  if (!Number.isSafeInteger(maxContextBytes) || maxContextBytes < 0) {
    return { route: 'review', reason: 'invalid_budget' };
  }
  const selected = [];
  const required = new Set(requiredIds);
  const byId = new Map();
  for (const item of pack) {
    if (!required.has(item.id)) continue;
    if (byId.has(item.id)) return { route: 'review', reason: 'ambiguous_evidence' };
    byId.set(item.id, item);
  }
  for (const id of required) {
    if (!byId.has(id)) return { route: 'review', reason: 'missing_evidence' };
    selected.push(byId.get(id));
  }
  const bytes = contextBytes(selected);
  if (bytes > maxContextBytes) return { route: 'review', reason: 'budget_exceeded' };
  return { route: 'compact', evidence: selected, bytes };
}

if (import.meta.main) {
  const [corrected, withdrawn] = runExperiment();
  const request = { intent: 'exact_lookup', requiredIds: [5], maxContextBytes: 256 };
  const pack = corrected.packs.get(4);
  console.log({
    fullPackBytes: contextBytes(pack),
    corrected: routeEvidence({ ...request, pack }),
    withdrawn: routeEvidence({ ...request, pack: withdrawn.packs.get(4) }),
  });
}
