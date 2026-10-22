import { json, route, type Params } from "@/lib/http";
import { runDraft } from "@/lib/services";

export const maxDuration = 300;

export const POST = route<Params<{ id: string }>>(async (_req, { params }) => {
  const { id } = await params;
  return json(await runDraft(id));
});
