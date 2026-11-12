// T015: /settings. Daily reminder (Web Push, one per day at the learner's local hour, only when cards are due),
// export of progress to a JSON file, and import of that file (review data only; the server never lets an import
// create proof or unlock a level).
import { type ChangeEvent, type ReactNode, useEffect, useState } from "react";
import type { ImportResult, PushStatus, PushSubscribeRequest } from "../shared/offline.ts";
import { OFFLINE_TEXT, requireOnline } from "./offline.tsx";
import { signedOut } from "./offline-store.ts";

const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
const IOS_HINT = "Add to Home Screen to install and get reminders";
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourText = (h: number) => `${String(h).padStart(2, "0")}:00`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Feedback = { kind: "ok" | "error"; text: string };

/** The VAPID public key (base64url) as the bytes pushManager.subscribe expects. */
function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** The active service worker registration, or an error after 10 s (no endless wait when it never installed). */
function workerReady() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("service worker not ready")), 10_000)),
  ]);
}

function Message({ feedback }: { feedback?: Feedback }) {
  if (!feedback) return null;
  return (
    <p
      className={`settings-feedback ${feedback.kind === "error" ? "settings-error" : "settings-ok"}`}
      role={feedback.kind === "error" ? "alert" : "status"}
    >
      {feedback.text}
    </p>
  );
}

function Reminders() {
  const supported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [status, setStatus] = useState<PushStatus>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [hour, setHour] = useState(9);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(() => supported && Notification.permission === "denied");
  const [feedback, setFeedback] = useState<Feedback>();

  useEffect(() => {
    if (!supported) return;
    fetch("/api/push/status")
      .then(async (res) => {
        if (res.status === 401) return signedOut();
        if (!res.ok) throw new Error(`push status failed: ${res.status}`);
        const body = (await res.json()) as PushStatus;
        setStatus(body);
        if (body.hour !== null) setHour(body.hour);
      })
      .catch(() => setLoadFailed(true));
  }, [supported]);

  const turnOn = async (publicKey: string) => {
    setBusy(true);
    setFeedback(undefined);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "denied") return setBlocked(true);
      if (permission !== "granted") {
        return setFeedback({ kind: "error", text: "Notifications were not allowed. Turn on reminders to ask again." });
      }
      const registration = await workerReady();
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const keys = sub.toJSON().keys ?? {};
      const body: PushSubscribeRequest = {
        subscription: { endpoint: sub.endpoint, keys: { p256dh: keys.p256dh ?? "", auth: keys.auth ?? "" } },
        hour,
        timezone,
      };
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) return signedOut();
      if (!res.ok) throw new Error(`subscribe failed: ${res.status}`);
      setStatus((s) => (s ? { ...s, subscribed: true, hour, timezone } : s));
      setFeedback({ kind: "ok", text: `Reminders are on for ${hourText(hour)}.` });
    } catch {
      setFeedback({ kind: "error", text: requireOnline() ? "Could not turn on reminders. Try again." : OFFLINE_TEXT });
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setFeedback(undefined);
    try {
      const sub = await (await workerReady()).pushManager.getSubscription();
      if (sub) {
        const res = await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        if (res.status === 401) return signedOut();
        if (!res.ok) throw new Error(`unsubscribe failed: ${res.status}`);
        await sub.unsubscribe();
      }
      setStatus((s) => (s ? { ...s, subscribed: false } : s));
      setFeedback({ kind: "ok", text: "Reminders are off." });
    } catch {
      setFeedback({ kind: "error", text: requireOnline() ? "Could not turn off reminders. Try again." : OFFLINE_TEXT });
    } finally {
      setBusy(false);
    }
  };

  let body: ReactNode;
  if (!supported) {
    body = <p className="status-detail">{IOS_HINT}</p>;
  } else if (loadFailed) {
    body = (
      <>
        <p className="status-detail">{requireOnline() ? "Could not load your reminder settings." : OFFLINE_TEXT}</p>
        <p>
          <a className="button button-quiet" href="/settings">
            Try again
          </a>
        </p>
      </>
    );
  } else if (!status) {
    body = <p className="status-detail">Loading</p>;
  } else if (!status.configured || !status.publicKey) {
    body = <p className="status-detail">Reminders are not available on this server</p>;
  } else if (blocked) {
    body = (
      <>
        <p className="settings-error">Reminders blocked in browser settings</p>
        <p className="status-detail">
          Allow notifications for this site in your browser settings, then reload this page.
        </p>
      </>
    );
  } else if (status.subscribed) {
    body = (
      <>
        <p>
          On: every day at {hourText(status.hour ?? hour)} ({status.timezone ?? timezone}), only when cards are due.
        </p>
        {status.timezone && status.timezone !== timezone ? (
          <p className="status-detail">This device is now in {timezone}. To use it, turn reminders off and on again.</p>
        ) : null}
        <button className="button button-quiet" type="button" disabled={busy} onClick={() => void turnOff()}>
          Turn off reminders
        </button>
      </>
    );
  } else {
    const key = status.publicKey;
    body = (
      <>
        <p className="status-detail">One push a day at the hour you choose, only when cards are due.</p>
        <div className="settings-field">
          <label htmlFor="reminder-hour">Reminder time ({timezone})</label>
          <select id="reminder-hour" value={hour} onChange={(e) => setHour(Number(e.currentTarget.value))}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {hourText(h)}
              </option>
            ))}
          </select>
        </div>
        <button className="button" type="button" disabled={busy} onClick={() => void turnOn(key)}>
          Turn on reminders
        </button>
      </>
    );
  }
  return (
    <section className="settings-section" aria-labelledby="reminders-title">
      <h2 id="reminders-title">Reminders</h2>
      {body}
      <Message feedback={feedback} />
    </section>
  );
}

