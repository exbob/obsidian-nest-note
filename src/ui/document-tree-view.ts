import { ItemView, Menu, Modal, setIcon } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import type { DocumentNode, DocumentService } from "../types";
import { isAlreadyNoticed } from "../services/document-service";
import type { DesktopFileActions } from "./desktop-file-actions";
import { createDesktopFileActions } from "./desktop-file-actions";

export const VIEW_TYPE_NESTNOTE = "nestnote-document-tree";

export const NESTNOTE_DOCUMENT_DRAG_MIME =
  "application/x-nestnote-document-path";

export interface DocumentTreeViewOptions {
  documents: DocumentService;
  getNodes: () => readonly DocumentNode[];
  requestRefresh: () => Promise<void>;
  notice?: (message: string) => void;
  desktop?: DesktopFileActions;
}

export class DocumentTreeView extends ItemView {
  private treeEl: HTMLElement | null = null;
  private allToggleButton: HTMLButtonElement | null = null;
  private nodes: readonly DocumentNode[] = [];
  private expanded = new Set<string>();
  private selected: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly options: DocumentTreeViewOptions,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_NESTNOTE;
  }

  getDisplayText(): string {
    return "NestNote";
  }

  getIcon(): string {
    return "folder-tree";
  }

  async onOpen(): Promise<void> {
    this.contentEl.replaceChildren();
    this.contentEl.classList.add("nestnote-view");

    const toolbar = createEl("div", { cls: "nestnote-toolbar" });
    this.allToggleButton = iconButton("chevrons-up-down", t("ui.expandAll"), () => {
      this.toggleAllExpanded();
    });
    toolbar.append(
      iconButton("plus", t("command.newDocument"), () => {
        this.openNameModal(t("command.newDocument"), "", (name) =>
          this.createAndOpen(null, name),
        );
      }),
      this.allToggleButton,
      iconButton("refresh-cw", t("command.refresh"), () => {
        this.options.requestRefresh();
      }),
    );

    const tree = createEl("div", { cls: "nestnote-tree" });
    this.treeEl = tree;
    tree.addEventListener("dragover", (event) => {
      event.preventDefault();
      this.clearDropHighlights();
      tree.classList.add("is-drop-root");
    });
    tree.addEventListener("dragleave", () => {
      tree.classList.remove("is-drop-root");
    });
    tree.addEventListener("drop", (event) => {
      event.preventDefault();
      this.clearDropHighlights();
      const source = event.dataTransfer?.getData(NESTNOTE_DOCUMENT_DRAG_MIME) ?? "";
      void this.handleDrop(source, null, null);
    });
    this.contentEl.append(toolbar, tree);
    this.render(this.options.getNodes());
  }

  async onClose(): Promise<void> {
    this.treeEl = null;
    this.allToggleButton = null;
    this.contentEl.replaceChildren();
  }

  render(nodes: readonly DocumentNode[]): void {
    this.nodes = nodes;
    this.expanded = new Set(
      [...this.expanded].filter((path) => containsPath(nodes, path)),
    );
    if (this.selected !== null && !containsPath(nodes, this.selected)) {
      this.selected = null;
    }
    this.syncAllToggleButton();
    if (this.treeEl === null) {
      return;
    }
    this.treeEl.replaceChildren(this.buildList(nodes));
  }

  private buildList(nodes: readonly DocumentNode[]): HTMLUListElement {
    const list = createEl("ul", { cls: "nestnote-list" });
    for (const node of nodes) {
      list.append(this.buildNode(node));
    }
    return list;
  }

  private buildNode(node: DocumentNode): HTMLLIElement {
    const item = createEl("li", { cls: "nestnote-node" });
    item.dataset.path = node.path;
    if (this.expanded.has(node.path)) {
      item.classList.add("is-expanded");
    }
    if (this.selected === node.path) {
      item.classList.add("is-selected");
    }

    const row = createEl("div", { cls: "nestnote-row" });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showDocumentMenu(node, event);
    });
    row.draggable = true;
    row.addEventListener("dragstart", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("button") !== null) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData(NESTNOTE_DOCUMENT_DRAG_MIME, node.path);
      if (event.dataTransfer !== null) {
        event.dataTransfer.effectAllowed = "move";
      }
    });
    row.addEventListener("dragend", () => {
      this.clearDropHighlights();
    });

    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.clearDropHighlights();
      const zone = this.dropZone(event, item, node, row);
      if (zone === "before") {
        item.classList.add("is-drop-before");
      } else if (zone === "after") {
        item.classList.add("is-drop-after");
      } else {
        item.classList.add("is-drop-target");
      }
    });
    item.addEventListener("dragleave", (event) => {
      if (event.currentTarget instanceof HTMLElement) {
        event.currentTarget.classList.remove(
          "is-drop-target",
          "is-drop-before",
          "is-drop-after",
        );
      }
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.clearDropHighlights();
      const source = event.dataTransfer?.getData(NESTNOTE_DOCUMENT_DRAG_MIME) ?? "";
      const zone = this.dropZone(event, item, node, row);
      if ((zone === "before" || zone === "after") && source === node.path) {
        return;
      }
      const { newParentPath, insertBeforePath } = this.dropParams(
        node,
        zone,
        source,
      );
      void this.handleDrop(source, newParentPath, insertBeforePath);
    });

    if (node.children.length > 0) {
      const expanded = this.expanded.has(node.path);
      row.append(
        iconButton(
          expanded ? "chevron-down" : "chevron-right",
          expanded ? t("ui.collapse") : t("ui.expand"),
          (event) => {
            event.stopPropagation();
            this.toggleExpanded(node.path);
          },
        ),
      );
    } else {
      const spacer = createEl("span", { cls: "nestnote-twistie-spacer" });
      row.append(spacer);
    }

    const name = createEl("span", { cls: "nestnote-name" });
    name.textContent = node.name;
    name.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.openDocument(node.path);
    });

    const actions = createEl("div", { cls: "nestnote-actions" });
    actions.append(
      iconButton("plus", t("command.newChildDocument"), (event) => {
        event.stopPropagation();
        this.openNameModal(t("command.newChildDocument"), "", (name) =>
          this.createAndOpen(node.path, name),
        );
      }),
      iconButton("ellipsis-vertical", t("ui.more"), (event) => {
        event.stopPropagation();
        this.showDocumentMenu(node, event);
      }),
    );

    row.append(name, actions);
    item.append(row);

    if (node.children.length > 0) {
      const children = this.buildList(node.children);
      children.classList.add("nestnote-children");
      item.append(children);
    }

    return item;
  }

  private showDocumentMenu(node: DocumentNode, event: MouseEvent): void {
    const menu = new Menu();
    const subtreePaths = this.expandablePaths([node]);
    if (subtreePaths.length > 0) {
      const allExpanded = subtreePaths.every((path) => this.expanded.has(path));
      menu.addItem((item) => {
        item.setTitle(allExpanded ? t("ui.collapseAll") : t("ui.expandAll"));
        item.setIcon(allExpanded ? "chevrons-down-up" : "chevrons-up-down");
        item.onClick(() => {
          this.toggleExpandedPaths(subtreePaths);
        });
      });
      menu.addSeparator();
    }
    menu.addItem((item) => {
      item.setTitle(t("ui.copyRelativePath"));
      item.setIcon("copy");
      item.onClick(() => {
        void this.copyText(node.indexPath);
      });
    });
    menu.addItem((item) => {
      item.setTitle(t("ui.copyAbsolutePath"));
      item.setIcon("copy");
      item.onClick(() => {
        void this.copyAbsolutePath(node.indexPath);
      });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle(t("ui.openWithDefaultApp"));
      item.setIcon("external-link");
      item.onClick(() => {
        void this.openIndexExternally(node.indexPath, "app");
      });
    });
    menu.addItem((item) => {
      item.setTitle(t("ui.showInSystemExplorer"));
      item.setIcon("folder-open");
      item.onClick(() => {
        void this.openIndexExternally(node.indexPath, "folder");
      });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle(t("ui.rename"));
      item.setIcon("pencil");
      item.onClick(() => {
        this.openNameModal(t("ui.rename"), node.name, (name) =>
          this.run(() => this.options.documents.rename(node.path, name)),
        );
      });
    });
    menu.addItem((item) => {
      item.setTitle(t("ui.delete"));
      item.setIcon("trash-2");
      item.onClick(() => {
        this.openTrashModal(node);
      });
    });
    menu.showAtMouseEvent(event);
  }

  private fileActions(): DesktopFileActions {
    return this.options.desktop ?? createDesktopFileActions(this.app);
  }

  private async copyText(text: string): Promise<void> {
    try {
      await this.fileActions().copyText(text);
    } catch {
      this.options.notice?.(t("notice.copyFailed"));
    }
  }

  private async copyAbsolutePath(indexPath: string): Promise<void> {
    const absolute = this.fileActions().resolveAbsolutePath(indexPath);
    if (absolute === null) {
      this.options.notice?.(t("notice.localPathUnavailable"));
      return;
    }
    await this.copyText(absolute);
  }

  private async openIndexExternally(
    indexPath: string,
    mode: "app" | "folder",
  ): Promise<void> {
    const actions = this.fileActions();
    const absolute = actions.resolveAbsolutePath(indexPath);
    if (absolute === null) {
      this.options.notice?.(t("notice.localPathUnavailable"));
      return;
    }
    try {
      if (mode === "app") {
        await actions.openWithDefaultApp(absolute);
      } else {
        await actions.showInSystemExplorer(absolute);
      }
    } catch {
      this.options.notice?.(t("notice.openExternallyFailed"));
    }
  }

  private toggleExpanded(path: string): void {
    if (this.expanded.has(path)) {
      this.expanded.delete(path);
    } else {
      this.expanded.add(path);
    }
    this.render(this.nodes);
  }

  private expandablePaths(nodes: readonly DocumentNode[]): string[] {
    return nodes.flatMap((node) => [
      ...(node.children.length > 0 ? [node.path] : []),
      ...this.expandablePaths(node.children),
    ]);
  }

  private toggleAllExpanded(): void {
    this.toggleExpandedPaths(this.expandablePaths(this.nodes));
  }

  private toggleExpandedPaths(paths: readonly string[]): void {
    if (paths.length === 0) {
      return;
    }
    const allExpanded = paths.every((path) => this.expanded.has(path));
    if (allExpanded) {
      for (const path of paths) {
        this.expanded.delete(path);
      }
    } else {
      for (const path of paths) {
        this.expanded.add(path);
      }
    }
    this.render(this.nodes);
  }

  private syncAllToggleButton(): void {
    const button = this.allToggleButton;
    if (button === null) {
      return;
    }
    const paths = this.expandablePaths(this.nodes);
    const allExpanded =
      paths.length > 0 && paths.every((path) => this.expanded.has(path));
    button.disabled = paths.length === 0;
    const label = allExpanded ? t("ui.collapseAll") : t("ui.expandAll");
    button.setAttribute("aria-label", label);
    setIcon(button, allExpanded ? "chevrons-down-up" : "chevrons-up-down");
  }

  private async openDocument(path: string): Promise<void> {
    this.selected = path;
    this.render(this.nodes);
    try {
      await this.options.documents.open(path);
    } catch (error) {
      this.fail(error);
    }
  }

  reveal(path: string): void {
    this.selected = path;
    for (const ancestor of ancestorPaths(path)) {
      this.expanded.add(ancestor);
    }
    this.render(this.nodes);
    const selected = this.treeEl?.querySelector(".nestnote-node.is-selected");
    if (selected instanceof HTMLElement) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }

  private isRootPath(path: string): boolean {
    return this.nodes.some((root) => root.path === path) || !path.includes("/");
  }

  private dropZone(
    event: DragEvent,
    item: HTMLElement,
    node: DocumentNode,
    row: HTMLElement,
  ): DropZone {
    const children = item.querySelector(":scope > .nestnote-children");
    const target = event.target;
    if (
      children instanceof HTMLElement &&
      target instanceof Node &&
      children.contains(target) &&
      !row.contains(target)
    ) {
      return "into";
    }
    if (this.isRootPath(node.path)) {
      return "into";
    }
    const rect = row.getBoundingClientRect();
    if (rect.height === 0) {
      return "into";
    }
    const y = event.clientY - rect.top;
    if (y < rect.height * 0.25) {
      return "before";
    }
    if (y >= rect.height * 0.75) {
      return "after";
    }
    return "into";
  }

  private dropParams(
    node: DocumentNode,
    zone: DropZone,
    sourcePath: string,
  ): { newParentPath: string | null; insertBeforePath: string | null } {
    if (zone === "before") {
      return { newParentPath: parentPath(node.path), insertBeforePath: node.path };
    }
    if (zone === "after") {
      return {
        newParentPath: parentPath(node.path),
        insertBeforePath: this.nextSiblingPath(node.path, sourcePath),
      };
    }
    return { newParentPath: node.path, insertBeforePath: null };
  }

  private nextSiblingPath(targetPath: string, sourcePath: string): string | null {
    const parent = parentPath(targetPath);
    const siblings =
      parent === null ? this.nodes : findNode(this.nodes, parent)?.children ?? [];
    const index = siblings.findIndex((sibling) => sibling.path === targetPath);
    if (index === -1) {
      return null;
    }
    for (let i = index + 1; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling.path !== sourcePath) {
        return sibling.path;
      }
    }
    return null;
  }

  private clearDropHighlights(): void {
    this.treeEl?.classList.remove("is-drop-root");
    this.treeEl
      ?.querySelectorAll(".is-drop-target, .is-drop-before, .is-drop-after")
      .forEach((el) => {
        el.classList.remove("is-drop-target", "is-drop-before", "is-drop-after");
      });
  }

  private async handleDrop(
    sourcePath: string,
    newParentPath: string | null,
    insertBeforePath?: string | null,
  ): Promise<void> {
    if (sourcePath === "") {
      return;
    }
    try {
      const moved = await this.options.documents.move(
        sourcePath,
        newParentPath,
        insertBeforePath ?? null,
      );
      await this.options.requestRefresh();
      this.reveal(moved.path);
    } catch (error) {
      this.fail(error);
    }
  }

  private async createAndOpen(
    parentPath: string | null,
    name: string,
  ): Promise<void> {
    let created: DocumentNode;
    try {
      created = await this.options.documents.create(parentPath, name);
    } catch (error) {
      this.fail(error);
      return;
    }
    try {
      await this.options.documents.open(created.path);
    } catch (error) {
      this.fail(error);
    }
    await this.options.requestRefresh();
    this.reveal(created.path);
  }

  private openNameModal(
    title: string,
    initial: string,
    submit: (name: string) => Promise<unknown>,
  ): void {
    new NestNoteNameModal(this.app, title, initial, (name) => {
      void submit(name);
    }).open();
  }

  private openTrashModal(node: DocumentNode): void {
    const message = t("ui.deleteConfirm", { name: node.name });
    new NestNoteConfirmModal(this.app, t("ui.deleteDocument"), message, () => {
      void this.run(async () => this.options.documents.trash(node.path));
    }).open();
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      await this.options.requestRefresh();
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (isAlreadyNoticed(error)) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.options.notice?.(message);
  }
}

