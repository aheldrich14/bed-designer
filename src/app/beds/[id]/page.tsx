import { notFound } from "next/navigation";
import * as repo from "@/lib/db/repo";
import { TopBar } from "@/components/TopBar";
import { BedWorkspace } from "@/components/bed/BedWorkspace";

export const dynamic = "force-dynamic";

export default async function BedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bed = await repo.getBed(id);
  if (!bed) notFound();
  const project = (await repo.getProject(bed.projectId))!;
  return (
    <>
      <TopBar crumbs={[{ href: `/projects/${project.id}`, label: project.name }, { label: bed.name }]} />
      <BedWorkspace bedId={id} />
    </>
  );
}
