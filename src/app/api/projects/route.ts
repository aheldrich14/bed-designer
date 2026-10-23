import { z } from "zod";
import * as repo from "@/lib/db/repo";
import { body, json, route } from "@/lib/http";

export const GET = route(async () => json({ projects: await repo.listProjects() }));

export const POST = route(async (req) => {
  const { name } = await body(req, z.object({ name: z.string().min(1).default("My yard") }));
  return json({ project: await repo.createProject(name) }, { status: 201 });
});
