import type { Prim, Sheet } from "../sheet";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => (Number.isFinite(v) ? +v.toFixed(2) : 0);

function attrs(o: Record<string, string | number | undefined>): string {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}="${typeof v === "number" ? n(v) : esc(String(v))}"`)
    .join(" ");
}

export function primToSvg(p: Prim): string {
  switch (p.k) {
    case "path":
      return `<path ${attrs({ d: p.d, fill: p.fill ?? "none", stroke: p.stroke, "stroke-width": p.sw, "stroke-dasharray": p.dash, opacity: p.opacity, "stroke-linejoin": "round" })}/>`;
    case "circle":
      return `<circle ${attrs({ cx: p.cx, cy: p.cy, r: p.r, fill: p.fill ?? "none", stroke: p.stroke, "stroke-width": p.sw, "stroke-dasharray": p.dash, opacity: p.opacity })}/>`;
    case "line":
      return `<line ${attrs({ x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, stroke: p.stroke, "stroke-width": p.sw, "stroke-dasharray": p.dash })}/>`;
    case "rect":
      return `<rect ${attrs({ x: p.x, y: p.y, width: p.w, height: p.h, fill: p.fill ?? "none", stroke: p.stroke, "stroke-width": p.sw, rx: p.rx })}/>`;
    case "image":
      return `<image ${attrs({ href: p.href, x: p.x, y: p.y, width: p.w, height: p.h, opacity: p.opacity, preserveAspectRatio: "none" })}/>`;
    case "text": {
      const base = {
        x: p.x, y: p.y, "font-size": p.size, "text-anchor": p.anchor ?? "start", "font-weight": p.weight,
        "font-style": p.italic ? "italic" : undefined, "font-family": "Helvetica, Arial, sans-serif",
        transform: p.rotate ? `rotate(${n(p.rotate)} ${n(p.x)} ${n(p.y)})` : undefined,
      };
      // Halos are drawn as a separate white stroke pass so PDF renderers that ignore paint-order still get them.
      const halo = p.halo ? `<text ${attrs({ ...base, fill: "#fff", stroke: "#fff", "stroke-width": 3, "stroke-linejoin": "round" })}>${esc(p.text)}</text>` : "";
      return `${halo}<text ${attrs({ ...base, fill: p.fill ?? "#000" })}>${esc(p.text)}</text>`;
    }
  }
}

export function sheetToSvg(sheet: Sheet): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(sheet.width)}" height="${n(sheet.height)}" viewBox="0 0 ${n(sheet.width)} ${n(sheet.height)}">${sheet.prims.map(primToSvg).join("")}</svg>`;
}
