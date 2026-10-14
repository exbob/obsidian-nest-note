import { describe, expect, it, vi } from "vitest";
import { FileSystemAdapter } from "obsidian";
import type { App } from "obsidian";
import {
  absolutePathFromAdapter,
  buildSetClipboardFilesCommand,
  createDesktopFileActions,
  escapePowerShellSingleQuoted,
  parseClipboardFileList,
} from "../src/ui/desktop-file-actions";

describe("absolutePathFromAdapter", () => {
  it("returns getFullPath when the adapter is a FileSystemAdapter", () => {
    const adapter = Object.create(
      FileSystemAdapter.prototype,
    ) as FileSystemAdapter;
    Object.defineProperty(adapter, "getFullPath", {
      value: (normalizedPath: string) => `C:/vault/${normalizedPath}`,
    });
    expect(absolutePathFromAdapter(adapter, "Work/index.md")).toBe(
      "C:/vault/Work/index.md",
    );
  });

  it("returns null when the adapter is not a FileSystemAdapter", () => {
    expect(absolutePathFromAdapter({}, "Work/index.md")).toBeNull();
  });
});

describe("escapePowerShellSingleQuoted", () => {
  it("doubles single quotes", () => {
    expect(escapePowerShellSingleQuoted("C:\\a\\it's.md")).toBe(
      "C:\\a\\it''s.md",
    );
  });

  it("leaves strings without single quotes unchanged", () => {
    expect(escapePowerShellSingleQuoted("C:\\a\\b.md")).toBe("C:\\a\\b.md");
  });

  it("escapes every single quote", () => {
    expect(escapePowerShellSingleQuoted("''a'")).toBe("''''a''");
  });
});

describe("buildSetClipboardFilesCommand", () => {
  it("builds a Set-Clipboard -LiteralPath command with escaped paths", () => {
    expect(buildSetClipboardFilesCommand(["C:\\a.md", "C:\\it's.md"])).toBe(
      "Set-Clipboard -LiteralPath @('C:\\a.md','C:\\it''s.md')",
    );
  });
});

describe("parseClipboardFileList", () => {
  it("splits lines, trims and drops empty entries", () => {
    expect(parseClipboardFileList("C:\\a.md\r\n\r\n  C:\\b\\c.md \n")).toEqual([
      "C:\\a.md",
      "C:\\b\\c.md",
    ]);
  });

  it("returns [] for empty output", () => {
    expect(parseClipboardFileList("")).toEqual([]);
    expect(parseClipboardFileList("\r\n")).toEqual([]);
  });
});

function fakeApp(): App {
  const adapter = Object.create(FileSystemAdapter.prototype) as FileSystemAdapter;
  Object.defineProperty(adapter, "getFullPath", {
    value: (p: string) => `C:/vault/${p}`,
  });
  return { vault: { adapter } } as unknown as App;
}

describe("createDesktopFileActions (win32)", () => {
  it("copyFiles runs Set-Clipboard through the injected runner", async () => {
    const runPowerShell = vi.fn().mockResolvedValue("");
    const actions = createDesktopFileActions(fakeApp(), {
      platform: "win32",
      runPowerShell,
    });
    await actions.copyFiles(["C:\\a.md", "C:\\it's.md"]);
    expect(runPowerShell).toHaveBeenCalledWith(
      "Set-Clipboard -LiteralPath @('C:\\a.md','C:\\it''s.md')",
    );
  });

  it("copyFiles does nothing for an empty list", async () => {
    const runPowerShell = vi.fn().mockResolvedValue("");
    const actions = createDesktopFileActions(fakeApp(), {
      platform: "win32",
      runPowerShell,
    });
    await actions.copyFiles([]);
    expect(runPowerShell).not.toHaveBeenCalled();
  });

  it("readClipboardFiles parses FileDropList output", async () => {
    const runPowerShell = vi
      .fn()
      .mockResolvedValue("C:\\a.md\r\nC:\\b\r\n");
    const actions = createDesktopFileActions(fakeApp(), {
      platform: "win32",
      runPowerShell,
    });
    await expect(actions.readClipboardFiles()).resolves.toEqual([
      "C:\\a.md",
      "C:\\b",
    ]);
    expect(runPowerShell).toHaveBeenCalledWith(
      "Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }",
    );
  });

  it("importAbsolutePath copies recursively into the resolved vault path", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    const actions = createDesktopFileActions(fakeApp(), {
      platform: "win32",
      copy,
    });
    await actions.importAbsolutePath("D:\\ext\\dir", "Work/dir");
    expect(copy).toHaveBeenCalledWith("D:\\ext\\dir", "C:/vault/Work/dir", {
      recursive: true,
    });
  });

  it("importAbsolutePath throws when the vault path cannot be resolved", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    const app = { vault: { adapter: {} } } as unknown as App;
    const actions = createDesktopFileActions(app, { platform: "win32", copy });
    await expect(
      actions.importAbsolutePath("D:\\ext\\a.md", "Work/a.md"),
    ).rejects.toThrow();
    expect(copy).not.toHaveBeenCalled();
  });
});

describe("createDesktopFileActions (non-win32)", () => {
  it("copyFiles throws and readClipboardFiles returns []", async () => {
    const runPowerShell = vi.fn();
    const actions = createDesktopFileActions(fakeApp(), {
      platform: "linux",
      runPowerShell,
    });
    await expect(actions.copyFiles(["/a.md"])).rejects.toThrow();
    await expect(actions.readClipboardFiles()).resolves.toEqual([]);
    expect(runPowerShell).not.toHaveBeenCalled();
  });
});
