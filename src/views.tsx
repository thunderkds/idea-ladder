import type { Child } from 'hono/jsx';
import { deepWikiUrl, readmeUrl, type LadderListItem, type LadderView } from './ladder/view.js';

export const APP_NAME = 'Idea Ladder';

function Layout(props: { title: string; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <link rel="stylesheet" href="/assets/tokens.css" />
        <link rel="stylesheet" href="/assets/app.css" />
      </head>
      <body>
        <main class="page">{props.children}</main>
      </body>
    </html>
  );
}

export function HomePage() {
  return (
    <Layout title={APP_NAME}>
      <h1>{APP_NAME}</h1>
      <p>Learn a repo one level at a time.</p>
      <form method="get" action="/auth/github">
        <button type="submit" class="button">
          Sign in with GitHub
        </button>
      </form>
    </Layout>
  );
}

export function LaddersPage(props: { login: string; ladders?: LadderListItem[] }) {
  const ladders = props.ladders ?? [];
  return (
    <Layout title={`My ladders - ${APP_NAME}`}>
      <header class="bar">
        <span class="muted">
          Signed in as <strong>{props.login}</strong>
        </span>
        <form method="post" action="/auth/sign-out">
          <button type="submit" class="button button-quiet">
            Sign out
          </button>
        </form>
      </header>
      <h1>My ladders</h1>
      {ladders.length === 0 ? (
        <p class="muted">No ladders yet</p>
      ) : (
        <ul class="ladder-list">
          {ladders.map((l) => (
            <li class="ladder-row">
              <span class="wrap">
                <code>{l.repoFullName}</code>
              </span>
              <a href={`/ladders/${l.id}`}>
                Open ladder<span class="visually-hidden"> {l.repoFullName}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
}

const STATUS_HINTS: Record<string, string> = { unverified: 'AI-drafted, not yet reviewed by people' };

function LockIcon() {
  return (
    <svg class="icon" aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm-2 3.5a2 2 0 1 1 4 0V6H6V4.5Z" />
    </svg>
  );
}

export function LadderPage(props: { login: string; ladder: LadderView }) {
  const { ladder } = props;
  const status = ladder.status.charAt(0).toUpperCase() + ladder.status.slice(1);
  const hint = STATUS_HINTS[ladder.status];
  const [owner, name] = ladder.repoFullName.split('/');
  return (
    <Layout title={`${ladder.repoFullName} - ${APP_NAME}`}>
      <header class="bar">
        <a href="/ladders">My ladders</a>
        <span class="muted">
          Signed in as <strong>{props.login}</strong>
        </span>
      </header>
      <h1 class="wrap">
        {owner}/{name}
      </h1>
      <div class="ladder-meta">
        <span class="badge" title={hint}>
          {status}
        </span>
        {hint ? <span class="visually-hidden">{hint}</span> : null}
        <span class="muted">
          Pinned to commit <code>{ladder.commitSha.slice(0, 7)}</code>
        </span>
      </div>
      <div class="ladder-links">
        <a class="button button-quiet" href={readmeUrl(ladder.repoFullName, ladder.commitSha)} target="_blank" rel="noopener noreferrer">
          Read the README
        </a>
        <a class="button button-quiet" href={deepWikiUrl(ladder.repoFullName)} target="_blank" rel="noopener noreferrer">
          Open in DeepWiki
        </a>
      </div>
      <ol class="levels">
        {ladder.levels.map((level, i) => (
          <li
            class={`level level-${level.lock}`}
            id={`level-${level.id}`}
            aria-disabled={level.lock === 'locked' ? 'true' : undefined}
            aria-current={level.lock === 'open' ? 'step' : undefined}
            tabindex={level.lock === 'open' ? 0 : undefined}
          >
            <h2 class="level-title">
              {level.id} {level.title}
            </h2>
            <p class="wrap">{level.goal}</p>
            <p class="wrap muted">
              Pass test: {level.passTest.description}
            </p>
            {level.lock === 'locked' ? (
              <p class="level-state muted">
                <LockIcon /> Locked — pass {ladder.levels[i - 1]?.id} first
              </p>
            ) : null}
            {level.lock === 'open' ? <p class="level-state">Open</p> : null}
            {level.lock === 'passed' ? <p class="level-state">Passed</p> : null}
          </li>
        ))}
      </ol>
    </Layout>
  );
}

export function MessagePage(props: { heading: string; message: string }) {
  return (
    <Layout title={`${props.heading} - ${APP_NAME}`}>
      <h1>{props.heading}</h1>
      <p>{props.message}</p>
      <p>
        <a href="/">Back to start</a>
      </p>
    </Layout>
  );
}

export function UnsupportedUrlPage(props: { url: string }) {
  return (
    <Layout title={`Not supported yet - ${APP_NAME}`}>
      <h1>Not supported yet</h1>
      <p>Only GitHub repository URLs work for now, like https://github.com/owner/name.</p>
      <p class="muted">You gave:</p>
      <p class="wrap">
        <code>{props.url}</code>
      </p>
      <p>
        <a href="/">Back to start</a>
      </p>
    </Layout>
  );
}

const STATUS_HEADINGS = { queued: 'Queued', running: 'Reading the repo', fetched: 'Done' } as const;

const FAILURE_TEXT: Record<string, string> = {
  'repo-not-found': 'GitHub has no public repository with that name.',
  'github-error': 'GitHub did not answer after several tries.',
  'enqueue-failed': 'The job could not be started.',
};

function formatResetTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export interface JobView {
  id: string;
  repoFullName: string;
  status: 'queued' | 'running' | 'fetched' | 'failed';
  reason: string | null;
  resetAt: Date | null;
}

export function JobPage(props: { job: JobView }) {
  const { job } = props;
  const isFinal = job.status === 'fetched' || job.status === 'failed';
  const heading = job.status === 'failed' ? `Failed: ${job.reason ?? 'unknown'}` : STATUS_HEADINGS[job.status];
  return (
    <Layout title={`${heading} - ${APP_NAME}`}>
      <h1 id="job-status">{heading}</h1>
      <p class="wrap muted">
        Repo: <code>{job.repoFullName}</code>
      </p>
      {job.status === 'failed' && job.reason === 'rate-limited' ? (
        <p>
          GitHub is limiting requests right now.
          {job.resetAt ? ` You can try again after ${formatResetTime(job.resetAt)}.` : ' Try again in a few minutes.'}
        </p>
      ) : null}
      {job.status === 'failed' && job.reason !== 'rate-limited' ? (
        <p>{FAILURE_TEXT[job.reason ?? ''] ?? 'Something went wrong.'}</p>
      ) : null}
      {job.status === 'fetched' ? <p>The repo is read and saved. Building the ladder arrives in a later release.</p> : null}
      {!isFinal ? <p class="muted">This page updates by itself.</p> : null}
      {job.status === 'failed' ? (
        <p>
          <a href={`/start?url=${encodeURIComponent(`https://github.com/${job.repoFullName}`)}`}>Try again</a>
        </p>
      ) : null}
      {!isFinal ? <script src="/assets/job-status.js" defer data-job-id={job.id} data-status={job.status}></script> : null}
    </Layout>
  );
}
