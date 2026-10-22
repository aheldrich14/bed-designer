"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { MONTH_NAMES } from "@/lib/rules";
import type { Render } from "@/lib/types";
import type { BedStateData } from "./BedWorkspace";

const SERIES = [5, 7, 9, 1];

/** Gemini renders of the bed through the year, cached per plan version and month. */
export function RendersTab({ data, ensureSaved }: { data: BedStateData; ensureSaved: () => Promise<string | null> }) {
  const [renders, setRenders] = useState<Render[]>(data.renders);
  const [viewpoint, setViewpoint] = useState<"street" | "overhead">("street");
  const [previewMonth, setPreviewMonth] = useState(7);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const v = data.version;
  const hasStreet = data.bed.photos.some((p) => p.isStreetView);

  useEffect(() => setRenders(data.renders), [data.renders]);
  useEffect(() => {
    if (!v) return;
    api<{ prompt: string }>(`/api/beds/${data.bed.id}/renders?version=${v.id}&month=${previewMonth}&viewpoint=${viewpoint}`).then((r) => setPrompt(r.prompt));
  }, [data.bed.id, v, previewMonth, viewpoint]);

  const render = async (month: number, force = false) => {
    setBusy(month);
    try {
      const versionId = await ensureSaved();
      if (!versionId) return;
      const { render: r } = await api<{ render: Render }>(`/api/beds/${data.bed.id}/renders`, { method: "POST", json: { versionId, month, viewpoint, force } });
      setRenders((cur) => [...cur.filter((x) => !(x.month === r.month && x.viewpoint === r.viewpoint && x.planVersionId === r.planVersionId)), r]);
    } finally {
      setBusy(null);
    }
  };

  const shown = (m: number) => renders.find((r) => r.month === m && r.viewpoint === viewpoint && r.planVersionId === v?.id);

  return (
    <div className="stack">
      <section className="card stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Renders through the year</h2>
          <small>{data.renderer.name}{data.renderer.available ? "" : " — not configured"}</small>
        </div>
        <p className="muted">Illustrative, not botanically exact. Each render is built from the current plan version and cached for that version and month.</p>
        {!data.renderer.available && <div className="banner">Set <code>GEMINI_API_KEY</code> in <code>.env.local</code> to generate images. You can still read the prompt each render would use.</div>}
        {viewpoint === "street" && !hasStreet && <div className="banner">Upload a street-level photo in Site & start to set the viewpoint.</div>}
        <div className="row">
          <button className={viewpoint === "street" ? "active" : ""} onClick={() => setViewpoint("street")}>From the street photo</button>
          <button className={viewpoint === "overhead" ? "active" : ""} onClick={() => setViewpoint("overhead")}>Overhead</button>
          <span style={{ flex: 1 }} />
          <button className="primary" disabled={!v || busy != null} onClick={async () => { for (const m of SERIES) await render(m); }}>
            Render May, July, September, January
          </button>
        </div>
      </section>
      <div className="renders">
        {SERIES.map((m) => {
          const r = shown(m);
          return (
            <figure key={m} className="card stack" style={{ padding: 10 }}>
              <div className="row between">
                <strong>{MONTH_NAMES[m - 1]}</strong>
                <button className="small" disabled={!v || busy != null} onClick={() => render(m, !!r?.imageUrl)}>
                  {busy === m ? "Rendering…" : r?.imageUrl ? "Re-render" : "Render"}
                </button>
              </div>
              {r?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.imageUrl} alt={`${data.bed.name} in ${MONTH_NAMES[m - 1]}`} />
              ) : (
                <div className="empty" style={{ aspectRatio: "4/3", background: "#f2efe7", borderRadius: 8 }}>{r?.error ?? "Not rendered yet"}</div>
              )}
              <figcaption>Illustrative render · version {v?.seq}</figcaption>
            </figure>
          );
        })}
      </div>
      <section className="card stack">
        <div className="row">
          <h3 style={{ margin: 0 }}>Prompt preview</h3>
          <select value={previewMonth} onChange={(e) => setPreviewMonth(+e.target.value)}>
            {MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
          {!SERIES.includes(previewMonth) && <button className="small" disabled={!v || busy != null} onClick={() => render(previewMonth)}>Render {MONTH_NAMES[previewMonth - 1]}</button>}
        </div>
        <pre className="prompt">{prompt || "Create a plan to see the prompt."}</pre>
        {renders.filter((r) => !SERIES.includes(r.month) && r.viewpoint === viewpoint && r.imageUrl).map((r) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={r.id} src={r.imageUrl!} alt={MONTH_NAMES[r.month - 1]} style={{ maxWidth: 480, borderRadius: 8 }} />
        ))}
      </section>
    </div>
  );
}
