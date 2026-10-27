"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, imageSize, upload } from "@/lib/client/api";
import { bbox, dist, polygonArea, formatFtIn } from "@/lib/geometry";
import { newId } from "@/lib/plan";
import type { Bed, Project, Pt, SiteFeature, SiteFeatureKind } from "@/lib/types";
import { useSvgPoint } from "./useSvgPoint";

type BedRow = Bed & { areaSqFt: number; plants: number; versionCount: number };
type Mode = "pan" | "calibrate" | "origin" | "bed" | SiteFeatureKind;

const FEATURE_STYLE: Record<SiteFeatureKind, { fill: string; stroke: string }> = {
  house: { fill: "rgba(120,110,100,0.35)", stroke: "#5f564b" },
  walk: { fill: "rgba(230,225,215,0.55)", stroke: "#8d877d" },
  driveway: { fill: "rgba(160,160,160,0.4)", stroke: "#6d6d6d" },
  tree: { fill: "rgba(90,140,80,0.25)", stroke: "#3f6b4a" },
  other: { fill: "rgba(200,180,120,0.3)", stroke: "#8a7340" },
};

const MODE_HELP: Record<Mode, string> = {
  pan: "Drag to pan, scroll to zoom.",
  calibrate: "Click both ends of something you've measured (porch, walk, garage door), then enter its length.",
  origin: "Click a fixed reference point, such as a house corner. Positions are measured from here.",
  bed: "Click around the bed edge. Close it by clicking the first point, pressing Enter or Finish. Backspace undoes a point, Esc cancels.",
  house: "Click the house corners. Close it by clicking the first point, pressing Enter or Finish. Esc cancels.",
  walk: "Click around the walk. Close it by clicking the first point, pressing Enter or Finish. Esc cancels.",
  driveway: "Click around the driveway. Close it by clicking the first point, pressing Enter or Finish. Esc cancels.",
  other: "Click around the feature. Close it by clicking the first point, pressing Enter or Finish. Esc cancels.",
  tree: "Click the trunk, then click the edge of the canopy.",
};