class NestNoteNameModal extends Modal {
  constructor(
    app: App,
    private readonly heading: string,
    private readonly initial: string,
    private readonly onSubmit: (name: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.classList.add("nestnote-modal");
    this.setTitle(this.heading);

    const input = createEl("input", {
      type: "text",
      value: this.initial,
      attr: { "aria-label": t("ui.documentName") },
    });

    let submitted = false;
    const submit = (): void => {
      if (submitted) {
        return;
      }
      const name = input.value.trim();
      if (name === "") {
        return;
      }
      submitted = true;
      this.onSubmit(name);
      this.close();
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });

    const actions = createEl("div", { cls: "nestnote-modal-actions" });
    actions.append(
      iconButton("check", t("ui.confirm"), (event) => {
        event.preventDefault();
        submit();
      }),
      iconButton("x", t("ui.cancel"), () => {
        this.close();
      }),
    );

    this.contentEl.append(input, actions);
    input.focus();
    input.select();
  }

  onClose(): void {
    this.contentEl.replaceChildren();
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

type DropZone = "before" | "after" | "into";

function parentPath(path: string): string | null {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? null : path.slice(0, slash);
}

function findNode(
  nodes: readonly DocumentNode[],
  path: string,
): DocumentNode | undefined {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    const found = findNode(node.children, path);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function ancestorPaths(path: string): string[] {
  const parts = path.split("/").filter((part) => part !== "");
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join("/"));
  }
  return ancestors;
}

function containsPath(nodes: readonly DocumentNode[], path: string): boolean {
  for (const node of nodes) {
    if (node.path === path) {
      return true;
    }
    if (containsPath(node.children, path)) {
      return true;
    }
  }
  return false;
}