function ExportProgress() {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const run = async () => {
    setFeedback(undefined);
    if (!requireOnline()) return setFeedback({ kind: "error", text: OFFLINE_TEXT });
    setBusy(true);
    try {
      const res = await fetch("/api/progress/export");
      if (res.status === 401) return signedOut();
      if (!res.ok) throw new Error(`export failed: ${res.status}`);
      const given = /filename="?([\w.-]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1];
      const name = given ?? "idea-ladder-progress.json";
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setFeedback({ kind: "ok", text: `Downloaded ${name}. Keep it as a backup.` });
    } catch {
      setFeedback({ kind: "error", text: "Could not export your progress. Try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-section" aria-labelledby="export-title">
      <h2 id="export-title">Export progress</h2>
      <p className="status-detail">Download your review progress as one JSON file.</p>
      <button className="button button-quiet" type="button" disabled={busy} onClick={() => void run()}>
        Export progress
      </button>
      <Message feedback={feedback} />
    </section>
  );
}

const importSummary = (r: ImportResult) => {
  const skipped = [
    r.skipped.olderThanServer ? `${r.skipped.olderThanServer} older than your saved progress` : "",
    r.skipped.notRateable ? `${r.skipped.notRateable} for cards you cannot review` : "",
    r.skipped.futureTime ? `${r.skipped.futureTime} with a time in the future` : "",
  ].filter(Boolean);
  return (
    `Imported ${plural(r.applied, "review", "reviews")}; ${plural(r.duplicates, "was", "were")} already saved.` +
    (skipped.length ? ` Skipped: ${skipped.join(", ")}.` : "")
  );
};

function ImportProgress() {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const run = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    setFeedback(undefined);
    if (!file) return;
    try {
      if (file.size > IMPORT_MAX_BYTES) {
        return setFeedback({ kind: "error", text: "This file is larger than 5 MB. Choose the file you exported." });
      }
      if (!requireOnline()) return setFeedback({ kind: "error", text: OFFLINE_TEXT });
      setBusy(true);
      const res = await fetch("/api/progress/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: await file.text(),
      });
      if (res.status === 401) return signedOut();
      if (res.ok) return setFeedback({ kind: "ok", text: importSummary((await res.json()) as ImportResult) });
      const problem = (await res.json().catch(() => ({}))) as { detail?: unknown };
      const known = [400, 403, 413].includes(res.status) && typeof problem.detail === "string";
      setFeedback({ kind: "error", text: known ? String(problem.detail) : "Could not import this file. Try again." });
    } catch {
      setFeedback({ kind: "error", text: "Could not import this file. Try again." });
    } finally {
      input.value = "";
      setBusy(false);
    }
  };
  return (
    <section className="settings-section" aria-labelledby="import-title">
      <h2 id="import-title">Import progress</h2>
      <p className="status-detail">
        Restore review progress from an exported file. An import never changes proof or unlocks a level.
      </p>
      <div className="settings-field">
        <label htmlFor="import-file">Import progress</label>
        <input
          id="import-file"
          className="file-input"
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => void run(e)}
        />
      </div>
      <Message feedback={feedback} />
    </section>
  );
}

export function SettingsPage() {
  return (
    <main className="page">
      <header className="bar">
        <nav className="bar-links" aria-label="Settings">
          <a className="back-link" href="/ladders">
            My ladders
          </a>
          <a className="back-link" href="/review">
            Review
          </a>
        </nav>
      </header>
      <h1>Settings</h1>
      <Reminders />
      <ExportProgress />
      <ImportProgress />
    </main>
  );
}
