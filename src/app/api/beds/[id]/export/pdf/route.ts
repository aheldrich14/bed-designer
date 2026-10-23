import * as repo from "@/lib/db/repo";
import { route, type Params } from "@/lib/http";
import { planSheetPdf } from "@/lib/export/pdf";
import { requireBed, requireVersion, versionLabel } from "@/lib/services";

export const GET = route<Params<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  const bed = await requireBed(id);
  const version = await requireVersion(id, new URL(req.url).searchParams.get("version"));
  const project = (await repo.getProject(bed.projectId))!;
  const pdf = await planSheetPdf(project, bed, version, versionLabel(version));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${slug(bed.name)}-plan-sheet.pdf"`,
    },
  });
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bed";
