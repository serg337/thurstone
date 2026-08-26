# Third-party notices

Checked for the initial Gate 0 dependency set on 26 August 2026. The release process will regenerate a complete transitive inventory from the final lockfile and fail closed on unknown or incompatible rights.

## Runtime and application dependencies

| Component         |    Pin | Source                                         | License | Use                                        |
| ----------------- | -----: | ---------------------------------------------- | ------- | ------------------------------------------ |
| Next.js           | 16.3.3 | https://github.com/vercel/next.js              | MIT     | Web application and server routes          |
| React / React DOM | 19.2.8 | https://github.com/facebook/react              | MIT     | Interface runtime                          |
| Zod               |  4.4.3 | https://github.com/colinhacks/zod              | MIT     | Runtime validation and schema generation   |
| json-canonicalize |  3.0.0 | https://github.com/snowyu/json-canonicalize.ts | MIT     | Canonical JSON evidence bytes              |
| Upstash Redis SDK | 1.38.3 | https://github.com/upstash/redis-js            | MIT     | Server-only durable guard transport        |
| uncrypto          |  0.1.3 | https://github.com/unjs/uncrypto               | MIT     | Upstash SDK cryptographic compatibility    |
| server-only       |  0.0.1 | https://github.com/facebook/react              | MIT     | Prevents client imports of server controls |

## Development and verification dependencies

| Component                 |                                                    Pin | Source                                             | License      | Use                                                               |
| ------------------------- | -----------------------------------------------------: | -------------------------------------------------- | ------------ | ----------------------------------------------------------------- |
| TypeScript                |                                                  6.0.3 | https://github.com/microsoft/TypeScript            | Apache-2.0   | Strict type checking                                              |
| ESLint                    |                                                 9.39.5 | https://github.com/eslint/eslint                   | MIT          | Static analysis; maintenance pin required by current Next plugins |
| eslint-config-next        |                                                 16.3.3 | https://github.com/vercel/next.js                  | MIT          | Next/React lint rules                                             |
| Prettier                  |                                                  3.9.6 | https://github.com/prettier/prettier               | MIT          | Formatting                                                        |
| tsx                       |                                                4.23.12 | https://github.com/privatenumber/tsx               | MIT          | Operator-only TypeScript control scripts                          |
| Vitest / coverage         |                                                 4.1.11 | https://github.com/vitest-dev/vitest               | MIT          | Deterministic tests and coverage                                  |
| Testing Library packages  |                                See `package-lock.json` | https://github.com/testing-library                 | MIT          | Component interaction tests                                       |
| jsdom                     |                                                 30.0.1 | https://github.com/jsdom/jsdom                     | MIT          | Test DOM runtime                                                  |
| Playwright                |                                                 1.62.1 | https://github.com/microsoft/playwright            | Apache-2.0   | Ordinary browser regression tests                                 |
| Axe Core Playwright       |                                                 4.13.0 | https://github.com/dequelabs/axe-core-npm          | MPL-2.0      | Accessibility checks; used unmodified as test tooling             |
| webmcp-types              | 0.1.5, commit d54df903bddb0453e2e6940dd41984ef72a44f85 | https://github.com/webmachinelearning/webmcp-types | MIT          | Official ambient WebMCP declarations                              |
| Node.js type declarations |                                                22.20.1 | https://github.com/DefinitelyTyped/DefinitelyTyped | MIT          | Node TypeScript declarations                                      |
| React type declarations   |                                       19.2.18 / 19.2.5 | https://github.com/DefinitelyTyped/DefinitelyTyped | MIT          | React TypeScript declarations                                     |
| npm                       |                                                 10.9.8 | https://github.com/npm/cli                         | Artistic-2.0 | Package manager and lockfile                                      |

## Continuous-integration actions and tools

| Component               | Immutable pin                                                                                        | Source                                     | License | Use                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------- | ------------------------------- |
| actions/checkout        | 11d5960a326750d5838078e36cf38b85af677262                                                             | https://github.com/actions/checkout        | MIT     | Read-only source checkout       |
| actions/setup-node      | 49933ea5288caeca8642d1e84afbd3f7d6820020                                                             | https://github.com/actions/setup-node      | MIT     | Pinned Node/npm setup and cache |
| actions/upload-artifact | ea165f8d65b6e75b540449e92b4886f43607fa02                                                             | https://github.com/actions/upload-artifact | MIT     | Failure-only browser artifacts  |
| Gitleaks CLI            | 8.30.1; Linux x64 archive SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` | https://github.com/gitleaks/gitleaks       | MIT     | Complete-history secret scan    |

## APIs and specifications

- WebMCP is an evolving Web Machine Learning Community Group draft. The specification is not a W3C Standard.
- ChatGPT Site Tools are used as a supported browser-agent path; this project is not affiliated with or endorsed by OpenAI.
- Chrome WebMCP documentation and DevTools are used for implementation and verification guidance; this project is not an officially supported Google or Chrome product.
- A future OpenAI Responses API Probe may be enabled only under the provider's applicable terms, a server-held credential, bounded synthetic data, and an approved hard spend ceiling.

## Assets

The initial application uses project-authored CSS, text, and interface shapes with system fonts. It contains no third-party image, icon, music, video, sound, dataset, or adapted runner sou
