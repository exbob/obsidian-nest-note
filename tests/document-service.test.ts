import { describe, expect, it } from "vitest";
import { t } from "../src/i18n";
import {
  DocumentServiceError,
  NestNoteDocumentService,
} from "../src/services/document-service";
import type { DocumentServiceApp } from "../src/services/document-service";

const created = "2026-08-28T19:00:00+08:00";

interface FileRef {
  path: string;
}

class FakeVault {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  readonly renameCalls: Array<{ from: string; to: string }> = [];
  readonly trashCalls: FileRef[] = [];
  readonly deleteCalls: string[] = [];
  failCreatePaths = new Set<string>();
  failCreateFolderPaths = new Set<string>();

  getAbstractFileByPath(path: string): FileRef | null {
    const normalized = normalize(path);
    if (this.files.has(normalized) || this.folders.has(normalized)) {
      return { path: normalized };
    }
    return null;
  }

  getFolderByPath(path: string): FileRef | null {
    const normalized = normalize(path);
    return this.folders.has(normalized) ? { path: normalized } : null;
  }

  getFileByPath(path: string): FileRef | null {
    const normalized = normalize(path);
    return this.files.has(normalized) ? { path: normalized } : null;
  }

  getFiles(): FileRef[] {
    return [...this.files.keys()].map((path) => ({ path }));
  }

  getAllFolders(includeRoot = false): FileRef[] {
    const folders = [...this.folders].map((path) => ({ path }));
    if (includeRoot) {
      return [{ path: "" }, ...folders];
    }
    return folders;
  }

  getAllLoadedFiles(): Array<{ path: string; children?: FileRef[] }> {
    return [
      ...[...this.folders].map((path) => ({ path, children: [] as FileRef[] })),
      ...[...this.files.keys()].map((path) => ({ path })),
    ];
  }

  async createFolder(path: string): Promise<FileRef> {
    const normalized = normalize(path);
    if (this.failCreateFolderPaths.has(normalized)) {
      throw new Error(`createFolder failed: ${normalized}`);
    }
    if (this.folders.has(normalized) || this.files.has(normalized)) {
      throw new Error(`Folder already exists: ${normalized}`);
    }
    this.folders.add(normalized);
    return { path: normalized };
  }

  async create(path: string, data: string): Promise<FileRef> {
    const normalized = normalize(path);
    if (this.failCreatePaths.has(normalized)) {
      throw new Error(`create failed: ${normalized}`);
    }
    if (this.files.has(normalized) || this.folders.has(normalized)) {
      throw new Error(`File already exists: ${normalized}`);
    }
    this.files.set(normalized, data);
    return { path: normalized };
  }

  async read(file: FileRef): Promise<string> {
    const content = this.files.get(normalize(file.path));
    if (content === undefined) {
      throw new Error(`File not found: ${file.path}`);
    }
    return content;
  }

  async modify(file: FileRef, data: string): Promise<void> {
    const normalized = normalize(file.path);
    if (!this.files.has(normalized)) {
      throw new Error(`File not found: ${normalized}`);
    }
    this.files.set(normalized, data);
  }

  async rename(file: FileRef, newPath: string): Promise<void> {
    const from = normalize(file.path);
    const to = normalize(newPath);
    if (this.getAbstractFileByPath(to) !== null) {
      throw new Error(`Target already exists: ${to}`);
    }
    this.renameCalls.push({ from, to });
    movePrefix(this.folders, from, to);
    movePrefixMap(this.files, from, to);
  }

  async delete(file: FileRef): Promise<void> {
    const normalized = normalize(file.path);
    this.deleteCalls.push(normalized);
    this.files.delete(normalized);
    this.folders.delete(normalized);
    for (const path of [...this.files.keys()]) {
      if (path.startsWith(`${normalized}/`)) {
        this.files.delete(path);
      }
    }
    for (const path of [...this.folders]) {
      if (path.startsWith(`${normalized}/`)) {
        this.folders.delete(path);
      }
    }
  }

  readonly trashLocalCalls: Array<{ path: string; system: boolean }> = [];

  async trash(file: FileRef, system: boolean): Promise<void> {
    this.trashLocalCalls.push({ path: normalize(file.path), system });
    await this.delete(file);
  }

