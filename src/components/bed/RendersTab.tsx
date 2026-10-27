"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { MONTHS, MONTH_NAMES } from "@/lib/rules";
import type { Render } from "@/lib/types";
import type { BedStateData } from "./BedWorkspace";

const SERIES = [5, 7, 9, 1];
const ALL = Array.from({ length: 12 }, (_, i) => i + 1);

/** Gemini renders of the bed through the year, cached per plan version and month, scrubbed with a month slider. */
export function RendersTab({ data, ensureSaved }: { data: BedStateData; ensureSaved: () => Promise<string | null> }) {
  const [renders, setRenders] = useState<Render[]>(data.renders);
  const [viewpoint, setViewpoint] = useState<"street" | "overhead">("street");
  const [month, setMonth] = useState(7);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const v = data.version;
  const hasStreet = data.bed.photos.some((p) => p.isStreetView);

  useEffect(() => setRenders(data.renders), [data.renders]);
  useEffect(() => {
    if (!v) return;
    api<{ prompt: string }>(`/api/beds/${data.bed.id}/renders?version=${v.id}&month=${month}&viewpoint=${viewpoint}`).then((r) => setPrompt(r.prompt));
  }, [data.bed.id, v, month, viewpoint]);

  const render = async (m: number, force = false) => {
    setBusy(m);
    try {
      const versionId = await ensureSaved();
      if (!versionId) return;
      const { render: r } = await api<{ render: Render }>(`/api/beds/${data.bed.id}/renders`, { method: "POST", json: { versionId, month: m, viewpoint, force } });
      setRenders((cur) => [...cur.filter((x) => !(x.month === r.month && x.viewpoint === r.viewpoint && x.planVersionId === r.planVersionId)), r]);
    } finally {
      setBusy(null);
    }
  };
  const renderAll = async (months: number[]) => {
    for (const m of months) {
      setMonth(m);
      await render(m);
    }
  };

  const forMonth = (m: number) => renders.find((r) => r.month === m && r.viewpoint === viewpoint && r.planVersionId === v?.id);
  const rendered = ALL.filter((m) => forMonth(m)?.imageUrl);
  const current = forMonth(month);
  const missing = ALL.filter((m) => !rendered.includes(m));
  const missingSeries = SERIES.filter((m) => !rendered.includes(m));

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
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className={viewpoint === "street" ? "active" : ""} onClick={() => setViewpoint("street")}>From the street photo</button>
          <button className={viewpoint === "overhead" ? "active" : ""} onClick={() => setViewpoint("overhead")}>Overhead</button>
          <span style={{ flex: 1 }} />
          {missingSeries.length > 0 && (
            <button className="primary" disabled={!v || busy != null} onClick={() => renderAll(missingSeries)}>
              Render {missingSeries.map((m) => MONTH_NAMES[m - 1]).join(", ")}
            </button>
          )}
          {missing.length > 0 && (
            <button disabled={!v || busy != null} onClick={() => renderAll(missing)} title="One image per month; each is a separate Gemini call">
              Render all {missing.length === 12 ? "12 months" : `${missing.length} remaining months`}
            </button>
          )}
        </div>
      </section>

      <section className="card stack">
        <div className="season-viewer">
          {/* Every finished render stays mounted, so dragging the slider cross-fades instantly. */}
          {rendered.map((m) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={m} src={forMonth(m)!.imageUrl!} alt={`${data.bed.name} in ${MONTH_NAMES[m - 1]}`} style={{ opacity: m === month ? 1 : 0 }} />
          ))}
          {!current?.imageUrl && (
            <div className="season-empty">
              <strong>{MONTH_NAMES[month - 1]}</strong>
              <span>{busy === month ? "Rendering… (can take a minute)" : current?.error ?? "Not rendered yet"}</span>
              {busy !== month && (
                <button className="small primary" disabled={!v || busy != null} onClick={() => render(month)}>Render {MONTH_NAMES[month - 1]}</button>
              )}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 10 }}>
          <input
            type="range"
            min={1}
            max={12}
            step={1}
            value={month}
            onChange={(e) => setMonth(+e.target.value)}
            style={{ flex: 1 }}
            aria-label="Render month"
          />
          <strong style={{ width: 90 }}>{MONTH_NAMES[month - 1]}</strong>
        </div>
        <div className="season-ticks">
          {ALL.map((m) => (
            <button key={m} className={`small ${m === month ? "active" : ""}`} onClick={() => setMonth(m)} title={rendered.includes(m) ? "Rendered" : "Not rendered yet"}>
              {MONTHS[m - 1]}
              <span className={`dot ${rendered.includes(m) ? "on" : ""}`} />
            </button>
          ))}
        </div>
        <div className="row between">
          <small>{rendered.length ? `${rendered.length} of 12 months rendered · version ${v?.seq}` : "Render a few months, then drag the slider to watch the bed change through the seasons."}</small>
          {current?.imageUrl && (
            <button className="small" disabled={!v || busy != null} onClick={() => render(month, true)}>
              {busy === month ? "Rendering…" : `Re-render ${MONTH_NAMES[month - 1]}`}
            </button>
          )}
        </div>
      </section>

      <section className="card stack">
        <h3 style={{ margin: 0 }}>Prompt for {MONTH_NAMES[month - 1]}</h3>
        <pre className="prompt">{prompt || "Create a plan to see the prompt."}</pre>
        {v && (
          <details>
            <summary className="hint">Scale reference sent with each render</summary>
            <p className="hint">A to-scale overhead plan goes to the image model with the photo, so it can match the bed's size and its distance from the house and walk.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/beds/${data.bed.id}/renders/site-plan?version=${v.id}&month=${month}`} alt="Overhead site plan sent with renders" style={{ maxWidth: "100%", borderRadius: 8 }} />
          </details>
        )}
      </section>
    </div>
  );
}
