import { constantTimeEqual } from './crypto';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEFAULT_ITERATIONS = 210_000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function derivePassword(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  ));
}

export async function hashAdminPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  if (password.length < 10) throw new Error('Admin password must contain at least 10 characters');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePassword(password, salt, iterations);
  return `pbkdf2$${iterations}$${bytesToBase64Url(salt)}$${bytesToBase64Url(derived)}`;
}

export async function verifyAdminPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsValue, saltValue, hashValue] = encoded.split('$');
  const iterations = Number(iterationsValue);
  if (algorithm !== 'pbkdf2' || !Number.isInteger(iterations) || iterations < 100_000 || !saltValue || !hashValue) return false;
  const derived = await derivePassword(password, base64UrlToBytes(saltValue), iterations);
  return constantTimeEqual(bytesToBase64Url(derived), hashValue);
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

export async function createAdminSession(secret: string, now = Date.now()): Promise<string> {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({ exp: now + 8 * 60 * 60 * 1000 })));
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifyAdminSession(value: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!value) return false;
  const [payload, signature] = value.split('.');
  if (!payload || !signature || !constantTimeEqual(await hmac(payload, secret), signature)) return false;
  try {
    const parsed = JSON.parse(decoder.decode(base64UrlToBytes(payload))) as { exp?: number };
    return typeof parsed.exp === 'number' && parsed.exp > now;
  } catch {
    return false;
  }
}
