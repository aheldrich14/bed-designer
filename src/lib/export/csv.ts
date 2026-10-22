import { schedule } from "../plan";
import { MONTHS } from "../rules";
import type { Bed, Plan } from "../types";

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const SIZE_LABEL = { plug: "Plug", "1gal": "1 gal" } as const;

/**
 * Plant list for nursery orders: grouped by pot size, one row per plant with
 * quantities totalled across the given beds.
 */
export function plantListCsv(items: { bed: Bed; plan: Plan }[]): string {
  type Row = { size: "plug" | "1gal"; code: string; botanical: string; common: string; qty: number; spacing: number; height: number; bloom: string; beds: Set<string> };
  const rows = new Map<string, Row>();
  for (const { bed, plan } of items) {
    for (const r of schedule(plan)) {
      const key = `${r.size}|${r.plant.id}`;
      const row = rows.get(key) ?? {
        size: r.size, code: r.plant.code, botanical: r.plant.botanical, common: r.plant.common, qty: 0,
        spacing: r.plant.spacingIn, height: r.plant.heightIn,
        bloom: r.plant.bloomMonths.map((m) => MONTHS[m - 1]).join(" "), beds: new Set<string>(),
      };
      row.qty += r.quantity;
      row.beds.add(bed.name);
      rows.set(key, row);
    }
  }
  const lines = [["Size", "Code", "Botanical name", "Common name", "Quantity", "Spacing (in)", "Height (in)", "Bloom", "Beds"].join(",")];
  for (const size of ["plug", "1gal"] as const) {
    const group = [...rows.values()].filter((r) => r.size === size).sort((a, b) => a.botanical.localeCompare(b.botanical));
    if (!group.length) continue;
    for (const r of group) {
      lines.push([SIZE_LABEL[r.size], r.code, r.botanical, r.common, r.qty, r.spacing, r.height, r.bloom, [...r.beds].join("; ")].map(cell).join(","));
    }
    lines.push([`${SIZE_LABEL[size]} total`, "", "", "", group.reduce((s, r) => s + r.qty, 0), "", "", "", ""].map(cell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
