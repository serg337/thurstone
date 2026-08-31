export type DemoMode = "guided-demo" | "contract-workshop" | "open-sandbox";

const modes: readonly { readonly id: DemoMode; readonly label: string }[] = Object.freeze([
  Object.freeze({ id: "guided-demo", label: "Guided Demo" }),
  Object.freeze({ id: "contract-workshop", label: "Contract Workshop" }),
  Object.freeze({ id: "open-sandbox", label: "Open Sandbox" })
]);

export function DemoModeNav({
  selected,
  onSelect
}: {
  readonly selected: DemoMode;
  readonly onSelect: (mode: DemoMode) => void;
}) {
  return (
    <nav className="demo-mode-nav" aria-label="Demo modes">
      {modes.map((mode) => (
        <a
          key={mode.id}
          href={`#${mode.id}`}
          aria-current={selected === mode.id ? "page" : undefined}
          onClick={() => onSelect(mode.id)}
        >
          {mode.label}
        </a>
      ))}
    </nav>
  );
}
