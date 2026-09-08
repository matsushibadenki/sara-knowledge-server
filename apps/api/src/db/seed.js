// /apps/api/src/db/seed.js
import { eq } from 'drizzle-orm';
import { db, closeDatabase } from './client.js';
import { users, workspaceMemberships, workspaces } from './schema/index.js';
import { hashPassword } from '../auth/passwords.js';

const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
const password = process.env.ADMIN_PASSWORD || 'admin_change_me';
const displayName = process.env.ADMIN_DISPLAY_NAME || 'SARA Administrator';
const defaultWorkspaceId = '00000000-0000-4000-8000-000000000001';

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

  await db.insert(workspaces).values({
    id: defaultWorkspaceId,
    scopeKey: 'server',
    slug: process.env.WORKSPACE_SLUG || 'default',
    name: process.env.WORKSPACE_NAME || 'SARA Workspace',
    status: 'active',
    createdBy: user.id,
  }).onConflictDoUpdate({
    target: workspaces.scopeKey,
    set: {
      name: process.env.WORKSPACE_NAME || 'SARA Workspace',
      status: 'active',
      updatedAt: now,
    },
  });

  const [workspace] = await db.select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.scopeKey, 'server'))
    .limit(1);

  await db.insert(workspaceMemberships).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: 'admin',
    status: 'active',
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
    set: { role: 'admin', status: 'active', updatedAt: now },
  });

  console.log(JSON.stringify({
    level: 'info',
    service: 'api',
    message: 'Admin user and workspace membership seeded',
    user_id: user.id,
    workspace_id: workspace.id,
    email: user.email,
  }));
} finally {
  await closeDatabase();
}
