import { describe, expect, it } from 'vitest';
import { createAdminSession, hashAdminPassword, verifyAdminPassword, verifyAdminSession } from './admin-auth';

describe('admin authentication', () => {
  it('hashes and verifies passwords with PBKDF2', async () => {
    const hash = await hashAdminPassword('a-secure-admin-password', 100_000);
    expect(hash).not.toContain('a-secure-admin-password');
    await expect(verifyAdminPassword('a-secure-admin-password', hash)).resolves.toBe(true);
    await expect(verifyAdminPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('signs sessions and rejects expired or modified values', async () => {
    const now = 1_800_000_000_000;
    const session = await createAdminSession('session-secret', now);
    await expect(verifyAdminSession(session, 'session-secret', now + 1_000)).resolves.toBe(true);
    await expect(verifyAdminSession(`${session}x`, 'session-secret', now + 1_000)).resolves.toBe(false);
    await expect(verifyAdminSession(session, 'session-secret', now + 9 * 60 * 60 * 1000)).resolves.toBe(false);
  });
});