export function ProjectSite({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [beds, setBeds] = useState<BedRow[]>([]);
  const [mode, setMode] = useState<Mode>("pan");
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, w: 1000, h: 700 });
  const [error, setError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(1);
  const { ref, toSvg } = useSvgPoint();
  const panning = useRef<{ start: Pt; view: typeof view } | null>(null);

  const load = useCallback(async () => {
    const data = await api<{ project: Project; beds: BedRow[] }>(`/api/projects/${projectId}`);
    setProject(data.project);
    setBeds(data.beds);
    return data;
  }, [projectId]);

  useEffect(() => {
    load().then(({ project: p }) => {
      if (p.aerialSize) setView({ x: 0, y: 0, w: p.aerialSize.w, h: p.aerialSize.h });
    }).catch((e) => setError(String(e.message)));
  }, [load]);

  const cal = project?.calibration ?? null;
  const toPx = useCallback((ft: Pt): Pt => (cal ? { x: cal.originPx.x + ft.x * cal.pxPerFt, y: cal.originPx.y + ft.y * cal.pxPerFt } : ft), [cal]);
  const toFt = useCallback((px: Pt): Pt => (cal ? { x: (px.x - cal.originPx.x) / cal.pxPerFt, y: (px.y - cal.originPx.y) / cal.pxPerFt } : px), [cal]);

  const lineW = view.w / 400;

  const patchProject = async (patch: Partial<Project>) => {
    const { project: p } = await api<{ project: Project }>(`/api/projects/${projectId}`, { method: "PATCH", json: patch });
    setProject(p);
  };

  /** Leaves drawing mode so further clicks don't start a new shape. */
  const stopDrawing = useCallback(() => {
    setDraft([]);
    setHover(null);
    setMode("pan");
  }, []);

  const finish = useCallback(async (pts: Pt[]) => {
    if (!project || pts.length < 3) return;
    const ft = pts.map(toFt);
    stopDrawing();
    if (mode === "bed") {
      const name = window.prompt("Name this bed", beds.length ? `Bed ${beds.length + 1}` : "Front bed");
      if (!name) return;
      const b = bbox(ft);
      const origin = { x: Math.floor(b.minX), y: Math.floor(b.minY) };
      await api(`/api/projects/${projectId}/beds`, {
        method: "POST",
        json: { name, origin, outline: { points: ft.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y })), smooth: false } },
      });
      await load();
    } else if (mode !== "pan" && mode !== "calibrate" && mode !== "origin" && mode !== "tree") {
      const label = window.prompt("Label (optional)", mode === "house" ? "House" : "") ?? "";
      const feature: SiteFeature = { id: newId("f_"), kind: mode, label, shape: { points: ft } };
      await patchProject({ features: [...project.features, feature] });
    }
  }, [project, toFt, mode, beds.length, projectId, load, stopDrawing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "Escape" && mode !== "pan") stopDrawing();
      if (e.key === "Enter" && draft.length >= 3) finish(draft);
      if (e.key === "Backspace" && draft.length) {
        e.preventDefault();
        setDraft(draft.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, finish, mode, stopDrawing]);

  const onClick = async (e: React.MouseEvent) => {
    if (!project || mode === "pan") return;
    const p = toSvg(e);
    if (mode === "calibrate") {
      const pts = [...draft, p];
      if (pts.length < 2) return setDraft(pts);
      setDraft([]);
      const answer = window.prompt("Distance between those two points, in feet (e.g. 24 or 24.5)");
      const ft = Number(answer);
      if (!ft || ft <= 0) return;
      const pxPerFt = dist(pts[0], pts[1]) / ft;
      await patchProject({ calibration: { pxPerFt, originPx: cal?.originPx ?? pts[0] } });
      setMode("pan");
      return;
    }
    if (!cal) return setError("Calibrate the scale first.");
    if (mode === "origin") {
      await patchProject({ calibration: { ...cal, originPx: p } });
      setMode("pan");
      return;
    }
    if (mode === "tree") {
      if (!draft.length) return setDraft([p]);
      const center = toFt(draft[0]);
      const r = dist(draft[0], p) / cal.pxPerFt;
      setDraft([]);
      const label = window.prompt("Tree (optional label)", "Maple") ?? "Tree";
      await patchProject({ features: [...project.features, { id: newId("f_"), kind: "tree", label, shape: { points: [center] }, radiusFt: Math.max(1, r) }] });
      return;
    }
    if (e.detail === 2) return finish(draft);
    // Clicking back on the first point closes the shape.
    if (draft.length >= 3 && dist(p, draft[0]) < lineW * 8) return finish(draft);
    setDraft([...draft, p]);
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = toSvg(e);
    const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    setView((v) => ({ x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w: v.w * k, h: v.h * k }));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== "pan" && e.button !== 1) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    panning.current = { start: { x: e.clientX, y: e.clientY }, view };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (mode !== "pan") setHover(toSvg(e));
    const pan = panning.current;
    if (!pan || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const k = pan.view.w / rect.width;
    setView({ ...pan.view, x: pan.view.x - (e.clientX - pan.start.x) * k, y: pan.view.y - (e.clientY - pan.start.y) * k });
  };
  const onPointerUp = () => {
    panning.current = null;
  };

  const onAerial = async (file: File) => {
    const size = await imageSize(file);
    const { project: p } = await upload<{ project: Project }>(`/api/projects/${projectId}/aerial`, file, { width: String(size.w), height: String(size.h) });
    setProject(p);
    setView({ x: 0, y: 0, w: size.w, h: size.h });
    setMode("calibrate");
  };

  const draftLen = useMemo(() => {
    if (mode !== "calibrate" || !draft.length || !hover || !cal) return null;
    return dist(draft[0], hover) / cal.pxPerFt;
  }, [mode, draft, hover, cal]);

  if (!project) return <div className="page">{error ?? "Loading…"}</div>;

  return (
    <div className="workspace" style={{ padding: 16, maxWidth: 1400, margin: "0 auto" }}>
      <section className="canvas-wrap">
        <div className="toolbar">
          <label className="btn">
            {project.aerialUrl ? "Replace aerial" : "Upload aerial"}
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onAerial(e.target.files[0])} />
          </label>
          {project.aerialUrl && (
            <>
              <button className={mode === "pan" ? "active" : ""} onClick={() => { setMode("pan"); setDraft([]); }}>Pan</button>
              <button className={mode === "calibrate" ? "active" : ""} onClick={() => { setMode("calibrate"); setDraft([]); }}>Calibrate</button>
              <button className={mode === "origin" ? "active" : ""} disabled={!cal} onClick={() => setMode("origin")}>Origin</button>
              <span className="muted">Trace:</span>
              {(["bed", "house", "walk", "driveway", "tree", "other"] as const).map((m) => (
                <button key={m} className={mode === m ? "active" : ""} disabled={!cal} onClick={() => { setMode(m); setDraft([]); }}>
                  {m === "bed" ? "New bed" : m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
              {draft.length >= 3 && <button className="primary" onClick={() => finish(draft)}>Finish</button>}
              {draft.length > 0 && <button onClick={() => setDraft(draft.slice(0, -1))}>Undo point</button>}
              {mode !== "pan" && <button onClick={stopDrawing}>{draft.length ? "Cancel" : "Done"}</button>}
              <label className="row hint" style={{ marginLeft: "auto" }}>
                Aerial
                <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} />
              </label>
            </>
          )}
        </div>
        <div className="hint" style={{ padding: "6px 10px" }}>
          {project.aerialUrl ? MODE_HELP[mode] : "Upload a screenshot from Google Maps, Google Earth or the county GIS, north up."}
          {project.aerialUrl && !cal && <strong> Calibrate the scale before tracing.</strong>}
          {draftLen != null && <strong> {formatFtIn(draftLen)} at the current scale</strong>}
        </div>
        {project.aerialUrl && project.aerialSize ? (
          <svg
            ref={ref}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            style={{ aspectRatio: `${project.aerialSize.w} / ${project.aerialSize.h}`, cursor: mode === "pan" ? "grab" : "crosshair", background: "#ddd" }}
            onClick={onClick}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <image href={project.aerialUrl} x={0} y={0} width={project.aerialSize.w} height={project.aerialSize.h} opacity={opacity} />
            {project.features.map((f) => {
              const st = FEATURE_STYLE[f.kind];
              if (f.kind === "tree" && cal) {
                const c = toPx(f.shape.points[0]);
                return <circle key={f.id} cx={c.x} cy={c.y} r={(f.radiusFt ?? 10) * cal.pxPerFt} fill={st.fill} stroke={st.stroke} strokeWidth={lineW} strokeDasharray={`${lineW * 4} ${lineW * 3}`} />;
              }
              return <polygon key={f.id} points={f.shape.points.map(toPx).map((p) => `${p.x},${p.y}`).join(" ")} fill={st.fill} stroke={st.stroke} strokeWidth={lineW} />;
            })}
            {cal &&
              beds.map((b) => {
                const pts = b.outline.points.map((p) => toPx({ x: p.x + b.origin.x, y: p.y + b.origin.y }));
                if (pts.length < 3) return null;
                const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
                return (
                  <g key={b.id}>
                    <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(224,102,43,0.25)" stroke="#e0662b" strokeWidth={lineW * 1.5} />
                    <text x={c.x} y={c.y} fontSize={lineW * 14} textAnchor="middle" fill="#fff" stroke="#000" strokeWidth={lineW * 2} paintOrder="stroke">{b.name}</text>
                  </g>
                );
              })}
            {cal && (
              <g>
                <circle cx={cal.originPx.x} cy={cal.originPx.y} r={lineW * 4} fill="#e0662b" stroke="#fff" strokeWidth={lineW} />
              </g>
            )}
            {draft.length > 0 && (
              <polyline
                points={[...draft, ...(hover ? [hover] : [])].map((p) => `${p.x},${p.y}`).join(" ")}
                fill={mode === "calibrate" || mode === "tree" ? "none" : "rgba(224,102,43,0.15)"}
                stroke="#e0662b"
                strokeWidth={lineW * 1.5}
                strokeDasharray={`${lineW * 4} ${lineW * 2}`}
              />
            )}
            {draft.map((p, i) => {
              const closes = i === 0 && draft.length >= 3 && hover != null && dist(hover, p) < lineW * 8;
              return <circle key={i} cx={p.x} cy={p.y} r={lineW * (closes ? 5 : 3)} fill={closes ? "#e0662b" : "#fff"} stroke="#e0662b" strokeWidth={lineW} />;
            })}
          </svg>
        ) : (
          <div className="empty">No aerial yet. You can still create a bed by its dimensions on the right.</div>
        )}
      </section>

      <aside className="stack">
        <section className="card stack">
          <div className="row between">
            <h2 style={{ margin: 0 }}>{project.name}</h2>
            <button className="small" onClick={async () => {
              const name = window.prompt("Project name", project.name);
              if (name) await patchProject({ name });
            }}>Rename</button>
          </div>
          <small>
            {cal ? `Scale: ${cal.pxPerFt.toFixed(2)} px per ft` : "Not calibrated"}
          </small>
          {error && <div className="banner err">{error}</div>}
        </section>

        <section className="card stack">
          <h3>Beds</h3>
          {beds.length === 0 && <p className="muted">Trace a bed on the aerial, or create one by its dimensions.</p>}
          {beds.map((b) => (
            <div key={b.id} className="item row between">
              <div>
                <Link href={`/beds/${b.id}`}><strong>{b.name}</strong></Link>
                <div className="hint">
                  {Math.round(b.areaSqFt)} sq ft · faces {b.conditions.orientation} · {b.plants} plants · {b.versionCount} versions
                </div>
              </div>
              <Link className="btn small" href={`/beds/${b.id}`}>Open</Link>
            </div>
          ))}
          <QuickBed projectId={projectId} onCreated={load} />
          {beds.length > 0 && (
            <a className="btn" href={`/api/projects/${projectId}/export`}>Plant list CSV for all beds</a>
          )}
        </section>

        <section className="card stack">
          <h3>Site features</h3>
          {project.features.length === 0 && <p className="hint">Trace the house, walks, driveway and trees so they show on the plan sheet.</p>}
          {project.features.map((f) => (
            <div key={f.id} className="row between">
              <span>
                <span className="swatch" style={{ background: FEATURE_STYLE[f.kind].fill, borderColor: FEATURE_STYLE[f.kind].stroke }} />{" "}
                {f.label || f.kind}{" "}
                <small>{f.kind === "tree" ? `${Math.round(f.radiusFt ?? 0)} ft canopy` : `${Math.round(polygonArea(f.shape.points))} sq ft`}</small>
              </span>
              <button className="small danger" onClick={() => patchProject({ features: project.features.filter((x) => x.id !== f.id) })}>Remove</button>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}

function QuickBed({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Front bed");
  const [len, setLen] = useState(30);
  const [depth, setDepth] = useState(8);
  if (!open) return <button onClick={() => setOpen(true)}>New bed by dimensions</button>;
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        await api(`/api/projects/${projectId}/beds`, {
          method: "POST",
          json: { name, outline: { points: [{ x: 0, y: 0 }, { x: depth, y: 0 }, { x: depth, y: len }, { x: 0, y: len }] } },
        });
        setOpen(false);
        onCreated();
      }}
    >
      <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="row">
        <label className="field"><span>Length (ft, north–south)</span><input type="number" min={2} step={0.5} value={len} onChange={(e) => setLen(+e.target.value)} /></label>
        <label className="field"><span>Depth (ft)</span><input type="number" min={1} step={0.5} value={depth} onChange={(e) => setDepth(+e.target.value)} /></label>
      </div>
      <div className="row">
        <button className="primary">Create</button>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
