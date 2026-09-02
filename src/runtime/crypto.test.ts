import { describe, expect, it } from 'vitest';
import { createLookupDigest, createRandomBase64Key, decryptPii, encryptPii } from './crypto';

describe('PII crypto', () => {
  it('encrypts and decrypts a payload with AES-GCM', async () => {
    const key = createRandomBase64Key();
    const input = { email: 'buyer@example.com', address: 'Tokyo' };
    const encrypted = await encryptPii(input, key);

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain(input.email);
    await expect(decryptPii(encrypted, key)).resolves.toEqual(input);
  });

  it('normalizes email addresses before producing the lookup digest', async () => {
    const first = await createLookupDigest(' Buyer@Example.com ', 'pepper');
    const second = await createLookupDigest('buyer@example.com', 'pepper');
    expect(first).toBe(second);
  });
});
