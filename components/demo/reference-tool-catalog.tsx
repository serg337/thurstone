"use client";

import { useMemo, useState } from "react";

import styles from "@/components/demo/reference-tool-catalog.module.css";
import {
  createThurstoneDemoCatalogSnapshot,
  type ThurstoneDemoCatalogSnapshotV1
} from "@/lib/demo/catalog-snapshot";
import {
  THURSTONE_DEMO_SELECTABLE_TOOL_NAMES,
  THURSTONE_REFERENCE_TOOL_TEMPLATES,
  type ThurstoneDemoSelectableToolName
} from "@/lib/demo/reference-tool-templates";

interface ReferenceToolCatalogProps {
  readonly snapshot: ThurstoneDemoCatalogSnapshotV1;
  readonly referencedToolNames?: readonly ThurstoneDemoSelectableToolName[];
  readonly processEndingToolNames?: readonly ThurstoneDemoSelectableToolName[];
  readonly onChange: (snapshot: ThurstoneDemoCatalogSnapshotV1) => void | Promise<void>;
  readonly onProcessEndingChange?: (
    toolName: ThurstoneDemoSelectableToolName,
    processEnding: boolean
  ) => void | Promise<void>;
}

interface DescriptorDraft {
  readonly title: string;
  readonly description: string;
}

type SaveStatus = "editing" | "saving" | "saved" | "error";

function draftsFor(snapshot: ThurstoneDemoCatalogSnapshotV1) {
  return Object.fromEntries(
    snapshot.tools.map(({ name, title, description }) => [name, { title, description }])
  ) as Partial<Record<ThurstoneDemoSelectableToolName, DescriptorDraft>>;
}

function overridesFor(
  snapshot: ThurstoneDemoCatalogSnapshotV1,
  drafts: Partial<Record<ThurstoneDemoSelectableToolName, DescriptorDraft>>
) {
  return Object.fromEntries(
    snapshot.tools.map(({ name, title, description }) => [
      name,
      drafts[name] ?? { title, description }
    ])
  ) as Partial<Record<ThurstoneDemoSelectableToolName, DescriptorDraft>>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The catalog change could not be applied.";
}

function preserveViewportAfterChange(position: { readonly left: number; readonly top: number }) {
  const restore = () => {
    if (window.scrollX !== position.left || window.scrollY !== position.top) {
      window.scrollTo(position.left, position.top);
    }
  };
  window.requestAnimationFrame(() => {
    restore();
  });
}

function registrationView(tool: ThurstoneDemoCatalogSnapshotV1["tools"][number]) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations
  };
}

