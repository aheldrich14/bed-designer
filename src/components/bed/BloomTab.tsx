"use client";

import { useMemo } from "react";
import { bedRegions, runChecks } from "@/lib/checks";
import { effectivePoints, intersectionArea } from "@/lib/geometry";
import { plantLibrary } from "@/lib/plants";
import { buildSheet } from "@/lib/sheet";
import { MONTHS, MONTH_NAMES, rules } from "@/lib/rules";
import { useEditor } from "@/store/editor";
import { SceneSvg } from "../SceneSvg";
import { MonthSlider } from "./MonthSlider";
import type { BedStateData } from "./BedWorkspace";
import type { Plant } from "@/lib/types";

export function BloomTab({ data }: { data: BedStateData }) {
  const ed = useEditor();
  const month = ed.month ?? 7;
  const bed = useMemo(() => ({ ...data.bed, outline: ed.outline, zones: ed.zones, existing: ed.existing }), [data.bed, ed.outline, ed.zones, ed.existing]);
  const sheet = useMemo(() => buildSheet(bed, ed.plan, { project: data.project, month, showDimensions: false, width: 900 }), [bed, ed.plan, month, data.project]);

  const plants = useMemo(() => {
    const ids = [...new Set(ed.plan.drifts.map((d) => d.plantId))];
    return ids
      .map((id) => plantLibrary.get(id))
      .filter((p): p is Plant => !!p)
      .sort((a, b) => (a.bloomMonths[0] ?? 13) - (b.bloomMonths[0] ?? 13) || a.code.localeCompare(b.code));
  }, [ed.plan]);

  const regions = useMemo(() => (bed.outline.points.length >= 3 ? bedRegions(bed, rules.bloomRegions) : []), [bed]);
  const regionCoverage = useMemo(
    () =>
      regions.map((r) => {
        const inside = ed.plan.drifts.filter((d) => intersectionArea(effectivePoints(d.shape), r.poly) > 0.5);
        return {
          name: r.name,
          months: MONTHS.map((_, i) => inside.filter((d) => {
            const p = plantLibrary.get(d.plantId);
            return p?.showy && p.bloomMonths.includes(i + 1);
          }).length),
        };
      }),
    [regions, ed.plan],
  );
  const warnings = useMemo(
    () => runChecks(bed, ed.plan).filter((i) => (i.source === "bloom-gap" || i.source === "height-order" || i.source === "palette") && !ed.dismissedChecks.includes(i.key)),
    [bed, ed.plan, ed.dismissedChecks],
  );
  const blooming = plants.filter((p) => p.bloomMonths.includes(month));
  const [w0, w1] = rules.bloomWindow;

  return (
    <div className="workspace">
      <div className="stack">
        <section className="canvas-wrap">
          <SceneSvg sheet={sheet} />
          <div style={{ padding: 10, borderTop: "1px solid var(--line)" }}><MonthSlider /></div>
        </section>
        <section className="card stack">
          <h2>Bloom calendar</h2>
          <div className="table-scroll">
            <table className="calendar">
              <thead>
                <tr>
                  <th />
                  {MONTHS.map((m, i) => <th key={m} className={i + 1 === month ? "now" : ""} style={{ cursor: "pointer" }} onClick={() => ed.setMonth(i + 1)}>{m}</th>)}
                </tr>
              </thead>
              <tbody>
                {plants.map((p) => (
                  <tr key={p.id}>
                    <td className="name"><strong>{p.code}</strong> <small>{p.common}</small></td>
                    {MONTHS.map((m, i) => (
                      <td key={m} className={`cell ${i + 1 === month ? "now" : ""}`}>
                        {p.bloomMonths.includes(i + 1) && <span style={{ background: p.bloomColor, opacity: p.showy ? 1 : 0.45 }} title={`${p.common}: ${p.bloomColorName}`} />}
                      </td>
                    ))}
                  </tr>
                ))}
                {regionCoverage.map((r) => (
                  <tr key={r.name}>
                    <td className="name"><em>Showy plants, {r.name}</em></td>
                    {r.months.map((n, i) => {
                      const inWindow = i + 1 >= w0 && i + 1 <= w1;
                      return (
                        <td key={i} className={i + 1 === month ? "now" : ""} style={{ color: inWindow && n === 0 ? "var(--error)" : "var(--muted)", fontWeight: inWindow && n === 0 ? 700 : 400 }}>
                          {inWindow ? (n === 0 ? "gap" : n) : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plants.length === 0 && <div className="empty">Add drifts to see the calendar.</div>}
        </section>
      </div>
      <aside className="stack">
        <section className="card stack">
          <h3>In bloom in {MONTH_NAMES[month - 1]}</h3>
          {blooming.length === 0 && <small>Nothing in flower.</small>}
          {blooming.map((p) => (
            <div key={p.id} className="row"><span className="swatch" style={{ background: p.bloomColor }} /> {p.common} <small>({p.bloomColorName})</small></div>
          ))}
        </section>
        <section className="card stack">
          <h3>Warnings</h3>
          {warnings.length === 0 && <small>No bloom gaps or height-order problems.</small>}
          {warnings.map((w) => (
            <div key={w.key} className="item stack" style={{ gap: 4 }}>
              <strong>{w.issue}</strong>
              <small>{w.detail}</small>
              {w.ops.length > 0 && <button className="small primary" style={{ alignSelf: "start" }} onClick={() => ed.applyOps(w.ops)}>Fix</button>}
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
