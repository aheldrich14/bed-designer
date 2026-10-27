"use client";

import { create } from "zustand";
import { applyOps } from "@/lib/plan";
import type { Bed, ExistingPlant, Plan, PlanOp, Shape, Zone } from "@/lib/types";

/** Everything the editor can change; undo and redo swap whole snapshots. */
export type Snapshot = {
  outline: Shape;
  zones: Zone[];
  existing: ExistingPlant[];
  /** Live-check keys the user has hidden. */
  dismissedChecks: string[];
  plan: Plan;
};

export type Selection =
  | { kind: "drift"; id: string }
  | { kind: "zone"; id: string }
  | { kind: "existing"; id: string }
  | { kind: "outline" }
  | null;

type EditorState = Snapshot & {
  bedId: string | null;
  baseVersionId: string | null;
  savedKey: string;
  past: Snapshot[];
  future: Snapshot[];
  selection: Selection;
  month: number | null;
  load: (bed: Bed, plan: Plan, versionId: string | null) => void;
  /** Records an undo step, then applies the change. */
  commit: (fn: (s: Snapshot) => Partial<Snapshot>) => void;
  /** Starts a drag: one undo step for the whole gesture. */
  begin: () => void;
  /** Applies a change without recording an undo step (during a drag). */
  live: (fn: (s: Snapshot) => Partial<Snapshot>) => void;
  applyOps: (ops: PlanOp[]) => void;
  undo: () => void;
  redo: () => void;
  select: (s: Selection) => void;
  setMonth: (m: number | null) => void;
  markSaved: (versionId: string | null) => void;
  /** Hides a live check, or shows it again. */
  setDismissed: (key: string, dismissed: boolean) => void;
};

const snap = (s: Snapshot): Snapshot => ({ outline: s.outline, zones: s.zones, existing: s.existing, dismissedChecks: s.dismissedChecks, plan: s.plan });
export const snapshotKey = (s: Snapshot) => JSON.stringify(snap(s));

const LIMIT = 200;

export const useEditor = create<EditorState>((set, get) => ({
  bedId: null,
  baseVersionId: null,
  savedKey: "",
  outline: { points: [] },
  zones: [],
  existing: [],
  dismissedChecks: [],
  plan: { drifts: [], zoneNotes: {} },
  past: [],
  future: [],
  selection: null,
  month: null,

  load: (bed, plan, versionId) => {
    const s: Snapshot = { outline: bed.outline, zones: bed.zones, existing: bed.existing, dismissedChecks: bed.dismissedChecks ?? [], plan: { drifts: plan.drifts, zoneNotes: plan.zoneNotes ?? {} } };
    set({ ...s, bedId: bed.id, baseVersionId: versionId, savedKey: snapshotKey(s), past: [], future: [], selection: null });
  },
  commit: (fn) => {
    const cur = snap(get());
    set({ ...fn(cur), past: [...get().past, cur].slice(-LIMIT), future: [] });
  },
  begin: () => {
    const cur = snap(get());
    set({ past: [...get().past, cur].slice(-LIMIT), future: [] });
  },
  live: (fn) => set(fn(snap(get()))),
  applyOps: (ops) => get().commit((s) => ({ plan: applyOps(s.plan, ops) })),
  undo: () => {
    const { past, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ ...prev, past: past.slice(0, -1), future: [snap(get()), ...future] });
  },
  redo: () => {
    const { past, future } = get();
    if (!future.length) return;
    const next = future[0];
    set({ ...next, past: [...past, snap(get())], future: future.slice(1) });
  },
  select: (selection) => set({ selection }),
  setMonth: (month) => set({ month }),
  markSaved: (versionId) => set({ baseVersionId: versionId, savedKey: snapshotKey(snap(get())) }),
  setDismissed: (key, dismissed) =>
    get().commit((s) => ({ dismissedChecks: dismissed ? [...new Set([...s.dismissedChecks, key])] : s.dismissedChecks.filter((k) => k !== key) })),
}));

export function useDirty(): boolean {
  return useEditor((s) => snapshotKey(s) !== s.savedKey);
}
