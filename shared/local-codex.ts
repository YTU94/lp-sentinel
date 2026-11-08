export const localCodexUrl = "http://127.0.0.1:4318";
export const localCodexLaunchUrl = "lp-sentinel://repair";
export type LocalCodexPhase = "checking" | "ready" | "needs-login" | "missing-cli" | "error";

export interface LocalCodexStatus {
  service: "lp-sentinel-codex";
  version: 1;
  phase: LocalCodexPhase;
  message: string;
  checkedAt: string;
  verifiedAt?: string;
  cliVersion?: string;
  sessionToken: string;
}
