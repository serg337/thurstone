export function HeroSignalBackdrop() {
  return (
    <div className="hero-signal-backdrop" aria-hidden="true">
      <svg viewBox="0 0 1440 720" preserveAspectRatio="xMidYMid slice" role="presentation">
        <defs>
          <linearGradient id="hero-cyan-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#178bff" stopOpacity="0.16" />
            <stop offset="0.52" stopColor="#00d9ff" stopOpacity="0.72" />
            <stop offset="1" stopColor="#65e1d4" stopOpacity="0.92" />
          </linearGradient>
          <linearGradient id="hero-silver-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#9ab4c6" stopOpacity="0.1" />
            <stop offset="0.55" stopColor="#e7f8ff" stopOpacity="0.68" />
            <stop offset="1" stopColor="#36ecff" stopOpacity="0.88" />
          </linearGradient>
          <linearGradient id="hero-amber-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#00d9ff" stopOpacity="0.35" />
            <stop offset="0.55" stopColor="#ff9700" stopOpacity="0.72" />
            <stop offset="1" stopColor="#ffc247" stopOpacity="0.94" />
          </linearGradient>
          <radialGradient id="hero-gate-fill" cx="50%" cy="36%" r="72%">
            <stop offset="0" stopColor="#0c5b91" stopOpacity="0.62" />
            <stop offset="0.55" stopColor="#062339" stopOpacity="0.64" />
            <stop offset="1" stopColor="#02070a" stopOpacity="0.9" />
          </radialGradient>
          <filter id="hero-wide-blur" x="-40%" y="-80%" width="180%" height="260%">
            <feGaussianBlur stdDeviation="28" />
          </filter>
          <filter id="hero-line-glow" x="-30%" y="-100%" width="170%" height="300%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="hero-node-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="12" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="hero-signal-haze" filter="url(#hero-wide-blur)">
          <path d="M190 132 C470 118 640 170 934 348" />
          <path d="M198 492 C470 502 680 470 934 364" />
          <path className="hero-signal-haze-amber" d="M930 370 C1100 398 1170 490 1370 518" />
        </g>

        <g className="hero-input-nodes" filter="url(#hero-node-glow)">
          <circle cx="192" cy="132" r="18" />
          <rect x="172" y="208" width="40" height="40" rx="9" />
          <rect x="176" y="292" width="34" height="34" rx="4" transform="rotate(45 193 309)" />
          <path d="M192 376 210 386 210 407 192 417 174 407 174 386Z" />
          <path d="M173 472 214 492 173 512Z" />
        </g>

        <g className="hero-signal-traces" fill="none" strokeLinecap="round">
          <path className="hero-trace hero-trace-1" d="M218 132 C450 128 640 176 922 344" />
          <path className="hero-trace hero-trace-2" d="M218 228 C470 224 670 226 922 350" />
          <path className="hero-trace hero-trace-3" d="M218 309 C480 308 680 314 922 356" />
          <path className="hero-trace hero-trace-4" d="M218 397 C460 402 680 390 922 362" />
          <path className="hero-trace hero-trace-5" d="M218 492 C470 506 680 470 922 368" />
          <path className="hero-trace hero-trace-silver" d="M218 132 C500 112 670 214 922 348" />
          <path
            className="hero-trace hero-trace-silver hero-trace-delay"
            d="M218 397 C470 430 700 430 922 362"
          />
        </g>

        <g className="hero-verification-gate" filter="url(#hero-node-glow)">
          <path className="hero-gate-shackle" d="M894 314v-35a47 47 0 0 1 94 0v35" />
          <path className="hero-gate-body" d="M942 306 1003 340v72l-61 35-61-35v-72Z" />
          <path className="hero-gate-check" d="m908 375 23 23 48-52" />
          <circle className="hero-gate-core" cx="942" cy="376" r="7" />
        </g>

        <g className="hero-output-traces" fill="none" strokeLinecap="round">
          <path className="hero-output-pass" d="M1003 370 C1060 364 1100 316 1130 302" />
          <path className="hero-output-block" d="M994 394 C1060 424 1100 488 1130 512" />
        </g>

        <g className="hero-pass-node" filter="url(#hero-node-glow)">
          <circle cx="1160" cy="298" r="31" />
          <circle cx="1160" cy="298" r="22" />
          <path d="m1148 298 9 9 17-19" />
        </g>

        <g className="hero-block-node" filter="url(#hero-node-glow)">
          <path d="m1160 483 27 16v31l-27 16-27-16v-31Z" />
          <path d="m1150 504 20 20m0-20-20 20" />
        </g>

        <g className="hero-signal-ticks">
          <circle cx="408" cy="174" r="3" />
          <circle cx="544" cy="224" r="3" />
          <circle cx="674" cy="288" r="3" />
          <circle cx="774" cy="338" r="3" />
          <circle cx="1130" cy="348" r="3" />
          <circle className="hero-signal-tick-amber" cx="1184" cy="470" r="3" />
        </g>
      </svg>
    </div>
  );
}