  async trashFile(file: FileRef): Promise<void> {
    this.trashCalls.push({ path: normalize(file.path) });
    await this.delete(file);
  }
}

class FakeWorkspace {
  lastNewLeaf: boolean | undefined;
  opened: string[] = [];
  openedViewTypes: string[] = [];
  sidebarFocused = false;

  getLeaf(newLeaf?: boolean): {
    openFile: (file: FileRef) => Promise<void>;
    getViewType: () => string;
  } {
    this.lastNewLeaf = newLeaf;
    const viewType =
      this.sidebarFocused && newLeaf !== true
        ? "nestnote-document-tree"
        : "markdown";
    return {
      getViewType: () => viewType,
      openFile: async (file: FileRef) => {
        this.opened.push(file.path);
        this.openedViewTypes.push(viewType);
      },
    };
  }

  getMostRecentLeaf(): {
    openFile: (file: FileRef) => Promise<void>;
    getViewType: () => string;
  } | null {
    if (!this.sidebarFocused) {
      return null;
    }
    return {
      getViewType: () => "nestnote-document-tree",
      openFile: async (file: FileRef) => {
        this.opened.push(file.path);
        this.openedViewTypes.push("nestnote-document-tree");
      },
    };
  }

  iterateRootLeaves(
    callback: (leaf: {
      openFile: (file: FileRef) => Promise<void>;
      getViewType: () => string;
    }) => void,
  ): void {
    if (!this.sidebarFocused) {
      return;
    }
    callback({
      getViewType: () => "markdown",
      openFile: async (file: FileRef) => {
        this.opened.push(file.path);
        this.openedViewTypes.push("markdown");
      },
    });
  }
}

