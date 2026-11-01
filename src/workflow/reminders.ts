import type pg from 'pg';
import { runReminders, type PushSender } from '../push/reminders.js';
import type { ReviewDeps } from '../review/store.js';
import { inngest } from './ladder-generate.js';

/** Hourly tick: sends each learner's daily reminder at their chosen local hour, only when cards are due. */
export function createReminderTick(pool: pg.Pool, send: PushSender | undefined, deps: ReviewDeps = {}) {
  return inngest.createFunction(
    { id: 'reminder-tick', triggers: [{ cron: '0 * * * *' }] },
    async ({ step }) => {
      if (!send) return { skipped: 'push-not-configured' };
      return step.run('send-reminders', () => runReminders(pool, send, (deps.now ?? (() => new Date()))(), deps));
    },
  );
}
