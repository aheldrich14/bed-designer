import Link from "next/link";
import * as repo from "@/lib/db/repo";
import { TopBar } from "@/components/TopBar";
import { NewProject } from "@/components/NewProject";
import { plantLibrary } from "@/lib/plants";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await repo.listProjects();
  return (
    <>
      <TopBar />
      <main className="page grid">
        <section className="card">
          <h1>Your yards</h1>
          <p className="muted">
            Each project holds an aerial and any number of beds. Start with the front bed, then repeat for the side bed and the window well.
          </p>
          <NewProject />
        </section>
        {projects.length === 0 ? (
          <div className="card empty">No projects yet. Create one to upload an aerial and trace your first bed.</div>
        ) : (
          <section className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
                {p.aerialUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.aerialUrl} alt="" style={{ width: "100%", height: 140, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />
                ) : (
                  <div style={{ height: 140, borderRadius: 8, background: "#e9e4d8", marginBottom: 8 }} />
                )}
                <h2>{p.name}</h2>
                <small>
                  {p.bedCount} bed{p.bedCount === 1 ? "" : "s"} · {p.calibration ? "calibrated" : "not calibrated"}
                </small>
              </Link>
            ))}
          </section>
        )}
        <p className="hint">
          Plant library v{plantLibrary.version}: {plantLibrary.all().length} {plantLibrary.region} natives. {plantLibrary.note}
        </p>
      </main>
    </>
  );
}
