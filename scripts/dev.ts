// Local dev: rebuild the client on change and restart the server on change. Reads .env (Bun loads it).
const opts = { stdout: "inherit", stderr: "inherit", env: { ...process.env, NODE_ENV: "development" } } as const;
const children = [
  Bun.spawn(["bunx", "vite", "build", "--watch"], opts),
  Bun.spawn(["bun", "--watch", "src/server/main.ts"], opts),
];
const stopAll = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
await Promise.race(children.map((child) => child.exited));
stopAll();

export {};
