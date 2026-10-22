"use client";

import { useEffect, useState } from "react";
import { api, upload } from "@/lib/client/api";
import type { Bed, Conditions, MissingInfoItem, Template } from "@/lib/types";
import type { BedStateData } from "./BedWorkspace";

const ORIENTATIONS: Conditions["orientation"][] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function StartTab({ data, refresh, goEdit }: {
  data: BedStateData;
  refresh: (versionId?: string | null, opts?: { keepEdits?: boolean }) => Promise<BedStateData>;
  goEdit: () => void;
}) {
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start" }}>
      <div className="stack">
        <ConditionsCard bed={data.bed} onSaved={() => refresh(undefined, { keepEdits: true })} />
        <PhotosCard bed={data.bed} onSaved={() => refresh(undefined, { keepEdits: true })} />
      </div>
      <div className="stack">
        <AgentCard data={data} refresh={refresh} goEdit={goEdit} />
        <TemplatesCard data={data} refresh={refresh} goEdit={goEdit} />
        <section className="card stack">
          <h2>Blank outline</h2>
          <p className="muted">Skip the starting points and draw every drift yourself.</p>
          <button
            onClick={async () => {
              const { version } = await api<{ version: { id: string } }>(`/api/beds/${data.bed.id}/blank`, { method: "POST" });
              await refresh(version.id);
              goEdit();
            }}
          >
            Start blank
          </button>
        </section>
      </div>
    </div>
  );
}

function ConditionsCard({ bed, onSaved }: { bed: Bed; onSaved: () => void }) {
  const [c, setC] = useState<Conditions>(bed.conditions);
  const [name, setName] = useState(bed.name);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    setC(bed.conditions);
    setName(bed.name);
  }, [bed]);
  const set = (patch: Partial<Conditions>) => {
    setC({ ...c, ...patch });
    setSaved(false);
  };
  return (
    <section className="card stack">
      <h2>Site conditions</h2>
      <label className="field">
        <span>Bed name</span>
        <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
      </label>
      <div className="row">
        <label className="field">
          <span>Faces</span>
          <select value={c.orientation} onChange={(e) => set({ orientation: e.target.value as Conditions["orientation"] })}>
            {ORIENTATIONS.map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Direct sun (h)</span>
          <input type="number" min={0} max={16} step={0.5} value={c.sunHours ?? ""} placeholder="?" style={{ width: 90 }}
            onChange={(e) => set({ sunHours: e.target.value === "" ? null : +e.target.value })} />
        </label>
        <label className="field">
          <span>Soil</span>
          <select value={c.soil ?? ""} onChange={(e) => set({ soil: (e.target.value || null) as Conditions["soil"] })}>
            <option value="">?</option><option value="sand">Sand</option><option value="loam">Loam</option><option value="clay">Clay</option>
          </select>
        </label>
        <label className="field">
          <span>Moisture</span>
          <select value={c.moisture ?? ""} onChange={(e) => set({ moisture: (e.target.value || null) as Conditions["moisture"] })}>
            <option value="">?</option><option value="dry">Dry</option><option value="medium">Average</option><option value="wet">Wet</option>
          </select>
        </label>
        <label className="field">
          <span>Tree canopy</span>
          <select value={c.canopy} onChange={(e) => set({ canopy: e.target.value as Conditions["canopy"] })}>
            <option value="none">None</option><option value="partial">Partial</option><option value="heavy">Heavy</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea rows={2} value={c.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Downspout at the north corner, salt spray from the walk…" />
      </label>
      <p className="hint">“Faces” is where you stand to look at the bed; a bed along the west wall of the house faces W. Zones can override sun and moisture in the editor.</p>
      <div className="row">
        <button className="primary" disabled={saved} onClick={async () => {
          await api(`/api/beds/${bed.id}`, { method: "PATCH", json: { conditions: c, name } });
          setSaved(true);
          onSaved();
        }}>Save conditions</button>
        {saved && <small>Saved</small>}
      </div>
    </section>
  );
}

function PhotosCard({ bed, onSaved }: { bed: Bed; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const patch = async (photos: Bed["photos"]) => {
    await api(`/api/beds/${bed.id}`, { method: "PATCH", json: { photos } });
    onSaved();
  };
  return (
    <section className="card stack">
      <h2>Photos</h2>
      <p className="muted">Street-level photos. The one marked “street view” is the viewpoint for renders.</p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        {bed.photos.map((p) => (
          <figure key={p.id} style={{ margin: 0 }} className="stack">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={p.caption} style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 6, outline: p.isStreetView ? "3px solid var(--accent)" : undefined }} />
            <div className="row">
              <button className="small" disabled={p.isStreetView} onClick={() => patch(bed.photos.map((x) => ({ ...x, isStreetView: x.id === p.id })))}>
                {p.isStreetView ? "Street view" : "Use for renders"}
              </button>
              <button className="small danger" onClick={() => patch(bed.photos.filter((x) => x.id !== p.id))}>Remove</button>
            </div>
          </figure>
        ))}
      </div>
      <label className="btn" style={{ alignSelf: "start" }}>
        {busy ? "Uploading…" : "Add photo"}
        <input type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            await upload(`/api/beds/${bed.id}/photos`, f, { caption: f.name });
            onSaved();
          } finally {
            setBusy(false);
          }
        }} />
      </label>
    </section>
  );
}

