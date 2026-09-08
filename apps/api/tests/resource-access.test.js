import { expect, test } from 'bun:test';
import { db } from '../src/db/client.js';
import { resourceAccessConditions } from '../src/services/resource-access.js';

const firstId = '00000000-0000-0000-0000-000000000001';
const secondId = '00000000-0000-0000-0000-000000000002';

function compile(type) {
  const { table, where } = resourceAccessConditions(type, firstId);
  return db.select({ id: table.id }).from(table).where(where).toSQL();
}

test('shared Record access compiles without a nonexistent created_by condition', () => {
  const query = compile('record');
  expect(query.sql).toContain('"dataset"."records"."id" = $1');
  expect(query.sql).toContain('"dataset"."records"."deleted_at" is null');
  expect(query.sql).not.toContain('and  =');
  expect(query.params).toEqual([firstId]);
});

test('shared Source access does not depend on its nullable creator', () => {
  const query = compile('source');
  expect(query.sql).not.toContain('"created_by" =');
  expect(query.params).toEqual([firstId]);
});

test('workspace Memory access does not use creator attribution as a boundary', () => {
  const query = compile('event');
  expect(query.sql).not.toContain('"created_by" =');
  expect(query.params).toEqual([firstId]);
});

test('unsupported polymorphic resource types fail closed', () => {
  expect(() => compile('unknown')).toThrow('Unsupported resource type: unknown');
});
