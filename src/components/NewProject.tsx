"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import type { Project } from "@/lib/types";

export function NewProject() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="row"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const { project } = await api<{ project: Project }>("/api/projects", { method: "POST", json: { name: name || "My yard" } });
          router.push(`/projects/${project.id}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 412 Main St, Northville" style={{ minWidth: 260 }} />
      <button className="primary" disabled={busy}>New project</button>
    </form>
  );
}
