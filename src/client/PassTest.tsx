// T030: /ladders/:ladderId?test=<level>. The learner takes a level's pass test: an MCQ attempt (L0, L1, L3; T012), an
// artifact link (L2 branch, L4 repo or PR; T013), then for L2 the 5 diff questions (T014). The client decides nothing:
// it sends answers or a link and shows what the server returns. After a pass it re-fetches the ladder view.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { LadderView } from "../server/ladder-view.ts";
import type { McqAttempt, McqResult } from "../server/mcq-test.ts";
import type { LevelId } from "../shared/levels.ts";
import { OfflineNotice, useOnline } from "./offline.tsx";
import { expireSession } from "./offline-store.ts";
import {
  artifactProblemText,
  DIFF_POLL_MS,
  DIFF_STATUS_TEXT,
  diffPollStep,
  diffRetakeProblemText,
  diffStatusPath,
  diffSubmitPath,
  diffSubmitProblemText,
  localTime,
  mcqProblemText,
  reviewCardsHref,
  runFeedbackProblemText,
  testKind,
} from "./pass-test.ts";

/** One question as shown: only id, text and options are kept, never any other field the server might send. */
type Question = { id: string; question: string; options: string[] };
const keepShown = (qs: readonly Question[]): Question[] =>
  qs.map(({ id, question, options }) => ({ id, question, options: [...options] }));

/** What the result view shows: only fields the server returned. */
type TestResult = {
  pass: boolean;
  score?: { correct: number; asked: number };
  unlockedLevel: string | null;
  reviewCardIds: string[];
};
const fromMcqResult = (r: McqResult): TestResult => ({
  pass: r.pass,
  score: { correct: r.correct, asked: r.asked },
  unlockedLevel: r.unlockedLevel,
  reviewCardIds: r.reviewCardIds,
});

type Problem = { error: string; retryAt?: string };
const enc = encodeURIComponent;
const NOT_SENT = "Not sent — try again";

/** m:ss, rounded up. */
const clockText = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

async function postJson(path: string, body?: unknown): Promise<{ res: Response; json: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { res, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

function PassIcon({ pass }: { pass: boolean }) {
  return (
    <svg className="icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      {pass ? (
        <path d="M6 10.5l2.5 2.5L14 7.5" fill="none" stroke="currentColor" strokeWidth="2" />
      ) : (
        <path d="M10 5.5v5.5M10 13.5v1" fill="none" stroke="currentColor" strokeWidth="2" />
      )}
    </svg>
  );
}

