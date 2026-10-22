import { z } from "zod";
import { body, json, route, type Params } from "@/lib/http";
import { answerChecklist } from "@/lib/services";

const AnswersZ = z.object({
  answers: z.record(z.string(), z.object({ answer: z.string().optional(), skip: z.boolean().optional() })),
});

export const PATCH = route<Params<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  const { answers } = await body(req, AnswersZ);
  return json({ session: answerChecklist(id, answers) });
});