function statusPill(i: MissingInfoItem) {
  if (i.status === "answered") return <span className="pill">✓ {i.answer}</span>;
  if (i.status === "skipped") return <span className="pill info">optional</span>;
  return <span className="pill warn">needed</span>;
}

function AgentCard({ data, refresh, goEdit }: {
  data: BedStateData;
  refresh: (versionId?: string | null, opts?: { keepEdits?: boolean }) => Promise<BedStateData>;
  goEdit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const checklist = data.session.checklist;
  const missing = checklist.filter((i) => i.status === "missing");
  const freeText = new Set(["style", "soil", "existing"]);

  return (
    <section className="card stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Agent draft</h2>
        <small>{data.planner}</small>
      </div>
      <p className="muted">The agent checks what it knows, asks for anything missing, then drafts zones and drifts with a rationale per zone.</p>
      <div className="list">
        {checklist.map((i) => (
          <div key={i.key} className="item stack" style={{ gap: 4 }}>
            <div className="row between">
              <strong>{i.question}</strong>
              {statusPill(i)}
            </div>
            <small>{i.why}</small>
            {i.status !== "answered" && freeText.has(i.key) && (
              <div className="row">
                <input style={{ flex: 1 }} placeholder="Your answer" value={answers[i.key] ?? ""} onChange={(e) => setAnswers({ ...answers, [i.key]: e.target.value })} />
                <button className="small" disabled={!answers[i.key]} onClick={async () => {
                  await api(`/api/beds/${data.bed.id}/agent`, { method: "PATCH", json: { answers: { [i.key]: { answer: answers[i.key] } } } });
                  await refresh(undefined, { keepEdits: true });
                }}>Save</button>
              </div>
            )}
            {i.status === "missing" && !freeText.has(i.key) && (
              <small className="hint">Answer this in Site conditions{i.key === "outline" ? " or trace the bed on the project aerial" : ""}.</small>
            )}
          </div>
        ))}
      </div>
      {data.session.messages.length > 0 && (
        <div className="stack" style={{ maxHeight: 200, overflow: "auto" }}>
          {data.session.messages.slice(-6).map((m, i) => (
            <div key={i} className={m.role === "agent" ? "banner ok" : "hint"} style={{ whiteSpace: "pre-wrap" }}>
              {m.role === "agent" ? "Agent: " : "You: "}
              {m.text}
            </div>
          ))}
        </div>
      )}
      {result && <div className="banner">{result}</div>}
      <button className="primary" disabled={busy} onClick={async () => {
        setBusy(true);
        setResult(null);
        try {
          const r = await api<{ status: string; message: string; version: { id: string } | null }>(`/api/beds/${data.bed.id}/draft`, { method: "POST" });
          if (r.version) {
            await refresh(r.version.id);
            goEdit();
          } else {
            setResult(r.message);
            await refresh(undefined, { keepEdits: true });
          }
        } catch (e) {
          setResult(e instanceof Error ? e.message : "Draft failed");
        } finally {
          setBusy(false);
        }
      }}>
        {busy ? "Drafting… (can take a minute)" : missing.length ? `Draft (${missing.length} item${missing.length > 1 ? "s" : ""} missing)` : "Draft a plan"}
      </button>
    </section>
  );
}

function TemplatesCard({ data, refresh, goEdit }: {
  data: BedStateData;
  refresh: (versionId?: string | null) => Promise<BedStateData>;
  goEdit: () => void;
}) {
  const [list, setList] = useState<{ template: Template; fit: number | null }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ templates: { template: Template; fit: number | null }[] }>(`/api/templates?bed=${data.bed.id}`).then((r) => setList(r.templates));
  }, [data.bed.id, data.bed.conditions]);
  return (
    <section className="card stack">
      <h2>Starter templates</h2>
      <p className="muted">Proven layouts that scale to your outline. Plants are picked to suit your sun and moisture.</p>
      {error && <div className="banner err">{error}</div>}
      <div className="list">
        {list.map(({ template: t, fit }) => (
          <div key={t.id} className="item row between" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div className="row">
                <strong>{t.name}</strong>
                {fit === 2 && <span className="pill">fits your site</span>}
                {fit === 1 && <span className="pill warn">partial fit</span>}
                {fit === 0 && <span className="pill error">poor fit</span>}
              </div>
              <small>{t.description}</small>
            </div>
            <button disabled={!!busy || data.bed.outline.points.length < 3} onClick={async () => {
              setBusy(t.id);
              setError(null);
              try {
                const { version } = await api<{ version: { id: string } }>(`/api/beds/${data.bed.id}/template`, { method: "POST", json: { templateId: t.id } });
                await refresh(version.id);
                goEdit();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed");
              } finally {
                setBusy(null);
              }
            }}>{busy === t.id ? "…" : "Use"}</button>
          </div>
        ))}
      </div>
      {data.bed.outline.points.length < 3 && <small className="hint">Draw the bed outline first.</small>}
    </section>
  );
}
