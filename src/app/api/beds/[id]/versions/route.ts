import * as repo from "@/lib/db/repo";
import { body, json, route, type Params } from "@/lib/http";
import { NewVersionZ } from "@/lib/schemas";
import { saveVersion } from "@/lib/services";

type P = Params<{ id: string }>;

export const GET = route<P>(async (_req, { params }) => {
  const { id } = await params;
  return json({ versions: await repo.listVersions(id) });
});

export const POST = route<P>(async (req, { params }) => {
  const { id } = await params;
  const v = await body(req, NewVersionZ);
  return json({ version: await saveVersion(id, v.plan, v.author, v.rationale, v.parentId) }, { status: 201 });
});
