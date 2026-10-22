import { describe, expect, it } from "vitest";
import {
  blob, chaikin, formatFtIn, frontVector, lateralVector, polygonArea, regionNames, shapeArea, toFrame,
  intersectionArea, differenceArea,
} from "./geometry";

const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

describe("geometry", () => {
  it("computes shoelace area regardless of winding", () => {
    expect(polygonArea(square)).toBe(100);
    expect(polygonArea([...square].reverse())).toBe(100);
  });

  it("smoothing stays inside a convex control polygon", () => {
    const a = polygonArea(chaikin(square));
    expect(a).toBeLessThan(100);
    expect(a).toBeGreaterThan(80);
  });

  it("blob hits the requested smoothed area", () => {
    expect(shapeArea(blob({ x: 5, y: 5 }, 20))).toBeCloseTo(20, 5);
  });

  it("orients a west-facing bed: front is west, left end north", () => {
    expect(frontVector("W").x).toBeCloseTo(-1);
    expect(lateralVector("W").y).toBeCloseTo(1); // left-to-right runs north to south
    expect(regionNames("W", 3)).toEqual(["north end", "middle", "south end"]);
    // The house side (east, larger x) is the back: smaller depth.
    expect(toFrame({ x: 8, y: 0 }, "W").d).toBeLessThan(toFrame({ x: 0, y: 0 }, "W").d);
  });

  it("intersects and differences polygons", () => {
    const shifted = square.map((p) => ({ x: p.x + 5, y: p.y }));
    expect(intersectionArea(square, shifted)).toBeCloseTo(50);
    expect(differenceArea(shifted, square)).toBeCloseTo(50);
  });

  it("formats feet and inches", () => {
    expect(formatFtIn(12.5)).toBe(`12' 6"`);
    expect(formatFtIn(3)).toBe(`3'`);
    expect(formatFtIn(0.5)).toBe(`6"`);
  });
});
