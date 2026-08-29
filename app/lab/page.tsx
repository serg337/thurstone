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
          <p className="eyebrow">Lab · execution trust surface</p>
          <h1>One live tool catalog. No expected answers.</h1>
          <p>
            Five deterministic checkout tools share one replay-safe store. Four are exposed at the
            initial fixture; cancellation appears only while simulated checkout is pending.
          </p>
        </div>
        <StatusPill state="ready">Gate 7 · live judge and Site Tools proof</StatusPill>
      </header>
      <LabClient />
      <ProbeLaunchPanel />
    </div>
  );
}
