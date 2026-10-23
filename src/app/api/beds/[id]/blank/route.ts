import { json, route, type Params } from "@/lib/http";
import { startBlank } from "@/lib/services";

export const POST = route<Params<{ id: string }>>(async (_req, { params }) => {
  const { id } = await params;
  return json({ version: await startBlank(id) }, { status: 201 });
});
