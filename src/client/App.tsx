import { useEffect, useState } from "react";
import { LadderPage } from "./LadderView.tsx";
import { OfflineNotice, requireOnline } from "./offline.tsx";
import { clearOfflineData, signedOut } from "./offline-store.ts";
import { ReviewPage } from "./Review.tsx";
import { SettingsPage } from "./Settings.tsx";

function Home() {
  return (
    <main className="page home">
      <h1>Idea Ladder</h1>
      <p>Climb a repo's ideas level by level, and leave with proof.</p>
      <form action="/auth/github" method="get">
        <button className="button" type="submit">
          Sign in with GitHub
        </button>
      </form>
    </main>
  );
}

type LadderListItem = { ladderId: string; repo: string };

function Ladders() {
  const [login, setLogin] = useState<string>();
  const [ladders, setLadders] = useState<LadderListItem[]>();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((me: { login: string }) => setLogin(me.login))
      .catch((reason) => {
        if (reason === 401) return void signedOut();
        if (!requireOnline()) return setOffline(true);
        window.location.assign("/");
      });
    fetch("/api/ladders")
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((list: LadderListItem[]) => setLadders(list))
      .catch(() => setLadders([]));
  }, []);
  return (
    <main className="page">
      <header className="bar">
        <span className="brand">Idea Ladder</span>
        <span className="bar-links">
          <a className="back-link" href="/settings">
            Settings
          </a>
          {/* Sign-out first forgets this learner's offline review data and cached pages (T015). */}
          <form
            action="/auth/sign-out"
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void clearOfflineData().then(() => form.submit());
            }}
          >
            <span className="muted">{login ? `@${login} ` : ""}</span>
            <button className="button button-quiet" type="submit">
              Sign out
            </button>
          </form>
        </span>
      </header>
      <h1>My ladders</h1>
      {offline ? (
        <OfflineNotice retryHref="/ladders" />
      ) : ladders === undefined ? null : ladders.length === 0 ? (
        <section className="empty">
          <p>No ladders yet</p>
        </section>
      ) : (
        <ul className="ladder-list">
          {ladders.map((ladder) => (
            <li key={ladder.ladderId} className="ladder-row">
              <span className="long-text">{ladder.repo}</span>
              <span className="ladder-actions">
                <a className="button button-quiet" href="/review">
                  Start review
                </a>
                <a className="button button-quiet" href={`/ladders/${ladder.ladderId}`}>
                  Open ladder<span className="visually-hidden"> {ladder.repo}</span>
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** Plain-words time for a reset or retry moment; never raw JSON. */
const when = (iso: string | undefined) => (iso ? new Date(iso).toLocaleString() : "later");

/** /start problems: the server serves the client with `data-error` (a fixed code) on #root. */
function StartProblem({ error, resetAt, retryAt }: { error: string; resetAt?: string; retryAt?: string }) {
  const given = new URLSearchParams(window.location.search).get("url") ?? "";
  const messages: Record<string, [title: string, detail: string]> = {
    "unsupported-url": ["Only GitHub repos work for now", "Paste a link to a public GitHub repo. You gave:"],
    "url-required": ["No URL given", "Open /start?url= with a GitHub repo link."],
    "url-too-long": ["That URL is too long", "A URL can have at most 2,048 characters."],
    "repo-not-found": ["Repo not found", "GitHub has no public repo at this link. You gave:"],
    "repo-empty": ["This repo is empty", "It has no commits yet, so there is nothing to read."],
    "rate-limited": ["GitHub is busy", `The GitHub rate limit is used up. Try again after ${when(resetAt)}.`],
    "too-many-starts": ["Too many new ladders", `You started the hourly maximum. Try again after ${when(retryAt)}.`],
    "queue-unavailable": ["Could not start", "The ladder queue is not available. Try again in a few minutes."],
    "github-unavailable": ["Could not reach GitHub", "Try again in a few minutes."],
  };
  const [title, detail] = messages[error] ?? ["Could not start", "Try again in a few minutes."];
  const showUrl = error === "unsupported-url" || error === "repo-not-found";
  return (
    <main className="page">
      <h1>{title}</h1>
      <p className="status-detail">{detail}</p>
      {showUrl && given ? <p className="long-text">{given}</p> : null}
      <p>
        <a href="/ladders">Back to My ladders</a>
      </p>
    </main>
  );
}

type Job = { status: "queued" | "running" | "fetched" | "failed"; repo: string; reason?: string; resetAt?: string };
const POLL_MS = 2_000;
const STATUS_TEXT: Record<Job["status"], string> = {
  queued: "Queued",
  running: "Reading the repo",
  fetched: "Done",
  failed: "Failed",
};
const FAILED_DETAIL: Record<string, (job: Job) => string> = {
  "rate-limited": (job) => `The GitHub rate limit is used up. It resets at ${when(job.resetAt)}; then try again.`,
  "repo-not-found": () => "GitHub no longer has this repo.",
  "queue-unavailable": () => "The ladder queue was not available. Try again in a few minutes.",
};

/** /jobs/:jobId: polls the job every 2 s and stops on a final status (fetched, failed). */
function JobStatus({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (res.status === 401) return signedOut();
        if (res.status === 404) return setMissing(true);
        if (res.ok) {
          const next = (await res.json()) as Job;
          if (stopped) return;
          setJob(next);
          if (next.status === "fetched" || next.status === "failed") return;
        }
      } catch {
        // network blip: try again on the next tick
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  if (missing) {
    return (
      <main className="page">
        <h1>Job not found</h1>
        <p className="status-detail">This job does not exist, or you did not start it.</p>
        <p>
          <a href="/ladders">Back to My ladders</a>
        </p>
      </main>
    );
  }
  const title = !job
    ? "Loading"
    : job.status === "failed"
      ? `Failed: ${job.reason ?? "unknown"}`
      : STATUS_TEXT[job.status];
  const detail = !job
    ? ""
    : job.status === "failed"
      ? (FAILED_DETAIL[job.reason ?? ""]?.(job) ?? "Something went wrong while reading the repo. Try again later.")
      : job.status === "fetched"
        ? "The repo is read and its snapshot is saved."
        : "This page updates by itself.";
  return (
    <main className="page" aria-live="polite">
      <h1>{title}</h1>
      {job ? <p className="long-text">{job.repo}</p> : null}
      <p className="status-detail">{detail}</p>
      <p>
        <a href="/ladders">Back to My ladders</a>
      </p>
    </main>
  );
}

export function App() {
  const path = window.location.pathname;
  if (path === "/ladders") return <Ladders />;
  if (path === "/review") return <ReviewPage />;
  if (path === "/settings") return <SettingsPage />;
  if (path.startsWith("/ladders/")) return <LadderPage ladderId={path.slice("/ladders/".length)} />;
  if (path.startsWith("/jobs/")) return <JobStatus jobId={path.slice("/jobs/".length)} />;
  const root = document.getElementById("root");
  if (path === "/start" && root?.dataset.error) {
    return <StartProblem error={root.dataset.error} resetAt={root.dataset.resetAt} retryAt={root.dataset.retryAt} />;
  }
  // Ladder generation needs the server: offline, the service worker serves the shell and nothing is sent or queued.
  if (path === "/start" && !requireOnline()) {
    return (
      <main className="page">
        <h1>Start a ladder</h1>
        <OfflineNotice retryHref={window.location.pathname + window.location.search} />
      </main>
    );
  }
  return <Home />;
}
