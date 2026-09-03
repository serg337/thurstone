"use client";

import { useState } from "react";

interface BrowserEntryGuideProps {
  readonly compact?: boolean;
}

const MANUAL_BROWSER_COMMAND = "Open https://thurstone.invarra.ai/demo";

function copyWithSelectionFallback(value: string): boolean {
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

export function BrowserEntryGuide({ compact = false }: BrowserEntryGuideProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copyCommand() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(MANUAL_BROWSER_COMMAND);
      } else if (!copyWithSelectionFallback(MANUAL_BROWSER_COMMAND)) {
        throw new Error("Clipboard unavailable.");
      }
      setCopyState("copied");
    } catch {
      setCopyState(copyWithSelectionFallback(MANUAL_BROWSER_COMMAND) ? "copied" : "failed");
    }
  }

  return (
    <section
      className="browser-entry-guide"
      data-compact={compact ? "true" : "false"}
      aria-labelledby="browser-entry-title"
    >
      <div className="browser-entry-primary">
        <p className="eyebrow">Independent-agent path</p>
        <h2 id="browser-entry-title">Open Thurstone in ChatGPT&apos;s In-App Browser</h2>
        <p>
          Open a fresh Work or Codex chat in the latest ChatGPT desktop app using GPT-5.6 Sol or
          Terra (<strong>not the Chrome side panel</strong>). Type <code>@</code>, select
          <strong> Browser</strong> from the composer menu, then paste the copied command. You can
          build the owner contract in any browser; only the fresh-agent test requires Site Tools.
        </p>
        <button
          className="button button-secondary browser-entry-copy"
          type="button"
          onClick={() => void copyCommand()}
        >
          {copyState === "copied" ? "Demo launch command copied" : "Copy Demo launch command"}
        </button>
        {copyState !== "idle" ? (
          <span className="browser-entry-copy-status" aria-live="polite">
            {copyState === "copied"
              ? "Select Browser from the @ menu, then paste the command after the mention."
              : "Copy was blocked. Select the command below."}
          </span>
        ) : null}
        {copyState === "failed" ? <code>{MANUAL_BROWSER_COMMAND}</code> : null}
      </div>
    </section>
  );
}
