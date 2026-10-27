import * as repo from "@/lib/db/repo";
import { route, type Params } from "@/lib/http";
import { requireBed, requireVersion, sitePlanPng } from "@/lib/services";

type P = Params<{ id: string }>;

/** The to-scale overhead plan that goes to the image model with each render. */
export const GET = route<P>(async (req, { params }) => {
  const { id } = await params;
  const url = new URL(req.url);
  const bed = requireBed(id);
  const version = requireVersion(id, url.searchParams.get("version"));
  const month = Number(url.searchParams.get("month") ?? 7);
  const png = await sitePlanPng(bed, version, repo.getProject(bed.projectId)!, month);
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
});
