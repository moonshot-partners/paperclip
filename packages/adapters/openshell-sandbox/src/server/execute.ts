import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import { asString, asNumber, asBoolean, parseObject } from "@paperclipai/adapter-utils/server-utils";
import { OpenShellClient, streamExecLines } from "openshell-node";
import { getOrCreateSandbox, deleteSandboxSafe } from "./sandbox.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const config = ctx.config;
  const gatewayUrl = asString(config.gatewayUrl, "127.0.0.1:8080");
  const gatewayCluster = asString(config.gatewayCluster, "openshell");
  const insecure = asBoolean(config.insecure, false);
  const persistSandbox = asBoolean(config.persistSandbox, false);
  const timeoutSec = asNumber(config.timeoutSec, 3600);
  const sandboxTimeoutSec = asNumber(config.sandboxTimeoutSec, 60);
  const model = asString(config.model, "");
  const maxTurns = asNumber(config.maxTurnsPerRun, 0);
  const effort = asString(config.effort, "");
  const skipPerms = asBoolean(config.dangerouslySkipPermissions, true);
  const envOverrides = parseObject(config.env);
  const providers = Array.isArray(config.providers) ? config.providers as string[] : [];

  const client = new OpenShellClient({ gateway: gatewayUrl, cluster: gatewayCluster, insecure });

  // Session key for sandbox naming (reuse across heartbeats if persistent)
  const sessionKey = ctx.runtime.taskKey ?? ctx.runId;
  const sandboxName = `paperclip-${ctx.agent.id.slice(0, 8)}-${sessionKey.slice(0, 12)}`;

  let exitCode: number | null = null;
  const stdoutLines: string[] = [];

  try {
    // 1. Create or reuse sandbox
    const sandbox = await getOrCreateSandbox(client, sandboxName, config, providers);
    await client.waitReady(sandbox.name, sandboxTimeoutSec * 1000);

    // 2. Build Claude CLI args
    const args = ["--print", "-", "--output-format", "stream-json", "--verbose"];
    if (model) args.push("--model", model);
    if (maxTurns > 0) args.push("--max-turns", String(maxTurns));
    if (effort) args.push("--effort", effort);
    if (skipPerms) args.push("--dangerously-skip-permissions");

    // Resume session if we have one
    const sessionId = asString(ctx.runtime.sessionParams?.sessionId, "");
    if (sessionId) args.push("--resume", sessionId);

    // 3. Build environment for the sandbox exec
    const execEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(envOverrides)) {
      if (typeof v === "string") execEnv[k] = v;
    }

    // Inject Paperclip context env vars
    execEnv.PAPERCLIP_RUN_ID = ctx.runId;
    execEnv.PAPERCLIP_AGENT_ID = ctx.agent.id;
    execEnv.PAPERCLIP_COMPANY_ID = ctx.agent.companyId;
    if (ctx.runtime.taskKey) execEnv.PAPERCLIP_TASK_KEY = ctx.runtime.taskKey;
    if (ctx.authToken) execEnv.PAPERCLIP_AUTH_TOKEN = ctx.authToken;

    // Build the prompt from context
    const prompt = asString(ctx.context.prompt, asString(ctx.context.message, ""));

    // 4. Execute Claude Code inside sandbox (streaming)
    const grpcStream = client.execSandbox({
      sandboxId: sandbox.id,
      command: ["claude", ...args],
      environment: execEnv,
      timeoutSeconds: timeoutSec,
      stdin: new TextEncoder().encode(prompt),
    });

    for await (const event of streamExecLines(grpcStream)) {
      if (event.type === "stdout") {
        stdoutLines.push(event.line);
        await ctx.onLog("stdout", event.line + "\n");
      } else if (event.type === "stderr") {
        await ctx.onLog("stderr", event.line + "\n");
      } else if (event.type === "exit") {
        exitCode = event.exitCode;
      }
    }

    // 5. Parse Claude stream-json output
    // Import parse from claude-local adapter (same format)
    const { parseClaudeStreamJson } = await import("@paperclipai/adapter-claude-local/server");
    const parsed = parseClaudeStreamJson(stdoutLines.join("\n"));

    // 6. Cleanup if ephemeral
    if (!persistSandbox) {
      await deleteSandboxSafe(client, sandbox.name);
    }

    client.close();

    return {
      exitCode: exitCode ?? (parsed.resultJson ? 0 : 1),
      signal: null,
      timedOut: false,
      usage: parsed.usage ?? undefined,
      model: parsed.model || undefined,
      costUsd: parsed.costUsd,
      summary: parsed.summary || undefined,
      resultJson: parsed.resultJson,
      sessionParams: parsed.sessionId ? { sessionId: parsed.sessionId } : undefined,
      sessionDisplayId: parsed.sessionId ?? undefined,
      provider: "anthropic",
      biller: "anthropic",
      billingType: "api",
    };
  } catch (err) {
    // Ensure cleanup on error
    if (!persistSandbox) {
      await deleteSandboxSafe(client, sandboxName);
    }
    client.close();

    const message = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      signal: null,
      timedOut: message.includes("timed out") || message.includes("timeout"),
      errorMessage: message,
    };
  }
}
