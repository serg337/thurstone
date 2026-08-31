import type { ByoaToolName } from "@/lib/demo/contract-v2";

interface EditableTool {
  readonly name: ByoaToolName;
  readonly title: string;
  readonly description: string;
  readonly readOnly: boolean;
}

export function ToolDescriptionEditor({
  tool,
  onTitleChange,
  onDescriptionChange,
  onReset
}: {
  readonly tool: EditableTool;
  readonly onTitleChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly onReset: () => void;
}) {
  return (
    <article className="owner-tool-editor">
      <header>
        <div>
          <span className="owner-tool-kind">{tool.readOnly ? "Read-only" : "Consequential"}</span>
          <code>{tool.name}</code>
        </div>
        <button className="text-button" type="button" onClick={onReset}>
          Reset to verified default
        </button>
      </header>
      <label>
        <span>Agent-visible title</span>
        <input
          value={tool.title}
          minLength={3}
          maxLength={80}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>
      <label>
        <span>
          Agent-visible description <small>{tool.description.length}/600</small>
        </span>
        <textarea
          value={tool.description}
          minLength={20}
          maxLength={600}
          rows={5}
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
      </label>
      <details>
        <summary>Why this distinction matters</summary>
        <p>
          The agent chooses from titles, descriptions, schemas, and the current page. Clear
          descriptions separate a read-only preview from an action that creates pending checkout.
        </p>
      </details>
    </article>
  );
}
