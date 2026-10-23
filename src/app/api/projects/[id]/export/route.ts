import * as repo from "@/lib/db/repo";
import { notFound, route, type Params } from "@/lib/http";
import { plantListCsv } from "@/lib/export/csv";

/** Plant list CSV across every bed in the project (latest version of each). */
export const GET = route<Params<{ id: string }>>(async (_req, { params }) => {
  const { id } = await params;
  const project = await repo.getProject(id);
  if (!project) throw notFound("Project");
  const beds = await repo.listBeds(id);
  const items = (await Promise.all(beds.map(async (bed) => ({ bed, plan: await repo.latestVersion(bed.id) })))).flatMap(
    ({ bed, plan }) => (plan ? [{ bed, plan }] : []),
  );
  return new Response(plantListCsv(items), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug(project.name)}-plant-list.csv"`,
    },
  });
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
