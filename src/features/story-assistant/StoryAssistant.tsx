import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { ToolButton } from "../../components/primitives";
import { useWorkbench } from "../../lib/store";
import type { WritingProject } from "../../lib/domain";
import { answerStoryQuestion, checkRules, checkSemantics, storySources } from "./consistency";
import type { Finding, StorySource } from "./consistency";
import { basicOutline, generateOutline } from "./outline";
import type { DraftRow } from "./outline";
import { OutlineReview } from "./OutlineReview";
import type { ImportRecords } from "./OutlineReview";
import "./storyAssistant.css";

type Message = { text: string; user?: boolean; findings?: Finding[]; draft?: DraftRow[]; citations?: Finding["sources"] };

export function StoryAssistant({ project, onOpenSource }: {
  project: WritingProject;
  onOpenSource: (source: StorySource) => void;
}) {
  const { updateProject } = useWorkbench();
  const [messages, setMessages] = useState<Message[]>([]);
  const [mode, setMode] = useState<"ask" | "check" | "outline">("check");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<number>();
  const [imported, setImported] = useState<number[]>([]);
  const request = useRef<AbortController>(null);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => () => {
    const controller = request.current;
    request.current = null;
    controller?.abort();
  }, []);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages.length, busy]);

  function reply(message: Message) {
    setMessages((current) => [...current, message]);
  }

  async function submit() {
    if (request.current || (mode !== "check" && !input.trim())) return;
    const text = input.trim();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setInput("");
    reply({ user: true, text: mode === "check" ? text || "Check story consistency" : text });
    try {
      if (mode === "ask") {
        try {
          const answer = await answerStoryQuestion(storySources(project), text, messages, controller.signal);
          if (!controller.signal.aborted) reply(answer);
        } catch {
          if (!controller.signal.aborted) reply({ text: "Project chat needs a supported Chrome device with the on-device model enabled. Consistency rules and basic outline drafting are still available." });
        }
      } else if (mode === "check") {
        const sources = storySources(project);
        const rules = checkRules(project, sources);
        let semantic: Awaited<ReturnType<typeof checkSemantics>>;
        try {
          semantic = await checkSemantics(sources, text, controller.signal);
        } catch {
          semantic = { findings: [], coverage: "Semantic review unavailable. Use a supported Chrome device with the on-device model enabled. Rule checks are complete." };
        }
        if (!controller.signal.aborted) reply({
          text: `${rules.length} rule findings · ${semantic.findings.length} semantic suggestions. ${semantic.coverage}`,
          findings: [...rules, ...semantic.findings],
        });
      } else {
        let draft: DraftRow[];
        let summary = "I extracted these drafts from your outline.";
        try {
          draft = await generateOutline(project, text, controller.signal);
        } catch {
          if (controller.signal.aborted) return;
          draft = basicOutline(project, text);
          summary = "The browser model is unavailable. Basic drafting split the text into story beats and matched named characters. To add names, include a line such as Characters: Lin Xia, Mei.";
        }
        if (!controller.signal.aborted) reply(draft.length ? { text: summary, draft } : { text: "I found no draft records in this outline." });
      }
    } catch (error) {
      if (!controller.signal.aborted) reply({ text: error instanceof Error ? error.message : "The assistant could not complete this request." });
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
        if (controller.signal.aborted) reply({ text: "Request cancelled." });
      }
    }
  }

  function importRecords(records: ImportRecords) {
    if (review === undefined) return;
    updateProject(project.id, (current) => ({
      ...current,
      characters: [...current.characters, ...records.characters],
      events: [...current.events, ...records.events],
      scenes: [...current.scenes, ...records.scenes],
    }));
    setImported((current) => [...current, review]);
    setReview(undefined);
    reply({ text: `Imported ${records.characters.length} new characters, ${records.events.length} events and ${records.scenes.length} scenes.` });
  }

  function citations(items: Finding["sources"]) {
    return items.map(({ source, quote }, index) => (
      <div key={index} className="assistant-citation">
        <button type="button" onClick={() => {
          const current = storySources(project).some((item) => item.id === source.id && item.kind === source.kind);
          if (current) onOpenSource(source);
          else reply({ text: "That source was removed. Run the check again to refresh the results." });
        }}>{source.kind}: {source.title}</button>
        {quote && <q>{quote}</q>}
      </div>
    ));
  }

  return (
    <section className="story-assistant" aria-labelledby="story-assistant-title">
      <h3 id="story-assistant-title"><Sparkles size={16} aria-hidden="true" /> Story AI</h3>
      <div className="assistant-modes" role="group" aria-label="Assistant task">
        <button type="button" className="toolbar-button" aria-pressed={mode === "ask"} disabled={busy} onClick={() => { setMode("ask"); setInput(""); }}>Chat</button>
        <button type="button" className="toolbar-button" aria-pressed={mode === "check"} disabled={busy} onClick={() => { setMode("check"); setInput(""); }}>Consistency</button>
        <button type="button" className="toolbar-button" aria-pressed={mode === "outline"} disabled={busy} onClick={() => { setMode("outline"); setInput(""); }}>Outline</button>
      </div>
      <div className="assistant-transcript" ref={transcript} role="log" aria-label="Story AI conversation">
        {messages.length === 0 && <p>Ask about your story, check for contradictions, or turn an outline into drafts.</p>}
        {messages.map((message, index) => (
          <article key={index} className={message.user ? "assistant-user" : "assistant-reply"} aria-label={message.user ? "You" : "Story AI"}>
            <p>{message.text}</p>
            {message.findings?.length ? (
              <ul className="assistant-findings">
                {message.findings.map((finding, i) => (
                  <li key={i}>
                    <strong>{finding.mode === "rule" ? "Rule" : "Semantic suggestion"}</strong>
                    <p>{finding.message}</p>
                    {citations(finding.sources)}
                  </li>
                ))}
              </ul>
            ) : null}
            {message.citations && citations(message.citations)}
            {message.draft && (
              <ToolButton disabled={imported.includes(index)} onClick={() => setReview(index)}>
                {imported.includes(index) ? "Imported" : `Review ${message.draft.length} drafts`}
              </ToolButton>
            )}
          </article>
        ))}
        {busy && <p role="status">Working…</p>}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label htmlFor="assistant-input">
          {mode === "check" ? "What should I check?" : mode === "outline" ? "Paste your outline" : "Ask about your project"}
        </label>
        <textarea id="assistant-input" value={input} disabled={busy} maxLength={mode === "outline" ? 8000 : 500}
          placeholder={mode === "check" ? "Optional focus, e.g. Does Mei’s timeline make sense?"
            : mode === "outline" ? "Paste the outline here…" : "What motivates the protagonist?"}
          onChange={(event) => setInput(event.target.value)} />
        <ToolButton type="submit" primary disabled={busy || (mode !== "check" && !input.trim())}>
          {mode === "check" ? "Check consistency" : mode === "outline" ? "Draft from outline" : "Send"}
        </ToolButton>
        {busy && <ToolButton onClick={() => request.current?.abort()}>Cancel request</ToolButton>}
      </form>
      {review !== undefined && messages[review]?.draft && <OutlineReview project={project}
        rows={messages[review].draft} onClose={() => setReview(undefined)} onImport={importRecords} />}
    </section>
  );
}
