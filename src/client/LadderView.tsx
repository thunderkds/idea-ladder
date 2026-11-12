// T010: /ladders/:ladderId. Shows L0-L4 with lock state, the status badge, the pinned SHA, and links out to the
// repo README and DeepWiki. The app writes no explanation of the repo (requirement: link out only).
import { useEffect, useState } from "react";
import type { LadderView as Ladder, LevelView } from "../server/ladder-view.ts";
import { expireSession } from "./offline-store.ts";

const UNVERIFIED_DESCRIPTION = "AI-drafted, not yet reviewed by people";
const levelNumber = (level: LevelView) => Number(level.id.slice(1));

function LockIcon() {
  return (
    <svg className="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Level({ level }: { level: LevelView }) {
  const open = level.lock === "open";
  const locked = level.lock === "locked";
  return (
    <li
      id={`level-${level.id}`}
      className={`level level-${level.lock}`}
      aria-disabled={locked ? "true" : undefined}
      aria-current={open ? "step" : undefined}
    >
      <div className="level-head">
        <span className="level-id">{level.id}</span>
        <h2 className="level-title long-text">
          {open ? <a href={`#level-${level.id}`}>{level.title}</a> : level.title}
        </h2>
      </div>
      <p className="level-goal long-text">{level.goal}</p>
      <p className="level-test long-text">
        <span className="muted">Pass test: </span>
        {level.passTest.description}
      </p>
      {open ? <p className="level-state">Open now</p> : null}
      {level.lock === "passed" ? <p className="level-state">Passed</p> : null}
      {locked ? (
        <p className="level-state level-lock">
          <LockIcon /> Locked — pass L{levelNumber(level) - 1} first
        </p>
      ) : null}
    </li>
  );
}

export function LadderPage({ ladderId }: { ladderId: string }) {
  const [ladder, setLadder] = useState<Ladder>();
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    fetch(`/api/ladders/${encodeURIComponent(ladderId)}`)
      .then(async (res) => {
        if (res.status === 401) return expireSession();
        if (res.status === 404) return stopped ? undefined : setMissing(true);
        if (!res.ok) throw new Error(`ladder request failed: ${res.status}`);
        const body = (await res.json()) as Ladder;
        if (!stopped) setLadder(body);
      })
      .catch(() => {
        if (!stopped) setFailed(true);
      });
    return () => {
      stopped = true;
    };
  }, [ladderId]);

  if (missing) {
    return (
      <main className="page">
        <h1>Ladder not found</h1>
        <p className="status-detail">This ladder does not exist.</p>
        <p>
          <a className="back-link" href="/ladders">
            Back to My ladders
          </a>
        </p>
      </main>
    );
  }
  if (failed) {
    return (
      <main className="page" role="alert">
        <h1>Could not load this ladder</h1>
        <p className="status-detail">Something went wrong while loading it.</p>
        <p>
          <a className="back-link" href={`/ladders/${encodeURIComponent(ladderId)}`}>
            Try again
          </a>
        </p>
        <p>
          <a className="back-link" href="/ladders">
            Back to My ladders
          </a>
        </p>
      </main>
    );
  }
  if (!ladder) {
    return (
      <main className="page" aria-busy="true">
        <h1>Loading</h1>
      </main>
    );
  }
  const [owner = "", name = ""] = ladder.repoFullName.split("/");
  const repoPath = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const unverified = ladder.status === "unverified";
  return (
    <main className="page">
      <p>
        <a className="back-link" href="/ladders">
          My ladders
        </a>
      </p>
      <header className="ladder-head">
        <div className="ladder-title">
          <h1 className="long-text">{ladder.repoFullName}</h1>
          <p className="ladder-meta">
            <span className="badge" aria-describedby={unverified ? "status-description" : undefined}>
              {ladder.status.charAt(0).toUpperCase() + ladder.status.slice(1)}
            </span>
            {unverified ? (
              <span id="status-description" className="visually-hidden">
                {UNVERIFIED_DESCRIPTION}
              </span>
            ) : null}
            <span className="muted">
              Pinned to <code>{ladder.commitSha.slice(0, 7)}</code>
            </span>
          </p>
          {unverified ? <p className="muted">{UNVERIFIED_DESCRIPTION}</p> : null}
        </div>
        <div className="ladder-links">
          <a
            className="button"
            href={`https://github.com/${repoPath}/blob/${ladder.commitSha}/README.md`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the README
          </a>
          <a className="button button-quiet" href="/review">
            Start review
          </a>
          <a
            className="button button-quiet"
            href={`https://deepwiki.com/${repoPath}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in DeepWiki
          </a>
        </div>
      </header>
      <ol className="levels">
        {ladder.levels.map((level) => (
          <Level key={level.id} level={level} />
        ))}
      </ol>
    </main>
  );
}
