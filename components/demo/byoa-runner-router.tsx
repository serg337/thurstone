"use client";

import { useEffect, useState } from "react";

import { ByoaRunner } from "@/components/demo/byoa-runner-live";
import { ByoaRunnerV2 } from "@/components/demo/byoa-runner-live-v2";
import {
  BYOA_REMOTE_SESSION_V2_STORAGE_KEY,
  BYOA_RUNNER_V2_MARKER_KEY
} from "@/lib/demo/agent-handoff-v2";
import { BYOA_AGENT_PROJECTION_V2_STORAGE_KEY } from "@/lib/demo/agent-projection";
import { BYOA_SESSION_V2_STORAGE_KEY } from "@/lib/demo/agent-session-v2";

export function ByoaRunnerRouter() {
  const [version, setVersion] = useState<1 | 2>();

  useEffect(() => {
    const storage = window.sessionStorage;
    const v2 =
      window.location.hash === "#handoff-source-v2" ||
      storage.getItem(BYOA_RUNNER_V2_MARKER_KEY) === "2" ||
      storage.getItem(BYOA_SESSION_V2_STORAGE_KEY) !== null ||
      storage.getItem(BYOA_REMOTE_SESSION_V2_STORAGE_KEY) !== null ||
      storage.getItem(BYOA_AGENT_PROJECTION_V2_STORAGE_KEY) !== null;
    queueMicrotask(() => setVersion(v2 ? 2 : 1));
  }, []);

  if (version === undefined) {
    return (
      <section className="agent-runner-loading" aria-live="polite">
        <p className="eyebrow">Opening isolated run</p>
        <h1>Verifying the handoff version…</h1>
      </section>
    );
  }
  return version === 2 ? <ByoaRunnerV2 /> : <ByoaRunner />;
}
