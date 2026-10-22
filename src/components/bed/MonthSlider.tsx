"use client";

import { MONTHS, MONTH_NAMES } from "@/lib/rules";
import { useEditor } from "@/store/editor";

/** Recolors the plan by what is in bloom; "Plant colors" shows each plant's own color. */
export function MonthSlider() {
  const month = useEditor((s) => s.month);
  const setMonth = useEditor((s) => s.setMonth);
  return (
    <div className="row" style={{ gap: 10 }}>
      <button className={`small ${month == null ? "active" : ""}`} onClick={() => setMonth(null)}>Plant colors</button>
      <input
        type="range"
        min={1}
        max={12}
        step={1}
        value={month ?? 7}
        onChange={(e) => setMonth(+e.target.value)}
        style={{ flex: 1, minWidth: 160 }}
        aria-label="Bloom month"
        list="months"
      />
      <datalist id="months">{MONTHS.map((_, i) => <option key={i} value={i + 1} />)}</datalist>
      <strong style={{ width: 90 }}>{month ? MONTH_NAMES[month - 1] : "—"}</strong>
    </div>
  );
}
