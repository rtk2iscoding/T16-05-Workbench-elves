import { useEffect, useRef, useState } from "react";
import { ArrowUp, BookOpen, ListTree, ShieldCheck, Sparkles, Square, X } from "lucide-react";
import { ToolButton } from "../../components/primitives";
import { useWorkbench } from "../../lib/store";
import type { WritingProject } from "../../lib/domain";
import { answerStoryQuestion, checkRules, checkSemantics, storySources } from "./consistency";
import type { Finding, StorySource } from "./consistency";
import { basicOutline, generateOutline } from "./outline";
import type { DraftRow } from "./outline";
import { OutlineReview } from "./OutlineReview";
import type { ImportRecords } from "./OutlineReview";
import { getAppearances, interpretQuestion } from "./appearances";
import "./storyAssistant.css";

type Tool = "check" | "outline" | "appearance";
type Message = {
  text: string;
  user?: boolean;
  findings?: Finding[];
  draft?: DraftRow[];
  citations?: Finding["sources"];
  chooseCharacter?: boolean;
  preferLocations?: boolean;
  autoOpen?: boolean;
};

const tools = [
  { id: "check", label: "Check consistency", short: "Check", icon: ShieldCheck, placeholder: "What should I check? Leave blank to check everything." },
  { id: "outline", label: "Break down outline", short: "Outline", icon: ListTree, placeholder: "Paste the outline to turn it into drafts…" },
  { id: "appearance", label: "Find appearances", short: "Appearances", icon: BookOpen, placeholder: "Which chapters does this character appear in?" },
] as const;

function inferTool(text: string): Tool | undefined {
  if (/一致性|矛盾|前后冲突|前後衝突|consistency|contradictions?/iu.test(text)) return "check";
  if (/^(?:大纲|大綱|outline)\s*[:：]|(?:拆解|拆分|导入|導入).{0,12}(?:大纲|大綱)|(?:大纲|大綱).{0,12}(?:拆解|拆分|拆成|转成|轉成)|(?:break down|split|extract|import|draft from|turn).{0,32}outline/iu.test(text)) return "outline";
  if (/出场|出場|登场|登場|出现在哪|出現在哪|在哪.{0,12}(?:出现|出現)|\b(?:where|which chapters?|which locations?).{0,80}\bappear(?:s|ed)?\b|\bappearances?\b|\bwhich chapters? (?:feature|include)/iu.test(text)) return "appearance";
}

