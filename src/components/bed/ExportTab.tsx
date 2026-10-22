"use client";

import type { BedStateData } from "./BedWorkspace";
import { useDirty } from "@/store/editor";

type Refresh = (versionId?: string | null, opts?: { keepEdits?: boolean }) => Promise<BedStateData>;

export function ExportTab({ data, refresh, ensureSaved }: { data: BedStateData; refresh: Refresh; ensureSaved: () => Promise<string | null> }) {
  const dirty = useDirty();
  const v = data.version;
  const go = async (kind: "pdf" | "csv") => {
    const id = await ensureSaved();
    if (id) window.location.href = `/api/beds/${data.bed.id}/export/${kind}?version=${id}`;
  };
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start" }}>
      <section className="card stack">
        <h2>Export</h2>
        <p className="muted">Both exports read the same plan version, so the sheet and the order always agree.</p>
        {dirty && <div className="banner">Unsaved edits will be saved as a new version first.</div>}
        <button className="primary" disabled={!v && !dirty} onClick={() => go("pdf")}>Plan sheet PDF</button>
        <small>Plan view with codes, counts, spread circles, north arrow, scale bar, title block and edge dimensions, plus the schedule.</small>
        <button disabled={!v && !dirty} onClick={() => go("csv")}>Plant list CSV (this bed)</button>
        <a className="btn" href={`/api/projects/${data.project.id}/export`}>Plant list CSV (all beds in {data.project.name})</a>
        <small>Grouped by pot size for nursery orders.</small>
      </section>
      <section className="card stack">
        <h2>Versions</h2>
        <p className="muted">Every save, template, agent draft and applied suggestion is an immutable snapshot.</p>
        <div className="list" style={{ maxHeight: 480, overflow: "auto" }}>
          {data.versions.map((x) => (
            <div key={x.id} className={`item stack ${x.id === v?.id ? "sel" : ""}`} style={{ gap: 2 }}>
              <div className="row between">
                <strong>Version {x.seq} <span className="pill info">{x.author}</span></strong>
                {x.id === v?.id ? <small>open</small> : <button className="small" onClick={() => refresh(x.id)}>Open</button>}
              </div>
              <small>{new Date(x.createdAt).toLocaleString()} · {x.driftCount} drifts</small>
              {x.rationale && <small>{x.rationale}</small>}
            </div>
          ))}
          {data.versions.length === 0 && <small>No versions yet.</small>}
        </div>
      </section>
    </div>
  );
}
