"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/client/api";
import { buildSheet } from "@/lib/sheet";
import { useDirty } from "@/store/editor";
import { SceneSvg } from "../SceneSvg";
import type { BedStateData } from "./BedWorkspace";

type Refresh = (versionId?: string | null, opts?: { keepEdits?: boolean }) => Promise<BedStateData>;

/** On-demand design review: suggestions drawn on the plan, applied or dismissed in one tap. */
export function ReviewTab({ data, refresh, ensureSaved }: { data: BedStateData; refresh: Refresh; ensureSaved: () => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const dirty = useDirty();
  const v = data.version;
  const open = data.suggestions.filter((s) => s.status === "open");
  const closed = data.suggestions.filter((s) => s.status !== "open");
  const focused = open.find((s) => s.id === focus);

  const sheet = useMemo(
    () => (v ? buildSheet(data.bed, v, { project: data.project, suggestions: open, highlight: focused?.driftIds ?? [], width: 1000 }) : null),
    [data.bed, data.project, v, open, focused],
  );

  const run = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const versionId = await ensureSaved();
      if (!versionId) return setMessage("Create a plan first (Site & start tab).");
      const r = await api<{ message: string; planner: string }>(`/api/beds/${data.bed.id}/review`, { method: "POST", json: { versionId } });
      setMessage(`${r.message} — ${r.planner}`);
      await refresh(versionId);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: "apply" | "dismiss" | "reopen") => {
    const r = await api<{ version?: { id: string } }>(`/api/suggestions/${id}`, { method: "POST", json: { action } });
    await refresh(r.version?.id ?? v?.id);
  };

  return (
    <div className="workspace">
      <section className="canvas-wrap">
        <div className="toolbar">
          <button className="primary" onClick={run} disabled={busy}>{busy ? "Reviewing… (can take a minute)" : "Run design review"}</button>
          <small>{data.planner}</small>
          {dirty && <span className="pill warn">Unsaved edits will be saved first</span>}
        </div>
        {message && <div className="banner ok" style={{ margin: 8 }}>{message}</div>}
        {sheet ? <SceneSvg sheet={sheet} /> : <div className="empty">No plan yet.</div>}
      </section>
      <aside className="stack">
        <section className="card stack">
          <h3>Suggestions {open.length > 0 && <span className="pill warn">{open.length} open</span>}</h3>
          {data.suggestions.length === 0 && <small>Run a review to get specific fixes. The live checks in the editor feed into it; the agent adds judgment calls on top.</small>}
          <div className="list">
            {open.map((s, i) => (
              <div key={s.id} className={`item stack ${focus === s.id ? "sel" : ""}`} style={{ gap: 6 }} onMouseEnter={() => setFocus(s.id)}>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  {s.anchor && <span className="marker">{i + 1}</span>}
                  <strong style={{ flex: 1 }}>{s.issue}</strong>
                </div>
                <small>{s.detail}</small>
                <div className="row">
                  <span className={`pill ${s.source === "judgment" ? "info" : s.severity === "info" ? "info" : s.severity}`}>{s.source === "judgment" ? "agent judgment" : s.source.replace("-", " ")}</span>
                  <span style={{ flex: 1 }} />
                  {s.ops.length > 0 && <button className="small primary" onClick={() => act(s.id, "apply")}>Apply</button>}
                  <button className="small" onClick={() => act(s.id, "dismiss")}>Dismiss</button>
                </div>
              </div>
            ))}
          </div>
          {closed.length > 0 && (
            <details>
              <summary className="hint">{closed.length} applied or dismissed</summary>
              <div className="list" style={{ marginTop: 6 }}>
                {closed.map((s) => (
                  <div key={s.id} className="row between hint">
                    <span>{s.status === "applied" ? "✓" : "✕"} {s.issue}</span>
                    {s.status === "dismissed" && <button className="small" onClick={() => act(s.id, "reopen")}>Reopen</button>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      </aside>
    </div>
  );
}
