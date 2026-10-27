"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { plantLibrary } from "@/lib/plants";
import { useEditor } from "@/store/editor";
import type { AgentMessage, Plan, PlanOp } from "@/lib/types";
import type { BedStateData } from "./BedWorkspace";

type ChatResponse = { reply: string; ops: PlanOp[]; summary: string | null; planner: string; messages: AgentMessage[] };

/** A change the planner made, keyed by its reply's timestamp, so it can be undone from the chat. */
type Change = { summary: string; before: Plan; after: Plan; undone: boolean };

const EXAMPLES = [
  "Make the back row more hedge-like",
  "Swap the pink flowers for something white",
  "Add more fall color at the south end",
  "What blooms here in early spring?",
];

/** Talk to the planner about the plan in the editor; its changes land in the editor as one undoable step. */
export function PlannerChat({ data }: { data: BedStateData }) {
  const ed = useEditor();
  const [messages, setMessages] = useState<AgentMessage[]>(data.session.messages);
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  const sel = ed.selection;
  const focus = sel?.kind === "drift" || sel?.kind === "zone" ? { kind: sel.kind, id: sel.id } : null;
  const focusLabel =
    sel?.kind === "drift" ? (() => {
      const d = ed.plan.drifts.find((x) => x.id === sel.id);
      return d ? `${plantLibrary.get(d.plantId)?.common ?? "drift"} drift` : null;
    })()
    : sel?.kind === "zone" ? `${ed.zones.find((z) => z.id === sel.id)?.name ?? "zone"} zone`
    : null;

  const send = async (message: string) => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setText("");
    // Show the message right away; the server returns the full history with the reply.
    setMessages((m) => [...m, { role: "user", text: message, at: new Date().toISOString() }]);
    try {
      const s = useEditor.getState();
      const r = await api<ChatResponse>(`/api/beds/${data.bed.id}/chat`, {
        method: "POST",
        json: { message, plan: s.plan, outline: s.outline, zones: s.zones, existing: s.existing, focus },
      });
      if (r.ops.length) {
        const before = useEditor.getState().plan;
        useEditor.getState().applyOps(r.ops);
        const after = useEditor.getState().plan;
        const at = r.messages[r.messages.length - 1].at;
        setChanges((c) => ({ ...c, [at]: { summary: r.summary ?? "Changed the plan", before, after, undone: false } }));
      }
      setMessages(r.messages);
    } catch (e) {
      setMessages((m) => [...m, { role: "agent", text: e instanceof Error ? e.message : "Something went wrong.", at: new Date().toISOString() }]);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (at: string) => {
    const c = changes[at];
    ed.commit(() => ({ plan: c.undone ? c.after : c.before }));
    setChanges((all) => ({ ...all, [at]: { ...c, undone: !c.undone } }));
  };

  return (
    <section className="card stack">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Ask the planner</h3>
        <small>{data.planner}</small>
      </div>
      <div ref={listRef} className="chat" aria-live="polite">
        {messages.length === 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <small>Describe a change in your own words. Select a drift or zone first to talk about that spot.</small>
            {EXAMPLES.map((x) => (
              <button key={x} className="small" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => send(x)} disabled={busy}>{x}</button>
            ))}
          </div>
        )}
        {messages.map((m, i) => {
          const c = m.role === "agent" ? changes[m.at] : undefined;
          // A change can be flipped back only while the plan still matches it.
          const canToggle = c && (c.undone ? ed.plan === c.before : ed.plan === c.after);
          return (
            <div key={`${m.at}-${i}`} className={`msg ${m.role}`}>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
              {c && (
                <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                  <span className={`pill ${c.undone ? "info" : ""}`}>{c.undone ? "Undone" : "Changed"}: {c.summary}</span>
                  {canToggle && <button className="small" onClick={() => toggle(m.at)}>{c.undone ? "Reapply" : "Undo"}</button>}
                </div>
              )}
            </div>
          );
        })}
        {busy && <div className="msg agent hint">Thinking… (can take a minute)</div>}
      </div>
      {focusLabel && (
        <div className="row hint">
          About: <strong>{focusLabel}</strong>
          <button className="small" onClick={() => ed.select(null)}>Clear</button>
        </div>
      )}
      <form
        className="stack"
        style={{ gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <textarea
          rows={2}
          value={text}
          placeholder={focusLabel ? `e.g. "make this more hedge-like"` : `e.g. "something taller by the front steps"`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        <div className="row between">
          <small>Changes go into the plan like your own edits. Save a version to keep them.</small>
          <button className="primary small" disabled={busy || !text.trim()}>Send</button>
        </div>
      </form>
    </section>
  );
}
