"use client";

import { useMemo, useState } from "react";
import { driftCount, newId } from "@/lib/plan";
import { plantLibrary } from "@/lib/plants";
import { MONTHS, tierOf } from "@/lib/rules";
import { rankPlants, siteAt } from "@/lib/match";
import { shapeArea, translateShape } from "@/lib/geometry";
import { useEditor } from "@/store/editor";
import type { Bed, Drift, Plant } from "@/lib/types";

function bloomRange(p: Plant) {
  if (!p.bloomMonths.length) return "no flowers";
  return `${MONTHS[p.bloomMonths[0] - 1]}–${MONTHS[p.bloomMonths[p.bloomMonths.length - 1] - 1]}`;
}

export function DriftPanel({ bed, drift }: { bed: Bed; drift: Drift }) {
  const ed = useEditor();
  const plant = plantLibrary.get(drift.plantId);
  const count = driftCount(drift, plant);
  const [target, setTarget] = useState<string>("");
  if (!plant) return null;
  return (
    <section className="card stack">
      <div className="row between">
        <div className="row">
          <span className="swatch" style={{ background: plant.bloomColor, width: 16, height: 16 }} />
          <h3 style={{ margin: 0 }}>{plant.code} · {count}</h3>
        </div>
        <button className="small danger" onClick={() => { ed.applyOps([{ op: "removeDrift", driftId: drift.id }]); ed.select(null); }}>Delete</button>
      </div>
      <div>
        <strong>{plant.common}</strong> <em className="muted">{plant.botanical}</em>
        <div className="hint">
          {plant.heightIn}" tall · {plant.spacingIn}" spacing · {tierOf(plant)} tier · blooms {bloomRange(plant)} ({plant.bloomColorName}) · {plant.sun.join("/")} sun · {plant.moisture.join("/")}
        </div>
        <div className="hint">{plant.notes}</div>
      </div>
      <div className="row">
        <span className="hint">{Math.round(shapeArea(drift.shape) * 10) / 10} sq ft</span>
        <button className="small" onClick={() => ed.applyOps([{ op: "scaleDrift", driftId: drift.id, factor: 0.85 }])}>− Smaller</button>
        <button className="small" onClick={() => ed.applyOps([{ op: "scaleDrift", driftId: drift.id, factor: 1.18 }])}>+ Larger</button>
      </div>
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        const n = Number(target);
        if (n > 0) ed.applyOps([{ op: "scaleDrift", driftId: drift.id, factor: n / count }]);
        setTarget("");
      }}>
        <input type="number" min={1} placeholder={`Resize to N plants (now ${count})`} value={target} onChange={(e) => setTarget(e.target.value)} style={{ flex: 1 }} />
        <button className="small">Resize</button>
      </form>
      <div className="row">
        <span className="hint">Size</span>
        {(["plug", "1gal"] as const).map((sz) => (
          <button key={sz} className={`small ${drift.size === sz ? "active" : ""}`} onClick={() => ed.applyOps([{ op: "setSize", driftId: drift.id, size: sz }])}>
            {sz === "plug" ? "Plug" : "1 gal"}
          </button>
        ))}
        <button className="small" onClick={() => {
          const id = newId("d_");
          ed.commit((c) => ({ plan: { ...c.plan, drifts: [...c.plan.drifts, { ...drift, id, shape: translateShape(drift.shape, 2, 2) }] } }));
          ed.select({ kind: "drift", id });
        }}>Duplicate</button>
        <button className="small" onClick={() => ed.commit((c) => ({ plan: { ...c.plan, drifts: c.plan.drifts.map((d) => (d.id === drift.id ? { ...d, shape: { ...d.shape, smooth: !d.shape.smooth } } : d)) } }))}>
          {drift.shape.smooth ? "Square corners" : "Round corners"}
        </button>
      </div>
      <h3 style={{ marginTop: 6 }}>Swap plant</h3>
      <PlantPicker bed={bed} drift={drift} selectedId={drift.plantId} onPick={(id) => ed.applyOps([{ op: "setPlant", driftId: drift.id, plantId: id }])} />
    </section>
  );
}

/** Library list filtered by the spot's sun and moisture, and optionally by tier and bloom window. */
export function PlantPicker({ bed, drift, selectedId, onPick }: { bed: Bed; drift: Drift | null; selectedId: string | null; onPick: (id: string) => void }) {
  const current = drift ? plantLibrary.get(drift.plantId) : null;
  const [sameTier, setSameTier] = useState(!!current);
  const [sameBloom, setSameBloom] = useState(false);
  const [siteOnly, setSiteOnly] = useState(true);
  const [q, setQ] = useState("");
  const site = siteAt(bed, drift);
  const list = useMemo(() => {
    const ranked = rankPlants(
      {
        sun: siteOnly ? site.sun : null,
        moisture: siteOnly ? site.moisture : null,
        tier: sameTier && current ? tierOf(current) : null,
        months: sameBloom && current ? current.bloomMonths : undefined,
      },
    );
    return ranked
      .filter((r) => !sameTier || !current || tierOf(r.plant) === tierOf(current))
      .filter((r) => !sameBloom || !current || r.plant.bloomMonths.some((m) => current.bloomMonths.includes(m)))
      .filter((r) => !q || `${r.plant.common} ${r.plant.botanical} ${r.plant.code}`.toLowerCase().includes(q.toLowerCase()));
  }, [site.sun, site.moisture, siteOnly, sameTier, sameBloom, current, q]);

  return (
    <div className="stack">
      <input placeholder="Search plants" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row hint">
        <label className="row"><input type="checkbox" checked={siteOnly} onChange={(e) => setSiteOnly(e.target.checked)} /> Suits {site.sun ?? "?"} sun / {site.moisture ?? "?"}</label>
        {current && <label className="row"><input type="checkbox" checked={sameTier} onChange={(e) => setSameTier(e.target.checked)} /> Same tier</label>}
        {current && <label className="row"><input type="checkbox" checked={sameBloom} onChange={(e) => setSameBloom(e.target.checked)} /> Same bloom window</label>}
      </div>
      <div className="list" style={{ maxHeight: 320, overflow: "auto", gap: 4 }}>
        {list.map(({ plant: p }) => (
          <button key={p.id} className={`small ${p.id === selectedId ? "active" : ""}`} style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => onPick(p.id)}>
            <span className="swatch" style={{ background: p.bloomColor }} />
            <span style={{ flex: 1 }}>
              <strong>{p.code}</strong> {p.common}
              <br />
              <small>{p.heightIn}" · {bloomRange(p)} · {p.bloomColorName}</small>
            </span>
          </button>
        ))}
        {list.length === 0 && <small className="hint">No plants match. Loosen a filter.</small>}
      </div>
    </div>
  );
}
