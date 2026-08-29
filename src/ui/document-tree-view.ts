import { ItemView, Modal, setIcon } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
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

    const toolbar = document.createElement("div");
    toolbar.className = "nestnote-toolbar";
    this.allToggleButton = iconButton("chevrons-down", "全部展开", () => {
      this.toggleAllExpanded();
    });
    toolbar.append(
      iconButton("plus", "新建文档", () => {
        this.openNameModal("新建文档", "", (name) =>
          this.options.documents.create(null, name),
        );
      }),
      this.allToggleButton,
      iconButton("refresh-cw", "刷新", () => {
        this.options.requestRefresh();
      }),
    );

    const tree = document.createElement("div");
    tree.className = "nestnote-tree";
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
    const list = document.createElement("ul");
    list.className = "nestnote-list";
    for (const node of nodes) {
      list.append(this.buildNode(node));
    }
    return list;
  }

  private buildNode(node: DocumentNode): HTMLLIElement {
    const item = document.createElement("li");
    item.className = "nestnote-node";
    item.dataset.path = node.path;
    if (this.expanded.has(node.path)) {
      item.classList.add("is-expanded");
    }
    if (this.selected === node.path) {
      item.classList.add("is-selected");
    }

    const row = document.createElement("div");
    row.className = "nestnote-row";

    if (node.children.length > 0) {
      const expanded = this.expanded.has(node.path);
      row.append(
        iconButton(
          expanded ? "chevron-down" : "chevron-right",
          expanded ? "折叠" : "展开",
          (event) => {
            event.stopPropagation();
            this.toggleExpanded(node.path);
          },
        ),
      );
    } else {
      const spacer = document.createElement("span");
      spacer.className = "nestnote-twistie-spacer";
      row.append(spacer);
    }

    const name = document.createElement("span");
    name.className = "nestnote-name";
    name.textContent = node.name;
    name.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.openDocument(node.path);
    });

    const actions = document.createElement("div");
    actions.className = "nestnote-actions";
    actions.append(
      iconButton("file-text", "打开", (event) => {
        event.stopPropagation();
        void this.openDocument(node.path);
      }),
      iconButton("plus-circle", "新建子文档", (event) => {
        event.stopPropagation();
        this.openNameModal("新建子文档", "", (name) =>
          this.options.documents.create(node.path, name),
        );
      }),
      iconButton("pencil", "重命名", (event) => {
        event.stopPropagation();
        this.openNameModal("重命名", node.name, (name) =>
          this.options.documents.rename(node.path, name),
        );
      }),
      iconButton("trash-2", "删除", (event) => {
        event.stopPropagation();
        this.openTrashModal(node);
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
    const label = allExpanded ? "全部折叠" : "全部展开";
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
    const message = `删除「${node.name}」会将整个子树移入回收站。`;
    new NestNoteConfirmModal(this.app, "删除文档", message, () => {
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

    const input = document.createElement("input");
    input.type = "text";
    input.value = this.initial;
    input.setAttribute("aria-label", "文档名称");

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

    const actions = document.createElement("div");
    actions.className = "nestnote-modal-actions";
    actions.append(
      iconButton("check", "确认", (event) => {
        event.preventDefault();
        submit();
      }),
      iconButton("x", "取消", () => {
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

    const body = document.createElement("p");
    body.className = "nestnote-modal-message";
    body.textContent = this.message;

    const actions = document.createElement("div");
    actions.className = "nestnote-modal-actions";
    actions.append(
      iconButton("check", "确认", (event) => {
        event.preventDefault();
        this.onConfirm();
        this.close();
      }),
      iconButton("x", "取消", () => {
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
  const button = document.createElement("button");
  button.type = "button";
  button.className = "nestnote-icon-button";
  button.setAttribute("aria-label", label);
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
