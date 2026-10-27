"use client";

import { useMemo, useState } from "react";
import { buildSheet } from "@/lib/sheet";
import { useEditor } from "@/store/editor";
import { SceneSvg } from "../SceneSvg";
import { QuantitySummary, ScheduleTable } from "./ScheduleTable";
import { MonthSlider } from "./MonthSlider";
import type { BedStateData } from "./BedWorkspace";

/** Installer-grade plan view of the current edits: drifts with codes and counts, schedule, callouts. */
export function SheetTab({ data }: { data: BedStateData }) {
  const ed = useEditor();
  const [circles, setCircles] = useState(true);
  const [dims, setDims] = useState(true);
  const [site, setSite] = useState(true);
  const bed = useMemo(() => ({ ...data.bed, outline: ed.outline, zones: ed.zones, existing: ed.existing }), [data.bed, ed.outline, ed.zones, ed.existing]);
  const v = data.version;
  const sheet = useMemo(
    () =>
      buildSheet(bed, ed.plan, {
        project: data.project,
        month: ed.month,
        titleBlock: true,
        showCircles: circles,
        showDimensions: dims,
        showSite: site,
        versionLabel: v ? `Version ${v.seq} · ${new Date(v.createdAt).toLocaleDateString()}` : "Unsaved",
        width: 1200,
      }),
    [bed, ed.plan, ed.month, data.project, circles, dims, site, v],
  );
  const notes = Object.entries(ed.plan.zoneNotes ?? {}).map(([id, note]) => ({ name: ed.zones.find((z) => z.id === id)?.name ?? "Zone", note }));
  return (
    <div className="stack">
      <section className="canvas-wrap">
        <div className="toolbar">
          <label className="row"><input type="checkbox" checked={circles} onChange={(e) => setCircles(e.target.checked)} /> Circles at mature spread</label>
          <label className="row"><input type="checkbox" checked={dims} onChange={(e) => setDims(e.target.checked)} /> Edge dimensions</label>
          <label className="row"><input type="checkbox" checked={site} onChange={(e) => setSite(e.target.checked)} /> House, walks and trees</label>
          <span style={{ flex: 1 }} />
          {v && <a className="btn" href={`/api/beds/${data.bed.id}/export/pdf?version=${v.id}`}>Download PDF</a>}
        </div>
        <SceneSvg sheet={sheet} />
        <div style={{ padding: 10, borderTop: "1px solid var(--line)" }}><MonthSlider /></div>
      </section>
      <section className="card stack">
        <h2>Plant schedule</h2>
        <QuantitySummary bed={bed} plan={ed.plan} />
        <ScheduleTable plan={ed.plan} />
      </section>
      {(v?.rationale || notes.length > 0 || bed.existing.length > 0) && (
        <section className="card stack">
          <h2>Notes</h2>
          {v?.rationale && <p>{v.rationale}</p>}
          {notes.map((n, i) => <p key={i}><strong>{n.name}:</strong> {n.note}</p>)}
          {bed.existing.map((e) => (
            <p key={e.id}>
              <span className={`pill ${e.action === "keep" ? "" : "error"}`}>{e.action === "keep" ? "To remain" : "To remove"}</span> {e.name}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
