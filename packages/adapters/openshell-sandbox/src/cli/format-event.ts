import pc from "picocolors";

export function printOpenShellStreamEvent(event: unknown): string {
  if (!event || typeof event !== "object") return "";
  const e = event as Record<string, unknown>;
  const type = typeof e.type === "string" ? e.type : "";

  if (type === "sandbox_created") {
    return pc.dim(`[openshell] Sandbox created: ${e.name ?? "unknown"}`);
  }
  if (type === "sandbox_ready") {
    return pc.green(`[openshell] Sandbox ready`);
  }
  if (type === "sandbox_deleted") {
    return pc.dim(`[openshell] Sandbox cleaned up`);
  }
  return "";
}
