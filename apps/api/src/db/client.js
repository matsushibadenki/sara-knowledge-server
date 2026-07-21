// /apps/api/src/db/client.js
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const databaseUrl = process.env.DATABASE_URL || 'postgresql://sara:change_me@localhost:5432/sara_knowledge';

export const sql = postgres(databaseUrl, {
  max: Number(process.env.DATABASE_POOL_MAX || 10),
  prepare: false,
});

export const db = drizzle(sql);

export async function closeDatabase() {
  await sql.end({ timeout: 5 });
}
