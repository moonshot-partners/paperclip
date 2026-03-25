import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadExternalAdapters, findServerAdapter } from "../adapters/registry.js";
import { knownAdapterTypes } from "@paperclipai/shared";

describe("loadExternalAdapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gracefully handles missing packages without crashing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await loadExternalAdapters(["nonexistent-adapter-package-xyz"]);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load external adapter"),
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  it("does not register anything for missing packages", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const beforeSize = knownAdapterTypes.size;
    await loadExternalAdapters(["nonexistent-package-abc"]);
    expect(knownAdapterTypes.size).toBe(beforeSize);

    vi.restoreAllMocks();
  });

  it("continues loading after one package fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Both are nonexistent — should log 2 errors but not crash
    await loadExternalAdapters(["bad-pkg-1", "bad-pkg-2"]);

    expect(console.error).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("findServerAdapter returns null for unregistered types", () => {
    expect(findServerAdapter("totally_unknown_type")).toBeNull();
  });
});
