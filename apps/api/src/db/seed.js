// /apps/api/src/db/seed.js
import { eq } from 'drizzle-orm';
import { db, closeDatabase } from './client.js';
import { users } from './schema/index.js';
import { hashPassword } from '../auth/passwords.js';

const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const password = process.env.ADMIN_PASSWORD || 'admin_change_me';
const displayName = process.env.ADMIN_DISPLAY_NAME || 'SARA Administrator';

if (password.length < 12) {
  throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
}

try {
  const passwordHash = await hashPassword(password);
  const now = new Date();

  await db.insert(users).values({
    email,
    displayName,
    passwordHash,
    status: 'active',
    role: 'admin',
    locale: process.env.ADMIN_LOCALE || 'ja',
    updatedAt: now,
  }).onConflictDoUpdate({
    target: users.email,
    set: {
      displayName,
      passwordHash,
      status: 'active',
      role: 'admin',
      updatedAt: now,
    },
  });

  const [user] = await db.select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  console.log(JSON.stringify({
    level: 'info',
    service: 'api',
    message: 'Admin user seeded',
    user_id: user.id,
    email: user.email,
  }));
} finally {
  await closeDatabase();
}
