import { ItemView, Menu, Modal, setIcon } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import type { ExplorerEntry } from "../domain/file-explorer-path";
import type { NestNoteFileExplorerService } from "../services/file-explorer-service";
import type { DesktopFileActions } from "./desktop-file-actions";

export const VIEW_TYPE_NESTNOTE_FILES = "nestnote-file-explorer";

export const NESTNOTE_FILES_ICON = "folder";

export interface FileExplorerViewOptions {
  getActiveFilePath(): string | null;
  service: NestNoteFileExplorerService;
  desktop: DesktopFileActions;
  notice: (message: string) => void;
  getEditorInsert?: () => ((text: string) => boolean) | null;
}

type ViewState =
  | { kind: "need-document" }
  | { kind: "error" }
  | { kind: "ready"; entries: ExplorerEntry[] };

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv", "avi"]);
const TEXT_EXTENSIONS = new Set(["md", "txt", "json", "csv", "log"]);
const PDF_EXTENSIONS = new Set(["pdf"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz"]);
const CODE_EXTENSIONS = new Set([
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rs",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "cs",
  "css",
  "html",
  "xml",
  "yml",
  "yaml",
]);

/** Lucide 图标类别，用于着色区分类型 */
export type FileIconKind =
  | "folder"
  | "image"
  | "audio"
  | "video"
  | "text"
  | "pdf"
  | "archive"
  | "code"
  | "file";

export class FileExplorerView extends ItemView {
  private documentPath: string | null = null;
  private relativeWithinRoot = "";
  private state: ViewState = { kind: "need-document" };
  private selected: string | null = null;
  private refreshToken = 0;

  private pathEl: HTMLElement | null = null;
  private upButton: HTMLButtonElement | null = null;
  private revealButton: HTMLButtonElement | null = null;
  private bodyEl: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly options: FileExplorerViewOptions,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_NESTNOTE_FILES;
  }

  getDisplayText(): string {
    return t("ui.fileExplorer");
  }

  getIcon(): string {
    return NESTNOTE_FILES_ICON;
  }

  async onOpen(): Promise<void> {
    this.contentEl.replaceChildren();
    this.contentEl.classList.add("nestnote-view", "nestnote-files-view");

    const pathbar = createEl("div", { cls: "nestnote-files-pathbar" });
    this.upButton = iconButton("arrow-up", t("ui.fileExplorerGoUp"), () => {
      this.goUp();
    });
    this.upButton.classList.add("up");
    this.pathEl = createEl("div", { cls: "nestnote-files-path" });
    this.revealButton = iconButton(
      "folder-open",
      t("ui.showInSystemExplorer"),
      () => {
        void this.revealCurrentFolder();
      },
    );
    this.revealButton.classList.add("reveal");
    pathbar.append(this.upButton, this.pathEl, this.revealButton);

    this.bodyEl = createEl("div", { cls: "nestnote-files-body" });
    this.bodyEl.addEventListener("contextmenu", (event) => {
      if (this.state.kind !== "ready") {
        return;
      }
      event.preventDefault();
      this.showBackgroundMenu(event);
    });

    this.contentEl.append(pathbar, this.bodyEl);
    await this.refresh(true);
  }

  async onClose(): Promise<void> {
    this.refreshToken++;
    this.pathEl = null;
    this.upButton = null;
    this.revealButton = null;
    this.bodyEl = null;
    this.contentEl.replaceChildren();
  }

  /** 活动文档变化或外部请求时调用；resetPath=true 时回到资源根 */
  async refresh(resetPath = false): Promise<void> {
    const token = ++this.refreshToken;
    const documentPath = this.options.service.resolveActiveDocument(
      this.options.getActiveFilePath(),
    );
    if (resetPath || documentPath !== this.documentPath) {
      this.relativeWithinRoot = "";
      this.selected = null;
    }
    this.documentPath = documentPath;

    if (documentPath === null) {
      this.state = { kind: "need-document" };
      this.render();
      return;
    }

    let next: ViewState;
    try {
      const root = await this.options.service.ensureRoot(documentPath);
      if (root === null) {
        next = { kind: "error" };
      } else {
        const entries = await this.options.service.listEntries(
          documentPath,
          this.relativeWithinRoot,
        );
        next = { kind: "ready", entries };
      }
    } catch {
      next = { kind: "error" };
    }
    if (token !== this.refreshToken) {
      return;
    }
    this.state = next;
    this.render();
  }

  private render(): void {
    const body = this.bodyEl;
    if (body === null) {
      return;
    }
    const documentPath = this.documentPath;
    const ready = this.state.kind === "ready" && documentPath !== null;

    if (this.pathEl !== null) {
      this.pathEl.textContent =
        ready && documentPath !== null ? this.displayPath(documentPath) : "";
    }
    if (this.upButton !== null) {
      this.upButton.disabled = !ready || this.relativeWithinRoot === "";
    }
    if (this.revealButton !== null) {
      this.revealButton.disabled = !ready;
    }

    switch (this.state.kind) {
      case "need-document":
        body.replaceChildren(
          emptyEl(t("ui.fileExplorerNeedDocument")),
        );
        return;
      case "error":
        body.replaceChildren(emptyEl(t("ui.fileExplorerError")));
        return;
      case "ready": {
        if (this.state.entries.length === 0) {
          body.replaceChildren(emptyEl(t("ui.fileExplorerEmpty")));
          return;
        }
        const list = createEl("div", { cls: "nestnote-files-list" });
        for (const entry of this.state.entries) {
          list.append(this.buildRow(entry));
        }
        body.replaceChildren(list);
      }
    }
  }

  private displayPath(documentPath: string): string {
    const full = this.options.service.vaultPath(
      documentPath,
      this.relativeWithinRoot,
    );
    const prefix = `${documentPath.replace(/^\/+|\/+$/g, "")}/`;
    return full.startsWith(prefix) ? full.slice(prefix.length) : full;
  }

  private buildRow(entry: ExplorerEntry): HTMLElement {
    const row = createEl("div", { cls: "nestnote-files-row" });
    row.dataset.name = entry.name;
    row.dataset.kind = entry.kind;
    if (this.selected === entry.name) {
      row.classList.add("is-selected");
    }

    const meta = fileIconMeta(entry);
    const icon = createEl("span", { cls: "nestnote-files-icon" });
    icon.dataset.fileKind = meta.kind;
    setIcon(icon, meta.icon);
    const name = createEl("span", {
      cls: "nestnote-files-name",
      text: entry.name,
    });
    row.append(icon, name);

    row.addEventListener("click", () => {
      this.select(entry.name);
    });
    row.addEventListener("dblclick", (event) => {
      event.preventDefault();
      void this.activate(entry);
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.select(entry.name);
      this.showEntryMenu(entry, event);
    });
    return row;
  }

  private select(name: string): void {
    this.selected = name;
    this.bodyEl
      ?.querySelectorAll(".nestnote-files-row")
      .forEach((el) => {
        el.classList.toggle("is-selected", el.getAttribute("data-name") === name);
      });
  }

  private async activate(entry: ExplorerEntry): Promise<void> {
    if (entry.kind === "folder") {
      this.relativeWithinRoot = joinRelative(this.relativeWithinRoot, entry.name);
      this.selected = null;
      await this.refresh(false);
      return;
    }
    const absolute = this.absolutePath(entry);
    if (absolute === null) {
      return;
    }
    try {
      await this.options.desktop.openWithDefaultApp(absolute);
    } catch {
      this.options.notice(t("notice.openExternallyFailed"));
    }
  }

  private goUp(): void {
    if (this.relativeWithinRoot === "") {
      return;
    }
    const slash = this.relativeWithinRoot.lastIndexOf("/");
    this.relativeWithinRoot =
      slash === -1 ? "" : this.relativeWithinRoot.slice(0, slash);
    this.selected = null;
    void this.refresh(false);
  }

  private async revealCurrentFolder(): Promise<void> {
    const documentPath = this.documentPath;
    if (documentPath === null) {
      return;
    }
    const absolute = this.options.desktop.resolveAbsolutePath(
      this.options.service.vaultPath(documentPath, this.relativeWithinRoot),
    );
    if (absolute === null) {
      this.options.notice(t("notice.localPathUnavailable"));
      return;
    }
    try {
      await this.options.desktop.showInSystemExplorer(absolute);
    } catch {
      this.options.notice(t("notice.openExternallyFailed"));
    }
  }

  private absolutePath(entry: ExplorerEntry): string | null {
    const documentPath = this.documentPath;
    if (documentPath === null) {
      return null;
    }
    const absolute = this.options.desktop.resolveAbsolutePath(
      this.options.service.vaultPath(
        documentPath,
        this.relativeWithinRoot,
        entry.name,
      ),
    );
    if (absolute === null) {
      this.options.notice(t("notice.localPathUnavailable"));
    }
    return absolute;
  }

  private showEntryMenu(entry: ExplorerEntry, event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle(t("ui.insertIntoDocument"));
      item.setIcon("file-input");
      item.onClick(() => {
        this.insertEntry(entry);
      });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle(t("ui.copy"));
      item.setIcon("copy");
      item.onClick(() => {
        void this.copyEntry(entry);
      });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle(t("ui.delete"));
      item.setIcon("trash-2");
      item.onClick(() => {
        void this.confirmDelete(entry);
      });
    });
    menu.showAtMouseEvent(event);
  }

  private showBackgroundMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle(t("ui.paste"));
      item.setIcon("clipboard-paste");
      item.onClick(() => {
        void this.pasteFromClipboard();
      });
    });
    menu.showAtMouseEvent(event);
  }

  private insertEntry(entry: ExplorerEntry): void {
    const documentPath = this.documentPath;
    if (documentPath === null) {
      return;
    }
    const insert = this.options.getEditorInsert?.() ?? null;
    if (insert === null) {
      this.options.notice(t("notice.insertRequiresEditor"));
      return;
    }
    const text = this.options.service.buildInsertText(
      documentPath,
      this.relativeWithinRoot,
      entry,
    );
    let inserted = false;
    try {
      inserted = insert(text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      this.options.notice(t("notice.insertRequiresEditor"));
    }
  }

  private async copyEntry(entry: ExplorerEntry): Promise<void> {
    const absolute = this.absolutePath(entry);
    if (absolute === null) {
      return;
    }
    try {
      await this.options.desktop.copyFiles([absolute]);
    } catch {
      this.options.notice(t("notice.copyFailed"));
    }
  }

  private async pasteFromClipboard(): Promise<void> {
    const documentPath = this.documentPath;
    if (documentPath === null) {
      return;
    }
    let sources: string[];
    try {
      sources = await this.options.desktop.readClipboardFiles();
    } catch {
      this.options.notice(t("notice.clipboardFilesUnavailable"));
      return;
    }
    if (sources.length === 0) {
      this.options.notice(t("notice.clipboardFilesUnavailable"));
      return;
    }
    try {
      await this.options.service.pasteAbsolutePaths(
        documentPath,
        this.relativeWithinRoot,
        sources,
      );
    } catch {
      this.options.notice(t("notice.pasteFailed"));
    }
    await this.refresh(false);
  }

  private async confirmDelete(entry: ExplorerEntry): Promise<void> {
    const documentPath = this.documentPath;
    if (documentPath === null) {
      return;
    }
    const relative = this.relativeWithinRoot;
    let referenced: boolean;
    try {
      referenced = await this.options.service.indexReferencesEntry(
        documentPath,
        relative,
        entry,
      );
    } catch {
      // 无法确认引用关系时，保守地按“仍被引用”提示。
      referenced = true;
    }
    const message = t(
      referenced ? "ui.deleteFileConfirmLinked" : "ui.deleteFileConfirm",
      { name: entry.name },
    );
    new NestNoteConfirmModal(this.app, t("ui.deleteFile"), message, () => {
      void this.trash(documentPath, relative, entry);
    }).open();
  }

  private async trash(
    documentPath: string,
    relative: string,
    entry: ExplorerEntry,
  ): Promise<void> {
    try {
      await this.options.service.trashEntry(documentPath, relative, entry);
    } catch {
      this.options.notice(t("notice.deleteFailed"));
    }
    await this.refresh(false);
  }
}

class NestNoteConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly heading: string,
    private readonly message: string,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.classList.add("nestnote-modal");
    this.setTitle(this.heading);

    const body = createEl("p", {
      cls: "nestnote-modal-message",
      text: this.message,
    });

    const actions = createEl("div", { cls: "nestnote-modal-actions" });
    actions.append(
      iconButton("check", t("ui.confirm"), (event) => {
        event.preventDefault();
        this.onConfirm();
        this.close();
      }),
      iconButton("x", t("ui.cancel"), () => {
        this.close();
      }),
    );

    this.contentEl.append(body, actions);
  }

  onClose(): void {
    this.contentEl.replaceChildren();
  }
}

function iconButton(
  icon: string,
  label: string,
  onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
  const button = createEl("button", {
    cls: "clickable-icon nestnote-icon-button",
    attr: { type: "button", "aria-label": label },
  });
  setIcon(button, icon);
  button.addEventListener("click", onClick);
  return button;
}

function emptyEl(text: string): HTMLElement {
  return createEl("div", { cls: "nestnote-files-empty", text });
}

function joinRelative(base: string, name: string): string {
  return base === "" ? name : `${base}/${name}`;
}

export function fileIconMeta(entry: ExplorerEntry): {
  icon: string;
  kind: FileIconKind;
} {
  if (entry.kind === "folder") {
    return { icon: "folder", kind: "folder" };
  }
  const dot = entry.name.lastIndexOf(".");
  const ext = dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : "";
  // 图标来自 Obsidian 内置 Lucide 集（setIcon）；用更直观的 glyph + data-file-kind 着色
  if (IMAGE_EXTENSIONS.has(ext)) return { icon: "image", kind: "image" };
  if (AUDIO_EXTENSIONS.has(ext)) return { icon: "music", kind: "audio" };
  if (VIDEO_EXTENSIONS.has(ext)) return { icon: "film", kind: "video" };
  if (PDF_EXTENSIONS.has(ext)) return { icon: "book-open", kind: "pdf" };
  if (ARCHIVE_EXTENSIONS.has(ext)) return { icon: "archive", kind: "archive" };
  if (CODE_EXTENSIONS.has(ext)) return { icon: "file-code", kind: "code" };
  if (TEXT_EXTENSIONS.has(ext)) return { icon: "file-text", kind: "text" };
  return { icon: "file", kind: "file" };
}
