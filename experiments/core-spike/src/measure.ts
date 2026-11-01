import { checkAnswerKey } from "./keycheck.js";

export interface Mcq {
  id: string;
  /** span: key is a literal span of the chunk; numeric: key is a number in the chunk; paraphrase: key restates the chunk */
  kind: "span" | "numeric" | "paraphrase";
  question: string;
  options: string[];
  key: string;
  chunk: string;
  source: { repo: string; path: string; sha: string };
}

interface Counts { wrongTotal: number; caught: number; correctTotal: number; falseRejects: number }
export interface Metrics extends Counts {
  catchRate: number;
  falseRejectRate: number;
  misses: Array<{ id: string; key: string }>;
  falseRejectList: Array<{ id: string; key: string }>;
  byKind: Record<string, Counts>;
}

/** Seeded wrong keys: each distractor in turn becomes the key. Correct keys: the real key. */
export function measure(items: Mcq[]): Metrics {
  const byKind: Record<string, Counts> = {};
  const misses: Metrics["misses"] = [];
  const falseRejectList: Metrics["falseRejectList"] = [];
  let wrongTotal = 0, caught = 0, correctTotal = 0, falseRejects = 0;
  for (const m of items) {
    const k = (byKind[m.kind] ??= { wrongTotal: 0, caught: 0, correctTotal: 0, falseRejects: 0 });
    correctTotal++; k.correctTotal++;
    if (!checkAnswerKey({ options: m.options, key: m.key, chunk: m.chunk }).pass) {
      falseRejects++; k.falseRejects++; falseRejectList.push({ id: m.id, key: m.key });
    }
    for (const d of m.options.filter((o) => o !== m.key)) {
      wrongTotal++; k.wrongTotal++;
      if (checkAnswerKey({ options: m.options, key: d, chunk: m.chunk }).pass) misses.push({ id: m.id, key: d });
      else { caught++; k.caught++; }
    }
  }
  return {
    wrongTotal, caught, correctTotal, falseRejects, misses, falseRejectList, byKind,
    catchRate: wrongTotal ? caught / wrongTotal : 0,
    falseRejectRate: correctTotal ? falseRejects / correctTotal : 0,
  };
}
