"use client";

import { useCallback, useRef } from "react";

/** Converts pointer events to the SVG's user coordinates. */
export function useSvgPoint() {
  const ref = useRef<SVGSVGElement | null>(null);
  const toSvg = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = ref.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }, []);
  return { ref, toSvg };
}
