import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Constant-time string comparison; hashes first so inputs of any length are safe. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
