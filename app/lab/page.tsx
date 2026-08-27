import type { Metadata } from "next";
import { cookies } from "next/headers";

import { LabClient } from "@/components/lab/lab-client";
import { ProbeCalibrationRunner } from "@/components/lab/probe-calibration-runner";
import { ProbeLaunchPanel } from "@/components/lab/probe-launch-panel";
import { ProbeSessionBlocked } from "@/components/lab/probe-session-blocked";
import { StatusPill } from "@/components/status-pill";
import { requireProbeActivation } from "@/lib/probe/activation";
import { PROBE_SESSION_COOKIE, verifyProbeSession } from "@/lib/probe/session";

export const metadata: Metadata = { title: "Lab" };

type EvaluationSessionState = "inactive" | "active" | "blocked";

async function evaluationSessionState(): Promise<EvaluationSessionState> {
  const cookie = (await cookies()).get(PROBE_SESSION_COOKIE)?.value;
  if (!cookie) return "inactive";
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.TOOLPROOF_BROWSER_FAKE_PROBE === "1" &&
    cookie === "browser-fixture-session"
  ) {
    return "active";
  }
  try {
    const activation = await requireProbeActivation();
    verifyProbeSession({
      cookieValue: cookie,
      signingSecret: process.env.TOOLPROOF_SIGNING_SECRET ?? "",
      activationHash: activation.activationHash,
      buildCommit: activation.manifest.activeCommit
    });
    return "active";
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
          <StatusPill state="pending">Gate 2 · non-scored calibration</StatusPill>
        </header>
        {sessionState === "active" ? <ProbeCalibrationRunner /> : <ProbeSessionBlocked />}
      </div>
    );
  }
  return (
    <div className="page-shell route-page">
      <header className="route-hero">
        <div>
          <p className="eyebrow">Lab · execution trust surface</p>
          <h1>One live tool catalog. No expected answers.</h1>
          <p>
            Five deterministic checkout tools share one replay-safe store. Four are exposed at the
            initial fixture; cancellation appears only while simulated checkout is pending.
          </p>
        </div>
        <StatusPill state="pending">Gate 1 · native plumbing proof</StatusPill>
      </header>
      <LabClient />
      <ProbeLaunchPanel />
    </div>
  );
}
