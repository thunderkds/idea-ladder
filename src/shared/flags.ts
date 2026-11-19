// T016: the flag request ("This question seems wrong"). Shared by the server route and the client button.
export const FLAG_KINDS = ["card", "mcq"] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];
/** The longest optional reason, in characters. */
export const FLAG_REASON_MAX = 280;
/** POST /api/flags body. Answers: 200 { ok: true } (also on a repeat), 400 { error: "invalid-request" }, 401, 404 { error: "not-found" }. */
export type FlagRequest = { kind: FlagKind; id: string; reason?: string };
