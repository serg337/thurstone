const steps = [
  { number: "01", title: "Define", label: "Set intended meaning" },
  { number: "02", title: "Arm", label: "Freeze the test boundary" },
  { number: "03", title: "Test", label: "Observe a real agent" },
  { number: "04", title: "Verify", label: "Check trusted reality" },
  { number: "05", title: "Diagnose", label: "Locate the mismatch" },
  { number: "06", title: "Save", label: "Preserve the receipt" },
  { number: "07", title: "Rerun", label: "Verify the fix" }
] as const;

const desktopPositions = [
  { x: 120, y: 78 },
  { x: 400, y: 78 },
  { x: 680, y: 78 },
  { x: 960, y: 78 },
  { x: 960, y: 270 },
  { x: 680, y: 270 },
  { x: 400, y: 270 }
] as const;

export function HomeWorkflowOrbit() {
  return (
    <figure
      className="home-workflow-orbit"
      role="img"
      aria-label="Thurstone’s seven-step semantic release loop: define, arm, test, verify, diagnose, save, and rerun."
    >
      <svg className="workflow-path-desktop" viewBox="0 0 1080 370" aria-hidden="true">
        <defs>
          <linearGradient id="workflow-path-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#178bff" />
            <stop offset="0.52" stopColor="#36ecff" />
            <stop offset="1" stopColor="#65e1d4" />
          </linearGradient>
          <filter id="workflow-path-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          className="workflow-path-track"
          d="M120 78H960C1035 78 1042 115 1042 174S1035 270 960 270H400C258 270 224 191 120 78Z"
        />
        <path
          className="workflow-path-flow"
          d="M120 78H960C1035 78 1042 115 1042 174S1035 270 960 270H400C258 270 224 191 120 78Z"
        />

        <g className="workflow-path-arrows">
          <path d="M-8-6 8 0-8 6Z" transform="translate(260 78)" />
          <path d="M-8-6 8 0-8 6Z" transform="translate(540 78)" />
          <path d="M-8-6 8 0-8 6Z" transform="translate(820 78)" />
          <path d="M-8-6 8 0-8 6Z" transform="translate(1041 174) rotate(90)" />
          <path d="M-8-6 8 0-8 6Z" transform="translate(820 270) rotate(180)" />
          <path d="M-8-6 8 0-8 6Z" transform="translate(540 270) rotate(180)" />
          <path d="M-8-6 8 0-8 6Z" transform="translate(232 218) rotate(236)" />
        </g>

        {steps.map(({ number, title, label }, index) => {
          const position = desktopPositions[index]!;
          return (
            <g
              className="workflow-path-node"
              key={number}
              transform={`translate(${position.x} ${position.y})`}
            >
              <circle r="29" filter="url(#workflow-path-glow)" />
              <text className="workflow-path-number" y="4" textAnchor="middle">
                {number}
              </text>
              <text className="workflow-path-title" y="57" textAnchor="middle">
                {title}
              </text>
              <text className="workflow-path-label" y="79" textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      <svg className="workflow-path-mobile" viewBox="0 0 360 710" aria-hidden="true">
        <defs>
          <linearGradient id="workflow-mobile-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#178bff" />
            <stop offset="0.5" stopColor="#36ecff" />
            <stop offset="1" stopColor="#65e1d4" />
          </linearGradient>
          <filter id="workflow-mobile-node-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          className="workflow-mobile-path-track"
          d="M50 80V620C50 674 330 674 330 620V80C330 26 50 26 50 80Z"
        />
        <path
          className="workflow-mobile-path-flow"
          d="M50 80V620C50 674 330 674 330 620V80C330 26 50 26 50 80Z"
        />
        <g className="workflow-mobile-path-arrows">
          <path d="M-7-6 8 0-7 6Z" transform="translate(50 170) rotate(90)" />
          <path d="M-7-6 8 0-7 6Z" transform="translate(50 350) rotate(90)" />
          <path d="M-7-6 8 0-7 6Z" transform="translate(50 530) rotate(90)" />
          <path d="M-7-6 8 0-7 6Z" transform="translate(190 674)" />
          <path d="M-7-6 8 0-7 6Z" transform="translate(330 525) rotate(270)" />
          <path d="M-7-6 8 0-7 6Z" transform="translate(330 250) rotate(270)" />
          <path d="M-7-6 8 0-7 6Z" transform="translate(190 26) rotate(180)" />
        </g>

        {steps.map(({ number, title, label }, index) => (
          <g
            className="workflow-mobile-path-node"
            key={`mobile-${number}`}
            transform={`translate(50 ${80 + index * 90})`}
          >
            <circle r="24" filter="url(#workflow-mobile-node-glow)" />
            <text className="workflow-mobile-path-number" y="4" textAnchor="middle">
              {number}
            </text>
            <text className="workflow-mobile-path-title" x="44" y="-3">
              {title}
            </text>
            <text className="workflow-mobile-path-label" x="44" y="19">
              {label}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
