const GIT_SHA = /^[a-f0-9]{40}$/u;

export interface DeploymentCommitEnvironment {
  readonly [key: string]: string | undefined;
}

/** Vercel's immutable source identity is authoritative; the configured value is a local fallback. */
export function resolveDeploymentCommit(environment: DeploymentCommitEnvironment): string {
  const vercel = environment.VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  if (GIT_SHA.test(vercel)) return vercel;
  const configured = environment.TOOLPROOF_COMMIT_SHA?.trim() ?? "";
  return GIT_SHA.test(configured) ? configured : "unversioned";
}
