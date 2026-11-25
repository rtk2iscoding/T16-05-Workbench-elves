import { useEffect, useRef, useState } from "react";
import { Field, ToolButton } from "../../components/primitives";
import type { WritingProject } from "../../lib/domain";
import { prepareImport, suggestedMatch } from "./outline";
import type { DraftRow } from "./outline";

export type ImportRecords = ReturnType<typeof prepareImport>;

export function OutlineReview({ project, rows, onClose, onImport }: {
  project: WritingProject;
  rows: DraftRow[];
  onClose: () => void;
  onImport: (records: ImportRecords) => void;
}) {
  const [draft, setDraft] = useState(rows);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const submitted = useRef(false);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);

  function edit(index: number, patch: Partial<DraftRow>) {
    setDraft((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
    setError("");
  }

  function confirm() {
    if (submitted.current) return;
    try {
      const imported = prepareImport(project, draft);
      if (!imported.characters.length && !imported.events.length && !imported.scenes.length) {
        throw new Error("There are no new records to import.");
      }
      submitted.current = true;
      onImport(imported);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not prepare this draft.");
    }
  }

  const events = draft.filter((row) => row.kind === "event");
  const people = draft.filter((row) => row.kind === "character");

  return (
    <dialog className="workbench-modal wide outline-review" ref={dialog} aria-labelledby="outline-review-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header><h2 id="outline-review-title">Review outline drafts</h2></header>
      <p>Review the extracted records and character matches. Enter dates where the outline left them blank. Nothing is saved until you confirm.</p>
      <div className="outline-review-rows">
        {draft.map((row, index) => (
          <fieldset key={index} className="workbench-form">
            <legend>{row.kind} · {row.title || "Untitled"}</legend>
            <Field label={row.kind === "character" ? "Name in outline" : "Title"}>
              <input value={row.title} onChange={(event) => {
                const title = event.target.value;
                const patch: Partial<DraftRow> = { title };
                if (row.kind === "character") patch.match = suggestedMatch(project, title);
                setDraft((current) => current.map((item, i) => {
                  if (i === index) return { ...item, ...patch };
                  if (row.kind === "event" && item.kind === "scene" && item.event === row.title) return { ...item, event: title };
                  if (row.kind === "character") return { ...item, characters: item.characters.map((name) => name === row.title ? title : name) };
                  return item;
                }));
                setError("");
              }} />
            </Field>
            {row.kind === "character" && (
              <Field label="Character match">
                <select value={row.match} onChange={(event) => edit(index, { match: event.target.value })}>
                  <option value="">Choose a match</option>
                  <option value="new">Create a new character</option>
                  {project.characters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
            )}
            {(row.kind !== "character" || row.match === "new") && (
              <>
                <Field label={row.kind === "character" ? "Birth date" : row.kind === "event" ? "Start date" : "Scene date"}>
                  <input placeholder="YYYY, YYYY-MM or YYYY-MM-DD" value={row.date} onChange={(event) => edit(index, { date: event.target.value })} />
                </Field>
                <Field label="Description" full>
                  <textarea value={row.description} onChange={(event) => edit(index, { description: event.target.value })} />
                </Field>
              </>
            )}
            {row.kind === "event" && (
              <Field label="End date (defaults to start)">
                <input value={row.end} onChange={(event) => edit(index, { end: event.target.value })} />
              </Field>
            )}
            {row.kind !== "character" && (
              <>
                <Field label="Chapter">
                  <select value={row.chapter} onChange={(event) => edit(index, { chapter: event.target.value })}>
                    <option value="">Unassigned</option>
                    {project.chapters.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                  </select>
                </Field>
                <Field label="Location">
                  <select value={row.location} onChange={(event) => edit(index, { location: event.target.value })}>
                    <option value="">Unassigned</option>
                    {project.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
                {row.kind === "scene" && (
                  <Field label="Linked draft event">
                    <select value={row.event} onChange={(event) => edit(index, { event: event.target.value })}>
                      <option value="">None</option>
                      {events.map((item, i) => <option key={i} value={item.title}>{item.title}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Participants" full>
                  <select multiple value={row.characters} onChange={(event) => edit(index, {
                    characters: Array.from(event.target.selectedOptions, (option) => option.value),
                  })}>
                    {[...new Set([...people.map((item) => item.title), ...project.characters.map((item) => item.name), ...row.characters])]
                      .filter(Boolean).map((name) => <option key={name}>{name}</option>)}
                  </select>
                </Field>
              </>
            )}
            <ToolButton onClick={() => {
              setDraft((current) => current.flatMap((item, i) => {
                if (i === index) return [];
                if (row.kind === "event" && item.kind === "scene" && item.event === row.title) return [{ ...item, event: "" }];
                if (row.kind === "character") return [{ ...item, characters: item.characters.filter((name) => name !== row.title) }];
                return [item];
              }));
              setError("");
            }}>Remove draft</ToolButton>
          </fieldset>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions">
        <ToolButton onClick={onClose}>Cancel</ToolButton>
        <ToolButton primary disabled={!draft.length} onClick={confirm}>Confirm import</ToolButton>
      </div>
    </dialog>
  );
}
