import * as repo from "./db/repo";
import { HttpError, notFound } from "./http";
import { applyOps } from "./plan";
import { runChecks } from "./checks";
import { applyTemplate, getTemplate } from "./templates";
import { buildChecklist } from "./agent/missing-info";
import { getPlanner, heuristicPlanner } from "./agent";
import type { DraftResult, Planner } from "./agent/planner";
import { buildRenderPrompt } from "./render/prompt";
import { renderProvider } from "./render/gemini";
import { fileStore, extFor } from "./storage";
import type { Bed, MissingInfoItem, Plan, PlanVersion } from "./types";

// Use cases shared by the API routes.

export async function requireBed(id: string): Promise<Bed> {
  const bed = await repo.getBed(id);
  if (!bed) throw notFound("Bed");
  return bed;
}

export async function requireVersion(bedId: string, versionId?: string | null): Promise<PlanVersion> {
  const v = versionId ? await repo.getVersion(versionId) : await repo.latestVersion(bedId);
  if (!v || v.bedId !== bedId) throw notFound("Plan version");
  return v;
}

export function versionLabel(v: PlanVersion & { seq?: number }): string {
  return `Version ${v.seq ?? ""} · ${v.author} · ${new Date(v.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}`;
}

export async function bedState(bedId: string, versionId?: string | null) {
  const bed = await requireBed(bedId);
  const project = await repo.getProject(bed.projectId);
  if (!project) throw notFound("Project");
  const versions = await repo.listVersions(bedId);
  const version = versionId ? await requireVersion(bedId, versionId) : await repo.latestVersion(bedId);
  const session = await repo.getAgentSession(bedId);
  return {
    bed,
    project,
    siblings: (await repo.listBeds(project.id)).map((b) => ({ id: b.id, name: b.name })),
    versions,
    version,
    suggestions: version ? await repo.listSuggestions(version.id) : [],
    renders: version ? await repo.listRenders(version.id) : [],
    session: session ? { ...session, checklist: buildChecklist(bed, session.checklist) } : { bedId, messages: [], checklist: buildChecklist(bed) },
    planner: getPlanner().name,
    renderer: { name: renderProvider.name, available: renderProvider.available },
  };
}

export async function saveVersion(bedId: string, plan: Plan, author: PlanVersion["author"], rationale: string, parentId: string | null) {
  await requireBed(bedId);
  return repo.createVersion(bedId, plan, author, rationale, parentId);
}

export async function startFromTemplate(bedId: string, templateId: string) {
  const bed = await requireBed(bedId);
  const t = getTemplate(templateId);
  if (!t) throw notFound("Template");
  if (bed.outline.points.length < 3) throw new HttpError(400, "Draw the bed outline before applying a template.");
  const { plan, zones } = applyTemplate(t, bed);
  await repo.updateBed(bedId, { zones });
  const parent = await repo.latestVersion(bedId);
  return repo.createVersion(bedId, plan, "template", `Started from the “${t.name}” template. ${t.description}`, parent?.id ?? null);
}

export async function startBlank(bedId: string) {
  await requireBed(bedId);
  const parent = await repo.latestVersion(bedId);
  return repo.createVersion(bedId, { drifts: [], zoneNotes: {} }, "user", "Blank plan.", parent?.id ?? null);
}

/** Records free-text checklist answers (e.g. style preferences). */
export async function answerChecklist(bedId: string, answers: Record<string, { answer?: string; skip?: boolean }>) {
  const bed = await requireBed(bedId);
  const session = await repo.getAgentSession(bedId);
  const checklist: MissingInfoItem[] = buildChecklist(bed, session?.checklist).map((item) => {
    const a = answers[item.key];
    if (!a) return item;
    if (a.skip) return { ...item, status: "skipped" };
    if (a.answer?.trim()) return { ...item, status: "answered", answer: a.answer.trim() };
    return item;
  });
  const messages = session?.messages ?? [];
  return repo.saveAgentSession({ bedId, messages, checklist });
}

async function withFallback<T>(fn: (p: Planner) => Promise<T>): Promise<{ result: T; planner: string; note?: string }> {
  const planner = getPlanner();
  try {
    return { result: await fn(planner), planner: planner.name };
  } catch (e) {
    if (planner === heuristicPlanner) throw e;
    console.error("Planner failed, falling back to heuristic:", e);
    return {
      result: await fn(heuristicPlanner),
      planner: heuristicPlanner.name,
      note: `${planner.name} failed (${e instanceof Error ? e.message : "error"}); used the built-in planner instead.`,
    };
  }
}

