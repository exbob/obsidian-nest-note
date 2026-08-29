import { ItemView, Menu, Modal, setIcon } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { t } from "../i18n";
import type { DocumentNode, DocumentService } from "../types";
import { isAlreadyNoticed } from "../services/document-service";

export const VIEW_TYPE_NESTNOTE = "nestnote-document-tree";

export interface DocumentTreeViewOptions {
  documents: DocumentService;
  getNodes: () => readonly DocumentNode[];
  requestRefresh: () => void;
  notice?: (message: string) => void;
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
    this.allToggleButton = iconButton("chevrons-down", t("ui.expandAll"), () => {
      this.toggleAllExpanded();
    });
    toolbar.append(
      iconButton("plus", t("command.newDocument"), () => {
        this.openNameModal(t("command.newDocument"), "", (name) =>
          this.options.documents.create(null, name),
        );
      }),
      this.allToggleButton,
      iconButton("refresh-cw", t("command.refresh"), () => {
        this.options.requestRefresh();
      }),
    );

    const tree = createEl("div", { cls: "nestnote-tree" });
    this.treeEl = tree;
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
      iconButton("plus-circle", t("command.newChildDocument"), (event) => {
        event.stopPropagation();
        this.openNameModal(t("command.newChildDocument"), "", (name) =>
          this.options.documents.create(node.path, name),
        );
      }),
      iconButton("ellipsis-vertical", t("ui.more"), (event) => {
        event.stopPropagation();
        const menu = new Menu();
        menu.addItem((item) => {
          item.setTitle(t("ui.rename"));
          item.setIcon("pencil");
          item.onClick(() => {
            this.openNameModal(t("ui.rename"), node.name, (name) =>
              this.options.documents.rename(node.path, name),
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
    const paths = this.expandablePaths(this.nodes);
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
    setIcon(button, allExpanded ? "chevrons-up" : "chevrons-down");
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

  private openNameModal(
    title: string,
    initial: string,
    submit: (name: string) => Promise<unknown>,
  ): void {
    new NestNoteNameModal(this.app, title, initial, (name) => {
      void this.run(async () => submit(name));
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
      this.options.requestRefresh();
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
