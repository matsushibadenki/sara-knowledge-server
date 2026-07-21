// /apps/api/src/db/migrate.js
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, closeDatabase } from './client.js';

try {
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  console.log(JSON.stringify({
    level: 'info',
    service: 'api',
    message: 'Database migrations applied',
  }));
} finally {
  await closeDatabase();
}
