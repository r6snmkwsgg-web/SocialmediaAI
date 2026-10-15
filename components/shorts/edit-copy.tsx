"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/app/toast";
import { button } from "@/components/app/ui";

type Edit = (id: string, title: string, description: string) => Promise<{ ok: boolean; message?: string }>;

/** A Short's title and description, changed before it posts. */
export function EditCopy({ id, title: t0, description: d0, onDone, edit }: { id: string; title: string; description: string; onDone: () => void; edit: Edit }) {
  const router = useRouter();
  const [title, setTitle] = useState(t0);
  const [description, setDescription] = useState(d0);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const field = "w-full border-2 border-edge-strong bg-surface px-3 py-2 text-[15px] text-fg focus:border-fg focus:outline-none";
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await edit(id, title, description);
          if (!r.ok) setMsg(r.message ?? "That didn't save.");
          else {
            toast("Title saved", "good");
            onDone();
            router.refresh();
          }
        });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Title ({title.length}/100)</span>
        <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} className={field} autoFocus />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={field} />
      </label>
      {msg && <p role="alert" className="text-[13px] text-signal">{msg}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={button.secondary}>{pending ? "Saving…" : "Save"}</button>
        <button type="button" onClick={onDone} className={button.quiet}>Cancel</button>
      </div>
    </form>
  );
}

/** "Edit the title" that opens the form in place, for a Short's own page. */
export function EditCopyToggle({ id, title, description, edit }: { id: string; title: string; description: string; edit: Edit }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <EditCopy id={id} title={title} description={description} onDone={() => setOpen(false)} edit={edit} />
  ) : (
    <button type="button" onClick={() => setOpen(true)} className={`${button.quiet} self-start`}>
      Edit the title
    </button>
  );
}
