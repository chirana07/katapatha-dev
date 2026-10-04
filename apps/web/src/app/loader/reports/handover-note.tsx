"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveHandoverNote } from "../actions";
import { NoteIcon } from "../icons";

/**
 * L-06's shift handover note: what the next shift needs to know. One note per
 * day, the latest edit wins, and it carries who wrote it and when.
 */
export function HandoverNote({
  date,
  note,
  authorName,
}: {
  date: string;
  note: { body: string; authorName: string; updatedAt: string } | null;
  authorName: string;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const updated = note
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(note.updatedAt))
    : null;

  function save() {
    setError(null);
    start(async () => {
      const saved = await saveHandoverNote({ date, body, authorName });
      if (saved.ok) setEditing(false);
      else setError(saved.detail);
    });
  }

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[#111827]">
          <NoteIcon className="size-4.5 text-[#374151]" />
          Shift handover note
        </h2>
        {!editing ? (
          <button type="button" onClick={() => setEditing(true)} className="min-h-9 text-[13px] font-semibold text-link">
            {note ? "Edit" : "Write one"}
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <label className="sr-only" htmlFor="handover-body">
            Handover note
          </label>
          <textarea
            id="handover-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={4}
            maxLength={2000}
            autoFocus
            className="w-full rounded-[8px] border border-line bg-surface p-2.5 text-sm text-ink"
          />
          {error ? (
            <p role="alert" className="text-[13px] text-bad-ink">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save note"}
            </Button>
          </div>
        </div>
      ) : note ? (
        <>
          <p className="mt-2 whitespace-pre-line text-sm text-[#374151]">{note.body}</p>
          <p className="mt-3 text-[12.5px] text-muted">
            {note.authorName} · updated {updated}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">Nothing written for the next shift yet.</p>
      )}
    </section>
  );
}
