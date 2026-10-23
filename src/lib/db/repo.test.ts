import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DB_BACKEND = "sqlite";
  process.env.DATABASE_FILE = ":memory:";
});

describe("repo (sqlite backend)", () => {
  it("round-trips projects, beds, versions, suggestions, renders and sessions", async () => {
    const repo = await import("./repo");
    expect(repo.backendName()).toBe("sqlite");

    const p = await repo.createProject("Front yard");
    const bed = await repo.createBed(p.id, { name: "Front bed", outline: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }] } });
    expect((await repo.listProjects()).find((x) => x.id === p.id)?.bedCount).toBe(1);
    expect((await repo.updateBed(bed.id, { name: "Renamed" }))?.name).toBe("Renamed");

    const v1 = await repo.createVersion(bed.id, { drifts: [], zoneNotes: {} }, "user", "Blank", null);
    const v2 = await repo.createVersion(bed.id, { drifts: [], zoneNotes: { a: "b" } }, "user", "Next", v1.id);
    expect(v2.seq).toBe(2);
    expect((await repo.latestVersion(bed.id))?.id).toBe(v2.id);
    expect((await repo.listVersions(bed.id)).map((v) => v.driftCount)).toEqual([0, 0]);

    const [s] = await repo.replaceOpenSuggestions(v2.id, [
      { issue: "Gap", detail: "d", source: "bloom", severity: "warn", driftIds: [], anchor: null, ops: [] },
    ]);
    await repo.setSuggestionStatus(s.id, "dismissed");
    expect((await repo.getSuggestion(s.id))?.status).toBe("dismissed");

    await repo.saveRender({ planVersionId: v2.id, month: 5, viewpoint: "street", prompt: "p", imageUrl: null, error: "x" });
    await repo.saveRender({ planVersionId: v2.id, month: 5, viewpoint: "street", prompt: "p2", imageUrl: null, error: null });
    expect((await repo.listRenders(v2.id)).map((r) => r.prompt)).toEqual(["p2"]);

    await repo.saveAgentSession({ bedId: bed.id, messages: [], checklist: [] });
    await repo.saveAgentSession({ bedId: bed.id, messages: [{ role: "user", text: "hi", at: "t" }], checklist: [] });
    expect((await repo.getAgentSession(bed.id))?.messages).toHaveLength(1);

    await repo.deleteProject(p.id);
    expect(await repo.getBed(bed.id)).toBeNull();
  });
});
