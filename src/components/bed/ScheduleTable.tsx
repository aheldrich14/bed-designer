"use client";

import { schedule } from "@/lib/plan";
import { MONTHS, tierOf } from "@/lib/rules";
import type { Plan } from "@/lib/types";

export function ScheduleTable({ plan, selectedPlantId, onPick }: { plan: Plan; selectedPlantId?: string | null; onPick?: (plantId: string) => void }) {
  const rows = schedule(plan);
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  if (!rows.length) return <div className="empty">No drifts yet.</div>;
  return (
    <div className="table-scroll">
      <table className="schedule">
        <thead>
          <tr>
            <th>Code</th><th>Botanical name</th><th>Common name</th><th>Size</th><th>Qty</th><th>Spacing</th><th>Height</th><th>Bloom</th><th>Tier</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.plant.id}-${r.size}`} className={selectedPlantId === r.plant.id ? "sel" : ""} onClick={() => onPick?.(r.plant.id)} style={onPick ? { cursor: "pointer" } : undefined}>
              <td><span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: r.plant.bloomColor }} /><strong>{r.plant.code}</strong></span></td>
              <td><em>{r.plant.botanical}</em></td>
              <td>{r.plant.common}</td>
              <td>{r.size === "plug" ? "Plug" : "1 gal"}</td>
              <td><strong>{r.quantity}</strong></td>
              <td>{r.plant.spacingIn}" o.c.</td>
              <td>{r.plant.heightIn}"</td>
              <td>{r.plant.bloomMonths.length ? r.plant.bloomMonths.map((m) => MONTHS[m - 1]).join(" ") : "—"}</td>
              <td>{tierOf(r.plant)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={4}><strong>Total</strong></td><td><strong>{total}</strong></td><td colSpan={4} /></tr>
        </tfoot>
      </table>
    </div>
  );
}
