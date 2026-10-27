import * as repo from "./db/repo";
import { HttpError, notFound } from "./http";
import { applyOps } from "./plan";
import { runChecks } from "./checks";
import { applyTemplate, getTemplate } from "./templates";
import { buildChecklist } from "./agent/missing-info";
import { getPlanner, heuristicPlanner } from "./agent";
import type { DraftResult, EditFocus, EditResult, Planner } from "./agent/planner";
import { buildRenderPrompt } from "./render/prompt";
import { renderProvider } from "./render/gemini";
import type { RenderImage } from "./render/provider";
import { svgToPng } from "./render/raster";
import { sitePlanSheet } from "./render/site";
import { sheetToSvg } from "./export/svg";
import { fileStore, extFor } from "./storage";
import type { Bed, MissingInfoItem, Plan, PlanVersion, Project } from "./types";

// Use cases shared by the API routes.

export function requireBed(id: string): Bed {
  const bed = repo.getBed(id);
  if (!bed) throw notFound("Bed");
  return bed;
}

export function requireVersion(bedId: string, versionId?: string | null): PlanVersion {
  const v = versionId ? repo.getVersion(versionId) : repo.latestVersion(bedId);
  if (!v || v.bedId !== bedId) throw notFound("Plan version");
  return v;
}

export function versionLabel(v: PlanVersion & { seq?: number }): string {
  return `Version ${v.seq ?? ""} · ${v.author} · ${new Date(v.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}`;
}

export function bedState(bedId: string, versionId?: string | null) {
  const bed = requireBed(bedId);
  const project = repo.getProject(bed.projectId);
  if (!project) throw notFound("Project");
  const versions = repo.listVersions(bedId);
  const version = versionId ? requireVersion(bedId, versionId) : repo.latestVersion(bedId);
  const session = repo.getAgentSession(bedId);
  return {
    bed,
    project,
    siblings: repo.listBeds(project.id).map((b) => ({ id: b.id, name: b.name })),
    versions,
    version,
    suggestions: version ? repo.listSuggestions(version.id) : [],
    renders: version ? repo.listRenders(version.id) : [],
    session: session ? { ...session, checklist: buildChecklist(bed, session.checklist) } : { bedId, messages: [], checklist: buildChecklist(bed) },
    planner: getPlanner().name,
    renderer: { name: renderProvider.name, available: renderProvider.available },
  };
}

export function saveVersion(bedId: string, plan: Plan, author: PlanVersion["author"], rationale: string, parentId: string | null) {
  requireBed(bedId);
  return repo.createVersion(bedId, plan, author, rationale, parentId);
}

export function startFromTemplate(bedId: string, templateId: string) {
  const bed = requireBed(bedId);
  const t = getTemplate(templateId);
  if (!t) throw notFound("Template");
  if (bed.outline.points.length < 3) throw new HttpError(400, "Draw the bed outline before applying a template.");
  const { plan, zones } = applyTemplate(t, bed);
  repo.updateBed(bedId, { zones });
  const parent = repo.latestVersion(bedId);
  return repo.createVersion(bedId, plan, "template", `Started from the “${t.name}” template. ${t.description}`, parent?.id ?? null);
}

export function startBlank(bedId: string) {
  requireBed(bedId);
  const parent = repo.latestVersion(bedId);
  return repo.createVersion(bedId, { drifts: [], zoneNotes: {} }, "user", "Blank plan.", parent?.id ?? null);
}

/** Records free-text checklist answers (e.g. style preferences). */
export function answerChecklist(bedId: string, answers: Record<string, { answer?: string; skip?: boolean }>) {
  const bed = requireBed(bedId);
  const session = repo.getAgentSession(bedId);
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
  const bed = requireBed(bedId);
  const project = repo.getProject(bed.projectId)!;
  const session = repo.getAgentSession(bedId);
  const checklist = buildChecklist(bed, session?.checklist);
  const { result, planner, note } = await withFallback<DraftResult>((p) => p.draft({ project, bed, checklist }));
  const at = new Date().toISOString();
  const messages = [...(session?.messages ?? []), { role: "user" as const, text: "Draft a plan for this bed.", at }];
  messages.push({ role: "agent", text: note ? `${result.message}\n(${note})` : result.message, at });

  if (result.status === "needs_info") {
    repo.saveAgentSession({ bedId, messages, checklist: result.checklist });
    return { status: result.status, planner, message: result.message, version: null };
  }
  repo.saveAgentSession({ bedId, messages, checklist });
  repo.updateBed(bedId, { zones: result.zones });
  const parent = repo.latestVersion(bedId);
  const version = repo.createVersion(bedId, result.plan, "agent", result.rationale, parent?.id ?? null);
  return { status: result.status, planner, message: result.message, version };
}

/**
 * One chat turn about the plan open in the editor. The plan and bed geometry
 * come from the editor (they may be unsaved); the reply's ops are applied there.
 */
