"use client";

import { useMemo } from "react";
import { runChecks } from "@/lib/checks";
import { useEditor } from "@/store/editor";
import type { Bed } from "@/lib/types";

/** Deterministic design checks, live against the current edits. */
export function ChecksPanel({ bed, onHighlight }: { bed: Bed; onHighlight: (ids: string[]) => void }) {
  const plan = useEditor((s) => s.plan);
  const dismissedKeys = useEditor((s) => s.dismissedChecks);
  const applyOps = useEditor((s) => s.applyOps);
  const select = useEditor((s) => s.select);
  const setDismissed = useEditor((s) => s.setDismissed);
  const all = useMemo(() => runChecks(bed, plan), [bed, plan]);
  const issues = all.filter((i) => !dismissedKeys.includes(i.key));
  const dismissed = all.filter((i) => dismissedKeys.includes(i.key));
  return (
    <section className="card stack">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Live checks</h3>
        <span className={`pill ${issues.some((i) => i.severity !== "info") ? "warn" : ""}`}>{issues.length ? `${issues.length} to look at` : "all clear"}</span>
      </div>
      {issues.length === 0 && plan.drifts.length > 0 && <small>{dismissed.length ? "Nothing else to look at." : "Height order, bloom coverage, spacing and drift sizes all pass."}</small>}
      {issues.length === 0 && plan.drifts.length === 0 && <small>Add drifts to see height, bloom and spacing checks.</small>}
      <div className="list" style={{ maxHeight: 360, overflow: "auto" }}>
        {issues.map((i) => (
          <div key={i.key} className="item stack" style={{ gap: 4 }} onMouseEnter={() => onHighlight(i.driftIds)} onMouseLeave={() => onHighlight([])}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <span className={`pill ${i.severity === "info" ? "info" : i.severity}`}>{i.source.replace("-", " ")}</span>
              <strong style={{ flex: 1 }}>{i.issue}</strong>
            </div>
            <small>{i.detail}</small>
            <div className="row">
              {i.ops.length > 0 && <button className="small primary" onClick={() => { applyOps(i.ops); onHighlight([]); }}>Fix</button>}
              {i.driftIds[0] && <button className="small" onClick={() => select({ kind: "drift", id: i.driftIds[0] })}>Select</button>}
              <span style={{ flex: 1 }} />
              <button className="small" title="Hide this check for this bed" onClick={() => { setDismissed(i.key, true); onHighlight([]); }}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
      {dismissed.length > 0 && (
        <details>
          <summary className="hint">{dismissed.length} dismissed</summary>
          <div className="list" style={{ marginTop: 6 }}>
            {dismissed.map((i) => (
              <div key={i.key} className="row between hint">
                <span>✕ {i.issue}</span>
                <button className="small" onClick={() => setDismissed(i.key, false)}>Show again</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
