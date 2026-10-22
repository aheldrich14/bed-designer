import { z } from "zod";
import * as repo from "@/lib/db/repo";
import { body, json, notFound, route, type Params } from "@/lib/http";
import { ConditionsZ, PtZ, ShapeZ } from "@/lib/schemas";

const NewBedZ = z.object({
  name: z.string().min(1),
  origin: PtZ.optional(),
  outline: ShapeZ.optional(),
  conditions: ConditionsZ.partial().optional(),
});

export const POST = route<Params<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  if (!repo.getProject(id)) throw notFound("Project");
  const input = await body(req, NewBedZ);
  const bed = repo.createBed(id, { ...input, conditions: { ...repo.DEFAULT_CONDITIONS, ...input.conditions } });
  return json({ bed }, { status: 201 });
});
