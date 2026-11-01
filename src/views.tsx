import type { Child } from 'hono/jsx';

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

export function LaddersPage(props: { login: string }) {
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
      <p class="muted">No ladders yet</p>
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
