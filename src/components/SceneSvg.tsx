"use client";

import type { Prim, Sheet } from "@/lib/sheet";

/** React renderer for a plan sheet (the PDF uses the string renderer). */
export function PrimEl({ p, onDrift }: { p: Prim; onDrift?: (id: string, e: React.PointerEvent) => void }) {
  switch (p.k) {
    case "path":
      return (
        <path
          d={p.d}
          fill={p.fill ?? "none"}
          stroke={p.stroke}
          strokeWidth={p.sw}
          strokeDasharray={p.dash}
          opacity={p.opacity}
          strokeLinejoin="round"
          style={p.driftId && onDrift ? { cursor: "pointer" } : undefined}
          onPointerDown={p.driftId && onDrift ? (e) => onDrift(p.driftId!, e) : undefined}
        />
      );
    case "circle":
      return <circle cx={p.cx} cy={p.cy} r={p.r} fill={p.fill ?? "none"} stroke={p.stroke} strokeWidth={p.sw} strokeDasharray={p.dash} opacity={p.opacity} pointerEvents="none" />;
    case "line":
      return <line x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} stroke={p.stroke} strokeWidth={p.sw} strokeDasharray={p.dash} pointerEvents="none" />;
    case "rect":
      return <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={p.fill ?? "none"} stroke={p.stroke} strokeWidth={p.sw} rx={p.rx} pointerEvents="none" />;
    case "image":
      return <image href={p.href} x={p.x} y={p.y} width={p.w} height={p.h} opacity={p.opacity} preserveAspectRatio="none" pointerEvents="none" />;
    case "text":
      return (
        <text
          x={p.x}
          y={p.y}
          fontSize={p.size}
          textAnchor={p.anchor ?? "start"}
          fontWeight={p.weight}
          fontStyle={p.italic ? "italic" : undefined}
          fill={p.fill ?? "#000"}
          transform={p.rotate ? `rotate(${p.rotate} ${p.x} ${p.y})` : undefined}
          stroke={p.halo ? "#fff" : undefined}
          strokeWidth={p.halo ? 3 : undefined}
          paintOrder={p.halo ? "stroke" : undefined}
          strokeLinejoin="round"
          pointerEvents="none"
          fontFamily="Helvetica, Arial, sans-serif"
        >
          {p.text}
        </text>
      );
  }
}

export function SceneSvg({ sheet, onDrift, children, svgRef, ...rest }: {
  sheet: Sheet;
  onDrift?: (id: string, e: React.PointerEvent) => void;
  children?: React.ReactNode;
  svgRef?: React.Ref<SVGSVGElement>;
} & React.SVGProps<SVGSVGElement>) {
  return (
    <svg ref={svgRef} viewBox={`0 0 ${sheet.width} ${sheet.height}`} xmlns="http://www.w3.org/2000/svg" {...rest}>
      {sheet.prims.map((p, i) => (
        <PrimEl key={i} p={p} onDrift={onDrift} />
      ))}
      {children}
    </svg>
  );
}