interface FakeApp extends DocumentServiceApp {
  vault: FakeVault;
  fileManager: { trashFile: (file: FileRef) => Promise<void> };
  workspace: FakeWorkspace;
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function movePrefix(set: Set<string>, from: string, to: string): void {
  const next = [...set].filter(
    (path) => path === from || path.startsWith(`${from}/`),
  );
  for (const path of next) {
    set.delete(path);
    set.add(to + path.slice(from.length));
  }
}

function movePrefixMap(
  map: Map<string, string>,
  from: string,
  to: string,
): void {
  const next = [...map.keys()].filter(
    (path) => path === from || path.startsWith(`${from}/`),
  );
  for (const path of next) {
    const value = map.get(path)!;
    map.delete(path);
    map.set(to + path.slice(from.length), value);
  }
}

function seedDocument(
  vault: FakeVault,
  path: string,
  indexContent: string,
): void {
  vault.folders.add(path);
  vault.folders.add(`${path}/attachments`);
  vault.files.set(`${path}/index.md`, indexContent);
}

function workIndex(body = "# Body\n"): string {
  return `---
name: Work
created: 2020-01-01T00:00:00Z
---
${body}`;
}

function createApp(seed?: (vault: FakeVault) => void): FakeApp {
  const vault = new FakeVault();
  seed?.(vault);
  const workspace = new FakeWorkspace();
  return {
    vault,
    fileManager: {
      trashFile: (file) => vault.trashFile(file),
    },
    workspace,
  };
}

function createHarness(seed?: (vault: FakeVault) => void): {
  app: FakeApp;
  notices: string[];
  service: NestNoteDocumentService;
} {
  const app = createApp(seed);
  const notices: string[] = [];
  const service = new NestNoteDocumentService(app, {
    createdAt: created,
    notice: (message: string) => notices.push(message),
  });
  return { app, notices, service };
}

function createSeededAppWithDocumentChain(depth: number): FakeApp {
  return createApp((vault) => {
    const segments: string[] = [];
    for (let level = 0; level <= depth; level++) {
      segments.push(`Level${level}`);
      seedDocument(
        vault,
        segments.join("/"),
        `---
name: Level${level}
created: 2020-01-01T00:00:00Z
---
`,
      );
    }
  });
}

describe("NestNoteDocumentService.create", () => {
  it('creates Work/, Work/index.md, and Work/attachments/ for create(null, "Work")', async () => {
    const { app, service } = createHarness();

    const node = await service.create(null, "Work");

    expect([...app.vault.folders].sort()).toEqual(["Work", "Work/attachments"]);
    expect([...app.vault.files.keys()]).toEqual(["Work/index.md"]);
    expect(app.vault.files.get("Work/index.md")).toBe(`---
name: Work
created: 2026-08-28T19:00:00+08:00
---
`);
    expect(node).toEqual({
      name: "Work",
      path: "Work",
      indexPath: "Work/index.md",
      attachmentsPath: "Work/attachments",
      children: [],
    });
  });

  it("creates a child document under the parent document directory", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(vault, "Work", workIndex());
    });

    const node = await service.create("Work", "文档1");

    expect(app.vault.folders.has("Work/文档1")).toBe(true);
    expect(app.vault.folders.has("Work/文档1/attachments")).toBe(true);
    expect(app.vault.files.get("Work/文档1/index.md")).toContain("name: 文档1");
    expect(node).toEqual({
      name: "文档1",
      path: "Work/文档1",
      indexPath: "Work/文档1/index.md",
      attachmentsPath: "Work/文档1/attachments",
      children: [],
    });
    expect(app.vault.files.get("Work/index.md")).toContain(
      "- [文档1](文档1/index.md)",
    );
    expect(app.vault.files.get("Work/index.md")).toContain("# Body");
  });

  it("re-reads the parent index before writing child links so a concurrent body edit is kept", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(vault, "Work", workIndex());
    });
    const originalCreateFolder = app.vault.createFolder.bind(app.vault);
    app.vault.createFolder = async (path: string) => {
      const created = await originalCreateFolder(path);
      if (path === "Work/Child/attachments") {
        app.vault.files.set("Work/index.md", workIndex("# User edit\n"));
      }
      return created;
    };

    await service.create("Work", "Child");

    expect(app.vault.files.get("Work/index.md")).toContain("# User edit");
    expect(app.vault.files.get("Work/index.md")).toContain(
      "- [Child](Child/index.md)",
    );
    expect(app.vault.files.get("Work/index.md")).not.toMatch(/# Body\n/);
  });

  it("throws a user-readable error for illegal names and existing targets", async () => {
    const { service } = createHarness((vault) => {
      seedDocument(vault, "Work", workIndex());
    });

    await expect(service.create(null, "")).rejects.toThrow(DocumentServiceError);
    await expect(service.create(null, "")).rejects.toThrow(t("error.nameEmpty"));
    await expect(service.create(null, ".")).rejects.toThrow(DocumentServiceError);
    await expect(service.create(null, "..")).rejects.toThrow(
      DocumentServiceError,
    );
    await expect(service.create(null, "a/b")).rejects.toThrow(
      DocumentServiceError,
    );
    await expect(service.create(null, "a\\b")).rejects.toThrow(
      DocumentServiceError,
    );
    await expect(service.create(null, "Work")).rejects.toThrow(
      DocumentServiceError,
    );
    await expect(service.create(null, "Work")).rejects.toThrow(
      t("error.targetExists", { path: "Work" }),
    );
    await expect(service.create(null, "a:b")).rejects.toThrow(DocumentServiceError);
    await expect(service.create(null, "a*b")).rejects.toThrow(DocumentServiceError);
    await expect(service.create(null, 'a?b')).rejects.toThrow(DocumentServiceError);
    await expect(service.create(null, 'a"b')).rejects.toThrow(DocumentServiceError);
    await expect(service.create(null, "a<b")).rejects.toThrow(DocumentServiceError);
    await expect(service.create(null, "a>b")).rejects.toThrow(DocumentServiceError);
    await expect(service.create(null, "a|b")).rejects.toThrow(DocumentServiceError);
    await expect(service.create(null, "notes.")).rejects.toThrow(
      DocumentServiceError,
    );
    await expect(service.create(null, "notes ")).rejects.toThrow(
      DocumentServiceError,
    );
    for (const reserved of [
      "CON",
      "con",
      "CON.txt",
      "PRN",
      "AUX",
      "NUL",
      "COM1",
      "COM9",
      "LPT1",
      "lpt9.dir",
    ]) {
      await expect(service.create(null, reserved)).rejects.toThrow(
        DocumentServiceError,
      );
    }
  });

  it("ignores incomplete parent directories instead of creating inside them", async () => {
    const { app, service } = createHarness((vault) => {
      vault.folders.add("Draft");
      vault.files.set("Draft/index.md", workIndex());
    });

    await expect(service.create("Draft", "Child")).rejects.toThrow(
      DocumentServiceError,
    );
    expect(app.vault.folders.has("Draft/Child")).toBe(false);
  });

  it("cleans up only this attempt's created paths and notifies on mid-create failure", async () => {
    const { app, notices, service } = createHarness();
    app.vault.failCreatePaths.add("Work/index.md");

    await expect(service.create(null, "Work")).rejects.toThrow(
      DocumentServiceError,
    );

    expect(app.vault.folders.has("Work")).toBe(false);
    expect(app.vault.folders.has("Work/attachments")).toBe(false);
    expect(app.vault.files.has("Work/index.md")).toBe(false);
    expect(notices.length).toBeGreaterThan(0);
    expect(notices[0]).toMatch(/create failed: Work\/index\.md/);
  });

  it("rejects a child whose depth exceeds the configured maximum", async () => {
    const app = createSeededAppWithDocumentChain(5);
    const service = new NestNoteDocumentService(app, {
      getMaxChildDepth: () => 5,
    });

    await expect(service.create("Level0/Level1/Level2/Level3/Level4/Level5", "TooDeep"))
      .rejects.toThrow(t("error.maxDepthReached", { max: 5 }));
    expect(app.vault.folders.has("Level0/Level1/Level2/Level3/Level4/Level5/TooDeep"))
      .toBe(false);
    expect(app.vault.files.has("Level0/Level1/Level2/Level3/Level4/Level5/TooDeep/index.md"))
      .toBe(false);
    expect(app.vault.deleteCalls).toEqual([]);
  });

  it("creates a child at the configured maximum depth", async () => {
    const app = createSeededAppWithDocumentChain(4);
    const service = new NestNoteDocumentService(app, {
      createdAt: created,
      getMaxChildDepth: () => 5,
    });

    const node = await service.create(
      "Level0/Level1/Level2/Level3/Level4",
      "Level5",
    );

    expect(node.path).toBe("Level0/Level1/Level2/Level3/Level4/Level5");
    expect(app.vault.folders.has("Level0/Level1/Level2/Level3/Level4/Level5")).toBe(
      true,
    );
    expect(
      app.vault.files.has("Level0/Level1/Level2/Level3/Level4/Level5/index.md"),
    ).toBe(true);
  });

  it("creates and returns a child at depth 9 when the maximum is 9", async () => {
    const app = createSeededAppWithDocumentChain(8);
    const service = new NestNoteDocumentService(app, {
      createdAt: created,
      getMaxChildDepth: () => 9,
    });
    const parent =
      "Level0/Level1/Level2/Level3/Level4/Level5/Level6/Level7/Level8";

    const node = await service.create(parent, "Level9");

    expect(node).toEqual({
      name: "Level9",
      path: `${parent}/Level9`,
      indexPath: `${parent}/Level9/index.md`,
      attachmentsPath: `${parent}/Level9/attachments`,
      children: [],
    });
    expect(app.vault.folders.has(`${parent}/Level9`)).toBe(true);
    expect(app.vault.files.has(`${parent}/Level9/index.md`)).toBe(true);
  });

  it("allows a root document when the maximum child depth is zero", async () => {
    const app = createApp();
    const service = new NestNoteDocumentService(app, {
      createdAt: created,
      getMaxChildDepth: () => 0,
    });

    const node = await service.create(null, "Work");

    expect(node.path).toBe("Work");
    expect(app.vault.folders.has("Work")).toBe(true);
    expect(app.vault.files.has("Work/index.md")).toBe(true);
  });

  it("rejects any child when the maximum child depth is zero", async () => {
    const app = createApp((vault) => {
      seedDocument(vault, "Work", workIndex());
    });
    const service = new NestNoteDocumentService(app, {
      getMaxChildDepth: () => 0,
    });

    await expect(service.create("Work", "Child")).rejects.toThrow(
      t("error.maxDepthReached", { max: 0 }),
    );
    expect(app.vault.folders.has("Work/Child")).toBe(false);
    expect(app.vault.files.has("Work/Child/index.md")).toBe(false);
    expect(app.vault.deleteCalls).toEqual([]);
  });

  it("treats a complete document under a regular folder as root depth", async () => {
    const app = createApp((vault) => {
      vault.folders.add("Archive");
      seedDocument(vault, "Archive/Work", workIndex());
    });
    const service = new NestNoteDocumentService(app, {
      createdAt: created,
      getMaxChildDepth: () => 1,
    });

    const node = await service.create("Archive/Work", "Child");

    expect(node.path).toBe("Archive/Work/Child");
    expect(app.vault.folders.has("Archive/Work/Child")).toBe(true);
    expect(app.vault.files.has("Archive/Work/Child/index.md")).toBe(true);
  });

  it("rejects a grandchild beyond one level under a regular-folder root without writing", async () => {
    const app = createApp((vault) => {
      vault.folders.add("Archive");
      seedDocument(vault, "Archive/Work", workIndex());
      seedDocument(
        vault,
        "Archive/Work/Child",
        `---
name: Child
created: 2020-01-01T00:00:00Z
---
`,
      );
    });
    const service = new NestNoteDocumentService(app, {
      getMaxChildDepth: () => 1,
    });

    await expect(service.create("Archive/Work/Child", "TooDeep")).rejects.toThrow(
      t("error.maxDepthReached", { max: 1 }),
    );
    expect(app.vault.folders.has("Archive/Work/Child/TooDeep")).toBe(false);
    expect(app.vault.files.has("Archive/Work/Child/TooDeep/index.md")).toBe(
      false,
    );
    expect(app.vault.deleteCalls).toEqual([]);
  });
});

