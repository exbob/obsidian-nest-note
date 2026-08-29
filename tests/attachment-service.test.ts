import { describe, expect, it } from "vitest";
import { t } from "../src/i18n";
import { NestNoteAttachmentService } from "../src/services/attachment-service";
import type { AttachmentServiceApp } from "../src/services/attachment-service";

interface FileRef {
  path: string;
  name: string;
  basename: string;
  extension: string;
}

class FakeVault {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  readonly renameCalls: Array<{ from: string; to: string }> = [];
  attachmentFolderPath: string | undefined;

  getConfig(name: string): unknown {
    if (name === "attachmentFolderPath") {
      return this.attachmentFolderPath;
    }
    return undefined;
  }

  getAbstractFileByPath(path: string): FileRef | null {
    const normalized = normalize(path);
    if (this.files.has(normalized) || this.folders.has(normalized)) {
      return fileRef(normalized);
    }
    return null;
  }

  getFolderByPath(path: string): FileRef | null {
    const normalized = normalize(path);
    return this.folders.has(normalized) ? fileRef(normalized) : null;
  }

  getFileByPath(path: string): FileRef | null {
    const normalized = normalize(path);
    return this.files.has(normalized) ? fileRef(normalized) : null;
  }

  async createFolder(path: string): Promise<FileRef> {
    const normalized = normalize(path);
    if (this.folders.has(normalized) || this.files.has(normalized)) {
      throw new Error(`Folder already exists: ${normalized}`);
    }
    this.folders.add(normalized);
    return fileRef(normalized);
  }

  async rename(file: FileRef, newPath: string): Promise<void> {
    const from = normalize(file.path);
    const to = normalize(newPath);
    if (this.getAbstractFileByPath(to) !== null) {
      throw new Error(`Target already exists: ${to}`);
    }
    this.renameCalls.push({ from, to });
    const content = this.files.get(from);
    if (content === undefined) {
      throw new Error(`File not found: ${from}`);
    }
    this.files.delete(from);
    this.files.set(to, content);
    file.path = to;
    file.name = fileRef(to).name;
    file.basename = fileRef(to).basename;
    file.extension = fileRef(to).extension;
  }
}

class FakeWorkspace {
  activeFile: FileRef | null = null;

  getActiveFile(): FileRef | null {
    return this.activeFile;
  }
}

