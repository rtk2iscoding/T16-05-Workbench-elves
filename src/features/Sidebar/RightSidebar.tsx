import { useState } from "react";
import { useWorkbench } from "../../lib/store";
import { useDbRecord } from "../../lib/useDbRecord";
import { StoryAssistant } from "../story-assistant/StoryAssistant";
import type { StorySource } from "../story-assistant/consistency";
import "./Sidebar.css";

// The sticky note at the top: a personal signature that can be edited by double-clicking.
function SignatureNote() {
  const defaultSignature =
    "Stories are like secret drawers — full of things we forgot we knew.";

  const {
    value: signature,
    setValue: setSignature,
    loaded,
    saveError,
  } = useDbRecord<string>(
    "notebook",
    "signature",
    defaultSignature
  );

  const [editing, setEditing] = useState(false);

  return (
    <div className="sticky-note">
      <span className="sticky-note-tape" />

      {!loaded ? (
        <p className="sticky-note-text">Loading notebook...</p>
      ) : editing ? (
        <textarea
          className="sticky-note-edit"
          value={signature}
          autoFocus
          onChange={(e) => setSignature(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              setEditing(false);
            }
          }}
        />
      ) : (
        <p
          className="sticky-note-text"
          onDoubleClick={() => setEditing(true)}
          title="Double-click to edit"
        >
          {signature}
        </p>
      )}

      <p className="sticky-note-author">— from your notebook</p>

      {saveError && (
        <p role="alert" className="sticky-note-error">
          Could not save your note. Please try editing again.
        </p>
      )}
    </div>
  );
}
export function RightSidebar({ onOpenSource }: { onOpenSource: (source: StorySource) => void }) {
  const { activeProject } = useWorkbench();
  return (
    <aside className="right-sidebar">
      <SignatureNote />
      {activeProject && <StoryAssistant key={activeProject.id} project={activeProject} onOpenSource={onOpenSource} />}
    </aside>
  );
}
