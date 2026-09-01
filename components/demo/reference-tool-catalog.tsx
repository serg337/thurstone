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
  readonly onChange: (snapshot: ThurstoneDemoCatalogSnapshotV1) => void | Promise<void>;
}

interface DescriptorDraft {
  readonly title: string;
  readonly description: string;
}

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
  onChange
}: ReferenceToolCatalogProps) {
  const [drafts, setDrafts] = useState(() => draftsFor(snapshot));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const selectedNames = useMemo(() => snapshot.tools.map(({ name }) => name), [snapshot]);
  const availableNames = THURSTONE_DEMO_SELECTABLE_TOOL_NAMES.filter(
    (name) => !selectedNames.includes(name)
  );
  const referenced = new Set(referencedToolNames);

  async function commit(next: ThurstoneDemoCatalogSnapshotV1) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onChange(next);
      setDrafts(draftsFor(next));
    } catch (caught) {
      setError(errorMessage(caught));
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
    try {
      const next = createThurstoneDemoCatalogSnapshot({
        selectedToolNames: selectedNames,
        descriptorOverrides: { ...overridesFor(snapshot, drafts), [name]: draft }
      });
      await commit(next);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function resetTool(name: ThurstoneDemoSelectableToolName) {
    const template = THURSTONE_REFERENCE_TOOL_TEMPLATES[name];
    await commit(
      createThurstoneDemoCatalogSnapshot({
        selectedToolNames: selectedNames,
        descriptorOverrides: {
          ...overridesFor(snapshot, drafts),
          [name]: { title: template.defaultTitle, description: template.defaultDescription }
        }
      })
    );
  }

  return (
    <section className={styles.catalog} aria-labelledby="reference-catalog-title">
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">Preconfigured for the Thurstone reference checkout</p>
          <h2 id="reference-catalog-title">Choose the real WebMCP tools this test will expose.</h2>
          <p>
            Agents choose from names, titles, descriptions, schemas, annotations, and page context.
            This test varies only the session-local agent-facing wording while real schemas,
            handlers, and effects remain fixed.
          </p>
          <p className={styles.privacyNotice}>
            Synthetic test wording only. Do not enter personal, customer, credential, payment,
            confidential, or secret data.
          </p>
        </div>
        <span className={styles.count} aria-live="polite">
          {snapshot.tools.length} real tools selected
        </span>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.toolList}>
        {snapshot.tools.map((tool) => {
          const template = THURSTONE_REFERENCE_TOOL_TEMPLATES[tool.name];
          const draft = drafts[tool.name] ?? {
            title: tool.title,
            description: tool.description
          };
          const changed = draft.title !== tool.title || draft.description !== tool.description;
          const removalBlocked = snapshot.tools.length <= 2 || referenced.has(tool.name);
          return (
            <article className={styles.tool} key={tool.name} data-tool-name={tool.name}>
              <header className={styles.toolHeader}>
                <div>
                  <span data-classification={template.classification}>
                    {template.classification === "read_only" ? "Read-only" : "Consequential"}
                  </span>
                  <h3>
                    <code>{tool.name}</code>
                    <small>fixed tool name</small>
                  </h3>
                </div>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy || removalBlocked}
                  title={
                    referenced.has(tool.name)
                      ? "Reassign or delete cases that use this tool before removing it."
                      : snapshot.tools.length <= 2
                        ? "At least two real tools are required."
                        : undefined
                  }
                  onClick={() =>
                    void commit(build(selectedNames.filter((name) => name !== tool.name)))
                  }
                >
                  Remove
                </button>
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
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [tool.name]: { ...draft, title: event.target.value }
                      }))
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
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [tool.name]: { ...draft, description: event.target.value }
                      }))
                    }
                  />
                </label>
              </div>

              <div className={styles.wordingActions}>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={busy || !changed}
                  onClick={() => void applyWording(tool.name)}
                >
                  Apply agent wording
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void resetTool(tool.name)}
                >
                  Reset to verified default
                </button>
              </div>

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
              </div>

              <details className={styles.registration}>
                <summary>
                  View <code>registerTool()</code> definition
                </summary>
                <pre tabIndex={0} aria-label={`${tool.name} registerTool definition`}>
                  {JSON.stringify(registrationView(tool), null, 2)}
                </pre>
              </details>
            </article>
          );
        })}
      </div>

      <section className={styles.library} aria-labelledby="reference-library-title">
        <div>
          <h3 id="reference-library-title">Add from reference tool library</h3>
          <p>Every option below already has a real handler and independently verifiable effect.</p>
        </div>
        <div className={styles.libraryActions}>
          {availableNames.map((name) => (
            <button
              className="button button-secondary"
              type="button"
              key={name}
              disabled={busy || snapshot.tools.length >= 4}
              onClick={() => void commit(build([...selectedNames, name]))}
            >
              Add <code>{name}</code>
            </button>
          ))}
          {availableNames.length === 0 ? <span>All four clean-fixture tools selected.</span> : null}
        </div>
        <aside>
          <strong>
            <code>checkout_cancel</code> is real but advanced.
          </strong>
          <p>
            It requires an existing pending checkout, so it cannot honestly enter this clean
            one-case, one-call catalog. Test it in the technical Lab.
          </p>
          <a href="/lab">Open advanced Lab</a>
        </aside>
      </section>

      <section className={styles.preview} aria-labelledby="agent-catalog-preview-title">
        <header>
          <div>
            <p className="eyebrow">Live preview</p>
            <h3 id="agent-catalog-preview-title">What the agent receives</h3>
          </div>
          <span>{snapshot.tools.length} discoverable tools</span>
        </header>
        <div>
          {snapshot.tools.map((tool) => (
            <article key={tool.name}>
              <strong>{tool.title}</strong>
              <code>{tool.name}</code>
              <p>{tool.description}</p>
            </article>
          ))}
        </div>
        <small>
          The owner&apos;s expected action and effect rules are not part of this preview.
        </small>
      </section>

      <button
        className="button button-secondary"
        type="button"
        disabled={busy}
        onClick={() => void commit(createThurstoneDemoCatalogSnapshot())}
      >
        Reset entire catalog to verified default
      </button>
    </section>
  );
}