interface FakeApp extends AttachmentServiceApp {
  vault: FakeVault;
  workspace: FakeWorkspace;
  fileManager: {
    getNewFileParent(sourcePath: string): { path: string };
  };
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function fileRef(path: string): FileRef {
  const normalized = normalize(path);
  const name = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;
  const dot = name.lastIndexOf(".");
  return {
    path: normalized,
    name,
    basename: dot === -1 ? name : name.slice(0, dot),
    extension: dot === -1 ? "" : name.slice(dot + 1),
  };
}

function seedDocument(vault: FakeVault, path: string): void {
  vault.folders.add(path);
  vault.folders.add(`${path}/attachments`);
  vault.files.set(
    `${path}/index.md`,
    `---
name: ${path}
created: 2020-01-01T00:00:00Z
---
`,
  );
}

function createHarness(seed?: (vault: FakeVault, workspace: FakeWorkspace) => void): {
  app: FakeApp;
  notices: string[];
  refreshCalls: string[][];
  internalDepthMax: { value: number };
  service: NestNoteAttachmentService;
} {
  const vault = new FakeVault();
  const workspace = new FakeWorkspace();
  seed?.(vault, workspace);
  const notices: string[] = [];
  const refreshCalls: string[][] = [];
  let internalDepth = 0;
  const internalDepthMax = { value: 0 };
  const app: FakeApp = {
    vault,
    workspace,
    fileManager: {
      getNewFileParent(sourcePath: string): { path: string } {
        const setting = vault.attachmentFolderPath;
        if (setting === undefined || setting === "./") {
          const idx = sourcePath.lastIndexOf("/");
          return { path: idx === -1 ? "" : sourcePath.slice(0, idx) };
        }
        if (setting === "/" || setting === "") {
          return { path: "" };
        }
        return { path: setting.replace(/^\/+|\/+$/g, "") };
      },
    },
  };
  const service = new NestNoteAttachmentService(app, {
    notice: (message) => notices.push(message),
    runInternal: async (fn) => {
      internalDepth += 1;
      internalDepthMax.value = Math.max(internalDepthMax.value, internalDepth);
      try {
        return await fn();
      } finally {
        internalDepth -= 1;
      }
    },
    requestRefresh: (paths) => {
      refreshCalls.push([...paths]);
    },
  });
  return { app, notices, refreshCalls, internalDepthMax, service };
}

describe("NestNoteAttachmentService.handleCreatedFile", () => {
  it("moves an attachment into the active document attachments folder", async () => {
    const { app, service, refreshCalls, internalDepthMax, notices } =
      createHarness((vault, workspace) => {
        seedDocument(vault, "Work");
        vault.files.set("Work/photo.png", "png-bytes");
        workspace.activeFile = fileRef("Work/index.md");
      });

    await service.handleCreatedFile(fileRef("Work/photo.png"));

    expect(app.vault.files.has("Work/photo.png")).toBe(false);
    expect(app.vault.files.has("Work/attachments/photo.png")).toBe(true);
    expect(app.vault.renameCalls).toEqual([
      { from: "Work/photo.png", to: "Work/attachments/photo.png" },
    ]);
    expect(internalDepthMax.value).toBeGreaterThanOrEqual(1);
    expect(refreshCalls).toEqual([
      ["Work/photo.png", "Work/attachments/photo.png"],
    ]);
    expect(notices).toEqual([]);
  });

  it("generates a unique target when the attachment name already exists", async () => {
    const { app, service } = createHarness((vault, workspace) => {
      seedDocument(vault, "Work");
      vault.files.set("Work/attachments/photo.png", "existing");
      vault.files.set("Work/photo.png", "new");
      workspace.activeFile = fileRef("Work/index.md");
    });

    await service.handleCreatedFile(fileRef("Work/photo.png"));

    expect(app.vault.files.get("Work/attachments/photo.png")).toBe("existing");
    expect(app.vault.files.has("Work/attachments/photo 1.png")).toBe(true);
    expect(app.vault.renameCalls).toEqual([
      { from: "Work/photo.png", to: "Work/attachments/photo 1.png" },
    ]);
  });

  it("does not move when the active file is not a document index.md", async () => {
    const { app, service, refreshCalls } = createHarness((vault, workspace) => {
      seedDocument(vault, "Work");
      vault.files.set("Work/notes.md", "# notes\n");
      vault.files.set("Work/photo.png", "png-bytes");
      workspace.activeFile = fileRef("Work/notes.md");
    });

    await service.handleCreatedFile(fileRef("Work/photo.png"));

    expect(app.vault.files.has("Work/photo.png")).toBe(true);
    expect(app.vault.files.has("Work/attachments/photo.png")).toBe(false);
    expect(app.vault.renameCalls).toEqual([]);
    expect(refreshCalls).toEqual([]);
  });

  it("does not move when there is no active file", async () => {
    const { app, service, refreshCalls, notices } = createHarness((vault) => {
      seedDocument(vault, "Work");
      vault.files.set("Work/photo.png", "png-bytes");
    });

    await service.handleCreatedFile(fileRef("Work/photo.png"));

    expect(app.vault.files.has("Work/photo.png")).toBe(true);
    expect(app.vault.renameCalls).toEqual([]);
    expect(refreshCalls).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("does not move when the active index.md is not a recognized document", async () => {
    const { app, service, refreshCalls } = createHarness((vault, workspace) => {
      vault.folders.add("Draft");
      vault.files.set("Draft/index.md", "# draft\n");
      vault.files.set("Draft/photo.png", "png-bytes");
      workspace.activeFile = fileRef("Draft/index.md");
    });

    await service.handleCreatedFile(fileRef("Draft/photo.png"));

    expect(app.vault.files.has("Draft/photo.png")).toBe(true);
    expect(app.vault.renameCalls).toEqual([]);
    expect(refreshCalls).toEqual([]);
  });

  it("does not move markdown files even when a document index is active", async () => {
    const { app, service, refreshCalls, notices } = createHarness(
      (vault, workspace) => {
        seedDocument(vault, "Work");
        vault.files.set("Work/scratch.md", "# scratch\n");
        workspace.activeFile = fileRef("Work/index.md");
      },
    );

    await service.handleCreatedFile(fileRef("Work/scratch.md"));

    expect(app.vault.files.has("Work/scratch.md")).toBe(true);
    expect(app.vault.renameCalls).toEqual([]);
    expect(refreshCalls).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("does not move a file that is already in the active document attachments folder", async () => {
    const { app, service, refreshCalls } = createHarness((vault, workspace) => {
      seedDocument(vault, "Work");
      vault.files.set("Work/attachments/photo.png", "png-bytes");
      workspace.activeFile = fileRef("Work/index.md");
    });

    await service.handleCreatedFile(fileRef("Work/attachments/photo.png"));

    expect(app.vault.files.has("Work/attachments/photo.png")).toBe(true);
    expect(app.vault.renameCalls).toEqual([]);
    expect(refreshCalls).toEqual([]);
  });

  it("does not move an attachment that already belongs to another document attachments folder", async () => {
    const { app, service, refreshCalls, notices } = createHarness(
      (vault, workspace) => {
        seedDocument(vault, "Work");
        seedDocument(vault, "Other");
        vault.files.set("Other/attachments/photo.png", "png-bytes");
        workspace.activeFile = fileRef("Work/index.md");
      },
    );

    await service.handleCreatedFile(fileRef("Other/attachments/photo.png"));

    expect(app.vault.files.has("Other/attachments/photo.png")).toBe(true);
    expect(app.vault.files.has("Work/attachments/photo.png")).toBe(false);
    expect(app.vault.renameCalls).toEqual([]);
    expect(refreshCalls).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("does not move a file from an arbitrary vault path even when a document index is active", async () => {
    const { app, service, refreshCalls, notices } = createHarness(
      (vault, workspace) => {
        seedDocument(vault, "Work");
        seedDocument(vault, "Work/文档1");
        vault.files.set("Inbox/paste.jpg", "jpg-bytes");
        workspace.activeFile = fileRef("Work/文档1/index.md");
      },
    );

    await service.handleCreatedFile(fileRef("Inbox/paste.jpg"));

    expect(app.vault.files.has("Inbox/paste.jpg")).toBe(true);
    expect(app.vault.files.has("Work/文档1/attachments/paste.jpg")).toBe(false);
    expect(app.vault.renameCalls).toEqual([]);
    expect(refreshCalls).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("notices when manual archive cannot attribute a file", async () => {
    const { app, service, notices } = createHarness((vault, workspace) => {
      seedDocument(vault, "Work");
      vault.files.set("Inbox/paste.jpg", "jpg-bytes");
      workspace.activeFile = fileRef("Work/index.md");
    });

    await service.handleCreatedFile(fileRef("Inbox/paste.jpg"), { notify: true });

    expect(app.vault.files.has("Inbox/paste.jpg")).toBe(true);
    expect(app.vault.renameCalls).toEqual([]);
    expect(notices).toEqual([
      t("notice.attachmentKept", { path: "Inbox/paste.jpg" }),
    ]);
  });

  it("archives a vault-root attachment when the active index.md is known", async () => {
    const { app, service, notices } = createHarness((vault, workspace) => {
      seedDocument(vault, "Work");
      vault.files.set("paste.jpg", "jpg-bytes");
      workspace.activeFile = fileRef("Work/index.md");
    });

    await service.handleCreatedFile(fileRef("paste.jpg"));

    expect(app.vault.files.has("paste.jpg")).toBe(false);
    expect(app.vault.files.has("Work/attachments/paste.jpg")).toBe(true);
    expect(notices).toEqual([]);
  });

  it("archives from a configured global attachment folder", async () => {
    const { app, service, notices } = createHarness((vault, workspace) => {
      seedDocument(vault, "Work");
      vault.attachmentFolderPath = "Assets";
      vault.folders.add("Assets");
      vault.files.set("Assets/paste.jpg", "jpg-bytes");
      workspace.activeFile = fileRef("Work/index.md");
    });

    await service.handleCreatedFile(fileRef("Assets/paste.jpg"));

    expect(app.vault.files.has("Assets/paste.jpg")).toBe(false);
    expect(app.vault.files.has("Work/attachments/paste.jpg")).toBe(true);
    expect(app.vault.renameCalls).toEqual([
      { from: "Assets/paste.jpg", to: "Work/attachments/paste.jpg" },
    ]);
    expect(notices).toEqual([]);
  });

  it("uses attachmentFolderPath even when getNewFileParent returns the new-note folder", async () => {
    const { app, service, notices } = createHarness((vault, workspace) => {
      seedDocument(vault, "Work");
      vault.attachmentFolderPath = "Assets";
      vault.folders.add("Assets");
      vault.folders.add("Notes");
      vault.files.set("Assets/paste.png", "png-bytes");
      workspace.activeFile = fileRef("Work/index.md");
    });
    app.fileManager.getNewFileParent = () => ({ path: "Notes" });

    await service.handleCreatedFile(fileRef("Assets/paste.png"));

    expect(app.vault.files.has("Assets/paste.png")).toBe(false);
    expect(app.vault.files.has("Work/attachments/paste.png")).toBe(true);
    expect(app.vault.files.has("Notes/paste.png")).toBe(false);
    expect(app.vault.renameCalls).toEqual([
      { from: "Assets/paste.png", to: "Work/attachments/paste.png" },
    ]);
    expect(notices).toEqual([]);
  });

  it("archives from a ./ relative attachmentFolderPath under the current document", async () => {
    const { app, service } = createHarness((vault, workspace) => {
      seedDocument(vault, "Work");
      vault.attachmentFolderPath = "./media";
      vault.folders.add("Work/media");
      vault.files.set("Work/media/paste.png", "png-bytes");
      workspace.activeFile = fileRef("Work/index.md");
    });
    app.fileManager.getNewFileParent = () => ({ path: "Notes" });

    await service.handleCreatedFile(fileRef("Work/media/paste.png"));

    expect(app.vault.files.has("Work/media/paste.png")).toBe(false);
    expect(app.vault.files.has("Work/attachments/paste.png")).toBe(true);
  });

  it("does not move an attachment that lives in another document directory", async () => {
    const { app, service, notices } = createHarness((vault, workspace) => {
      seedDocument(vault, "Work");
      seedDocument(vault, "Other");
      vault.files.set("Other/photo.png", "png-bytes");
      workspace.activeFile = fileRef("Work/index.md");
    });

    await service.handleCreatedFile(fileRef("Other/photo.png"));

    expect(app.vault.files.has("Other/photo.png")).toBe(true);
    expect(app.vault.files.has("Work/attachments/photo.png")).toBe(false);
    expect(app.vault.renameCalls).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("archives into the nested document that owns the active index.md", async () => {
    const { app, service } = createHarness((vault, workspace) => {
      seedDocument(vault, "Work");
      seedDocument(vault, "Work/文档1");
      vault.files.set("Work/文档1/paste.jpg", "jpg-bytes");
      workspace.activeFile = fileRef("Work/文档1/index.md");
    });

    await service.handleCreatedFile(fileRef("Work/文档1/paste.jpg"));

    expect(app.vault.files.has("Work/文档1/paste.jpg")).toBe(false);
    expect(app.vault.files.has("Work/文档1/attachments/paste.jpg")).toBe(true);
  });
});
