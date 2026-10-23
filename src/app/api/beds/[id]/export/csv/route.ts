import { route, type Params } from "@/lib/http";
import { plantListCsv } from "@/lib/export/csv";
import { requireBed, requireVersion } from "@/lib/services";

export const GET = route<Params<{ id: string }>>(async (req, { params }) => {
  const { id } = await params;
  const bed = await requireBed(id);
  const plan = await requireVersion(id, new URL(req.url).searchParams.get("version"));
  return new Response(plantListCsv([{ bed, plan }]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug(bed.name)}-plant-list.csv"`,
    },
  });
});

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bed";
