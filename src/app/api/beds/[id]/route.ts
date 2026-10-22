import * as repo from "@/lib/db/repo";
import { body, json, notFound, route, type Params } from "@/lib/http";
import { BedPatchZ } from "@/lib/schemas";
import { bedState } from "@/lib/services";

type P = Params<{ id: string }>;

export const GET = route<P>(async (req, { params }) => {
  const { id } = await params;
  const versionId = new URL(req.url).searchParams.get("version");
  return json(bedState(id, versionId));
});

export const PATCH = route<P>(async (req, { params }) => {
  const { id } = await params;
  const patch = await body(req, BedPatchZ);
  const bed = repo.updateBed(id, patch);
  if (!bed) throw notFound("Bed");
  return json({ bed });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const { id } = await params;
  repo.deleteBed(id);
  return json({ ok: true });
});
