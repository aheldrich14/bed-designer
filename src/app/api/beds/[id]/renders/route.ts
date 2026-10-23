import { z } from "zod";
import * as repo from "@/lib/db/repo";
import { body, json, route, type Params } from "@/lib/http";
import { buildRenderPrompt } from "@/lib/render/prompt";
import { renderMonth, requireBed, requireVersion } from "@/lib/services";

type P = Params<{ id: string }>;

export const maxDuration = 300;

/** Cached renders for a version, plus a prompt preview for a month. */
export const GET = route<P>(async (req, { params }) => {
  const { id } = await params;
  const url = new URL(req.url);
  const bed = await requireBed(id);
  const version = await requireVersion(id, url.searchParams.get("version"));
  const month = Number(url.searchParams.get("month") ?? 7);
  const viewpoint = url.searchParams.get("viewpoint") === "overhead" ? "overhead" : "street";
  return json({ renders: await repo.listRenders(version.id), prompt: buildRenderPrompt(bed, version, month, viewpoint) });
});

export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const r = await body(
    req,
    z.object({
      versionId: z.string(),
      month: z.number().int().min(1).max(12),
      viewpoint: z.enum(["street", "overhead"]).default("street"),
      force: z.boolean().default(false),
    }),
  );
  return json({ render: await renderMonth(id, r.versionId, r.month, r.viewpoint, r.force) });
});