describe("NestNoteDocumentService.rename", () => {
  it("renames the document directory and returns the new node", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(vault, "Work", workIndex());
      seedDocument(
        vault,
        "Work/文档1",
        `---
name: 文档1
created: 2020-01-01T00:00:00Z
---
# Child
`,
      );
    });

    const node = await service.rename("Work/文档1", "Renamed");

    expect(app.vault.renameCalls).toEqual([
      { from: "Work/文档1", to: "Work/Renamed" },
    ]);
    expect(app.vault.getFolderByPath("Work/文档1")).toBeNull();
    expect(app.vault.getFolderByPath("Work/Renamed")).not.toBeNull();
    expect(node).toEqual({
      name: "Renamed",
      path: "Work/Renamed",
      indexPath: "Work/Renamed/index.md",
      attachmentsPath: "Work/Renamed/attachments",
      children: [],
    });
    expect(app.vault.files.get("Work/Renamed/index.md")).toBe(`---
name: Renamed
created: 2020-01-01T00:00:00Z
---
# Child
`);
    expect(app.vault.files.get("Work/index.md")).toContain(
      "- [Renamed](Renamed/index.md)",
    );
    expect(app.vault.files.get("Work/index.md")).toContain("# Body");
    expect(app.vault.files.get("Work/index.md")).not.toContain("文档1");
  });

  it("fills missing frontmatter on an existing index and leaves the body unchanged", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(vault, "Work", "# Only body\n");
    });

    await service.rename("Work", "Office");

    expect(app.vault.files.get("Office/index.md")).toBe(`---
name: Office
created: 2026-08-28T19:00:00+08:00
---
# Only body
`);
  });

  it("fails closed on frontmatter parse errors without overwriting the body", async () => {
    const original = "---\nname: Broken\n# still body\n";
    const { app, notices, service } = createHarness((vault) => {
      seedDocument(vault, "Work", original);
    });

    await expect(service.rename("Work", "Office")).rejects.toThrow(
      DocumentServiceError,
    );
    expect(app.vault.renameCalls).toEqual([]);
    expect(app.vault.files.get("Work/index.md")).toBe(original);
    expect(notices.length).toBeGreaterThan(0);
  });

  it("blocks rename when the target already exists, before calling the vault API", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(vault, "Work", workIndex());
      seedDocument(vault, "Office", workIndex("Office body\n"));
    });

    await expect(service.rename("Work", "Office")).rejects.toThrow(
      DocumentServiceError,
    );
    await expect(service.rename("Work", "Office")).rejects.toThrow(/已存在/);
    expect(app.vault.renameCalls).toEqual([]);
    expect(app.vault.getFolderByPath("Work")).not.toBeNull();
  });
});

