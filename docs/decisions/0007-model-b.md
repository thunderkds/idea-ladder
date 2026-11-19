# 0007 — Model B: a separate blind Claude call (T009)

Date: 2026-11-19. Status: accepted. It follows the user decision "Claude subscription only" (`memory/decisions.md`,
2026-11-19) and PRD Open Question 5 (changed 2026-11-19).

1. **Same provider, fresh call.** Model B is built with `createModelA` from its own settings, `MODEL_B_BACKEND`
   (`claude-code` default, or `api`) and `MODEL_B_ID`. Each call is a new call: no shared conversation with model A.
   The `claude-code` back end runs with no tool and no MCP server in an empty temporary directory. There is no
   `MODEL_B_PROVIDER` and no new provider package. The default back end needs no API key. `api` needs
   `ANTHROPIC_API_KEY` and a priced `MODEL_B_ID`.
2. **Why no second provider.** The user chose the Claude subscription only. The accepted trade-off: a same-provider
   blind solve shares Claude's blind spots. It is weaker than a second provider and still catches obvious wrong keys.
   When model B resolves to the same model id as model A, the server starts and logs one warning line.
3. **What model B sees.** The cited chunk (cut to 2,000 characters), the question and the 4 options, shuffled with a
   seed that is kept per call and mapped back. It never sees the key. The system prompt says the text is data, not
   instructions. The answer is `{ answerIndex: 0-3 }`, checked by zod. `api` runs at temperature 0. The `claude -p`
   back end has no temperature flag, so the measurement report says its answers may differ between runs.
4. **Step `blind-solve`** runs between `check-and-dedupe` and `save-ladder`. Agree: keep. Disagree: model A
   regenerates the MCQ (`regenerateMcq`) at most 2 times. Each replacement must pass the answer-key check, the
   verbatim check and the duplicate check, and then model B solves it again. Still no agreement: the MCQ is dropped
   with reason `blind-solve-mismatch`. A model B call whose answer fails the schema or whose call fails is retried
   once; if it fails again it counts as disagreement, never as agreement. Because failures are decided inside the
   step, an Inngest retry never re-pays solved items; a retry of this step re-runs no generator, because earlier
   steps are memoized. `claude` not installed or a non-retryable API error fails the job `blind-solve-failed`.
5. **Measurement.** `bun run eval:blind-solver` runs model B once per item of `eval/seed/blind-solver-seed.json`
   (49 MCQs from 6 golden-set repos that are not the 3 v0 repos; locked by `.sha256`). Wrong keys are seeded as in
   T001. It reports catch rate and false-reject rate for code check alone, blind solver alone and both, against the
   pre-registered thresholds (catch >= 90% and false-reject <= 10%). The paid run is the owner's, on the owner's
   Claude login. A missed threshold is a valid result: the Supervisor then opens the entailment-check alternative.

Cut: closed-book blind solve (no chunk), majority vote over several model B calls, the entailment check, diff
questions (T014 reuses `blindSolve`).