export function StoryAssistant({ project, onOpenSource }: {
  project: WritingProject;
  onOpenSource: (source: StorySource) => void;
}) {
  const { updateProject } = useWorkbench();
  const [messages, setMessages] = useState<Message[]>([]);
  const [tool, setTool] = useState<Tool>();
  const [characterId, setCharacterId] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const selectedTool = tools.find(({ id }) => id === tool);
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

  function showAppearances(id: string, preferLocations = false, autoOpen = true) {
    const character = project.characters.find((item) => item.id === id);
    if (!character) return;
    setCharacterId(id);
    const report = getAppearances(project, id);
    const chapters = report.chapters.map((item): StorySource => ({
      kind: "chapter", id: item.id, title: item.title || `Chapter ${item.order + 1}`, text: "",
    }));
    const locations = report.locations.map((item): StorySource => ({
      kind: "location", id: item.id, title: item.name, text: "",
    }));
    const ordered = preferLocations ? [...locations, ...chapters] : [...chapters, ...locations];
    reply({
      text: `${character.name} appears in ${chapters.length} ${chapters.length === 1 ? "chapter" : "chapters"} and ${locations.length} ${locations.length === 1 ? "location" : "locations"}.`,
      citations: ordered.map((source) => ({ source })),
    });
    if (autoOpen && ordered[0]) onOpenSource(ordered[0]);
  }

  async function submit() {
    const text = input.trim();
    const mode = tool ?? inferTool(text);
    if (request.current || (mode !== "check" && !text)) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setInput("");
    setTool(undefined);
    reply({ user: true, text: mode === "check" ? text || "Check story consistency" : text });
    try {
      if (mode === "appearance") {
        const match = await interpretQuestion(text, project.characters, characterId, controller.signal);
        if (controller.signal.aborted) return;
        const autoOpen = !/只列出|不要跳转|不要跳轉|(?:don.t|do not) (?:open|jump)|list only/iu.test(text);
        if (match) showAppearances(match.characterId, match.preferLocations, autoOpen);
        else reply({
          text: project.characters.length ? "Which character do you mean? Choose one to see their appearances." : "Add a character to this project to see their appearances.",
          chooseCharacter: project.characters.length > 0, autoOpen,
          preferLocations: /地点|地點|哪里|哪裡|locations?|places?|where/iu.test(text) && !/chapters?|章节|章節/iu.test(text),
        });
      } else if (mode === undefined) {
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
          draft = await generateOutline(project, text.replace(/^(?:大纲|大綱|outline)\s*[:：]\s*/iu, ""), controller.signal);
        } catch {
          if (controller.signal.aborted) return;
          draft = basicOutline(project, text.replace(/^(?:大纲|大綱|outline)\s*[:：]\s*/iu, ""));
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
      <header className="assistant-header">
        <span className="assistant-avatar" aria-hidden="true"><Sparkles size={16} /></span>
        <h3 id="story-assistant-title">Story AI</h3>
      </header>
      <div className="assistant-transcript" ref={transcript} role="log" aria-label="Story AI conversation">
        {!messages.length && <p className="assistant-welcome">What would you like to work on?</p>}
        {messages.map((message, index) => (
          <article key={index} className={message.user ? "assistant-user" : "assistant-reply"} aria-label={message.user ? "You" : "Story AI"}>
            <span className="assistant-speaker">{message.user ? "You" : "Story AI"}</span>
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
            {message.chooseCharacter && (
              <label className="assistant-character">
                Character
                <select value="" disabled={busy} onChange={(event) => showAppearances(event.target.value, message.preferLocations, message.autoOpen)}>
                  <option value="" disabled>Choose a character</option>
                  {project.characters.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
            )}
            {message.draft && (
              <ToolButton disabled={imported.includes(index)} onClick={() => setReview(index)}>
                {imported.includes(index) ? "Imported" : `Review ${message.draft.length} drafts`}
              </ToolButton>
            )}
          </article>
        ))}
        {busy && <p role="status">Working…</p>}
      </div>
      <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {selectedTool && (
          <button type="button" className="assistant-active-tool" onClick={() => { setTool(undefined); composer.current?.focus(); }}
            aria-label={`Remove ${selectedTool.label} tool`} disabled={busy}>
            <selectedTool.icon size={13} aria-hidden="true" /> {selectedTool.label} <X size={13} aria-hidden="true" />
          </button>
        )}
        <textarea ref={composer} value={input} disabled={busy} maxLength={8000}
          aria-label="Message Story AI"
          placeholder={selectedTool?.placeholder ?? "Message Story AI…"}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }} />
        <div className="assistant-composer-footer">
          <div className="assistant-tools" role="group" aria-label="Story tools">
            {tools.map(({ id, label, short, icon: Icon }) => (
              <button type="button" key={id} disabled={busy} aria-pressed={tool === id} aria-label={label}
                title={label} onClick={() => { setTool(tool === id ? undefined : id); composer.current?.focus(); }}>
                <Icon size={14} aria-hidden="true" /> <span>{short}</span>
              </button>
            ))}
          </div>
          {busy ? (
            <button className="assistant-send" type="button" aria-label="Stop response" onClick={() => request.current?.abort()}>
              <Square size={14} aria-hidden="true" />
            </button>
          ) : (
            <button className="assistant-send" type="submit" aria-label="Send message" disabled={!input.trim() && tool !== "check"}>
              <ArrowUp size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
      {review !== undefined && messages[review]?.draft && <OutlineReview project={project}
        rows={messages[review].draft} onClose={() => setReview(undefined)} onImport={importRecords} />}
    </section>
  );
}
