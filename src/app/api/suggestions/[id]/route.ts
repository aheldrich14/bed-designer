import { z } from "zod";
import * as repo from "@/lib/db/repo";
import { body, json, notFound, route, type Params } from "@/lib/http";
import { applySuggestion } from "@/lib/services";

export const POST = route<Params<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  const { action } = await body(req, z.object({ action: z.enum(["apply", "dismiss", "reopen"]) }));
  if (!repo.getSuggestion(id)) throw notFound("Suggestion");
  if (action === "apply") return json({ version: applySuggestion(id) });
  repo.setSuggestionStatus(id, action === "dismiss" ? "dismissed" : "open");
  return json({ ok: true });
});
