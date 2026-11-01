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
