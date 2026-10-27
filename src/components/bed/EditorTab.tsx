"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bbox, effectivePoints, formatFtIn, shapeArea, translateShape } from "@/lib/geometry";
import { driftForCount, newId } from "@/lib/plan";
import { plantLibrary } from "@/lib/plants";
import { buildSheet, type Sheet } from "@/lib/sheet";
import { rules, defaultSizeFor } from "@/lib/rules";
import { useEditor, type Snapshot } from "@/store/editor";
import type { Bed, Pt, Shape } from "@/lib/types";
import { SceneSvg } from "../SceneSvg";
import { useSvgPoint } from "../useSvgPoint";
import type { BedStateData } from "./BedWorkspace";
import { DriftPanel, PlantPicker } from "./DriftPanel";
import { ChecksPanel } from "./ChecksPanel";
import { MonthSlider } from "./MonthSlider";

type Tool = "select" | "outline" | "draw-outline" | "add-drift" | "draw-drift" | "zone" | "existing";

type Target = { type: "drift" | "zone"; id: string } | { type: "outline" } | { type: "existing"; id: string };

type Drag =
  | { kind: "move"; target: Target; start: Pt; orig: Snapshot; started: boolean }
  | { kind: "vertex"; target: Target; index: number; start: Pt; orig: Snapshot; started: boolean };

type DragStart = { kind: "move"; target: Target } | { kind: "vertex"; target: Target; index: number };

const TOOL_HELP: Record<Tool, string> = {
  select: "Click a drift to select it. Drag to move; drag the white handles to reshape, the small ones to add a point; double-click a handle to delete it.",
  outline: "Drag the bed outline's handles; drag a small handle to add a point; double-click a handle to delete it.",
  "draw-outline": "Click around the bed edge, then click the first point, press Enter or Finish. Backspace undoes a point, Esc cancels.",
  "add-drift": "Pick a plant, then click the plan to place a drift of about 5.",
  "draw-drift": "Pick a plant, click around the drift's shape, then click the first point, press Enter or Finish. Esc cancels.",
  zone: "Click around a zone (e.g. the shady north end), then click the first point, press Enter or Finish. Esc cancels.",
  existing: "Click where an existing plant sits to mark it keep or remove.",
};

function getShape(s: Snapshot, t: Target): Shape | null {
  if (t.type === "outline") return s.outline;
  if (t.type === "drift") return s.plan.drifts.find((d) => d.id === t.id)?.shape ?? null;
  if (t.type === "zone") return s.zones.find((z) => z.id === t.id)?.shape ?? null;
  return null;
}

function withShape(s: Snapshot, t: Target, shape: Shape): Partial<Snapshot> {
  if (t.type === "outline") return { outline: shape };
  if (t.type === "drift") return { plan: { ...s.plan, drifts: s.plan.drifts.map((d) => (d.id === t.id ? { ...d, shape } : d)) } };
  if (t.type === "zone") return { zones: s.zones.map((z) => (z.id === t.id ? { ...z, shape } : z)) };
  return {};
}

