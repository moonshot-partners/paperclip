import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

// Mock openshell-node
const mockClient = {
  waitReady: vi.fn(),
  execSandbox: vi.fn(),
  deleteSandbox: vi.fn(),
  getSandbox: vi.fn(),
  createSandbox: vi.fn(),
  close: vi.fn(),
};

vi.mock("openshell-node", () => ({
  OpenShellClient: vi.fn(() => mockClient),
  streamExecLines: vi.fn(),
}));

// Mock claude-local parser
vi.mock("@paperclipai/adapter-claude-local/server", () => ({
  parseClaudeStreamJson: vi.fn(() => ({
    sessionId: "test-session-123",
    model: "claude-opus-4-6",
    costUsd: 0.05,
    usage: { inputTokens: 100, outputTokens: 50 },
    summary: "Hello world",
    resultJson: { type: "result", result: "Hello world" },
  })),
}));

import { execute } from "../execute.js";
import { streamExecLines } from "openshell-node";

function makeCtx(overrides?: Partial<AdapterExecutionContext>): AdapterExecutionContext {
  return {
    runId: "run-001",
    agent: { id: "agent-abc-123", companyId: "company-xyz", name: "Test Agent", adapterType: "openshell_sandbox", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: "task-001" },
    config: {
      gatewayUrl: "127.0.0.1:8080",
      insecure: true,
    },
    context: { prompt: "Say hello" },
    onLog: vi.fn(),
    ...overrides,
  };
}

function makeStream(stdoutLines: string[], exitCode = 0) {
  return async function* () {
    for (const line of stdoutLines) {
      yield { type: "stdout" as const, line };
    }
    yield { type: "exit" as const, exitCode };
  };
}

