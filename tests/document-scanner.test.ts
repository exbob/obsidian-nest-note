import { describe, expect, it } from "vitest";
import { scanDocuments } from "../src/domain/document-scanner";
import type { DocumentNode, VaultEntry } from "../src/types";

function collectNodes(nodes: DocumentNode[]): DocumentNode[] {
  return nodes.flatMap((node) => [node, ...collectNodes(node.children)]);
}

function documentChainEntries(count: number): VaultEntry[] {
  const entries: VaultEntry[] = [];
  const segments: string[] = [];
  for (let level = 0; level <= count; level++) {
    segments.push(`Level${level}`);
    const path = segments.join("/");
    entries.push(
      { kind: "folder", path },
      { kind: "file", path: `${path}/index.md` },
      { kind: "folder", path: `${path}/attachments` },
    );
  }
  return entries;
}

describe("scanDocuments", () => {
  it("builds a nested document tree from vault entries", () => {
    expect(
      scanDocuments([
        { kind: "folder", path: "Work" },
        { kind: "file", path: "Work/index.md" },
        { kind: "folder", path: "Work/attachments" },
        { kind: "folder", path: "Work/文档1" },
        { kind: "file", path: "Work/文档1/index.md" },
        { kind: "folder", path: "Work/文档1/attachments" },
      ]),
    ).toEqual([
      {
        name: "Work",
        path: "Work",
        indexPath: "Work/index.md",
        attachmentsPath: "Work/attachments",
        children: [
          {
            name: "文档1",
            path: "Work/文档1",
            indexPath: "Work/文档1/index.md",
            attachmentsPath: "Work/文档1/attachments",
            children: [],
          },
        ],
      },
    ]);
  });

  it("excludes standalone markdown files", () => {
    expect(
      scanDocuments([
        { kind: "file", path: "notes.md" },
        { kind: "file", path: "Work/readme.md" },
      ]),
    ).toEqual([]);
  });

  it("excludes incomplete document directories", () => {
    expect(
      scanDocuments([
        { kind: "folder", path: "Draft" },
        { kind: "file", path: "Draft/index.md" },
      ]),
    ).toEqual([]);

    expect(
      scanDocuments([
        { kind: "folder", path: "Draft" },
        { kind: "folder", path: "Draft/attachments" },
      ]),
    ).toEqual([]);
  });

  it("does not treat attachments folders as documents", () => {
    const result = scanDocuments([
      { kind: "folder", path: "Work" },
      { kind: "file", path: "Work/index.md" },
      { kind: "folder", path: "Work/attachments" },
    ]);

    expect(result).toEqual([
      {
        name: "Work",
        path: "Work",
        indexPath: "Work/index.md",
        attachmentsPath: "Work/attachments",
        children: [],
      },
    ]);
    expect(result[0].children.some((child) => child.name === "attachments")).toBe(
      false,
    );
  });

  it("excludes attachments reserved name even with pathological structure", () => {
    const result = scanDocuments([
      { kind: "folder", path: "Work" },
      { kind: "file", path: "Work/index.md" },
      { kind: "folder", path: "Work/attachments" },
      { kind: "file", path: "Work/attachments/index.md" },
      { kind: "folder", path: "Work/attachments/attachments" },
      { kind: "folder", path: "Work/attachments/attachments/Nested" },
      { kind: "file", path: "Work/attachments/attachments/Nested/index.md" },
      {
        kind: "folder",
        path: "Work/attachments/attachments/Nested/attachments",
      },
    ]);

    expect(result).toEqual([
      {
        name: "Work",
        path: "Work",
        indexPath: "Work/index.md",
        attachmentsPath: "Work/attachments",
        children: [],
      },
    ]);

    const allNodes = collectNodes(result);
    expect(allNodes.some((node) => node.name === "attachments")).toBe(false);
    expect(allNodes.some((node) => node.path.endsWith("/attachments"))).toBe(
      false,
    );
    expect(allNodes.some((node) => node.name === "Nested")).toBe(false);
    expect(
      allNodes.some((node) => node.path.includes("/attachments/")),
    ).toBe(false);
  });

  it("sorts siblings by name using localeCompare", () => {
    expect(
      scanDocuments([
        { kind: "folder", path: "Root" },
        { kind: "file", path: "Root/index.md" },
        { kind: "folder", path: "Root/attachments" },
        { kind: "folder", path: "Root/B" },
        { kind: "file", path: "Root/B/index.md" },
        { kind: "folder", path: "Root/B/attachments" },
        { kind: "folder", path: "Root/A" },
        { kind: "file", path: "Root/A/index.md" },
        { kind: "folder", path: "Root/A/attachments" },
      ]),
    ).toEqual([
      {
        name: "Root",
        path: "Root",
        indexPath: "Root/index.md",
        attachmentsPath: "Root/attachments",
        children: [
          {
            name: "A",
            path: "Root/A",
            indexPath: "Root/A/index.md",
            attachmentsPath: "Root/A/attachments",
            children: [],
          },
          {
            name: "B",
            path: "Root/B",
            indexPath: "Root/B/index.md",
            attachmentsPath: "Root/B/attachments",
            children: [],
          },
        ],
      },
    ]);
  });

  it("hides documents deeper than the configured child depth", () => {
    const entries = documentChainEntries(6);
    expect(scanDocuments(entries, { maxChildDepth: 5 })).toHaveLength(1);
    expect(collectNodes(scanDocuments(entries, { maxChildDepth: 5 })).map((node) => node.path))
      .toEqual(["Level0", "Level0/Level1", "Level0/Level1/Level2", "Level0/Level1/Level2/Level3", "Level0/Level1/Level2/Level3/Level4", "Level0/Level1/Level2/Level3/Level4/Level5"]);
  });

  it("shows only root documents when the limit is zero", () => {
    expect(collectNodes(scanDocuments(documentChainEntries(2), { maxChildDepth: 0 })))
      .toEqual([expect.objectContaining({ path: "Level0" })]);
  });

  it("defaults to max child depth 5 when options are omitted", () => {
    expect(
      collectNodes(scanDocuments(documentChainEntries(6))).map((node) => node.path),
    ).toEqual([
      "Level0",
      "Level0/Level1",
      "Level0/Level1/Level2",
      "Level0/Level1/Level2/Level3",
      "Level0/Level1/Level2/Level3/Level4",
      "Level0/Level1/Level2/Level3/Level4/Level5",
    ]);
  });
});
