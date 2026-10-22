import { z } from "zod";
import { body, json, route, type Params } from "@/lib/http";
import { startFromTemplate } from "@/lib/services";

export const POST = route<Params<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  const { templateId } = await body(req, z.object({ templateId: z.string() }));
  return json({ version: startFromTemplate(id, templateId) }, { status: 201 });
});
