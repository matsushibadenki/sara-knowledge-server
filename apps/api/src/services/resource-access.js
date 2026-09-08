import { and, eq, isNull } from 'drizzle-orm';
import {
  datasetSnapshots,
  memoryConcepts,
  memoryEntities,
  memoryEvents,
  memoryExperiences,
  records,
  sources,
  trainingModels,
} from '../db/schema/index.js';

// Authentication establishes the singleton workspace boundary before these
// lookups run. createdBy remains attribution and is never an access predicate.
const resourceDefinitions = {
  source: { table: sources, access: 'shared' },
  record: { table: records, access: 'shared' },
  event: { table: memoryEvents, access: 'shared' },
  experience: { table: memoryExperiences, access: 'shared' },
  entity: { table: memoryEntities, access: 'shared' },
  concept: { table: memoryConcepts, access: 'shared' },
  dataset_snapshot: { table: datasetSnapshots, access: 'shared', completedOnly: true },
  model: { table: trainingModels, access: 'shared' },
};

export function getResourceAccessDefinition(type) {
  return resourceDefinitions[type] || null;
}

export function resourceAccessConditions(type, id) {
  const definition = getResourceAccessDefinition(type);
  if (!definition) throw new Error(`Unsupported resource type: ${type}`);

  const { table } = definition;
  const conditions = [eq(table.id, id)];
  if (table.deletedAt) conditions.push(isNull(table.deletedAt));
  if (definition.completedOnly) conditions.push(eq(table.status, 'completed'));
  return { table, where: and(...conditions) };
}

export async function findAccessibleResource(executor, type, id) {
  const { table, where } = resourceAccessConditions(type, id);
  const [item] = await executor.select({ id: table.id }).from(table).where(where).limit(1);
  return item || null;
}
