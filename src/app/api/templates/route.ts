import { json, route } from "@/lib/http";
import { requireBed } from "@/lib/services";
import { templates, templatesFor } from "@/lib/templates";

export const GET = route(async (req) => {
  const bedId = new URL(req.url).searchParams.get("bed");
  if (!bedId) return json({ templates: templates.map((template) => ({ template, fit: null })) });
  return json({ templates: templatesFor(await requireBed(bedId)) });
});
