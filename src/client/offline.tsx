// T015 AC 7: online-only features (ladder generation now, pass tests from T030) check `requireOnline()` first and
// show <OfflineNotice /> instead of sending or queueing a request.
import { useEffect, useState } from "react";

export const OFFLINE_TEXT = "You are offline — this needs a connection";

/** True when the browser reports a network; an online-only action runs only then. */
export const requireOnline = () => navigator.onLine;

/** The browser's online state, updated on the `online` and `offline` events. */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function OfflineNotice({ retryHref }: { retryHref?: string }) {
  return (
    <div className="offline-notice" role="status">
      <p>{OFFLINE_TEXT}</p>
      <p className="status-detail">Your daily review still works offline.</p>
      <p className="offline-actions">
        <a className="button" href="/review">
          Open review
        </a>
        {retryHref ? (
          <a className="button button-quiet" href={retryHref}>
            Try again
          </a>
        ) : null}
      </p>
    </div>
  );
}
