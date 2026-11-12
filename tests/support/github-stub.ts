// Test-only stand-in for github.com OAuth + api.github.com/user. Never used in production code.
export type StubUser = { id: number; login: string };

export type GithubStub = {
  url: string;
  setUser: (user: StubUser) => void;
  /** Issues a one-time authorization code, as GitHub does after the user approves. */
  issueCode: () => string;
  lastAuthorize: () => URLSearchParams | undefined;
  stop: () => void;
};

export function startGithubStub(opts: {
  user: StubUser;
  clientId: string;
  clientSecret: string;
  /** If set, /login/oauth/authorize redirects straight back here (the browser e2e flow). */
  callbackUrl?: string;
  port?: number;
}): GithubStub {
  let user = opts.user;
  let authorize: URLSearchParams | undefined;
  const codes = new Map<string, boolean>(); // code -> used
  const tokens = new Set<string>();
  const issueCode = () => {
    const code = `code_${crypto.randomUUID()}`;
    codes.set(code, false);
    return code;
  };

  const server = Bun.serve({
    port: opts.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/login/oauth/authorize") {
        authorize = url.searchParams;
        if (!opts.callbackUrl) return new Response("authorize page");
        const back = new URL(opts.callbackUrl);
        back.searchParams.set("code", issueCode());
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        return Response.redirect(back.toString(), 302);
      }
      if (req.method === "POST" && url.pathname === "/login/oauth/access_token") {
        const body = (await req.json()) as Record<string, string>;
        const code = body.code ?? "";
        const valid =
          body.client_id === opts.clientId && body.client_secret === opts.clientSecret && codes.get(code) === false;
        if (!valid) return Response.json({ error: "bad_verification_code" }); // GitHub answers 200 + error
        codes.set(code, true);
        const token = `tok_${crypto.randomUUID()}`;
        tokens.add(token);
        return Response.json({ access_token: token, token_type: "bearer", scope: "read:user" });
      }
      if (req.method === "GET" && url.pathname === "/user") {
        const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
        if (!tokens.has(token)) return Response.json({ message: "Bad credentials" }, { status: 401 });
        return Response.json({ id: user.id, login: user.login });
      }
      return new Response("not found", { status: 404 });
    },
  });

  return {
    url: `http://localhost:${server.port}`,
    setUser: (u) => {
      user = u;
    },
    issueCode,
    lastAuthorize: () => authorize,
    stop: () => server.stop(true),
  };
}
