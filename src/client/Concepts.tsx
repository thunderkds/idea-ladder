// T007: /ladders/:ladderId/concepts. The learner renames, removes and adds concepts for themself. The same rules as the
// server (src/shared/concepts.ts) run before a save, but the server's 422 stays the source of truth: its message shows
// next to the named field and the learner's input is kept.
import { useEffect, useRef, useState } from "react";
import { MAX_NAME, nameLength, validateConceptNames } from "../shared/concepts.ts";
import { expireSession } from "./offline-store.ts";

type Row = { key: number; name: string; reason?: string };
type Problem = { field: string; message: string };
type Loaded = { concepts: { name: string; reason?: string }[]; fallbackToConcepts: boolean };

export function ConceptsPage({ ladderId }: { ladderId: string }) {
  const nextKey = useRef(0);
  const [rows, setRows] = useState<Row[]>();
  const [fallback, setFallback] = useState(false);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [problem, setProblem] = useState<Problem>();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const api = `/api/ladders/${encodeURIComponent(ladderId)}/concepts`;
  const back = `/ladders/${encodeURIComponent(ladderId)}`;

  useEffect(() => {
    let stopped = false;
    fetch(api)
      .then(async (res) => {
        if (res.status === 401) return expireSession();
        if (res.status === 404) return stopped ? undefined : setMissing(true);
        if (!res.ok) throw new Error(`concepts request failed: ${res.status}`);
        const body = (await res.json()) as Loaded;
        if (stopped) return;
        setFallback(body.fallbackToConcepts);
        setRows(body.concepts.map((c) => ({ key: nextKey.current++, name: c.name, reason: c.reason })));
      })
      .catch(() => {
        if (!stopped) setFailed(true);
      });
    return () => {
      stopped = true;
    };
  }, [api]);

  const edit = (next: Row[]) => {
    setRows(next);
    setProblem(undefined);
    setSaved(false);
  };

  const save = async () => {
    if (!rows) return;
    const names = rows.map((r) => r.name);
    const local = validateConceptNames(names);
    if (local) return setProblem(local);
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(api, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concepts: names.map((name) => ({ name })) }),
      });
      if (res.status === 401) return expireSession();
      if (res.status === 404) return setMissing(true);
      if (res.status === 422) return setProblem((await res.json()) as Problem);
      if (!res.ok) throw new Error(String(res.status));
      setProblem(undefined);
      setSaved(true);
    } catch {
      setProblem({ field: "concepts", message: "Could not save. Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  };

  if (missing) {
    return (
      <main className="page">
        <h1>Concepts not found</h1>
        <p className="status-detail">This ladder has no concepts to edit.</p>
        <p>
          <a className="back-link" href="/ladders">
            Back to My ladders
          </a>
        </p>
      </main>
    );
  }
  if (failed) {
    return (
      <main className="page" role="alert">
        <h1>Could not load the concepts</h1>
        <p className="status-detail">Something went wrong while loading them.</p>
        <p>
          <a className="back-link" href={`${back}/concepts`}>
            Try again
          </a>
        </p>
      </main>
    );
  }
  if (!rows) {
    return (
      <main className="page" aria-busy="true">
        <h1>Loading</h1>
      </main>
    );
  }

  const fieldError = (field: string) => (problem?.field === field ? problem.message : undefined);
  const rowError = (i: number) => fieldError(`concepts[${i}].name`) ?? fieldError(`concepts[${i}].slug`);
  const listError = fieldError("concepts");

  return (
    <main className="page concepts-page">
      <p>
        <a className="back-link" href={back}>
          Back to the ladder
        </a>
      </p>
      <h1>Edit concepts</h1>
      <p className="status-detail">Your list is yours. Other learners keep the shared one. Use 3 to 6 concepts.</p>
      {fallback ? (
        <p className="banner" role="note">
          Low confidence: this ladder uses concepts only
        </p>
      ) : null}
      {listError ? (
        <p id="concepts-error" className="field-error" role="alert">
          {listError}
        </p>
      ) : null}
      <ul className="concept-list" aria-describedby={listError ? "concepts-error" : undefined}>
        {rows.map((row, i) => {
          const error = rowError(i);
          return (
            <li key={row.key} className="concept-row">
              <label className="concept-label" htmlFor={`concept-${row.key}`}>
                Concept {i + 1}
              </label>
              <div className="concept-edit">
                <input
                  id={`concept-${row.key}`}
                  className="text-input"
                  type="text"
                  value={row.name}
                  aria-invalid={error ? "true" : undefined}
                  aria-describedby={error ? `concept-error-${row.key}` : undefined}
                  onChange={(e) => edit(rows.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)))}
                />
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => edit(rows.filter((r) => r.key !== row.key))}
                >
                  Remove<span className="visually-hidden"> concept {row.name || i + 1}</span>
                </button>
              </div>
              <p className="muted concept-count">
                {nameLength(row.name)} of {MAX_NAME} characters
              </p>
              {error ? (
                <p id={`concept-error-${row.key}`} className="field-error" role="alert">
                  {error}
                </p>
              ) : null}
              {row.reason ? <p className="concept-reason long-text">{row.reason}</p> : null}
            </li>
          );
        })}
      </ul>
      <button
        className="button button-quiet"
        type="button"
        onClick={() => edit([...rows, { key: nextKey.current++, name: "" }])}
      >
        Add concept
      </button>
      <div className="save-bar">
        <button className="button" type="button" disabled={saving} onClick={() => void save()}>
          Save concepts
        </button>
        <p className="muted save-status" role="status">
          {saved ? "Concepts saved." : ""}
        </p>
      </div>
    </main>
  );
}
