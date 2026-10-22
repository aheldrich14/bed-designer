"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { totalPlants } from "@/lib/plan";
import { shapeArea } from "@/lib/geometry";
import { snapshotKey, useDirty, useEditor } from "@/store/editor";
import type { AgentSession, Bed, PlanVersion, Project, Render, Suggestion } from "@/lib/types";
import { StartTab } from "./StartTab";
import { EditorTab } from "./EditorTab";
import { SheetTab } from "./SheetTab";
import { BloomTab } from "./BloomTab";
import { ReviewTab } from "./ReviewTab";
import { RendersTab } from "./RendersTab";
import { ExportTab } from "./ExportTab";

export type VersionRow = Omit<PlanVersion, "drifts" | "zoneNotes"> & { seq: number; driftCount: number };

export type BedStateData = {
  bed: Bed;
  project: Project;
  siblings: { id: string; name: string }[];
  versions: VersionRow[];
  version: (PlanVersion & { seq: number }) | null;
  suggestions: Suggestion[];
  renders: Render[];
  session: Pick<AgentSession, "bedId" | "messages" | "checklist">;
  planner: string;
  renderer: { name: string; available: boolean };
};

const TABS = [
  { id: "start", label: "Site & start" },
  { id: "edit", label: "Edit" },
  { id: "sheet", label: "Plan sheet" },
  { id: "bloom", label: "Bloom" },
  { id: "review", label: "Review" },
  { id: "renders", label: "Renders" },
  { id: "export", label: "Export" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function BedWorkspace({ bedId }: { bedId: string }) {
  const [data, setData] = useState<BedStateData | null>(null);
  const [tab, setTab] = useState<TabId>("edit");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = useDirty();
  const load = useEditor((s) => s.load);
  const ed = useEditor();

  const refresh = useCallback(
    async (versionId?: string | null, opts: { keepEdits?: boolean } = {}) => {
      const d = await api<BedStateData>(`/api/beds/${bedId}${versionId ? `?version=${versionId}` : ""}`);
      setData(d);
      if (!opts.keepEdits) load(d.bed, d.version ?? { drifts: [], zoneNotes: {} }, d.version?.id ?? null);
      return d;
    },
    [bedId, load],
  );

  useEffect(() => {
    refresh()
      .then((d) => {
        if (!d.version) setTab("start");
      })
      .catch((e) => setError(e.message));
    // Remember the last tab per bed.
    try {
      const t = localStorage.getItem(`tab:${bedId}`) as TabId | null;
      if (t && TABS.some((x) => x.id === t)) setTab(t);
    } catch {}
  }, [refresh, bedId]);

  useEffect(() => {
    try {
      localStorage.setItem(`tab:${bedId}`, tab);
    } catch {}
  }, [tab, bedId]);

  /** Saves bed geometry and, if the plan changed, a new immutable plan version. */
  const save = useCallback(
    async (rationale = "Edited in the plan editor.") => {
      if (!data) return null;
      setSaving(true);
      try {
        const s = useEditor.getState();
        await api(`/api/beds/${bedId}`, { method: "PATCH", json: { outline: s.outline, zones: s.zones, existing: s.existing } });
        const planChanged = !data.version || JSON.stringify(s.plan) !== JSON.stringify({ drifts: data.version.drifts, zoneNotes: data.version.zoneNotes });
        let versionId = data.version?.id ?? null;
        if (planChanged) {
          const { version } = await api<{ version: PlanVersion }>(`/api/beds/${bedId}/versions`, {
            method: "POST",
            json: { plan: s.plan, author: "user", rationale, parentId: data.version?.id ?? null },
          });
          versionId = version.id;
        }
        s.markSaved(versionId);
        await refresh(versionId, { keepEdits: true });
        return versionId;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [bedId, data, refresh],
  );

  // Keyboard: undo, redo, save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useEditor.getState().redo();
        else useEditor.getState().undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        useEditor.getState().redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  // Autosave after a quiet spell so work isn't lost.
  const key = useEditor((s) => snapshotKey(s));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save("Autosaved edits."), 20000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, dirty, save]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Tabs that act on a saved version save pending edits first. */
  const ensureSaved = useCallback(async () => (dirty ? await save() : data?.version?.id ?? null), [dirty, save, data]);

  const stats = useMemo(() => {
    const species = new Set(ed.plan.drifts.map((d) => d.plantId)).size;
    return { area: shapeArea(ed.outline), plants: totalPlants(ed.plan), species };
  }, [ed.plan, ed.outline]);

  if (error && !data) return <div className="page banner err">{error}</div>;
  if (!data) return <div className="page">Loading…</div>;

  const v = data.version;
  const viewingOld = v && data.versions[0] && v.id !== data.versions[0].id;

  return (
    <main style={{ maxWidth: 1400, margin: "0 auto", padding: "12px 16px 48px" }} className="stack">
      <div className="row between">
        <div className="stack" style={{ gap: 2 }}>
          <h1 style={{ margin: 0 }}>{data.bed.name}</h1>
          <small>
            {Math.round(stats.area)} sq ft · {stats.plants} plants · {stats.species} species · faces {data.bed.conditions.orientation}
            {v ? ` · version ${v.seq} (${v.author})` : " · no plan yet"}
          </small>
        </div>
        <div className="row">
          {viewingOld && <span className="pill warn">Viewing an older version; saving branches from it</span>}
          <button onClick={() => ed.undo()} disabled={!ed.past.length} title="Undo (Ctrl+Z)">Undo</button>
          <button onClick={() => ed.redo()} disabled={!ed.future.length} title="Redo (Ctrl+Shift+Z)">Redo</button>
          <button className={dirty ? "primary" : ""} onClick={() => save()} disabled={!dirty || saving} title="Save version (Ctrl+S)">
            {saving ? "Saving…" : dirty ? "Save version" : "Saved"}
          </button>
        </div>
      </div>
      {error && <div className="banner err" onClick={() => setError(null)}>{error}</div>}
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "review" && data.suggestions.filter((s) => s.status === "open").length > 0 && (
              <span className="pill warn" style={{ marginLeft: 6 }}>{data.suggestions.filter((s) => s.status === "open").length}</span>
            )}
          </button>
        ))}
      </nav>
      {tab === "start" && <StartTab data={data} refresh={refresh} goEdit={() => setTab("edit")} />}
      {tab === "edit" && <EditorTab data={data} />}
      {tab === "sheet" && <SheetTab data={data} />}
      {tab === "bloom" && <BloomTab data={data} />}
      {tab === "review" && <ReviewTab data={data} refresh={refresh} ensureSaved={ensureSaved} />}
      {tab === "renders" && <RendersTab data={data} ensureSaved={ensureSaved} />}
      {tab === "export" && <ExportTab data={data} refresh={refresh} ensureSaved={ensureSaved} />}
    </main>
  );
}
