// Test-only: @inngest/test returns from `execute()` as soon as the run resolves or a step fails, but the other
// chains of a parallel run (Promise.all of steps) keep executing their current step in the background, and may
// re-run an unmemoized step (generate-level-*, check-and-dedupe, save-ladder). That work writes to the test DB and to
// the test's cost/call arrays after the test ends. `drainInngestRuns()` waits until no execution is in flight.
import { InngestTestEngine } from "@inngest/test";

type Execution = (...args: unknown[]) => Promise<unknown>;
const inFlight = new Set<Promise<unknown>>();
const proto = InngestTestEngine.prototype as unknown as { individualExecution: Execution };
const original = proto.individualExecution;
proto.individualExecution = function (this: unknown, ...args: unknown[]) {
  const p = original.apply(this, args);
  inFlight.add(p);
  p.then(
    () => inFlight.delete(p),
    () => inFlight.delete(p),
  );
  return p;
};

/** Number of test-engine executions still running. */
export const inFlightInngestRuns = () => inFlight.size;

/** Waits until every test-engine execution has settled, including those a settled one starts next. */
export async function drainInngestRuns(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
    await new Promise((r) => setTimeout(r, 0)); // a chain starts its next execution in a microtask
  }
}
