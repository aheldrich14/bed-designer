import { z } from "zod";
import { body, json, route, type Params } from "@/lib/http";
import { ExistingZ, PlanZ, ShapeZ, ZoneZ } from "@/lib/schemas";
import { chatEdit } from "@/lib/services";

export const maxDuration = 300;

const ChatZ = z.object({
  message: z.string().trim().min(1).max(2000),
  plan: PlanZ,
  outline: ShapeZ.optional(),
  zones: z.array(ZoneZ).optional(),
  existing: z.array(ExistingZ).optional(),
  focus: z.object({ kind: z.enum(["drift", "zone"]), id: z.string() }).nullable().default(null),
});

/** One turn of conversation with the planner about the plan open in the editor. */
export const POST = route<Params<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  return json(await chatEdit(id, await body(req, ChatZ)));
});
