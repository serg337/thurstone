import type { Metadata } from "next";
import { cookies } from "next/headers";

import { LabClient } from "@/components/lab/lab-client";
import { ProbeCalibrationRunner } from "@/components/lab/probe-calibration-runner";
import { ProbeLaunchPanel } from "@/components/lab/probe-launch-panel";
import { ProbeSessionBlocked } from "@/components/lab/probe-session-blocked";
import { StatusPill } from "@/components/status-pill";
import { requireProbeActivation } from "@/lib/probe/activation";
import {
  PROBE_RECOVERY_COOKIE,
  PROBE_SESSION_COOKIE,
  verifyProbeRecoveryCredential,
  verifyProbeSession
} from "@/lib/probe/session";

export const metadata: Metadata = { title: "Lab" };

type EvaluationSessionState = "inactive" | "active" | "blocked";

async function evaluationSessionState(): Promise<EvaluationSessionState> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(PROBE_SESSION_COOKIE)?.value;
  const recoveryCookie = cookieStore.get(PROBE_RECOVERY_COOKIE)?.value;
  if (!cookie && !recoveryCookie) return "inactive";
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.TOOLPROOF_BROWSER_FAKE_PROBE === "1" &&
    cookie === "browser-fixture-session"
  ) {
    return "active";
  }
  try {
    const activation = await requireProbeActivation();
    const signingSecret = process.env.TOOLPROOF_SIGNING_SECRET ?? "";
    if (cookie) {
      try {
        verifyProbeSession({
          cookieValue: cookie,
          signingSecret,
          activationHash: activation.activationHash,
          buildCommit: activation.manifest.activeCommit
        });
        return "active";
      } catch {
        // A short API session may expire while its fixed recovery credential remains valid.
      }
    }
    if (recoveryCookie) {
      verifyProbeRecoveryCredential({
        cookieValue: recoveryCookie,
        signingSecret,
        activationHash: activation.activationHash,
        buildCommit: activation.manifest.activeCommit
      });
      return "active";
    }
    return "blocked";
  } catch {
    return "blocked";
  }
}

export default async function LabPage() {
  const sessionState = await evaluationSessionState();
  if (sessionState !== "inactive") {
    return (
      <div className="page-shell route-page probe-evaluation-shell">
        <header className="route-hero">
          <div>
            <p className="eyebrow">Lab · isolated Probe trust surface</p>
            <h1>One fresh decision. No prior evidence.</h1>
            <p>
              The current document contains only the declared synthetic fixture, the live target
              catalog, and the operational runner needed for this one trial.
            </p>
          </div>
          <StatusPill state="pending">Gate 2 · final non-scored calibration</StatusPill>
        </header>
        {sessionState === "active" ? <ProbeCalibrationRunner /> : <ProbeSessionBlocked />}
      </div>
    );
  }
  return (
    <div className="page-shell route-page">
      <header className="route-hero">
        <div>
          <p className="eyebrow">Live reference environment</p>
          <h1>Explore the live WebMCP sandbox.</h1>
          <p>
            Use the reference cart, invoke page tools, test replay and reset, and compare tool
            responses with trusted state.
          </p>
          <details className="expert-disclosure route-setup">
            <summary>Native browser setup</summary>
            <p>
              Use the official ChatGPT in-app browser. In Chrome 149+, enable{" "}
              <code>chrome://flags/#enable-webmcp-testing</code> and relaunch. If discovery reports
              a mismatch, close other Thurstone tabs and reload this one.
            </p>
          </details>
          <a className="button button-secondary" href="/results">
            View verified results
          </a>
        </div>
        <StatusPill state="ready">Provider-free sandbox</StatusPill>
      </header>
      <div id="impact-execution-judge-action" />
      <LabClient />
      <ProbeLaunchPanel />
    </div>
  );
}