export async function runDraft(bedId: string) {
  const bed = await requireBed(bedId);
  const project = (await repo.getProject(bed.projectId))!;
  const session = await repo.getAgentSession(bedId);
  const checklist = buildChecklist(bed, session?.checklist);
  const { result, planner, note } = await withFallback<DraftResult>((p) => p.draft({ project, bed, checklist }));
  const at = new Date().toISOString();
  const messages = [...(session?.messages ?? []), { role: "user" as const, text: "Draft a plan for this bed.", at }];
  messages.push({ role: "agent", text: note ? `${result.message}\n(${note})` : result.message, at });

  if (result.status === "needs_info") {
    await repo.saveAgentSession({ bedId, messages, checklist: result.checklist });
    return { status: result.status, planner, message: result.message, version: null };
  }
  await repo.saveAgentSession({ bedId, messages, checklist });
  await repo.updateBed(bedId, { zones: result.zones });
  const parent = await repo.latestVersion(bedId);
  const version = await repo.createVersion(bedId, result.plan, "agent", result.rationale, parent?.id ?? null);
  return { status: result.status, planner, message: result.message, version };
}

export async function runReview(bedId: string, versionId?: string | null) {
  const bed = await requireBed(bedId);
  const version = await requireVersion(bedId, versionId);
  const issues = runChecks(bed, version);
  const { result, planner, note } = await withFallback((p) => p.review({ bed, plan: version, issues }));
  const suggestions = await repo.replaceOpenSuggestions(version.id, result.suggestions);
  return { planner, message: note ? `${result.message} (${note})` : result.message, suggestions };
}

/** Applies a suggestion's diff as a new plan version; open suggestions carry over. */
export async function applySuggestion(id: string) {
  const s = await repo.getSuggestion(id);
  if (!s) throw notFound("Suggestion");
  const v = await repo.getVersion(s.planVersionId);
  if (!v) throw notFound("Plan version");
  const plan = applyOps(v, s.ops);
  const next = await repo.createVersion(v.bedId, plan, "user", `Applied suggestion: ${s.issue}`, v.id);
  await repo.setSuggestionStatus(id, "applied");
  const rest = (await repo.listSuggestions(v.id)).filter((x) => x.status === "open" && x.id !== id);
  const liveIds = new Set(plan.drifts.map((d) => d.id));
  await repo.replaceOpenSuggestions(
    next.id,
    rest
      .filter((x) => x.driftIds.every((d) => liveIds.has(d)))
      .map(({ issue, detail, source, severity, driftIds, anchor, ops }) => ({ issue, detail, source, severity, driftIds, anchor, ops })),
  );
  return next;
}

export async function renderMonth(bedId: string, versionId: string, month: number, viewpoint: "street" | "overhead", force: boolean) {
  const bed = await requireBed(bedId);
  const version = await requireVersion(bedId, versionId);
  const cached = await repo.findRender(version.id, month, viewpoint);
  if (cached?.imageUrl && !force) return cached;

  const prompt = buildRenderPrompt(bed, version, month, viewpoint);
  const project = (await repo.getProject(bed.projectId))!;
  const refUrl = viewpoint === "street" ? bed.photos.find((p) => p.isStreetView)?.url ?? bed.photos[0]?.url : project.aerialUrl;
  if (!renderProvider.available) {
    return repo.saveRender({ planVersionId: version.id, month, viewpoint, prompt, imageUrl: null, error: "Set GEMINI_API_KEY to generate renders. The prompt is shown below." });
  }
  if (viewpoint === "street" && !refUrl) {
    return repo.saveRender({ planVersionId: version.id, month, viewpoint, prompt, imageUrl: null, error: "Upload a street-level photo of the bed first." });
  }
  const ref = refUrl ? await fileStore.read(refUrl) : null;
  try {
    const out = await renderProvider.render({ prompt, reference: ref ? { data: ref.data, mimeType: ref.contentType } : null });
    const url = await fileStore.save("renders", out.data, extFor(out.mimeType));
    return repo.saveRender({ planVersionId: version.id, month, viewpoint, prompt, imageUrl: url, error: null });
  } catch (e) {
    return repo.saveRender({ planVersionId: version.id, month, viewpoint, prompt, imageUrl: null, error: e instanceof Error ? e.message : "Render failed" });
  }
}