export function EditorTab({ data }: { data: BedStateData }) {
  const ed = useEditor();
  const [tool, setTool] = useState<Tool>(ed.outline.points.length < 3 ? "draw-outline" : "select");
  const [pendingPlant, setPendingPlant] = useState<string | null>(null);
  const [draft, setDraft] = useState<Pt[]>([]);
  const drawing = tool === "draw-outline" || tool === "draw-drift" || tool === "zone";
  const [hover, setHover] = useState<Pt | null>(null);
  const [opacity, setOpacity] = useState(0.6);
  const [showAerial, setShowAerial] = useState(true);
  const [showCircles, setShowCircles] = useState(false);
  const [highlight, setHighlight] = useState<string[]>([]);
  const { ref, toSvg } = useSvgPoint();
  const drag = useRef<Drag | null>(null);
  // A pointer-down on a shape is followed by a click on the canvas; don't let it clear the selection.
  const suppressClick = useRef(false);

  // Live bed: saved conditions plus the editor's geometry.
  const bed: Bed = useMemo(() => ({ ...data.bed, outline: ed.outline, zones: ed.zones, existing: ed.existing }), [data.bed, ed.outline, ed.zones, ed.existing]);

  const computeFrame = useCallback(() => {
    const pts = [...effectivePoints(useEditor.getState().outline), ...useEditor.getState().plan.drifts.flatMap((d) => d.shape.points)];
    if (pts.length < 2) return { minX: -5, minY: -5, maxX: 35, maxY: 25 };
    const b = bbox(pts);
    const pad = Math.max(4, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.12);
    const f = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
    // Keep a landscape frame so long north-south beds stay readable.
    const extra = (f.maxY - f.minY) * 1.3 - (f.maxX - f.minX);
    if (extra > 0) {
      f.minX -= extra / 2;
      f.maxX += extra / 2;
    }
    return f;
  }, []);
  const [frame, setFrame] = useState(computeFrame);
  useEffect(() => setFrame(computeFrame()), [ed.bedId, ed.baseVersionId, computeFrame]);

  const cal = data.project.calibration;
  const underlay =
    showAerial && cal && data.project.aerialUrl && data.project.aerialSize
      ? {
          href: data.project.aerialUrl,
          x: -cal.originPx.x / cal.pxPerFt - data.bed.origin.x,
          y: -cal.originPx.y / cal.pxPerFt - data.bed.origin.y,
          w: data.project.aerialSize.w / cal.pxPerFt,
          h: data.project.aerialSize.h / cal.pxPerFt,
          opacity,
        }
      : null;

  const selectedDriftId = ed.selection?.kind === "drift" ? ed.selection.id : null;
  const sheet: Sheet = useMemo(
    () =>
      buildSheet(bed, ed.plan, {
        project: data.project,
        month: ed.month,
        frame,
        underlay,
        showCircles,
        showDimensions: true,
        highlight: [...highlight, ...(selectedDriftId ? [selectedDriftId] : [])],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bed, ed.plan, ed.month, frame, underlay?.opacity, showAerial, showCircles, highlight, selectedDriftId, data.project],
  );
  const { s, ox, oy } = sheet;
  const toFt = useCallback((p: Pt): Pt => ({ x: (p.x - ox) / s, y: (p.y - oy) / s }), [s, ox, oy]);
  const toSheet = (p: Pt): Pt => ({ x: ox + p.x * s, y: oy + p.y * s });

  const finishDraft = useCallback(() => {
    if (draft.length < 3) return;
    const pts = draft;
    setDraft([]);
    if (tool === "draw-outline") {
      ed.commit(() => ({ outline: { points: pts, smooth: false } }));
      setTool("select");
      setFrame(computeFrame());
    } else if (tool === "draw-drift" && pendingPlant) {
      const plant = plantLibrary.get(pendingPlant)!;
      const id = newId("d_");
      ed.commit((cur) => ({ plan: { ...cur.plan, drifts: [...cur.plan.drifts, { id, plantId: plant.id, size: defaultSizeFor(plant), shape: { points: pts, smooth: true } }] } }));
      ed.select({ kind: "drift", id });
      setTool("select");
    } else if (tool === "zone") {
      const name = window.prompt("Zone name", `Zone ${ed.zones.length + 1}`);
      if (!name) return;
      const id = newId("z_");
      ed.commit((cur) => ({ zones: [...cur.zones, { id, name, shape: { points: pts } }] }));
      ed.select({ kind: "zone", id });
      setTool("select");
    }
  }, [draft, tool, pendingPlant, ed, computeFrame]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === "Escape") {
        setDraft([]);
        ed.select(null);
        if (drawing) setTool("select");
      }
      if (e.key === "Enter") finishDraft();
      if (e.key === "Backspace" && draft.length) {
        e.preventDefault();
        setDraft(draft.slice(0, -1));
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && ed.selection?.kind === "drift") {
        const id = ed.selection.id;
        ed.applyOps([{ op: "removeDrift", driftId: id }]);
        ed.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finishDraft, ed, draft, drawing]);

  // ---- Pointer handling ---------------------------------------------------

  const startDrag = (e: React.PointerEvent, d: DragStart) => {
    e.stopPropagation();
    suppressClick.current = true;
    ref.current?.setPointerCapture(e.pointerId);
    const s0 = useEditor.getState();
    drag.current = { ...d, start: toFt(toSvg(e)), orig: { outline: s0.outline, zones: s0.zones, existing: s0.existing, dismissedChecks: s0.dismissedChecks, plan: s0.plan }, started: false } as Drag;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toFt(toSvg(e));
    setHover(p);
    const d = drag.current;
    if (!d) return;
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (!d.started) {
      if (Math.hypot(dx, dy) * s < 3) return;
      d.started = true;
      ed.begin();
    }
    if (d.target.type === "existing") {
      const id = d.target.id;
      ed.live(() => ({ existing: d.orig.existing.map((x) => (x.id === id ? { ...x, position: { x: x.position.x + dx, y: x.position.y + dy } } : x)) }));
      return;
    }
    const shape = getShape(d.orig, d.target);
    if (!shape) return;
    const target = d.target;
    if (d.kind === "move") {
      ed.live(() => withShape(d.orig, target, translateShape(shape, dx, dy)));
    } else {
      const pts = shape.points.map((q, i) => (i === d.index ? { x: q.x + dx, y: q.y + dy } : q));
      ed.live(() => withShape(d.orig, target, { ...shape, points: pts }));
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const onCanvasClick = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const p = toFt(toSvg(e));
    if (tool === "draw-outline" || tool === "draw-drift" || tool === "zone") {
      if (tool === "draw-drift" && !pendingPlant) return;
      if (e.detail === 2) return finishDraft();
      // Clicking back on the first point closes the shape.
      if (draft.length >= 3 && Math.hypot(p.x - draft[0].x, p.y - draft[0].y) * s < handleR * 1.5) return finishDraft();
      setDraft([...draft, p]);
      return;
    }
    if (tool === "add-drift" && pendingPlant) {
      const plant = plantLibrary.get(pendingPlant)!;
      const id = newId("d_");
      ed.commit((cur) => ({
        plan: { ...cur.plan, drifts: [...cur.plan.drifts, { id, plantId: plant.id, size: defaultSizeFor(plant), shape: driftForCount(plant, p, rules.preferredDriftCount) }] },
      }));
      ed.select({ kind: "drift", id });
      setTool("select");
      return;
    }
    if (tool === "existing") {
      const name = window.prompt("What is this existing plant?", "Peony");
      if (!name) return;
      const keep = window.confirm(`Keep the ${name}? (OK = keep, Cancel = remove)`);
      const id = newId("e_");
      ed.commit((cur) => ({ existing: [...cur.existing, { id, name, position: p, radiusFt: 1.5, action: keep ? "keep" : "remove" }] }));
      ed.select({ kind: "existing", id });
      setTool("select");
      return;
    }
    if (tool === "select") ed.select(null);
  };

  const onDrift = (id: string, e: React.PointerEvent) => {
    if (tool !== "select") return;
    ed.select({ kind: "drift", id });
    startDrag(e, { kind: "move", target: { type: "drift", id } });
  };

  // Which shape gets vertex handles.
  const editTarget: Target | null =
    tool === "outline" ? { type: "outline" }
    : ed.selection?.kind === "drift" ? { type: "drift", id: ed.selection.id }
    : ed.selection?.kind === "zone" ? { type: "zone", id: ed.selection.id }
    : ed.selection?.kind === "outline" ? { type: "outline" }
    : null;
  const editShape = editTarget ? getShape(ed, editTarget) : null;
  const handleR = Math.max(4, 7 * (sheet.width / 1000));

  const deleteVertex = (t: Target, i: number) => {
    const shape = getShape(useEditor.getState(), t);
    if (!shape || shape.points.length <= 3) return;
    ed.commit((cur) => withShape(cur, t, { ...shape, points: shape.points.filter((_, j) => j !== i) }));
  };

  const insertVertex = (e: React.PointerEvent, t: Target, i: number) => {
    const shape = getShape(useEditor.getState(), t);
    if (!shape) return;
    const a = shape.points[i];
    const b = shape.points[(i + 1) % shape.points.length];
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ed.commit((cur) => withShape(cur, t, { ...shape, points: [...shape.points.slice(0, i + 1), m, ...shape.points.slice(i + 1)] }));
    startDrag(e, { kind: "vertex", target: t, index: i + 1 });
  };

  const selectedDrift = selectedDriftId ? ed.plan.drifts.find((d) => d.id === selectedDriftId) ?? null : null;
  const selectedZone = ed.selection?.kind === "zone" ? ed.zones.find((z) => z.id === (ed.selection as { id: string }).id) ?? null : null;
  const selectedExisting = ed.selection?.kind === "existing" ? ed.existing.find((x) => x.id === (ed.selection as { id: string }).id) ?? null : null;

  return (
    <div className="workspace">
      <section className="canvas-wrap">
        <div className="toolbar">
          <button className={tool === "select" ? "active" : ""} onClick={() => { setTool("select"); setDraft([]); }}>Select</button>
          <button className={tool === "outline" ? "active" : ""} onClick={() => { setTool("outline"); setDraft([]); ed.select({ kind: "outline" }); }}>Bed outline</button>
          <button className={tool === "add-drift" || tool === "draw-drift" ? "active" : ""} onClick={() => { setTool("add-drift"); setDraft([]); }}>Add drift</button>
          <button className={tool === "zone" ? "active" : ""} onClick={() => { setTool("zone"); setDraft([]); }}>Zone</button>
          <button className={tool === "existing" ? "active" : ""} onClick={() => { setTool("existing"); setDraft([]); }}>Existing plant</button>
          {draft.length >= 3 && <button className="primary" onClick={finishDraft}>Finish</button>}
          {draft.length > 0 && <button onClick={() => setDraft(draft.slice(0, -1))}>Undo point</button>}
          {drawing && <button onClick={() => { setDraft([]); setTool("select"); }}>Cancel</button>}
          <span style={{ flex: 1 }} />
          <label className="row hint"><input type="checkbox" checked={showCircles} onChange={(e) => setShowCircles(e.target.checked)} /> Spread circles</label>
          {cal && data.project.aerialUrl && (
            <label className="row hint">
              <input type="checkbox" checked={showAerial} onChange={(e) => setShowAerial(e.target.checked)} /> Aerial
              <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} style={{ width: 80 }} />
            </label>
          )}
          <button className="small" onClick={() => setFrame(computeFrame())}>Fit</button>
        </div>
        <div className="hint" style={{ padding: "6px 10px", display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span>{TOOL_HELP[tool]}</span>
          {hover && <span className="kbd">{formatFtIn(hover.x)}, {formatFtIn(hover.y)}</span>}
          <span>Outline {Math.round(shapeArea(ed.outline))} sq ft</span>
        </div>
        <SceneSvg
          sheet={sheet}
          svgRef={ref}
          onDrift={onDrift}
          onClick={onCanvasClick}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
          style={{ cursor: tool === "select" ? "default" : "crosshair" }}
        >
          {/* Existing plants are draggable in select mode. */}
          {tool === "select" &&
            ed.existing.map((x) => {
              const c = toSheet(x.position);
              return (
                <circle key={x.id} cx={c.x} cy={c.y} r={Math.max(x.radiusFt * s, 8)} fill="transparent" style={{ cursor: "move" }}
                  onPointerDown={(e) => { ed.select({ kind: "existing", id: x.id }); startDrag(e, { kind: "move", target: { type: "existing", id: x.id } }); }}
                  onClick={(e) => e.stopPropagation()} />
              );
            })}
          {editTarget && editShape && (tool === "select" || tool === "outline") && (
            <g>
              {editShape.points.map((q, i) => {
                const a = toSheet(q);
                const b = toSheet(editShape.points[(i + 1) % editShape.points.length]);
                return (
                  <circle key={`m${i}`} cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r={handleR * 0.6} fill="#e0662b" opacity={0.7} style={{ cursor: "copy" }}
                    onPointerDown={(e) => insertVertex(e, editTarget, i)} onClick={(e) => e.stopPropagation()} />
                );
              })}
              {editShape.points.map((q, i) => {
                const a = toSheet(q);
                return (
                  <circle key={`v${i}`} cx={a.x} cy={a.y} r={handleR} fill="#fff" stroke="#e0662b" strokeWidth={2} style={{ cursor: "grab" }}
                    onPointerDown={(e) => startDrag(e, { kind: "vertex", target: editTarget, index: i })}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => { e.stopPropagation(); deleteVertex(editTarget, i); }} />
                );
              })}
            </g>
          )}
          {draft.length > 0 && (
            <polyline points={[...draft, ...(hover ? [hover] : [])].map(toSheet).map((p) => `${p.x},${p.y}`).join(" ")} fill="rgba(224,102,43,0.12)" stroke="#e0662b" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />
          )}
          {draft.map((p, i) => {
            const a = toSheet(p);
            const closes = i === 0 && draft.length >= 3 && hover != null && Math.hypot(hover.x - p.x, hover.y - p.y) * s < handleR * 1.5;
            return <circle key={i} cx={a.x} cy={a.y} r={handleR * (closes ? 1.2 : 0.8)} fill={closes ? "#e0662b" : "#fff"} stroke="#e0662b" strokeWidth={2} pointerEvents="none" />;
          })}
          {tool === "add-drift" && pendingPlant && hover && (() => {
            const plant = plantLibrary.get(pendingPlant)!;
            const ghost = effectivePoints(driftForCount(plant, hover, rules.preferredDriftCount)).map(toSheet);
            return <polygon points={ghost.map((p) => `${p.x},${p.y}`).join(" ")} fill={plant.bloomColor} opacity={0.35} stroke="#e0662b" pointerEvents="none" />;
          })()}
        </SceneSvg>
        <div style={{ padding: 10, borderTop: "1px solid var(--line)" }}>
          <MonthSlider />
        </div>
      </section>

      <aside className="stack">
        {(tool === "add-drift" || tool === "draw-drift") && (
          <section className="card stack">
            <div className="row between">
              <h3 style={{ margin: 0 }}>New drift</h3>
              <div className="row">
                <button className={`small ${tool === "add-drift" ? "active" : ""}`} onClick={() => setTool("add-drift")}>Click to place</button>
                <button className={`small ${tool === "draw-drift" ? "active" : ""}`} onClick={() => { setTool("draw-drift"); setDraft([]); }}>Draw shape</button>
              </div>
            </div>
            <PlantPicker bed={bed} drift={null} selectedId={pendingPlant} onPick={(id) => setPendingPlant(id)} />
          </section>
        )}
        {selectedDrift && tool === "select" && <DriftPanel bed={bed} drift={selectedDrift} />}
        {selectedZone && (
          <section className="card stack">
            <div className="row between">
              <h3 style={{ margin: 0 }}>Zone</h3>
              <button className="small danger" onClick={() => { ed.commit((c) => ({ zones: c.zones.filter((z) => z.id !== selectedZone.id) })); ed.select(null); }}>Delete</button>
            </div>
            <label className="field"><span>Name</span>
              <input value={selectedZone.name} onChange={(e) => ed.commit((c) => ({ zones: c.zones.map((z) => (z.id === selectedZone.id ? { ...z, name: e.target.value } : z)) }))} />
            </label>
            <div className="row">
              <label className="field"><span>Sun hours</span>
                <input type="number" min={0} max={16} step={0.5} placeholder="bed" value={selectedZone.sunHours ?? ""} style={{ width: 90 }}
                  onChange={(e) => ed.commit((c) => ({ zones: c.zones.map((z) => (z.id === selectedZone.id ? { ...z, sunHours: e.target.value === "" ? null : +e.target.value } : z)) }))} />
              </label>
              <label className="field"><span>Moisture</span>
                <select value={selectedZone.moisture ?? ""} onChange={(e) => ed.commit((c) => ({ zones: c.zones.map((z) => (z.id === selectedZone.id ? { ...z, moisture: (e.target.value || null) as never } : z)) }))}>
                  <option value="">same as bed</option><option value="dry">Dry</option><option value="medium">Average</option><option value="wet">Wet</option>
                </select>
              </label>
            </div>
            <small>{Math.round(shapeArea(selectedZone.shape))} sq ft. Plants in this zone are checked against these conditions.</small>
            {ed.plan.zoneNotes[selectedZone.id] && <p className="hint">Rationale: {ed.plan.zoneNotes[selectedZone.id]}</p>}
          </section>
        )}
        {selectedExisting && (
          <section className="card stack">
            <div className="row between">
              <h3 style={{ margin: 0 }}>Existing plant</h3>
              <button className="small danger" onClick={() => { ed.commit((c) => ({ existing: c.existing.filter((x) => x.id !== selectedExisting.id) })); ed.select(null); }}>Delete</button>
            </div>
            <label className="field"><span>Name</span>
              <input value={selectedExisting.name} onChange={(e) => ed.commit((c) => ({ existing: c.existing.map((x) => (x.id === selectedExisting.id ? { ...x, name: e.target.value } : x)) }))} />
            </label>
            <div className="row">
              <button className={selectedExisting.action === "keep" ? "active" : ""} onClick={() => ed.commit((c) => ({ existing: c.existing.map((x) => (x.id === selectedExisting.id ? { ...x, action: "keep" } : x)) }))}>Keep</button>
              <button className={selectedExisting.action === "remove" ? "active" : ""} onClick={() => ed.commit((c) => ({ existing: c.existing.map((x) => (x.id === selectedExisting.id ? { ...x, action: "remove" } : x)) }))}>Remove</button>
              <label className="field"><span>Radius (ft)</span>
                <input type="number" min={0.5} step={0.5} value={selectedExisting.radiusFt} style={{ width: 80 }}
                  onChange={(e) => ed.commit((c) => ({ existing: c.existing.map((x) => (x.id === selectedExisting.id ? { ...x, radiusFt: Math.max(0.5, +e.target.value) } : x)) }))} />
              </label>
            </div>
          </section>
        )}
        {ed.selection?.kind === "outline" && (
          <section className="card stack">
            <h3>Bed outline</h3>
            <label className="row"><input type="checkbox" checked={!!ed.outline.smooth} onChange={(e) => ed.commit((c) => ({ outline: { ...c.outline, smooth: e.target.checked } }))} /> Curved edges</label>
            <small>{ed.outline.points.length} points · {Math.round(shapeArea(ed.outline))} sq ft</small>
            <button onClick={() => { setDraft([]); ed.select(null); setTool("draw-outline"); }}>Redraw outline</button>
          </section>
        )}
        <ChecksPanel bed={bed} onHighlight={setHighlight} />
        <Legend />
        {ed.zones.length > 0 && (
          <section className="card stack">
            <h3>Zones</h3>
            {ed.zones.map((z) => (
              <button key={z.id} className={`small ${selectedZone?.id === z.id ? "active" : ""}`} style={{ justifyContent: "space-between" }} onClick={() => { setTool("select"); ed.select({ kind: "zone", id: z.id }); }}>
                <span>{z.name}</span><small>{z.sunHours != null ? `${z.sunHours} h sun` : ""}</small>
              </button>
            ))}
          </section>
        )}
      </aside>
    </div>
  );
}

function Legend() {
  const ed = useEditor();
  const rows = useMemo(() => {
    const m = new Map<string, { count: number; drifts: string[] }>();
    for (const d of ed.plan.drifts) {
      const r = m.get(d.plantId) ?? { count: 0, drifts: [] };
      r.drifts.push(d.id);
      m.set(d.plantId, r);
    }
    return [...m.entries()].map(([id, r]) => ({ plant: plantLibrary.get(id)!, ...r })).filter((r) => r.plant).sort((a, b) => a.plant.code.localeCompare(b.plant.code));
  }, [ed.plan]);
  if (!rows.length) return null;
  return (
    <section className="card stack">
      <h3>Legend</h3>
      {rows.map((r) => (
        <button key={r.plant.id} className="small" style={{ justifyContent: "flex-start" }} onClick={() => ed.select({ kind: "drift", id: r.drifts[0] })}>
          <span className="swatch" style={{ background: r.plant.bloomColor }} />
          <strong>{r.plant.code}</strong> {r.plant.common}
          <small style={{ marginLeft: "auto" }}>{r.drifts.length} drift{r.drifts.length > 1 ? "s" : ""}</small>
        </button>
      ))}
    </section>
  );
}

