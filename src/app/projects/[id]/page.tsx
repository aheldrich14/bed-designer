import { notFound } from "next/navigation";
import * as repo from "@/lib/db/repo";
import { TopBar } from "@/components/TopBar";
import { ProjectSite } from "@/components/ProjectSite";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await repo.getProject(id);
  if (!project) notFound();
  return (
    <>
      <TopBar crumbs={[{ label: project.name }]} />
      <ProjectSite projectId={id} />
    </>
  );
}
