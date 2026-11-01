import { STATE_MAX_AGE_SECONDS } from './cookies.js';
import { hmacHex, randomToken, safeEqual } from './crypto.js';

/** `state` goes to GitHub. `cookieValue` stays in the browser: `<state>.<issuedAtMs>.<hmac>`. */
export function issueState(secret: string, nowMs = Date.now()): { state: string; cookieValue: string } {
  const state = randomToken(24);
  const body = `${state}.${nowMs}`;
  return { state, cookieValue: `${body}.${hmacHex(secret, body)}` };
}

export function verifyState(
  secret: string,
  cookieValue: string | undefined,
  queryState: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!cookieValue || !queryState) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return false;
  const [state, issuedAt, mac] = parts as [string, string, string];
  if (!safeEqual(mac, hmacHex(secret, `${state}.${issuedAt}`))) return false;
  const ageMs = nowMs - Number(issuedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > STATE_MAX_AGE_SECONDS * 1000) return false;
  return safeEqual(state, queryState);
}
