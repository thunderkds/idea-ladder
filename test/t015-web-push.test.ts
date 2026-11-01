import { beforeEach, describe, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { createWebPushSender } from '../src/push/web-push.js';

vi.mock('web-push', () => ({ default: { sendNotification: vi.fn(async () => ({ statusCode: 201 })) } }));

describe('T015 web-push sender (web-push mocked)', () => {
  beforeEach(() => vi.mocked(webpush.sendNotification).mockClear());

  it('is undefined without VAPID keys', () => {
    expect(createWebPushSender(undefined)).toBeUndefined();
  });

  it('sends with the VAPID details and the stored subscription keys', async () => {
    const send = createWebPushSender({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.example' })!;
    await send({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'k', auth: 'a' }, '{"title":"t"}');
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'k', auth: 'a' } },
      '{"title":"t"}',
      expect.objectContaining({ vapidDetails: { subject: 'mailto:a@b.example', publicKey: 'pub', privateKey: 'priv' } }),
    );
  });

  it('lets a push service error with statusCode reach the caller', async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));
    const send = createWebPushSender({ publicKey: 'p', privateKey: 'q', subject: 'mailto:a@b.example' })!;
    await expect(send({ endpoint: 'https://fcm.googleapis.com/x', p256dh: 'k', auth: 'a' }, '{}')).rejects.toMatchObject({ statusCode: 410 });
  });
});