export function ReferenceToolCatalog({
  snapshot,
  referencedToolNames = [],
  processEndingToolNames = [],
  onChange,
  onProcessEndingChange
}: ReferenceToolCatalogProps) {
  const [drafts, setDrafts] = useState(() => draftsFor(snapshot));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saveStatus, setSaveStatus] = useState<
    Partial<Record<ThurstoneDemoSelectableToolName, SaveStatus>>
  >({});

  const selectedNames = useMemo(() => snapshot.tools.map(({ name }) => name), [snapshot]);
  const availableNames = useMemo(
    () => THURSTONE_DEMO_SELECTABLE_TOOL_NAMES.filter((name) => !selectedNames.includes(name)),
    [selectedNames]
  );
  const referenced = new Set(referencedToolNames);

  async function commit(next: ThurstoneDemoCatalogSnapshotV1) {
    if (busy) return false;
    setBusy(true);
    setError(undefined);
    try {
      await onChange(next);
      setDrafts(draftsFor(next));
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function build(selectedToolNames: readonly ThurstoneDemoSelectableToolName[]) {
    return createThurstoneDemoCatalogSnapshot({
      selectedToolNames,
      descriptorOverrides: overridesFor(snapshot, drafts)
    });
  }

  async function applyWording(name: ThurstoneDemoSelectableToolName) {
    const draft = drafts[name];
    if (!draft) return;
    const current = snapshot.tools.find((tool) => tool.name === name);
    if (current && draft.title === current.title && draft.description === current.description) {
      setSaveStatus((statuses) => ({ ...statuses, [name]: "saved" }));
      return;
    }
    setSaveStatus((statuses) => ({ ...statuses, [name]: "saving" }));
    setError(undefined);
    try {
      const next = createThurstoneDemoCatalogSnapshot({
        selectedToolNames: selectedNames,
        descriptorOverrides: { ...overridesFor(snapshot, drafts), [name]: draft }
      });
      await onChange(next);
      setDrafts(draftsFor(next));
      setSaveStatus((statuses) => ({ ...statuses, [name]: "saved" }));
    } catch (caught) {
      setError(errorMessage(caught));
      setSaveStatus((statuses) => ({ ...statuses, [name]: "error" }));
    }
  }

  async function resetTool(name: ThurstoneDemoSelectableToolName) {
    const template = THURSTONE_REFERENCE_TOOL_TEMPLATES[name];
    const next = createThurstoneDemoCatalogSnapshot({
      selectedToolNames: selectedNames,
      descriptorOverrides: {
        ...overridesFor(snapshot, drafts),
        [name]: { title: template.defaultTitle, description: template.defaultDescription }
      }
    });
    if (await commit(next)) {
      setSaveStatus((statuses) => ({ ...statuses, [name]: "saved" }));
    }
  }

  async function addTool(name: ThurstoneDemoSelectableToolName) {
    if (selectedNames.includes(name)) return;
    const viewport = { left: window.scrollX, top: window.scrollY };
    if (await commit(build([...selectedNames, name]))) preserveViewportAfterChange(viewport);
  }

  async function removeTool(name: ThurstoneDemoSelectableToolName) {
    if (!selectedNames.includes(name) || referenced.has(name)) return;
    const viewport = { left: window.scrollX, top: window.scrollY };
    if (await commit(build(selectedNames.filter((selectedName) => selectedName !== name)))) {
      preserveViewportAfterChange(viewport);
    }
  }

  function editDraft(name: ThurstoneDemoSelectableToolName, next: DescriptorDraft) {
    setDrafts((current) => ({ ...current, [name]: next }));
    setSaveStatus((statuses) => ({ ...statuses, [name]: "editing" }));
  }

  return (
    <section className={styles.catalog} aria-labelledby="reference-catalog-title">
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">Stage 2 · Configure the test catalog</p>
          <h2 id="reference-catalog-title">Choose the tools you want Thurstone to test.</h2>
          <p>
            Thurstone starts each test-building session by ingesting the website&apos;s current
            WebMCP catalog, so the tools under test match the latest deployed version. Agents choose
            from tool names, titles, descriptions, schemas, annotations, and page context. In this
            demo, you can vary only the session-local agent-facing title and description; real
            names, schemas, handlers, and effects remain fixed.
          </p>
        </div>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <section className={styles.picker} aria-label="Choose reference WebMCP tools">
        <p className={styles.pickerInstruction}>
          Choose up to four real tools you would like to test.
        </p>
        {availableNames.length > 0 ? (
          <div className={styles.toolChoices} role="group" aria-label="Available WebMCP tools">
            {availableNames.map((name) => {
              const template = THURSTONE_REFERENCE_TOOL_TEMPLATES[name];
              return (
                <button
                  className={styles.toolChoice}
                  type="button"
                  key={name}
                  disabled={busy}
                  title={`Add ${name} to this test`}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => void addTool(name)}
                >
                  <code>{name}</code>
                  <small>{template.defaultTitle}</small>
                </button>
              );
            })}
          </div>
        ) : (
          <p className={styles.allSelected} role="status">
            All available tools selected.
          </p>
        )}
      </section>

      <div className={styles.toolList}>
        {snapshot.tools.length === 0 ? (
          <div className={styles.emptySelection}>
            <strong>No tools selected yet.</strong>
            <p>Choose a real reference tool above to configure its agent-visible wording.</p>
          </div>
        ) : null}
        {snapshot.tools.map((tool) => {
          const template = THURSTONE_REFERENCE_TOOL_TEMPLATES[tool.name];
          const draft = drafts[tool.name] ?? {
            title: tool.title,
            description: tool.description
          };
          const changed = draft.title !== tool.title || draft.description !== tool.description;
          const status = saveStatus[tool.name] ?? (changed ? "editing" : "saved");
          return (
            <article className={styles.tool} key={tool.name} data-tool-name={tool.name}>
              <header className={styles.toolHeader}>
                <div className={styles.toolIdentity}>
                  <h3>
                    <code>{tool.name}</code>
                  </h3>
                  <span className={styles.saveStatus} data-state={status} aria-live="polite">
                    {status === "saving"
                      ? "Saving…"
                      : status === "error"
                        ? "Needs attention"
                        : status === "editing"
                          ? "Editing…"
                          : "Saved"}
                  </span>
                </div>
                <div className={styles.toolActions}>
                  <label className={styles.processEndingControl}>
                    <input
                      type="checkbox"
                      checked={processEndingToolNames.includes(tool.name)}
                      disabled={busy}
                      onChange={(event) =>
                        void onProcessEndingChange?.(tool.name, event.target.checked)
                      }
                    />
                    Process-ending
                  </label>
                  <button
                    className={styles.resetAction}
                    type="button"
                    disabled={busy}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => void resetTool(tool.name)}
                  >
                    Reset
                  </button>
                  <button
                    className={styles.removeAction}
                    type="button"
                    disabled={busy || referenced.has(tool.name)}
                    title={
                      referenced.has(tool.name)
                        ? "Reassign or delete cases that use this tool before removing it."
                        : `Remove ${tool.name} from this test`
                    }
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => void removeTool(tool.name)}
                  >
                    Remove
                  </button>
                </div>
              </header>

              <div className={styles.fields}>
                <label>
                  <span className={styles.fieldHeading}>
                    <strong>Agent-visible title</strong>
                    <small>{draft.title.length}/80</small>
                  </span>
                  <input
                    value={draft.title}
                    maxLength={80}
                    onBlur={() => void applyWording(tool.name)}
                    onChange={(event) =>
                      editDraft(tool.name, { ...draft, title: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span className={styles.fieldHeading}>
                    <strong>Agent-visible description</strong>
                    <small>{draft.description.length}/600</small>
                  </span>
                  <textarea
                    value={draft.description}
                    maxLength={600}
                    rows={4}
                    onBlur={() => void applyWording(tool.name)}
                    onChange={(event) =>
                      editDraft(tool.name, { ...draft, description: event.target.value })
                    }
                  />
                </label>
              </div>

              <details className={styles.technicalDetails}>
                <summary>
                  View fixed handler, schema, annotations, and <code>registerTool()</code>
                </summary>
                <div className={styles.fixedContract}>
                  <div>
                    <span>Fixed handler and effect</span>
                    <strong>{template.handlerEffectSummary}</strong>
                    <small>{tool.handlerVersion}</small>
                  </div>
                  <div>
                    <span>Fixed annotations</span>
                    <code>{JSON.stringify(tool.annotations)}</code>
                  </div>
                  <div>
                    <span>Fixed input schema</span>
                    <pre tabIndex={0} aria-label={`${tool.name} fixed input schema`}>
                      {JSON.stringify(tool.inputSchema, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <span>Fixed registration</span>
                    <pre tabIndex={0} aria-label={`${tool.name} registerTool definition`}>
                      {JSON.stringify(registrationView(tool), null, 2)}
                    </pre>
                  </div>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}
