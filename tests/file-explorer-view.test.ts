import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import {
  FileExplorerView,
  NESTNOTE_FILES_ICON,
  VIEW_TYPE_NESTNOTE_FILES,
} from "../src/ui/file-explorer-view";
import type { NestNoteFileExplorerService } from "../src/services/file-explorer-service";
import type { DesktopFileActions } from "../src/ui/desktop-file-actions";
import type { ExplorerEntry } from "../src/domain/file-explorer-path";
import { t } from "../src/i18n";

const DOC = "Work";

const rootEntries: ExplorerEntry[] = [
  { name: "images", kind: "folder" },
  { name: "photo.png", kind: "file" },
  { name: "notes.txt", kind: "file" },
];

function fakeService(
  overrides: Partial<Record<keyof NestNoteFileExplorerService, unknown>> = {},
) {
  const service = {
    resolveActiveDocument: vi.fn((path: string | null) =>
      path === null ? null : DOC,
    ),
    ensureRoot: vi.fn().mockResolvedValue(`${DOC}/files`),
    listEntries: vi.fn(async (_doc: string, rel: string) =>
      rel === "" ? rootEntries : [{ name: "inner.md", kind: "file" }],
    ),
    vaultPath: vi.fn((doc: string, rel: string, name?: string) =>
      [doc, "files", rel, name].filter((p) => p !== undefined && p !== "").join("/"),
    ),
    buildInsertText: vi.fn(
      (_doc: string, _rel: string, entry: ExplorerEntry) =>
        `[[files/${entry.name}|${entry.name}]]`,
    ),
    indexReferencesEntry: vi.fn().mockResolvedValue(false),
    trashEntry: vi.fn().mockResolvedValue(undefined),
    pasteAbsolutePaths: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return service as unknown as NestNoteFileExplorerService & typeof service;
}

function fakeDesktop(
  overrides: Partial<DesktopFileActions> = {},
): DesktopFileActions {
  return {
    copyText: vi.fn().mockResolvedValue(undefined),
    resolveAbsolutePath: vi.fn((p: string) => `/abs/${p}`),
    openWithDefaultApp: vi.fn().mockResolvedValue(undefined),
    showInSystemExplorer: vi.fn().mockResolvedValue(undefined),
    copyFiles: vi.fn().mockResolvedValue(undefined),
    readClipboardFiles: vi.fn().mockResolvedValue([]),
    importAbsolutePath: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

interface MountOptions {
  activePath?: string | null;
  service?: ReturnType<typeof fakeService>;
  desktop?: DesktopFileActions;
  getEditorInsert?: () => ((text: string) => boolean) | null;
}

async function mount(options: MountOptions = {}) {
  const service = options.service ?? fakeService();
  const desktop = options.desktop ?? fakeDesktop();
  const notice = vi.fn();
  const activePath =
    options.activePath === undefined ? "Work/index.md" : options.activePath;
  const view = new FileExplorerView({ app: {} } as unknown as WorkspaceLeaf, {
    getActiveFilePath: () => activePath,
    service,
    desktop,
    notice,
    getEditorInsert: options.getEditorInsert,
  });
  await view.onOpen();
  document.body.appendChild(view.contentEl);
  return { view, service, desktop, notice };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

function rowEl(name: string): HTMLElement {
  const el = document.querySelector(`.nestnote-files-row[data-name="${name}"]`);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`missing row ${name}`);
  }
  return el;
}

function rowNames(): string[] {
  return [...document.querySelectorAll(".nestnote-files-row")].map(
    (el) => el.getAttribute("data-name") ?? "",
  );
}

function openContextMenu(name: string): void {
  document.querySelector(".menu")?.remove();
  rowEl(name).dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
}

function menuStructure(): string[] {
  const menu = document.querySelector(".menu");
  if (menu === null) {
    throw new Error("menu missing");
  }
  return [...menu.children].map((el) =>
    el.classList.contains("menu-separator")
      ? "separator"
      : (el.getAttribute("aria-label") ?? ""),
  );
}

function clickMenu(label: string): void {
  const item = document.querySelector(`.menu [aria-label="${label}"]`);
  if (!(item instanceof HTMLElement)) {
    throw new Error(`missing menu item ${label}`);
  }
  item.click();
}

function pathText(): string {
  return document.querySelector(".nestnote-files-path")?.textContent ?? "";
}

async function confirmModal(): Promise<void> {
  const modal = document.querySelector(".nestnote-modal");
  if (!(modal instanceof HTMLElement)) {
    throw new Error("modal was not opened");
  }
  const confirm = modal.querySelector(`[aria-label="${t("ui.confirm")}"]`);
  if (!(confirm instanceof HTMLElement)) {
    throw new Error("confirm button missing");
  }
  confirm.click();
  await flush();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("FileExplorerView", () => {
  it("exposes view metadata", async () => {
    const { view } = await mount();
    expect(view.getViewType()).toBe(VIEW_TYPE_NESTNOTE_FILES);
    expect(VIEW_TYPE_NESTNOTE_FILES).toBe("nestnote-file-explorer");
    expect(view.getIcon()).toBe(NESTNOTE_FILES_ICON);
    expect(NESTNOTE_FILES_ICON).toBe("folder");
    expect(view.getDisplayText()).toBe(t("ui.fileExplorer"));
  });

  it("shows the need-document message when there is no NestNote document", async () => {
    const service = fakeService({
      resolveActiveDocument: vi.fn().mockReturnValue(null),
    });
    await mount({ service });
    const empty = document.querySelector(".nestnote-files-empty");
    expect(empty?.textContent).toBe(t("ui.fileExplorerNeedDocument"));
    expect(service.ensureRoot).not.toHaveBeenCalled();
    expect(document.querySelector(".nestnote-files-row")).toBeNull();
  });

  it("renders the path bar and entries with extensions", async () => {
    await mount();
    expect(pathText()).toBe("files");
    expect(rowNames()).toEqual(["images", "photo.png", "notes.txt"]);
    expect(rowEl("images").dataset.kind).toBe("folder");
    expect(rowEl("photo.png").dataset.kind).toBe("file");
    expect(rowEl("photo.png").textContent).toContain("photo.png");
    expect(
      rowEl("images").querySelector("[data-icon]")?.getAttribute("data-icon"),
    ).toBe("folder");
    expect(
      rowEl("images")
        .querySelector(".nestnote-files-icon")
        ?.getAttribute("data-file-kind"),
    ).toBe("folder");
    expect(
      rowEl("photo.png").querySelector("[data-icon]")?.getAttribute("data-icon"),
    ).toBe("image");
    expect(
      rowEl("photo.png")
        .querySelector(".nestnote-files-icon")
        ?.getAttribute("data-file-kind"),
    ).toBe("image");
    expect(
      rowEl("notes.txt").querySelector("[data-icon]")?.getAttribute("data-icon"),
    ).toBe("file-text");
  });

  it("shows an empty folder message", async () => {
    const service = fakeService({
      listEntries: vi.fn().mockResolvedValue([]),
    });
    await mount({ service });
    expect(document.querySelector(".nestnote-files-empty")?.textContent).toBe(
      t("ui.fileExplorerEmpty"),
    );
  });

  it("shows an error message when the root cannot be created", async () => {
    const service = fakeService({
      ensureRoot: vi.fn().mockResolvedValue(null),
    });
    await mount({ service });
    expect(document.querySelector(".nestnote-files-empty")?.textContent).toBe(
      t("ui.fileExplorerError"),
    );
  });

  it("enters a subfolder on double click and goes back up", async () => {
    const { service } = await mount();
    rowEl("images").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flush();
    expect(service.listEntries).toHaveBeenLastCalledWith(DOC, "images");
    expect(pathText()).toBe("files/images");
    expect(rowNames()).toEqual(["inner.md"]);

    const up = document.querySelector(
      `.nestnote-files-pathbar [aria-label="${t("ui.fileExplorerGoUp")}"]`,
    ) as HTMLButtonElement;
    expect(up.disabled).toBe(false);
    up.click();
    await flush();
    expect(service.listEntries).toHaveBeenLastCalledWith(DOC, "");
    expect(pathText()).toBe("files");
    const upAgain = document.querySelector(
      `.nestnote-files-pathbar [aria-label="${t("ui.fileExplorerGoUp")}"]`,
    ) as HTMLButtonElement;
    expect(upAgain.disabled).toBe(true);
  });

  it("opens a file with the default app on double click", async () => {
    const { desktop } = await mount();
    rowEl("photo.png").dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
    await flush();
    expect(desktop.openWithDefaultApp).toHaveBeenCalledWith(
      "/abs/Work/files/photo.png",
    );
  });

  it("notices when opening a file fails", async () => {
    const desktop = fakeDesktop({
      openWithDefaultApp: vi.fn().mockRejectedValue(new Error("x")),
    });
    const { notice } = await mount({ desktop });
    rowEl("photo.png").dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
    await flush();
    expect(notice).toHaveBeenCalledWith(t("notice.openExternallyFailed"));
  });

  it("reveals the current folder in the system explorer", async () => {
    const { desktop } = await mount();
    const reveal = document.querySelector(
      `.nestnote-files-pathbar [aria-label="${t("ui.showInSystemExplorer")}"]`,
    ) as HTMLElement;
    reveal.click();
    await flush();
    expect(desktop.showInSystemExplorer).toHaveBeenCalledWith("/abs/Work/files");
  });

  it("refresh(true) resets the path and re-resolves the document", async () => {
    const { view, service } = await mount();
    rowEl("images").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flush();
    expect(pathText()).toBe("files/images");
    await view.refresh(true);
    expect(pathText()).toBe("files");
    expect(service.listEntries).toHaveBeenLastCalledWith(DOC, "");
  });

  it("orders the entry context menu: insert, copy, delete", async () => {
    await mount();
    openContextMenu("photo.png");
    expect(menuStructure()).toEqual([
      t("ui.insertIntoDocument"),
      "separator",
      t("ui.copy"),
      "separator",
      t("ui.delete"),
    ]);
  });

  it("offers paste only on the blank area context menu", async () => {
    await mount();
    document.querySelector(".menu")?.remove();
    document
      .querySelector(".nestnote-files-body")
      ?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    expect(menuStructure()).toEqual([t("ui.paste")]);
  });

  function openBlankContextMenu(): void {
    document.querySelector(".menu")?.remove();
    document
      .querySelector(".nestnote-files-body")
      ?.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
  }

  it("inserts a wiki link through the editor insert callback", async () => {
    const insert = vi.fn().mockReturnValue(true);
    const { service, notice } = await mount({ getEditorInsert: () => insert });
    openContextMenu("photo.png");
    clickMenu(t("ui.insertIntoDocument"));
    await flush();
    expect(service.buildInsertText).toHaveBeenCalledWith(DOC, "", {
      name: "photo.png",
      kind: "file",
    });
    expect(insert).toHaveBeenCalledWith("[[files/photo.png|photo.png]]");
    expect(notice).not.toHaveBeenCalled();
  });

  it("notices when no editor is available for insert", async () => {
    const { notice } = await mount({ getEditorInsert: () => null });
    openContextMenu("photo.png");
    clickMenu(t("ui.insertIntoDocument"));
    await flush();
    expect(notice).toHaveBeenCalledWith(t("notice.insertRequiresEditor"));
  });

  it("notices when the editor insert returns false", async () => {
    const { notice } = await mount({ getEditorInsert: () => () => false });
    openContextMenu("photo.png");
    clickMenu(t("ui.insertIntoDocument"));
    await flush();
    expect(notice).toHaveBeenCalledWith(t("notice.insertRequiresEditor"));
  });

  it("copies the entry to the system file clipboard", async () => {
    const { desktop } = await mount();
    openContextMenu("photo.png");
    clickMenu(t("ui.copy"));
    await flush();
    expect(desktop.copyFiles).toHaveBeenCalledWith(["/abs/Work/files/photo.png"]);
  });

  it("notices when copying files fails", async () => {
    const desktop = fakeDesktop({
      copyFiles: vi.fn().mockRejectedValue(new Error("unsupported")),
    });
    const { notice } = await mount({ desktop });
    openContextMenu("photo.png");
    clickMenu(t("ui.copy"));
    await flush();
    expect(notice).toHaveBeenCalledWith(t("notice.copyFailed"));
  });

  it("pastes clipboard files into the current folder and refreshes", async () => {
    const desktop = fakeDesktop({
      readClipboardFiles: vi.fn().mockResolvedValue(["C:\\tmp\\a.png"]),
    });
    const { service } = await mount({ desktop });
    const callsBefore = vi.mocked(service.listEntries).mock.calls.length;
    openBlankContextMenu();
    clickMenu(t("ui.paste"));
    await flush();
    expect(service.pasteAbsolutePaths).toHaveBeenCalledWith(DOC, "", [
      "C:\\tmp\\a.png",
    ]);
    expect(vi.mocked(service.listEntries).mock.calls.length).toBe(callsBefore + 1);
  });

  it("notices when the clipboard has no files", async () => {
    const { service, notice } = await mount();
    openBlankContextMenu();
    clickMenu(t("ui.paste"));
    await flush();
    expect(service.pasteAbsolutePaths).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(t("notice.clipboardFilesUnavailable"));
  });

  it("notices when reading the clipboard fails", async () => {
    const desktop = fakeDesktop({
      readClipboardFiles: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const { service, notice } = await mount({ desktop });
    openBlankContextMenu();
    clickMenu(t("ui.paste"));
    await flush();
    expect(service.pasteAbsolutePaths).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(t("notice.clipboardFilesUnavailable"));
  });

  it("notices when importing pasted files fails", async () => {
    const desktop = fakeDesktop({
      readClipboardFiles: vi.fn().mockResolvedValue(["C:\\tmp\\a.png"]),
    });
    const service = fakeService({
      pasteAbsolutePaths: vi.fn().mockRejectedValue(new Error("copy failed")),
    });
    const { notice } = await mount({ desktop, service });
    openBlankContextMenu();
    clickMenu(t("ui.paste"));
    await flush();
    expect(notice).toHaveBeenCalledWith(t("notice.pasteFailed"));
  });

  it("confirms before moving an entry to the trash, then refreshes", async () => {
    const { service } = await mount();
    openContextMenu("photo.png");
    clickMenu(t("ui.delete"));
    await flush();
    expect(service.indexReferencesEntry).toHaveBeenCalledWith(DOC, "", {
      name: "photo.png",
      kind: "file",
    });
    expect(document.querySelector(".nestnote-modal-message")?.textContent).toBe(
      t("ui.deleteFileConfirm", { name: "photo.png" }),
    );
    expect(service.trashEntry).not.toHaveBeenCalled();
    const callsBefore = vi.mocked(service.listEntries).mock.calls.length;
    await confirmModal();
    expect(service.trashEntry).toHaveBeenCalledWith(DOC, "", {
      name: "photo.png",
      kind: "file",
    });
    expect(vi.mocked(service.listEntries).mock.calls.length).toBe(callsBefore + 1);
  });

  it("uses the linked confirmation when the index still references the entry", async () => {
    const service = fakeService({
      indexReferencesEntry: vi.fn().mockResolvedValue(true),
    });
    await mount({ service });
    openContextMenu("photo.png");
    clickMenu(t("ui.delete"));
    await flush();
    expect(document.querySelector(".nestnote-modal-message")?.textContent).toBe(
      t("ui.deleteFileConfirmLinked", { name: "photo.png" }),
    );
  });

  it("notices when trashing fails", async () => {
    const service = fakeService({
      trashEntry: vi.fn().mockRejectedValue(new Error("nope")),
    });
    const { notice } = await mount({ service });
    openContextMenu("photo.png");
    clickMenu(t("ui.delete"));
    await flush();
    await confirmModal();
    expect(notice).toHaveBeenCalledWith(t("notice.deleteFailed"));
  });

  it("does not trash when the modal is cancelled", async () => {
    const { service } = await mount();
    openContextMenu("photo.png");
    clickMenu(t("ui.delete"));
    await flush();
    const cancel = document.querySelector(
      `.nestnote-modal [aria-label="${t("ui.cancel")}"]`,
    ) as HTMLElement;
    cancel.click();
    await flush();
    expect(service.trashEntry).not.toHaveBeenCalled();
  });
});
