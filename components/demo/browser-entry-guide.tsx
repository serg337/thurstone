interface BrowserEntryGuideProps {
  readonly compact?: boolean;
}

const MANUAL_BROWSER_COMMAND = "@Browser Open https://thurstone.invarra.ai/demo";

export function BrowserEntryGuide({ compact = false }: BrowserEntryGuideProps) {
  return (
    <section
      className="browser-entry-guide"
      data-compact={compact ? "true" : "false"}
      aria-labelledby="browser-entry-title"
    >
      <div className="browser-entry-primary">
        <p className="eyebrow">Independent-agent path</p>
        <h2 id="browser-entry-title">Open Thurstone in ChatGPT&apos;s Browser</h2>
        <p>
          Start a fresh task in the latest ChatGPT desktop app with GPT-5.6 Sol or Terra and enter
          this exact command in the chat:
        </p>
        <code>{MANUAL_BROWSER_COMMAND}</code>
        {!compact ? (
          <>
            <strong>Chrome extension side chat is not the Site Tools consumer.</strong>
            <p>
              You can still build the owner contract in any browser. The fresh-agent Site Tools test
              later in the Demo must run in ChatGPT&apos;s built-in Browser.
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
