// /apps/api/src/auth/passwords.js
export async function hashPassword(password) {
  return Bun.password.hash(password, { algorithm: 'argon2id' });
}

export async function verifyPassword(password, passwordHash) {
  return Bun.password.verify(password, passwordHash);
}
