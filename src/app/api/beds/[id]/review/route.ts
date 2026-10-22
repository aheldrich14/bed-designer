import { z } from "zod";
import { body, json, route, type Params } from "@/lib/http";
import { runReview } from "@/lib/services";

export const maxDuration = 300;

export const POST = route<Params<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  const { versionId } = await body(req, z.object({ versionId: z.string().nullable().optional() }));
  return json(await runReview(id, versionId));
});