export async function chatEdit(
  bedId: string,
  input: { message: string; plan: Plan; outline?: Bed["outline"]; zones?: Bed["zones"]; existing?: Bed["existing"]; focus: EditFocus },
) {
  const saved = requireBed(bedId);
  const bed: Bed = { ...saved, outline: input.outline ?? saved.outline, zones: input.zones ?? saved.zones, existing: input.existing ?? saved.existing };
  const session = repo.getAgentSession(bedId);
  const history = session?.messages ?? [];
  const planner = getPlanner();
  let result: EditResult;
  try {
    result = await planner.edit({ bed, plan: input.plan, message: input.message, history, focus: input.focus });
  } catch (e) {
    console.error("Chat edit failed:", e);
    result = { reply: `Sorry, that didn't go through (${e instanceof Error ? e.message : "error"}). Try again, or put it another way.`, ops: [], summary: null };
  }
  const at = new Date().toISOString();
  const messages = [...history, { role: "user" as const, text: input.message, at }, { role: "agent" as const, text: result.reply, at }];
  repo.saveAgentSession({ bedId, messages, checklist: session?.checklist ?? buildChecklist(saved) });
  return { ...result, planner: planner.name, messages };
}

export async function runReview(bedId: string, versionId?: string | null) {
  const bed = requireBed(bedId);
  const version = requireVersion(bedId, versionId);
  // Checks the user dismissed stay hidden in the review too.
  const issues = runChecks(bed, version).filter((i) => !bed.dismissedChecks.includes(i.key));
  const { result, planner, note } = await withFallback((p) => p.review({ bed, plan: version, issues }));
  const suggestions = repo.replaceOpenSuggestions(version.id, result.suggestions);
  return { planner, message: note ? `${result.message} (${note})` : result.message, suggestions };
}

/** Applies a suggestion's diff as a new plan version; open suggestions carry over. */
export function applySuggestion(id: string) {
  const s = repo.getSuggestion(id);
  if (!s) throw notFound("Suggestion");
  const v = repo.getVersion(s.planVersionId);
  if (!v) throw notFound("Plan version");
  const plan = applyOps(v, s.ops);
  const next = repo.createVersion(v.bedId, plan, "user", `Applied suggestion: ${s.issue}`, v.id);
  repo.setSuggestionStatus(id, "applied");
  const rest = repo.listSuggestions(v.id).filter((x) => x.status === "open" && x.id !== id);
  const liveIds = new Set(plan.drifts.map((d) => d.id));
  repo.replaceOpenSuggestions(
    next.id,
    rest
      .filter((x) => x.driftIds.every((d) => liveIds.has(d)))
      .map(({ issue, detail, source, severity, driftIds, anchor, ops }) => ({ issue, detail, source, severity, driftIds, anchor, ops })),
  );
  return next;
}

/** PNG of the to-scale overhead site plan, with the aerial underneath when there is one. */
export async function sitePlanPng(bed: Bed, plan: Plan, project: Project, month: number | null): Promise<Buffer> {
  const aerial = project.aerialUrl ? await fileStore.read(project.aerialUrl) : null;
  const aerialHref = aerial ? `data:${aerial.contentType};base64,${aerial.data.toString("base64")}` : null;
  const sheet = sitePlanSheet(bed, plan, project, { month, aerialHref, width: 1200 });
  return svgToPng(sheetToSvg(sheet), sheet.width);
}

export async function renderMonth(bedId: string, versionId: string, month: number, viewpoint: "street" | "overhead", force: boolean) {
  const bed = requireBed(bedId);
  const version = requireVersion(bedId, versionId);
  const cached = repo.findRender(version.id, month, viewpoint);
  if (cached?.imageUrl && !force) return cached;

  const project = repo.getProject(bed.projectId)!;
  let prompt = buildRenderPrompt(bed, version, month, viewpoint, { project, sitePlan: true });
  const refUrl = viewpoint === "street" ? bed.photos.find((p) => p.isStreetView)?.url ?? bed.photos[0]?.url : project.aerialUrl;
  if (!renderProvider.available) {
    return repo.saveRender({ planVersionId: version.id, month, viewpoint, prompt, imageUrl: null, error: "Set GEMINI_API_KEY to generate renders. The prompt is shown below." });
  }
  if (viewpoint === "street" && !refUrl) {
    return repo.saveRender({ planVersionId: version.id, month, viewpoint, prompt, imageUrl: null, error: "Upload a street-level photo of the bed first." });
  }
  const ref = refUrl ? await fileStore.read(refUrl) : null;
  const images: RenderImage[] = ref ? [{ data: ref.data, mimeType: ref.contentType }] : [];
  // The to-scale overhead plan tells the model how big the bed is and how far it sits from the house and walk.
  try {
    images.push({ data: await sitePlanPng(bed, version, project, month), mimeType: "image/png" });
  } catch (e) {
    console.error("Site plan image failed; rendering without it.", e);
    prompt = buildRenderPrompt(bed, version, month, viewpoint, { project, sitePlan: false });
  }
  try {
    const out = await renderProvider.render({ prompt, images });
    const url = await fileStore.save("renders", out.data, extFor(out.mimeType));
    return repo.saveRender({ planVersionId: version.id, month, viewpoint, prompt, imageUrl: url, error: null });
  } catch (e) {
    return repo.saveRender({ planVersionId: version.id, month, viewpoint, prompt, imageUrl: null, error: e instanceof Error ? e.message : "Render failed" });
  }
}
