import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import { asString, asNumber, asBoolean, parseObject, renderTemplate } from "@paperclipai/adapter-utils/server-utils";
import { parseClaudeStreamJson } from "@paperclipai/adapter-claude-local/server";
import { OpenShellClient, streamExecLines } from "openshell-node";
import { getOrCreateSandbox, deleteSandboxSafe } from "./sandbox.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const config = ctx.config;
  const gatewayUrl = asString(config.gatewayUrl, "127.0.0.1:8080");
  const gatewayCluster = asString(config.gatewayCluster, "openshell");
  const insecure = asBoolean(config.insecure, false);
  const persistSandbox = asBoolean(config.persistSandbox, false);
  const timeoutSec = asNumber(config.timeoutSec, 3600);
  const sandboxTimeoutSec = asNumber(config.sandboxTimeoutSec, 120);
  const model = asString(config.model, "");
  const maxTurns = asNumber(config.maxTurnsPerRun, 0);
  const effort = asString(config.effort, "");
  const skipPerms = asBoolean(config.dangerouslySkipPermissions, true);
  const envOverrides = parseObject(config.env);
  const providers = Array.isArray(config.providers) ? config.providers as string[] : [];

  const client = new OpenShellClient({ gateway: gatewayUrl, cluster: gatewayCluster, insecure });

  const sessionKey = ctx.runtime.taskKey ?? ctx.runId;
  // K8s pod names max 63 chars — use short hashes of agent ID and session key
  const agentHash = ctx.agent.id.replace(/-/g, "").slice(0, 8);
  const sessionHash = sessionKey.replace(/-/g, "").slice(0, 12);
  const sandboxName = `pclip-${agentHash}-${sessionHash}`;

  let resolvedSandboxName = sandboxName;
  let exitCode: number | null = null;
  let result: AdapterExecutionResult;
  const stdoutLines: string[] = [];

  try {
    const sandbox = await getOrCreateSandbox(client, sandboxName, config, providers, persistSandbox);
    resolvedSandboxName = sandbox.name;
    await client.waitReady(sandbox.name, sandboxTimeoutSec * 1000);

    // Build Claude CLI args
    const args = ["--print", "-", "--output-format", "stream-json", "--verbose"];
    if (model) args.push("--model", model);
    if (maxTurns > 0) args.push("--max-turns", String(maxTurns));
    if (effort) args.push("--effort", effort);
    if (skipPerms) args.push("--dangerously-skip-permissions");

    const sessionId = asString(ctx.runtime.sessionParams?.sessionId, "");
    if (sessionId) args.push("--resume", sessionId);

    // Build environment
    const execEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(envOverrides)) {
      if (typeof v === "string") execEnv[k] = v;
    }

    // Claude credentials — support both OAuth token and API key.
    // OAuth token (CLAUDE_CODE_OAUTH_TOKEN) is preferred for team subscriptions.
    // API key (ANTHROPIC_API_KEY) is the standard for direct API access.
    // Both can be set in adapterConfig.env or inherited from the server environment.
    if (!execEnv.CLAUDE_CODE_OAUTH_TOKEN && !execEnv.ANTHROPIC_API_KEY) {
      const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (oauthToken) execEnv.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
      else if (apiKey) execEnv.ANTHROPIC_API_KEY = apiKey;
    }

    // Paperclip context
    execEnv.PAPERCLIP_RUN_ID = ctx.runId;
    execEnv.PAPERCLIP_AGENT_ID = ctx.agent.id;
    execEnv.PAPERCLIP_COMPANY_ID = ctx.agent.companyId;
    if (ctx.runtime.taskKey) execEnv.PAPERCLIP_TASK_KEY = ctx.runtime.taskKey;
    if (ctx.authToken) execEnv.PAPERCLIP_AUTH_TOKEN = ctx.authToken;

    // Build prompt from template (same pattern as claude_local adapter)
    const promptTemplate = asString(
      config.promptTemplate,
      "You are agent {{agent.name}}. Continue your Paperclip work.",
    );
    const templateData = {
      agentId: ctx.agent.id,
      companyId: ctx.agent.companyId,
      runId: ctx.runId,
      company: { id: ctx.agent.companyId },
      agent: ctx.agent,
      run: { id: ctx.runId },
      context: ctx.context,
    };
    const prompt = renderTemplate(promptTemplate, templateData);

    // Execute Claude Code inside sandbox (streaming)
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

    // Parse Claude stream-json output
    const parsed = parseClaudeStreamJson(stdoutLines.join("\n"));

    result = {
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
    const message = err instanceof Error ? err.message : String(err);
    result = {
      exitCode: 1,
      signal: null,
      timedOut: message.includes("timed out") || message.includes("timeout"),
      errorMessage: message,
    };
  } finally {
    if (!persistSandbox) {
      await deleteSandboxSafe(client, resolvedSandboxName);
    }
    client.close();
  }

  return result;
}
