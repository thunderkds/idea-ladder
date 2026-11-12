// T015: service worker registration, the theme-color meta tag, and the captured install prompt.

/** Registers /sw.js for the whole site; does nothing where service workers are not supported. */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
    // not installable this time (for example a private window); the app still works online
  });
}

/** The browser bar color from the theme token (index.html cannot hold a color literal). */
export function applyThemeColor() {
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", accent);
}

/** Chromium's install event (not in the TypeScript DOM types). */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | undefined;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/** Keeps the browser's install prompt for later: it is offered only after a finished review session. */
export function captureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = undefined;
    notify();
  });
}

export const installAvailable = () => deferred !== undefined;

export function onInstallChange(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Shows the browser's install dialog once; the event cannot be reused afterwards. */
export async function promptInstall() {
  const event = deferred;
  deferred = undefined;
  notify();
  if (!event) return;
  await event.prompt();
  await event.userChoice;
}
