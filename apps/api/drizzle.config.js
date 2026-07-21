// /apps/api/drizzle.config.js
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/index.js',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://sara:change_me@localhost:5432/sara_knowledge',
  },
  strict: true,
  verbose: true,
});
