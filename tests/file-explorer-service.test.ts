import { describe, expect, it, vi } from "vitest";
import { t } from "../src/i18n";
import {
  NestNoteFileExplorerService,
  type FileExplorerServiceDeps,
  type FileExplorerVault,
} from "../src/services/file-explorer-service";

interface FakeNode {
  path: string;
  name: string;
  children?: FakeNode[];
}

function createFakeVault(
  folders: string[],
  files: Record<string, string> = {},
): { vault: FileExplorerVault; folders: Set<string>; files: Map<string, string> } {
  const folderSet = new Set(folders);
  const fileMap = new Map(Object.entries(files));
  const nameOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);
  const parentOf = (p: string): string => {
    const i = p.lastIndexOf("/");
    return i === -1 ? "" : p.slice(0, i);
  };
  const folderNode = (path: string): FakeNode => ({
    path,
    name: nameOf(path),
    children: [
      ...[...folderSet].filter((f) => parentOf(f) === path),
      ...[...fileMap.keys()].filter((f) => parentOf(f) === path),
    ].map((p) =>
      folderSet.has(p) ? { path: p, name: nameOf(p), children: [] } : { path: p, name: nameOf(p) },
    ),
  });

  const vault: FileExplorerVault = {
    getFolderByPath: (path) => (folderSet.has(path) ? { path } : null),
    getFileByPath: (path) => (fileMap.has(path) ? { path } : null),
    getAbstractFileByPath: (path) => {
      if (folderSet.has(path)) return folderNode(path);
      if (fileMap.has(path)) return { path, name: nameOf(path) } as FakeNode;
      return null;
    },
    createFolder: async (path) => {
      folderSet.add(path);
    },
    read: async (file) => fileMap.get(file.path) ?? "",
    trashFile: async () => {},
    adapter: { exists: (path) => folderSet.has(path) || fileMap.has(path) },
  };
  return { vault, folders: folderSet, files: fileMap };
}

function createService(
  fake: ReturnType<typeof createFakeVault>,
  overrides: Partial<FileExplorerServiceDeps> = {},
) {
  const deps = {
    vault: fake.vault,
    fileManager: { trashFile: vi.fn(async () => {}) },
    resolveDocumentPath: vi.fn((p: string | null) => (p === null ? null : "Doc")),
    getRootName: () => "assets",
    notice: vi.fn(),
    importAbsolutePath: vi.fn(async () => {}),
    ...overrides,
  } satisfies FileExplorerServiceDeps;
  return { service: new NestNoteFileExplorerService(deps), deps };
}

