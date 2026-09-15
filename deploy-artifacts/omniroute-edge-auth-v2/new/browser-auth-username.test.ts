import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db/node';
import { createUser, findUserByIdentifier, normalizeUsername, validateUsername } from '../browserAuth';

const clients: Array<{ close(): void }> = [];
afterEach(() => {
  while (clients.length) clients.pop()?.close();
});

describe('browser admin username identity', () => {
  it('normalizes and validates usernames predictably', () => {
    expect(normalizeUsername('  Admin.User  ')).toBe('admin.user');
    expect(validateUsername('admin.user')).toBeNull();
    expect(validateUsername('A bad user')).toBeTruthy();
    expect(validateUsername('ab')).toBeTruthy();
  });

  it('resolves the same administrator by username or email', async () => {
    const { db, client } = await createTestDb();
    clients.push(client);
    const created = await createUser(db, {
      email: 'admin@example.com',
      username: 'admin',
      displayName: 'Administrator',
      password: 'S3cure!Password',
    });

    const byUsername = await findUserByIdentifier(db, 'ADMIN');
    const byEmail = await findUserByIdentifier(db, 'ADMIN@EXAMPLE.COM');
    expect(byUsername?.id).toBe(created.id);
    expect(byEmail?.id).toBe(created.id);
  });
});