/** The 10 (MCQ) or 5 (diff) questions: one fieldset per question, radio options, in the server's order. */
function Questions({
  questions,
  answers,
  disabled,
  onAnswer,
}: {
  questions: Question[];
  answers: Record<string, number>;
  disabled: boolean;
  onAnswer: (id: string, choice: number) => void;
}) {
  return (
    <div className="questions">
      {questions.map((q, i) => (
        <fieldset key={q.id} className="question">
          <legend className="long-text">
            {i + 1}. {q.question}
          </legend>
          <div className="options">
            {q.options.map((option, j) => (
              <label key={`${q.id}:${option}`} className="option long-text">
                <input
                  type="radio"
                  name={`q-${q.id}`}
                  value={j}
                  checked={answers[q.id] === j}
                  disabled={disabled}
                  onChange={() => onAnswer(q.id, j)}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function ProblemBox({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="test-problem" role="alert">
      <p className="test-problem-title">{title}</p>
      {children}
    </div>
  );
}

/**
 * A question set the learner answers and submits once (MCQ attempt or diff questions). `send` posts the answers; it
 * returns a problem text to show next to the form (the questions and answers stay, so the same answers can be sent
 * again), or undefined when the server's result (or a screen-level problem) took over.
 */
function AnswerForm({
  questions,
  disabled,
  send,
}: {
  questions: Question[];
  disabled: boolean;
  send: (answers: Record<string, number>) => Promise<string | undefined>;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const sending = useRef(false);
  const online = useOnline();
  const answered = questions.filter((q) => answers[q.id] !== undefined).length;
  const complete = answered === questions.length;

  // Leaving mid-attempt asks first, only once an answer is chosen.
  useEffect(() => {
    if (answered === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [answered]);

  const submit = async () => {
    if (!complete || sending.current) return;
    sending.current = true; // a double click sends one request
    setBusy(true);
    setProblem(undefined);
    try {
      setProblem(await send(answers));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <form
      className="test-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="test-progress" aria-live="off">
        {answered} of {questions.length} answered
      </p>
      <Questions
        questions={questions}
        answers={answers}
        disabled={disabled || busy}
        onAnswer={(id, choice) => setAnswers((a) => ({ ...a, [id]: choice }))}
      />
      {problem ? <ProblemBox title={problem} /> : null}
      {online ? (
        <button className="button test-submit" type="submit" disabled={!complete || busy || disabled}>
          Submit answers
        </button>
      ) : (
        <OfflineNotice />
      )}
    </form>
  );
}

/** T012 MCQ attempt: `Take the test` starts it; the server sends the questions without keys and scores the answers. */
function McqTest({
  ladderId,
  level,
  onResult,
}: {
  ladderId: string;
  level: string;
  onResult: (r: TestResult) => void;
}) {
  const [attempt, setAttempt] = useState<{ attemptId: string; questions: Question[]; deadline: number }>();
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const starting = useRef(false);
  const online = useOnline();

  const start = async () => {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      const { res, json } = await postJson(`/api/ladders/${enc(ladderId)}/levels/${enc(level)}/mcq-attempts`);
      if (res.status === 401) return void expireSession();
      if (!res.ok) return setProblem({ error: String(json.error ?? ""), retryAt: json.retryAt as string | undefined });
      const a = json as unknown as McqAttempt;
      const at = Date.now();
      // The 30-minute limit runs from now on this device's clock, for the length the server gave.
      setAttempt({
        attemptId: a.attemptId,
        questions: keepShown(a.questions),
        deadline: at + (Date.parse(a.expiresAt) - Date.parse(a.startedAt)),
      });
      setNow(at);
    } catch {
      setProblem({ error: "not-sent" });
    } finally {
      starting.current = false;
      setBusy(false);
    }
  };

  // Countdown while an attempt runs.
  const running = attempt !== undefined;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);

  // After a 429 the start button comes back only at the server's `retryAt`.
  const retryAt = problem?.retryAt;
  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(() => setProblem(undefined), Math.min(Date.parse(retryAt) - Date.now(), 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [retryAt]);

  const send = async (answers: Record<string, number>) => {
    if (!attempt) return undefined;
    try {
      const { res, json } = await postJson(`/api/mcq-attempts/${enc(attempt.attemptId)}/submit`, { answers });
      if (res.status === 401) return void expireSession();
      if (!res.ok) return void setProblem({ error: String(json.error ?? "") });
      onResult(fromMcqResult(json as unknown as McqResult));
      return undefined;
    } catch {
      return NOT_SENT;
    }
  };

  const startButton = (label: string) =>
    online ? (
      <button className="button" type="button" disabled={busy} onClick={() => void start()}>
        {label}
      </button>
    ) : (
      <OfflineNotice />
    );

  const remaining = attempt ? Math.max(0, attempt.deadline - now) : 0;
  const expired = (attempt !== undefined && remaining === 0) || problem?.error === "attempt-expired";
  if (expired) {
    return (
      <ProblemBox title={mcqProblemText("attempt-expired")}>
        <p className="status-detail">Each attempt has 30 minutes. Your answers were not sent.</p>
        {startButton("Start a new attempt")}
      </ProblemBox>
    );
  }
  if (problem && problem.error !== "not-sent") {
    if (problem.retryAt) {
      return (
        <ProblemBox title="You used today's attempts">
          <p className="status-detail">
            Next attempt at <time dateTime={problem.retryAt}>{localTime(problem.retryAt)}</time>
          </p>
        </ProblemBox>
      );
    }
    return (
      <ProblemBox title={mcqProblemText(problem.error)}>
        {problem.error === "pool-too-small" ? (
          <p className="status-detail">It needs more checked questions first. Keep reviewing this level meanwhile.</p>
        ) : problem.error === "already-submitted" ? (
          <p className="status-detail">This attempt was already sent. The ladder shows its result.</p>
        ) : null}
        <p>
          <a className="back-link" href={`/ladders/${enc(ladderId)}`}>
            Back to the ladder
          </a>
        </p>
      </ProblemBox>
    );
  }
  if (!attempt) {
    return (
      <section className="test-intro" aria-label="Before you start">
        <p>Answer every question, then submit. You have 30 minutes once you start; a few attempts per day.</p>
        {problem?.error === "not-sent" ? <ProblemBox title={NOT_SENT} /> : null}
        {startButton("Take the test")}
      </section>
    );
  }
  return (
    <>
      <p className="review-timer test-timer">
        <span className="muted">Time left </span>
        <span role="timer">{clockText(remaining)}</span>
      </p>
      <AnswerForm questions={attempt.questions} disabled={false} send={send} />
    </>
  );
}

/** T013 AC 6: the optional L1 run log and 3-sentence explanation. Feedback only: never scored, never evidence. */
function RunFeedback({ ladderId }: { ladderId: string }) {
  const [runLog, setRunLog] = useState("");
  const [explanation, setExplanation] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setStatus(undefined);
    try {
      const { res, json } = await postJson(`/api/ladders/${enc(ladderId)}/levels/L1/run-feedback`, {
        runLog,
        explanation,
      });
      if (res.status === 401) return void expireSession();
      setStatus(
        res.ok
          ? { ok: true, text: "Saved. It is feedback only and does not count toward the test." }
          : { ok: false, text: runFeedbackProblemText(String(json.error ?? "")) },
      );
    } catch {
      setStatus({ ok: false, text: NOT_SENT });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="feedback-section"
      aria-labelledby="feedback-title"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 id="feedback-title">Optional: your run log and explanation</h2>
      <p className="muted">Feedback only. It is never scored and does not count toward the test.</p>
      <label htmlFor="run-log">Run log, or a link to it</label>
      <textarea
        id="run-log"
        className="text-input"
        rows={3}
        maxLength={20_000}
        value={runLog}
        onChange={(e) => setRunLog(e.target.value)}
      />
      <label htmlFor="run-explanation">What it does, in 3 sentences</label>
      <textarea
        id="run-explanation"
        className="text-input"
        rows={3}
        maxLength={600}
        value={explanation}
        aria-invalid={status && !status.ok ? "true" : undefined}
        aria-describedby={status ? "feedback-status" : undefined}
        onChange={(e) => setExplanation(e.target.value)}
      />
      {status ? (
        <p id="feedback-status" className={status.ok ? "settings-ok" : "field-error"} role="status">
          {status.text}
        </p>
      ) : null}
      <button className="button button-quiet" type="submit" disabled={busy || !explanation.trim()}>
        Save feedback
      </button>
    </form>
  );
}

/** T013: the L2 branch link or the L4 repo / PR link. The server checks it on GitHub; its reason is shown in words. */
function ArtifactTest({
  ladderId,
  level,
  initialUrl = "",
  onResult,
  onBranchVerified,
}: {
  ladderId: string;
  level: "L2" | "L4";
  initialUrl?: string;
  onResult: (r: TestResult) => void;
  onBranchVerified: (artifactId: string, url: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const online = useOnline();
  const send = async () => {
    const value = url.trim(); // trimmed for display; the server still validates
    if (!value || sending.current) return;
    sending.current = true;
    setUrl(value);
    setBusy(true);
    setError(undefined);
    try {
      const { res, json } = await postJson(`/api/ladders/${enc(ladderId)}/levels/${level}/artifact`, { url: value });
      if (res.status === 401) return void expireSession();
      if (!res.ok) return setError(artifactProblemText(json as Problem, level, ""));
      // L4: the artifact is the pass (the evidence record is written). L2: the diff questions follow (T014).
      if (level === "L4") onResult({ pass: true, unlockedLevel: null, reviewCardIds: [] });
      else onBranchVerified(String((json.artifact as { id: unknown }).id), value);
    } catch {
      setError(NOT_SENT);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const label = level === "L2" ? "Branch link" : "Repo link or PR link";
  const hint =
    level === "L2"
      ? "A branch with your change, for example https://github.com/you/repo/tree/your-branch. Every commit on it must be yours."
      : "A repo you built from scratch, for example https://github.com/you/repo, or your merged PR, for example https://github.com/owner/repo/pull/12.";
  return (
    <form
      className="artifact-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label htmlFor="artifact-url">{label}</label>
      <p id="artifact-hint" className="muted long-text">
        {hint}
      </p>
      <input
        id="artifact-url"
        className="text-input"
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={url}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? "artifact-hint artifact-error" : "artifact-hint"}
        onChange={(e) => setUrl(e.target.value)}
      />
      {error ? (
        <p id="artifact-error" className="field-error long-text" role="alert">
          {error}
        </p>
      ) : null}
      {online ? (
        <button className="button" type="submit" disabled={busy || !url.trim()}>
          {level === "L2" ? "Check my branch" : "Check my link"}
        </button>
      ) : (
        <OfflineNotice />
      )}
    </form>
  );
}

type DiffState = { status: string; reason?: string; setId?: string; questions?: Question[] };

/**
 * T014: after the L2 branch is verified, polls the question status every 5 s, pauses while the page is hidden, and
 * stops on a final status or after 10 min. `ready` shows the 5 questions; the server scores. A `failed` set offers a
 * retake (new questions on the same branch).
 */
function DiffTest({
  artifactId,
  onResult,
  onAnother,
}: {
  artifactId: string;
  onResult: (r: TestResult) => void;
  onAnother: () => void;
}) {
  const [state, setState] = useState<DiffState>({ status: "generating" });
  const [slow, setSlow] = useState(false);
  const [round, setRound] = useState(0); // `Check again` starts a new 10-minute round

  useEffect(() => {
    void round;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let paused = false;
    let status = "generating";
    const poll = async () => {
      timer = undefined;
      try {
        const res = await fetch(diffStatusPath(artifactId));
        if (res.status === 401) return void expireSession();
        if (res.ok) {
          const body = (await res.json()) as DiffState;
          if (stopped) return;
          status = body.status;
          setState({ ...body, questions: body.questions ? keepShown(body.questions) : undefined });
        }
      } catch {
        // network blip: try again on the next tick
      }
      if (stopped) return;
      next();
    };
    const next = () => {
      const step = diffPollStep({
        status,
        elapsedMs: Date.now() - startedAt,
        hidden: document.visibilityState === "hidden",
      });
      paused = step === "pause";
      if (step === "poll") timer = setTimeout(poll, DIFF_POLL_MS);
      if (step === "slow") setSlow(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "hidden" && timer) {
        clearTimeout(timer);
        timer = undefined;
        paused = true;
      } else if (document.visibilityState === "visible" && paused) {
        paused = false;
        void poll();
      }
    };
    setSlow(false);
    document.addEventListener("visibilitychange", onVisible);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [artifactId, round]);

  const send = async (answers: Record<string, number>) => {
    if (!state.setId) return undefined;
    try {
      const { res, json } = await postJson(diffSubmitPath(state.setId), { answers });
      if (res.status === 401) return void expireSession();
      // The 5 questions and the answers stay on screen; only the reason is shown next to them.
      if (!res.ok) return diffSubmitProblemText(String(json.error ?? ""));
      onResult(fromMcqResult(json as unknown as McqResult));
      return undefined;
    } catch {
      return NOT_SENT;
    }
  };

  if (state.status === "ready" && state.questions) {
    return (
      <>
        <h2>5 questions on your code</h2>
        <AnswerForm questions={state.questions} disabled={false} send={send} />
      </>
    );
  }
  if (state.status === "failed") {
    return (
      <section className="test-problem" aria-label="Your last set">
        <p className="test-problem-title">Not passed yet</p>
        <p className="status-detail">Your last 5 questions on this branch were not passed.</p>
        <RetakeButton
          artifactId={artifactId}
          onStarted={() => {
            setState({ status: "generating" });
            setRound((r) => r + 1);
          }}
        />
      </section>
    );
  }
  if (state.status === "generating") {
    return (
      <section className="test-intro" aria-label="Your questions" aria-busy={slow ? undefined : "true"}>
        <p className="test-problem-title" role="status">
          {slow ? "Taking longer than usual" : DIFF_STATUS_TEXT.generating}
        </p>
        <p className="status-detail">
          {slow
            ? "Your questions are still not ready. Check again in a few minutes."
            : "Your branch is checked. This page updates by itself."}
        </p>
        {slow ? (
          <button className="button" type="button" onClick={() => setRound((r) => r + 1)}>
            Check again
          </button>
        ) : null}
      </section>
    );
  }
  return (
    <ProblemBox title={DIFF_STATUS_TEXT[state.status] ?? mcqProblemText(state.reason ?? "")}>
      <p className="status-detail">Change something else on a branch, then send it.</p>
      <button className="button" type="button" onClick={onAnother}>
        Submit another branch
      </button>
    </ProblemBox>
  );
}

/** T014 retake after a failed set: a new set of questions on the same branch, within T012's attempt limit. */
function RetakeButton({ artifactId, onStarted }: { artifactId: string; onStarted: () => void }) {
  const [problem, setProblem] = useState<Problem>();
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const retake = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      const { res, json } = await postJson(diffStatusPath(artifactId));
      if (res.status === 401) return void expireSession();
      if (res.ok) return onStarted();
      setProblem({ error: String(json.error ?? ""), retryAt: json.retryAt as string | undefined });
    } catch {
      setProblem({ error: "not-sent" });
    } finally {
      setBusy(false);
    }
  };
  if (problem?.retryAt) {
    return (
      <div className="test-problem" role="alert">
        <p className="test-problem-title">You used today's attempts</p>
        <p className="status-detail">
          Next attempt at <time dateTime={problem.retryAt}>{localTime(problem.retryAt)}</time>
        </p>
      </div>
    );
  }
  return (
    <>
      {problem ? (
        <ProblemBox title={problem.error === "not-sent" ? NOT_SENT : diffRetakeProblemText(problem.error)} />
      ) : null}
      {online ? (
        <p>
          <button className="button" type="button" disabled={busy} onClick={() => void retake()}>
            Try again with new questions
          </button>
        </p>
      ) : (
        <OfflineNotice />
      )}
    </>
  );
}

/** One result view for every test type: pass shows the newly open level; fail the score and the linked cards. */
function ResultView({
  ladderId,
  ladder,
  result,
  retake,
}: {
  ladderId: string;
  ladder: LadderView;
  result: TestResult;
  /** L2 only: the retake control shown after a failed diff set. */
  retake?: ReactNode;
}) {
  const next = ladder.levels.find((l) => l.id === result.unlockedLevel);
  return (
    <section className={`result ${result.pass ? "result-pass" : "result-fail"}`} aria-labelledby="result-title">
      <h2 id="result-title" className="result-title">
        <PassIcon pass={result.pass} /> {result.pass ? "Level passed" : "Not passed yet"}
      </h2>
      {result.score ? (
        <p className="result-score">
          {result.score.correct} of {result.score.asked} correct
        </p>
      ) : null}
      {result.pass && next ? (
        <>
          <p>
            {next.id} {next.title} is open now.
          </p>
          <p>
            <a className="button" href={`/ladders/${enc(ladderId)}#level-${next.id}`}>
              Go to {next.id} {next.title}
            </a>
          </p>
        </>
      ) : null}
      {result.pass && !result.unlockedLevel ? <p>That was the last level: your ladder is complete.</p> : null}
      {!result.pass && result.reviewCardIds.length > 0 ? (
        <>
          <p>Review the cards on the questions you missed, then try again.</p>
          <p>
            <a className="button" href={reviewCardsHref(result.reviewCardIds)}>
              Review these cards
            </a>
          </p>
        </>
      ) : null}
      {!result.pass && result.reviewCardIds.length === 0 ? <p>Study this level, then try again.</p> : null}
      {!result.pass ? retake : null}
      <p>
        <a className="back-link" href={`/ladders/${enc(ladderId)}`}>
          Back to the ladder
        </a>
      </p>
    </section>
  );
}

export function PassTestPage({ ladderId, level }: { ladderId: string; level: LevelId }) {
  const [ladder, setLadder] = useState<LadderView>();
  const [loadError, setLoadError] = useState<"missing" | "failed">();
  const [result, setResult] = useState<TestResult>();
  /** L2: the verified branch whose diff questions are shown (T014), and its URL for `Submit another branch`. */
  const [branch, setBranch] = useState<{ artifactId?: string; url: string }>({ url: "" });
  /** Counts L2 retakes: a new count remounts the diff screen in its waiting state. */
  const [retakes, setRetakes] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ladders/${enc(ladderId)}`);
      if (res.status === 401) return void expireSession();
      if (res.status === 404) return setLoadError("missing");
      if (!res.ok) throw new Error(`ladder request failed: ${res.status}`);
      setLadder((await res.json()) as LadderView);
    } catch {
      setLoadError((e) => e ?? "failed");
    }
  }, [ladderId]);
  useEffect(() => {
    void load();
  }, [load]);

  const onResult = (r: TestResult) => {
    setResult(r);
    if (r.pass) void load(); // the server's unlock state, never one computed here
  };

  const back = (
    <p>
      <a className="back-link" href={`/ladders/${enc(ladderId)}`}>
        Back to the ladder
      </a>
    </p>
  );
  if (loadError) {
    return (
      <main className="page" role={loadError === "failed" ? "alert" : undefined}>
        <h1>{loadError === "missing" ? "Ladder not found" : "Could not load this test"}</h1>
        <p className="status-detail">
          {loadError === "missing" ? "This ladder does not exist." : "Something went wrong while loading it."}
        </p>
        {loadError === "failed" ? (
          <p>
            <a className="button" href={window.location.pathname + window.location.search}>
              Try again
            </a>
          </p>
        ) : null}
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
  const view = ladder.levels.find((l) => l.id === level);
  const lock = view?.lock ?? "locked";
  if (!result && lock === "locked") {
    return (
      <main className="page">
        <h1>Pass the previous level first</h1>
        <p className="status-detail">
          {level} opens after you pass the level before it. Each level unlocks only by passing its test.
        </p>
        {back}
      </main>
    );
  }
  const kind = testKind(level);
  return (
    <main className="page pass-test">
      {back}
      <h1 className="long-text">
        {level} {view?.title}: pass test
      </h1>
      {view ? <p className="muted long-text">{view.passTest.description}</p> : null}
      <div aria-live="polite">
        {result ? (
          <ResultView
            ladderId={ladderId}
            ladder={ladder}
            result={result}
            retake={
              branch.artifactId && !result.pass ? (
                <RetakeButton
                  artifactId={branch.artifactId}
                  onStarted={() => {
                    setResult(undefined);
                    setRetakes((n) => n + 1);
                  }}
                />
              ) : undefined
            }
          />
        ) : null}
      </div>
      {result ? null : lock === "passed" ? (
        <p className="status-detail">You already passed this level.</p>
      ) : kind === "mcq" ? (
        <>
          <McqTest ladderId={ladderId} level={level} onResult={onResult} />
          {level === "L1" ? <RunFeedback ladderId={ladderId} /> : null}
        </>
      ) : branch.artifactId ? (
        <DiffTest
          key={retakes}
          artifactId={branch.artifactId}
          onResult={onResult}
          onAnother={() => setBranch({ url: branch.url })}
        />
      ) : (
        <ArtifactTest
          ladderId={ladderId}
          level={kind === "branch" ? "L2" : "L4"}
          initialUrl={branch.url}
          onResult={onResult}
          onBranchVerified={(artifactId, url) => setBranch({ artifactId, url })}
        />
      )}
    </main>
  );
}