describe("openshell-sandbox execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.createSandbox.mockResolvedValue({ id: "sb-123", name: "paperclip-agent-abc-123-task-001", phase: 2 });
    mockClient.getSandbox.mockRejectedValue(new Error("not found"));
    mockClient.waitReady.mockResolvedValue({ id: "sb-123", name: "paperclip-agent-abc-123-task-001", phase: 2 });
    mockClient.deleteSandbox.mockResolvedValue(undefined);
  });

  it("creates sandbox, executes claude, parses output, and cleans up", async () => {
    const streamOutput = makeStream([
      '{"type":"system","subtype":"init","session_id":"sess-1","model":"claude-opus-4-6"}',
      '{"type":"result","result":"Hello world","session_id":"sess-1"}',
    ]);
    vi.mocked(streamExecLines).mockReturnValue(streamOutput());

    const ctx = makeCtx();
    const result = await execute(ctx);

    // Sandbox lifecycle
    expect(mockClient.createSandbox).toHaveBeenCalledOnce();
    expect(mockClient.waitReady).toHaveBeenCalledOnce();
    expect(mockClient.deleteSandbox).toHaveBeenCalledOnce(); // ephemeral cleanup
    expect(mockClient.close).toHaveBeenCalledOnce();

    // Result
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.sessionParams).toEqual({ sessionId: "test-session-123" });
    expect(result.provider).toBe("anthropic");
  });

  it("streams stdout to onLog", async () => {
    const streamOutput = makeStream(["line1", "line2"]);
    vi.mocked(streamExecLines).mockReturnValue(streamOutput());

    const ctx = makeCtx();
    await execute(ctx);

    expect(ctx.onLog).toHaveBeenCalledWith("stdout", "line1\n");
    expect(ctx.onLog).toHaveBeenCalledWith("stdout", "line2\n");
  });

  it("streams stderr to onLog", async () => {
    async function* stream() {
      yield { type: "stderr" as const, line: "warning message" };
      yield { type: "exit" as const, exitCode: 0 };
    }
    vi.mocked(streamExecLines).mockReturnValue(stream());

    const ctx = makeCtx();
    await execute(ctx);

    expect(ctx.onLog).toHaveBeenCalledWith("stderr", "warning message\n");
  });

  it("skips sandbox deletion when persistSandbox is true", async () => {
    const streamOutput = makeStream(["output"]);
    vi.mocked(streamExecLines).mockReturnValue(streamOutput());

    const ctx = makeCtx({ config: { gatewayUrl: "127.0.0.1:8080", insecure: true, persistSandbox: true } });
    await execute(ctx);

    expect(mockClient.deleteSandbox).not.toHaveBeenCalled();
    expect(mockClient.close).toHaveBeenCalledOnce(); // client always closed
  });

  it("returns error result on sandbox creation failure", async () => {
    mockClient.createSandbox.mockRejectedValue(new Error("quota exceeded"));

    const ctx = makeCtx();
    const result = await execute(ctx);

    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toBe("quota exceeded");
    expect(result.timedOut).toBe(false);
    expect(mockClient.close).toHaveBeenCalledOnce(); // cleanup still runs
  });

  it("sets timedOut when error message contains timeout", async () => {
    mockClient.waitReady.mockRejectedValue(new Error("Sandbox did not become ready: timed out"));

    const ctx = makeCtx();
    const result = await execute(ctx);

    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(true);
  });

  it("cleans up sandbox even when exec throws", async () => {
    vi.mocked(streamExecLines).mockImplementation(() => {
      throw new Error("gRPC stream failed");
    });

    const ctx = makeCtx();
    await execute(ctx);

    expect(mockClient.deleteSandbox).toHaveBeenCalledOnce();
    expect(mockClient.close).toHaveBeenCalledOnce();
  });

  it("passes model and maxTurns to claude args", async () => {
    const streamOutput = makeStream(["output"]);
    vi.mocked(streamExecLines).mockReturnValue(streamOutput());

    const ctx = makeCtx({
      config: { gatewayUrl: "127.0.0.1:8080", insecure: true, model: "claude-sonnet-4-6", maxTurnsPerRun: 50 },
    });
    await execute(ctx);

    // Check the command passed to execSandbox includes model and max-turns
    const execCall = mockClient.execSandbox.mock.calls[0][0];
    expect(execCall.command).toContain("--model");
    expect(execCall.command).toContain("claude-sonnet-4-6");
    expect(execCall.command).toContain("--max-turns");
    expect(execCall.command).toContain("50");
  });

  it("injects Paperclip context env vars", async () => {
    const streamOutput = makeStream(["output"]);
    vi.mocked(streamExecLines).mockReturnValue(streamOutput());

    const ctx = makeCtx({ authToken: "jwt-token-123" });
    await execute(ctx);

    const execCall = mockClient.execSandbox.mock.calls[0][0];
    expect(execCall.environment.PAPERCLIP_RUN_ID).toBe("run-001");
    expect(execCall.environment.PAPERCLIP_AGENT_ID).toBe("agent-abc-123");
    expect(execCall.environment.PAPERCLIP_COMPANY_ID).toBe("company-xyz");
    expect(execCall.environment.PAPERCLIP_TASK_KEY).toBe("task-001");
    expect(execCall.environment.PAPERCLIP_AUTH_TOKEN).toBe("jwt-token-123");
  });

  it("resumes session when sessionParams.sessionId is set", async () => {
    const streamOutput = makeStream(["output"]);
    vi.mocked(streamExecLines).mockReturnValue(streamOutput());

    const ctx = makeCtx({
      runtime: { sessionId: null, sessionParams: { sessionId: "prev-session" }, sessionDisplayId: null, taskKey: "task-001" },
    });
    await execute(ctx);

    const execCall = mockClient.execSandbox.mock.calls[0][0];
    expect(execCall.command).toContain("--resume");
    expect(execCall.command).toContain("prev-session");
  });

  it("renders prompt from default template with agent name", async () => {
    const streamOutput = makeStream(["output"]);
    vi.mocked(streamExecLines).mockReturnValue(streamOutput());

    const ctx = makeCtx();
    await execute(ctx);

    const execCall = mockClient.execSandbox.mock.calls[0][0];
    const stdin = new TextDecoder().decode(execCall.stdin);
    expect(stdin).toContain("Test Agent");
    expect(stdin).toContain("Paperclip work");
  });

  it("renders prompt from custom template with context variables", async () => {
    const streamOutput = makeStream(["output"]);
    vi.mocked(streamExecLines).mockReturnValue(streamOutput());

    const ctx = makeCtx({
      config: {
        gatewayUrl: "127.0.0.1:8080",
        insecure: true,
        promptTemplate: "You are {{ agent.name }}. Task: {{ context.issueTitle }}",
      },
      context: { issueTitle: "Scan AI news" },
    });
    await execute(ctx);

    const execCall = mockClient.execSandbox.mock.calls[0][0];
    const stdin = new TextDecoder().decode(execCall.stdin);
    expect(stdin).toContain("Test Agent");
    expect(stdin).toContain("Scan AI news");
  });

  it("uses default prompt template when none configured", async () => {
    const streamOutput = makeStream(["output"]);
    vi.mocked(streamExecLines).mockReturnValue(streamOutput());

    const ctx = makeCtx({ config: { gatewayUrl: "127.0.0.1:8080", insecure: true } });
    await execute(ctx);

    const execCall = mockClient.execSandbox.mock.calls[0][0];
    const stdin = new TextDecoder().decode(execCall.stdin);
    // Default template should include agent name
    expect(stdin).toContain("Test Agent");
    // Should not be empty
    expect(stdin.length).toBeGreaterThan(10);
  });
});
