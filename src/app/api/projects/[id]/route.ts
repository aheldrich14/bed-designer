import * as repo from "@/lib/db/repo";
import { body, json, notFound, route, type Params } from "@/lib/http";
import { ProjectPatchZ } from "@/lib/schemas";
import { totalPlants } from "@/lib/plan";
import { shapeArea } from "@/lib/geometry";

type P = Params<{ id: string }>;

export const GET = route<P>(async (_req, { params }) => {
  const { id } = await params;
  const project = await repo.getProject(id);
  if (!project) throw notFound("Project");
  const beds = await Promise.all(
    (await repo.listBeds(id)).map(async (bed) => {
      const v = await repo.latestVersion(bed.id);
      return { ...bed, areaSqFt: shapeArea(bed.outline), plants: v ? totalPlants(v) : 0, versionCount: v?.seq ?? 0 };
    }),
  );
  return json({ project, beds });
});

export const PATCH = route<P>(async (req, { params }) => {
  const { id } = await params;
  const patch = await body(req, ProjectPatchZ);
  const project = await repo.updateProject(id, patch);
  if (!project) throw notFound("Project");
  return json({ project });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const { id } = await params;
  await repo.deleteProject(id);
  return json({ ok: true });
});
