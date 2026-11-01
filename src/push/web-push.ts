import webpush from 'web-push';
import type { Config } from '../config.js';
import type { PushSender } from './reminders.js';

/** The real sender, or undefined when VAPID keys are not configured. The private key stays on the server. */
export function createWebPushSender(vapid: Config['vapid']): PushSender | undefined {
  if (!vapid) return undefined;
  return async (target, payload) => {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      payload,
      { vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 6 * 3600, timeout: 10_000 },
    );
  };
}