describe("NestNoteDocumentService.trash", () => {
  it("moves the entire document directory into the Obsidian trash API", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(vault, "Work", workIndex());
      seedDocument(
        vault,
        "Work/文档1",
        `---
name: 文档1
created: 2020-01-01T00:00:00Z
---
`,
      );
    });

    await service.trash("Work");

    expect(app.vault.trashCalls).toEqual([{ path: "Work" }]);
    expect(app.vault.getFolderByPath("Work")).toBeNull();
    expect(app.vault.getFolderByPath("Work/文档1")).toBeNull();
    expect(app.vault.getFileByPath("Work/index.md")).toBeNull();
  });

  it("updates the parent children-link region after trashing a child", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
<!-- nestnote:children:start -->
- [文档1](文档1/index.md)
<!-- nestnote:children:end -->
# Body
`,
      );
      seedDocument(
        vault,
        "Work/文档1",
        `---
name: 文档1
created: 2020-01-01T00:00:00Z
---
`,
      );
    });

    await service.trash("Work/文档1");

    expect(app.vault.trashCalls).toEqual([{ path: "Work/文档1" }]);
    expect(app.vault.files.get("Work/index.md")).toBe(`---
name: Work
created: 2020-01-01T00:00:00Z
---
<!-- nestnote:children:start -->
<!-- nestnote:children:end -->
# Body
`);
  });
});

describe("NestNoteDocumentService.open", () => {
  it("opens the document index in the current leaf", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(vault, "Work", workIndex());
    });

    await service.open("Work");

    expect(app.workspace.lastNewLeaf).toBe(false);
    expect(app.workspace.opened).toEqual(["Work/index.md"]);
  });

  it("skips a NestNote sidebar leaf and opens in a workspace leaf", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(vault, "Work", workIndex());
    });
    app.workspace.sidebarFocused = true;

    await service.open("Work");

    expect(app.workspace.opened).toEqual(["Work/index.md"]);
    expect(app.workspace.openedViewTypes).toEqual(["markdown"]);
    expect(app.workspace.getMostRecentLeaf()?.getViewType()).toBe(
      "nestnote-document-tree",
    );
    expect(app.workspace.lastNewLeaf).toBeUndefined();
  });
});

function seedAttachmentsLookalike(vault: FakeVault, path: string): void {
  vault.folders.add(path);
  vault.folders.add(`${path}/attachments`);
  vault.files.set(`${path}/index.md`, workIndex("attachments body\n"));
}

describe("reserved attachments path", () => {
  it("does not create a child under an attachments folder even if it looks complete", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(vault, "Work", workIndex());
      seedAttachmentsLookalike(vault, "Work/attachments");
    });

    await expect(service.create("Work/attachments", "Child")).rejects.toThrow(
      DocumentServiceError,
    );
    expect(app.vault.folders.has("Work/attachments/Child")).toBe(false);
  });

  it("does not rename, trash, or open an attachments reserved path", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(vault, "Work", workIndex());
      seedAttachmentsLookalike(vault, "Work/attachments");
    });

    await expect(service.rename("Work/attachments", "Other")).rejects.toThrow(
      DocumentServiceError,
    );
    await expect(service.trash("Work/attachments")).rejects.toThrow(
      DocumentServiceError,
    );
    await expect(service.open("Work/attachments")).rejects.toThrow(
      DocumentServiceError,
    );

    expect(app.vault.renameCalls).toEqual([]);
    expect(app.vault.trashCalls).toEqual([]);
    expect(app.vault.trashLocalCalls).toEqual([]);
    expect(app.workspace.opened).toEqual([]);
    expect(app.vault.getFolderByPath("Work/attachments")).not.toBeNull();
    expect(app.vault.files.get("Work/attachments/index.md")).toContain(
      "attachments body",
    );
  });
});

describe("NestNoteDocumentService compatibility", () => {
  it("scans with getAllLoadedFiles when getAllFolders is unavailable", async () => {
    const { app, service } = createHarness();
    (app.vault as { getAllFolders?: unknown }).getAllFolders = undefined;

    const node = await service.create(null, "Work");

    expect(node).toEqual({
      name: "Work",
      path: "Work",
      indexPath: "Work/index.md",
      attachmentsPath: "Work/attachments",
      children: [],
    });
  });
});
