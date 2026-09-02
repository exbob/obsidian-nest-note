import { describe, expect, it } from "vitest";
import { FileSystemAdapter } from "obsidian";
import { absolutePathFromAdapter } from "../src/ui/desktop-file-actions";

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
