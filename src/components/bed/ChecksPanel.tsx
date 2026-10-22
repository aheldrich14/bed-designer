"use client";

import { useMemo } from "react";
import { runChecks } from "@/lib/checks";
import { useEditor } from "@/store/editor";
import type { Bed } from "@/lib/types";

/** Deterministic design checks, live against the current edits. */
export function ChecksPanel({ bed, onHighlight }: { bed: Bed; onHighlight: (ids: string[]) => void }) {
  const plan = useEditor((s) => s.plan);
  const applyOps = useEditor((s) => s.applyOps);
  const select = useEditor((s) => s.select);
  const issues = useMemo(() => runChecks(bed, plan), [bed, plan]);
  return (
    <section className="card stack">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Live checks</h3>
        <span className={`pill ${issues.some((i) => i.severity !== "info") ? "warn" : ""}`}>{issues.length ? `${issues.length} to look at` : "all clear"}</span>
      </div>
      {issues.length === 0 && plan.drifts.length > 0 && <small>Height order, bloom coverage, spacing and drift sizes all pass.</small>}
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
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