describe("NestNoteFileExplorerService", () => {
  it("delegates resolveActiveDocument to resolveDocumentPath", () => {
    const fake = createFakeVault(["Doc"]);
    const { service, deps } = createService(fake);
    expect(service.resolveActiveDocument("Doc/index.md")).toBe("Doc");
    expect(deps.resolveDocumentPath).toHaveBeenCalledWith("Doc/index.md");
    expect(service.resolveActiveDocument(null)).toBeNull();
  });

  it("builds vault paths under document root", () => {
    const { service } = createService(createFakeVault(["Doc"]));
    expect(service.vaultPath("Doc", "")).toBe("Doc/assets");
    expect(service.vaultPath("Doc", "sub")).toBe("Doc/assets/sub");
    expect(service.vaultPath("Doc", "sub", "a.png")).toBe("Doc/assets/sub/a.png");
    expect(service.vaultPath("Doc", "", "a.png")).toBe("Doc/assets/a.png");
  });

  it("creates the root folder when missing", async () => {
    const fake = createFakeVault(["Doc"]);
    const { service } = createService(fake);
    await expect(service.ensureRoot("Doc")).resolves.toBe("Doc/assets");
    expect(fake.folders.has("Doc/assets")).toBe(true);
  });

  it("does not recreate an existing root", async () => {
    const fake = createFakeVault(["Doc", "Doc/assets"]);
    const createFolder = vi.spyOn(fake.vault, "createFolder");
    const { service } = createService(fake);
    await expect(service.ensureRoot("Doc")).resolves.toBe("Doc/assets");
    expect(createFolder).not.toHaveBeenCalled();
  });

  it("notices and returns null when root creation fails", async () => {
    const fake = createFakeVault(["Doc"]);
    fake.vault.createFolder = async () => {
      throw new Error("boom");
    };
    const { service, deps } = createService(fake);
    await expect(service.ensureRoot("Doc")).resolves.toBeNull();
    expect(deps.notice).toHaveBeenCalledWith(
      t("notice.fileExplorerRootCreateFailed"),
    );
  });

  it("lists one level only, sorted folders first", async () => {
    const fake = createFakeVault(
      ["Doc", "Doc/assets", "Doc/assets/zeta", "Doc/assets/alpha", "Doc/assets/zeta/deep"],
      {
        "Doc/assets/b.png": "",
        "Doc/assets/a.png": "",
        "Doc/assets/zeta/deep/x.png": "",
      },
    );
    const { service } = createService(fake);
    await expect(service.listEntries("Doc", "")).resolves.toEqual([
      { name: "alpha", kind: "folder" },
      { name: "zeta", kind: "folder" },
      { name: "a.png", kind: "file" },
      { name: "b.png", kind: "file" },
    ]);
    await expect(service.listEntries("Doc", "zeta")).resolves.toEqual([
      { name: "deep", kind: "folder" },
    ]);
  });

  it("returns an empty list for a missing folder", async () => {
    const { service } = createService(createFakeVault(["Doc"]));
    await expect(service.listEntries("Doc", "")).resolves.toEqual([]);
  });

  it("builds insert text via buildFileWikiLink", () => {
    const { service } = createService(createFakeVault(["Doc"]));
    expect(
      service.buildInsertText("Doc", "sub", { name: "a.png", kind: "file" }),
    ).toBe("[[assets/sub/a.png|a.png]]");
    expect(
      service.buildInsertText("Doc", "", { name: "clip.mp4", kind: "file" }),
    ).toBe("![[assets/clip.mp4|clip.mp4]]");
  });

  it("checks index.md for references", async () => {
    const fake = createFakeVault(["Doc", "Doc/assets"], {
      "Doc/index.md": "see [[assets/sub/a.png|a.png]]",
    });
    const read = vi.spyOn(fake.vault, "read");
    const { service } = createService(fake);
    await expect(
      service.indexReferencesEntry("Doc", "sub", { name: "a.png", kind: "file" }),
    ).resolves.toBe(true);
    expect(read).toHaveBeenCalledWith({ path: "Doc/index.md" });
    await expect(
      service.indexReferencesEntry("Doc", "sub", { name: "b.png", kind: "file" }),
    ).resolves.toBe(false);
    // A folder counts as referenced when a link points inside it.
    await expect(
      service.indexReferencesEntry("Doc", "", { name: "sub", kind: "folder" }),
    ).resolves.toBe(true);
    await expect(
      service.indexReferencesEntry("Doc", "", { name: "other", kind: "folder" }),
    ).resolves.toBe(false);
  });

  it("returns false when index.md is missing", async () => {
    const { service } = createService(createFakeVault(["Doc"]));
    await expect(
      service.indexReferencesEntry("Doc", "", { name: "a.png", kind: "file" }),
    ).resolves.toBe(false);
  });

  it("trashes an entry through fileManager", async () => {
    const fake = createFakeVault(["Doc", "Doc/assets"], {
      "Doc/assets/a.png": "",
    });
    const { service, deps } = createService(fake);
    await service.trashEntry("Doc", "", { name: "a.png", kind: "file" });
    expect(deps.fileManager.trashFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "Doc/assets/a.png" }),
    );
  });

  it("imports absolute paths into the target folder", async () => {
    const fake = createFakeVault(["Doc", "Doc/assets", "Doc/assets/sub"]);
    const { service, deps } = createService(fake);
    await service.pasteAbsolutePaths("Doc", "sub", [
      "C:\\data\\a.png",
      "/home/u/b.txt",
    ]);
    expect(deps.importAbsolutePath).toHaveBeenCalledTimes(2);
    expect(deps.importAbsolutePath).toHaveBeenCalledWith(
      "C:\\data\\a.png",
      "Doc/assets/sub/a.png",
    );
    expect(deps.importAbsolutePath).toHaveBeenCalledWith(
      "/home/u/b.txt",
      "Doc/assets/sub/b.txt",
    );
    expect(deps.notice).not.toHaveBeenCalled();
  });

  it("cancels the whole batch on any name conflict", async () => {
    const fake = createFakeVault(["Doc", "Doc/assets"], {
      "Doc/assets/a.png": "",
    });
    const { service, deps } = createService(fake);
    await service.pasteAbsolutePaths("Doc", "", [
      "/src/new.png",
      "/src/a.png",
    ]);
    expect(deps.notice).toHaveBeenCalledWith(t("notice.pasteConflict"));
    expect(deps.importAbsolutePath).not.toHaveBeenCalled();
  });

  it("cancels the batch when sources share a basename", async () => {
    const fake = createFakeVault(["Doc", "Doc/assets"]);
    const { service, deps } = createService(fake);
    await service.pasteAbsolutePaths("Doc", "", ["/x/a.png", "/y/a.png"]);
    expect(deps.notice).toHaveBeenCalledWith(t("notice.pasteConflict"));
    expect(deps.importAbsolutePath).not.toHaveBeenCalled();
  });

  it("treats names differing only by case as a conflict with existing entries", async () => {
    const fake = createFakeVault(["Doc", "Doc/assets", "Doc/assets/Pics"], {
      "Doc/assets/Photo.PNG": "",
    });
    const { service, deps } = createService(fake);
    await service.pasteAbsolutePaths("Doc", "", ["/src/photo.png"]);
    expect(deps.notice).toHaveBeenCalledWith(t("notice.pasteConflict"));
    expect(deps.importAbsolutePath).not.toHaveBeenCalled();

    (deps.notice as ReturnType<typeof vi.fn>).mockClear();
    await service.pasteAbsolutePaths("Doc", "", ["/src/pics"]);
    expect(deps.notice).toHaveBeenCalledWith(t("notice.pasteConflict"));
    expect(deps.importAbsolutePath).not.toHaveBeenCalled();
  });

  it("treats names differing only by case within a batch as a conflict", async () => {
    const fake = createFakeVault(["Doc", "Doc/assets"]);
    const { service, deps } = createService(fake);
    await service.pasteAbsolutePaths("Doc", "", ["/x/A.png", "/y/a.PNG"]);
    expect(deps.notice).toHaveBeenCalledWith(t("notice.pasteConflict"));
    expect(deps.importAbsolutePath).not.toHaveBeenCalled();
  });

  it("detects case-insensitive conflicts with files unknown to the vault index", async () => {
    const fake = createFakeVault(["Doc", "Doc/assets"]);
    fake.vault.adapter.list = async () => ({
      files: ["Doc/assets/.Secret"],
      folders: [],
    });
    const { service, deps } = createService(fake);
    await service.pasteAbsolutePaths("Doc", "", ["/src/.secret"]);
    expect(deps.notice).toHaveBeenCalledWith(t("notice.pasteConflict"));
    expect(deps.importAbsolutePath).not.toHaveBeenCalled();
  });

  it("still imports when adapter.list fails", async () => {
    const fake = createFakeVault(["Doc", "Doc/assets"]);
    fake.vault.adapter.list = async () => {
      throw new Error("list failed");
    };
    const { service, deps } = createService(fake);
    await service.pasteAbsolutePaths("Doc", "", ["/src/new.png"]);
    expect(deps.importAbsolutePath).toHaveBeenCalledWith(
      "/src/new.png",
      "Doc/assets/new.png",
    );
  });
});
