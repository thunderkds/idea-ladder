import { useEffect, useState } from "react";

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

function Ladders() {
  const [login, setLogin] = useState<string>();
  useEffect(() => {
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((me: { login: string }) => setLogin(me.login))
      .catch(() => window.location.assign("/"));
  }, []);
  return (
    <main className="page">
      <header className="bar">
        <span className="brand">Idea Ladder</span>
        <form action="/auth/sign-out" method="post">
          <span className="muted">{login ? `@${login} ` : ""}</span>
          <button className="button button-quiet" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <h1>My ladders</h1>
      <section className="empty">
        <p>No ladders yet</p>
      </section>
    </main>
  );
}

export function App() {
  return window.location.pathname === "/ladders" ? <Ladders /> : <Home />;
}
