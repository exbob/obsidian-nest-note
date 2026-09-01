import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import {
  DocumentTreeView,
  NESTNOTE_DOCUMENT_DRAG_MIME,
  VIEW_TYPE_NESTNOTE,
} from "../src/ui/document-tree-view";
import type { DocumentNode, DocumentService } from "../src/types";
import { t } from "../src/i18n";
import { DocumentServiceError } from "../src/services/document-service";

function node(
  name: string,
  path: string,
  children: DocumentNode[] = [],
): DocumentNode {
  return {
    name,
    path,
    indexPath: `${path}/index.md`,
    attachmentsPath: `${path}/attachments`,
    children,
  };
}

const sampleTree: DocumentNode[] = [
  node("Work", "Work", [node("Notes", "Work/Notes")]),
  node("Inbox", "Inbox"),
];

interface MountOptions {
  nodes?: readonly DocumentNode[];
  documents?: Partial<DocumentService>;
}

async function mount(options: MountOptions = {}) {
  const documents: DocumentService = {
    create: vi.fn().mockResolvedValue(node("Work", "Work")),
    rename: vi.fn().mockResolvedValue(node("Work", "Work")),
    trash: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(node("Work", "Work")),
    open: vi.fn().mockResolvedValue(undefined),
    ...options.documents,
  };
  const requestRefresh = vi.fn(async () => undefined);
  const notice = vi.fn();
  const nodes = options.nodes ?? sampleTree;
  const view = new DocumentTreeView({ app: {} } as unknown as WorkspaceLeaf, {
    documents,
    getNodes: () => nodes,
    requestRefresh,
    notice,
  });
  await view.onOpen();
  document.body.appendChild(view.contentEl);
  return { view, documents, requestRefresh, notice };
}

function row(path: string): HTMLElement {
  const el = document.querySelector(`[data-path="${path}"]`);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`missing node ${path}`);
  }
  return el;
}

function action(path: string, label: string): HTMLElement {
  const button = row(path).querySelector(`[aria-label="${label}"]`);
  if (!(button instanceof HTMLElement)) {
    throw new Error(`missing ${label} on ${path}`);
  }
  return button;
}

function menuItem(path: string, label: string): HTMLElement {
  action(path, t("ui.more")).click();
  const item = document.querySelector(`.menu [aria-label="${label}"]`);
  if (!(item instanceof HTMLElement)) {
    throw new Error(`missing menu item ${label} for ${path}`);
  }
  return item;
}

function toolbar(label: string): HTMLElement {
  const button = document.querySelector(
    `.nestnote-toolbar [aria-label="${label}"]`,
  );
  if (!(button instanceof HTMLElement)) {
    throw new Error(`missing toolbar ${label}`);
  }
  return button;
}

async function confirmModal(name?: string): Promise<void> {
  const modal = document.querySelector(".nestnote-modal");
  if (!(modal instanceof HTMLElement)) {
    throw new Error("modal was not opened");
  }
  if (name !== undefined) {
    const input = modal.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("name input missing");
    }
    input.value = name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const confirm = modal.querySelector(`[aria-label="${t("ui.confirm")}"]`);
  if (!(confirm instanceof HTMLElement)) {
    throw new Error("confirm button missing");
  }
  confirm.click();
  await Promise.resolve();
  await Promise.resolve();
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function dispatchDrag(
  target: EventTarget,
  type: string,
  path?: string,
): DragEvent {
  const data: Record<string, string> = {};
  if (path !== undefined && type !== "dragstart") {
    data[NESTNOTE_DOCUMENT_DRAG_MIME] = path;
  }
  const dataTransfer = {
    effectAllowed: "move",
    dropEffect: "move",
    setData(kind: string, value: string) {
      data[kind] = value;
    },
    getData(kind: string) {
      return data[kind] ?? "";
    },
  };
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "dataTransfer", {
    value: dataTransfer,
  });
  target.dispatchEvent(event);
  return event;
}

function nodeRow(path: string): HTMLElement {
  const el = row(path).querySelector(".nestnote-row");
  if (!(el instanceof HTMLElement)) {
    throw new Error(`missing row ${path}`);
  }
  return el;
}

afterEach(async () => {
  document.body.replaceChildren();
});

describe("DocumentTreeView", () => {
  it("reports the NestNote view type and display text", async () => {
    const { view } = await mount({ nodes: [] });
    expect(view.getViewType()).toBe(VIEW_TYPE_NESTNOTE);
    expect(view.getViewType()).toBe("nestnote-document-tree");
    expect(view.getDisplayText()).toBe("NestNote");
  });

  it("renders each document name in a nested tree", async () => {
    const { view } = await mount();
    const names = [...view.contentEl.querySelectorAll("[data-path]")].map(
      (el) => el.getAttribute("data-path"),
    );
    expect(names).toEqual(["Work", "Work/Notes", "Inbox"]);
    expect(row("Work").textContent).toContain("Work");
    expect(row("Work/Notes").textContent).toContain("Notes");
    expect(row("Inbox").textContent).toContain("Inbox");
    expect(row("Work/Notes").closest('[data-path="Work"]')).toBe(row("Work"));
    expect(row("Inbox").closest('[data-path="Work"]')).toBeNull();
  });

  it("opens a document when its name is clicked", async () => {
    const { documents } = await mount();
    const name = row("Work/Notes").querySelector(".nestnote-name");
    if (!(name instanceof HTMLElement)) {
      throw new Error("name missing");
    }
    name.click();
    await Promise.resolve();
    expect(documents.open).toHaveBeenCalledWith("Work/Notes");
  });

  it("does not render an open button on each document row", async () => {
    await mount();
    expect(row("Inbox").querySelector('[aria-label="打开"]')).toBeNull();
  });

  it("creates a root document with a null parent path", async () => {
    const { documents, requestRefresh } = await mount();
    toolbar(t("command.newDocument")).click();
    await confirmModal("Journal");
    await flush();
    expect(documents.create).toHaveBeenCalledWith(null, "Journal");
    expect(documents.open).toHaveBeenCalledWith("Work");
    expect(requestRefresh).toHaveBeenCalled();
  });

  it("creates a child document from a node action", async () => {
    const { documents } = await mount();
    action("Work", t("command.newChildDocument")).click();
    await confirmModal("Drafts");
    await flush();
    expect(documents.create).toHaveBeenCalledWith("Work", "Drafts");
    expect(documents.open).toHaveBeenCalledWith("Work");
  });

  it("opens, refreshes, and reveals a created root document", async () => {
    const created = node("Journal", "Journal");
    let current = sampleTree;
    const requestRefresh = vi.fn(async () => {
      current = [...sampleTree, created];
      view.render(current);
    });
    const documents: DocumentService = {
      create: vi.fn().mockResolvedValue(created),
      rename: vi.fn(),
      trash: vi.fn(),
      move: vi.fn(),
      open: vi.fn().mockResolvedValue(undefined),
    };
    const view = new DocumentTreeView({ app: {} } as unknown as WorkspaceLeaf, {
      documents,
      getNodes: () => current,
      requestRefresh,
    });
    await view.onOpen();
    document.body.appendChild(view.contentEl);
    toolbar(t("command.newDocument")).click();
    await confirmModal("Journal");
    await flush();
    expect(documents.create).toHaveBeenCalledWith(null, "Journal");
    expect(documents.open).toHaveBeenCalledWith("Journal");
    expect(requestRefresh).toHaveBeenCalled();
    expect(row("Journal").classList.contains("is-selected")).toBe(true);
  });

  it("expands ancestors when revealing a nested new child", async () => {
    const created = node("Drafts", "Work/Notes/Drafts");
    let current = sampleTree;
    const requestRefresh = vi.fn(async () => {
      current = [
        node("Work", "Work", [
          node("Notes", "Work/Notes", [created]),
        ]),
        node("Inbox", "Inbox"),
      ];
      view.render(current);
    });
    const documents: DocumentService = {
      create: vi.fn().mockResolvedValue(created),
      rename: vi.fn(),
      trash: vi.fn(),
      move: vi.fn(),
      open: vi.fn().mockResolvedValue(undefined),
    };
    const view = new DocumentTreeView({ app: {} } as unknown as WorkspaceLeaf, {
      documents,
      getNodes: () => current,
      requestRefresh,
    });
    await view.onOpen();
    document.body.appendChild(view.contentEl);
    action("Work/Notes", t("command.newChildDocument")).click();
    await confirmModal("Drafts");
    await flush();
    expect(documents.open).toHaveBeenCalledWith("Work/Notes/Drafts");
    expect(row("Work").classList.contains("is-expanded")).toBe(true);
    expect(row("Work/Notes").classList.contains("is-expanded")).toBe(true);
    expect(row("Work/Notes/Drafts").classList.contains("is-selected")).toBe(true);
  });

  it("still refreshes and reveals when open fails after create", async () => {
    const created = node("Journal", "Journal");
    const notice = vi.fn();
    let current = sampleTree;
    const requestRefresh = vi.fn(async () => {
      current = [...sampleTree, created];
      view.render(current);
    });
    const documents: DocumentService = {
      create: vi.fn().mockResolvedValue(created),
      rename: vi.fn(),
      trash: vi.fn(),
      move: vi.fn(),
      open: vi.fn().mockRejectedValue(new Error("open failed")),
    };
    const view = new DocumentTreeView({ app: {} } as unknown as WorkspaceLeaf, {
      documents,
      getNodes: () => current,
      requestRefresh,
      notice,
    });
    await view.onOpen();
    document.body.appendChild(view.contentEl);
    toolbar(t("command.newDocument")).click();
    await confirmModal("Journal");
    await flush();
    expect(documents.create).toHaveBeenCalled();
    expect(notice).toHaveBeenCalled();
    expect(requestRefresh).toHaveBeenCalled();
    expect(row("Journal").classList.contains("is-selected")).toBe(true);
  });

  it("selects a path and expands its ancestors", async () => {
    const { view } = await mount();
    view.reveal("Work/Notes");
    expect(row("Work").classList.contains("is-expanded")).toBe(true);
    expect(row("Work/Notes").classList.contains("is-selected")).toBe(true);
  });

  it("renames a document from the more menu", async () => {
    const { documents } = await mount();
    menuItem("Inbox", t("ui.rename")).click();
    await confirmModal("Archive");
    expect(documents.rename).toHaveBeenCalledWith("Inbox", "Archive");
  });

  it("trashes a document after modal confirmation about the subtree", async () => {
    const { documents } = await mount();
    menuItem("Work", t("ui.delete")).click();
    const modal = document.querySelector(".nestnote-modal");
    expect(modal?.textContent).toContain(t("ui.deleteConfirm", { name: "Work" }));
    await confirmModal();
    expect(documents.trash).toHaveBeenCalledWith("Work");
  });

  it("keeps expand and selection after a refresh when nodes still exist", async () => {
    const { view } = await mount();
    action("Work", t("ui.expand")).click();
    const name = row("Work/Notes").querySelector(".nestnote-name");
    if (!(name instanceof HTMLElement)) {
      throw new Error("name missing");
    }
    name.click();
    expect(row("Work").classList.contains("is-expanded")).toBe(true);
    expect(row("Work/Notes").classList.contains("is-selected")).toBe(true);

    view.render(sampleTree);
    expect(row("Work").classList.contains("is-expanded")).toBe(true);
    expect(row("Work/Notes").classList.contains("is-selected")).toBe(true);
  });

  it("does not restore expand or selection for nodes that disappeared", async () => {
    const { view } = await mount();
    action("Work", t("ui.expand")).click();
    const name = row("Work/Notes").querySelector(".nestnote-name");
    if (!(name instanceof HTMLElement)) {
      throw new Error("name missing");
    }
    name.click();

    view.render([node("Inbox", "Inbox")]);
    expect(document.querySelector('[data-path="Work"]')).toBeNull();
    expect(document.querySelector('[data-path="Work/Notes"]')).toBeNull();
    expect(row("Inbox").classList.contains("is-selected")).toBe(false);
    expect(row("Inbox").classList.contains("is-expanded")).toBe(false);
  });

  it("labels toolbar and node actions for accessibility and icons", async () => {
    await mount();
    for (const label of [t("command.newDocument"), t("ui.expandAll"), t("command.refresh")]) {
      const button = toolbar(label);
      expect(button.tagName).toBe("BUTTON");
      expect(button.dataset.icon).toBeTruthy();
    }
    for (const label of [t("command.newChildDocument"), t("ui.more")]) {
      const button = action("Work", label);
      expect(button.tagName).toBe("BUTTON");
      expect(button.dataset.icon).toBeTruthy();
    }
    expect(action("Work", t("ui.more")).dataset.icon).toBe("ellipsis-vertical");
    expect(action("Work", t("ui.expand")).dataset.icon).toBeTruthy();
    action("Work", t("ui.more")).click();
    for (const label of [t("ui.rename"), t("ui.delete")]) {
      const item = document.querySelector(`.menu [aria-label="${label}"]`);
      expect(item).toBeInstanceOf(HTMLButtonElement);
      expect((item as HTMLElement).dataset.icon).toBeTruthy();
    }
  });

  it("requests a refresh from the toolbar without changing local tree state", async () => {
    const { requestRefresh } = await mount();
    action("Work", t("ui.expand")).click();
    toolbar(t("command.refresh")).click();
    expect(requestRefresh).toHaveBeenCalled();
    expect(row("Work").classList.contains("is-expanded")).toBe(true);
  });

  it("keeps sidebar state and notifies when trash fails", async () => {
    const { documents, requestRefresh, notice } = await mount({
      documents: {
        trash: vi.fn().mockRejectedValue(new Error("trash failed")),
      },
    });
    action("Work", t("ui.expand")).click();
    menuItem("Work", t("ui.delete")).click();
    await confirmModal();
    expect(documents.trash).toHaveBeenCalledWith("Work");
    expect(requestRefresh).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalled();
    expect(row("Work").classList.contains("is-expanded")).toBe(true);
  });

  it("does not notify again when DocumentService already showed the error", async () => {
    const alreadyNoticed = Object.assign(
      new DocumentServiceError("already shown"),
      { noticed: true },
    );
    const { documents, notice } = await mount({
      documents: {
        trash: vi.fn().mockRejectedValue(alreadyNoticed),
      },
    });
    menuItem("Work", t("ui.delete")).click();
    await confirmModal();
    expect(documents.trash).toHaveBeenCalledWith("Work");
    expect(notice).not.toHaveBeenCalled();
  });

  it("submits and closes the name modal on Enter", async () => {
    const { documents } = await mount();
    action("Work", t("command.newChildDocument")).click();
    const modal = document.querySelector(".nestnote-modal");
    const input = modal?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("input missing");
    const confirm = modal?.querySelector(`[aria-label="${t("ui.confirm")}"]`);
    if (!(confirm instanceof HTMLElement)) throw new Error("confirm missing");
    input.value = "From Enter";
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    confirm.click();
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
    expect(documents.create).toHaveBeenCalledTimes(1);
    expect(documents.create).toHaveBeenCalledWith("Work", "From Enter");
    expect(document.querySelector(".nestnote-modal")).toBeNull();
  });

  it("expands and collapses every expandable document", async () => {
    const nestedTree = [
      node("Work", "Work", [
        node("Notes", "Work/Notes", [node("Draft", "Work/Notes/Draft")]),
      ]),
      node("Inbox", "Inbox"),
    ];
    const { requestRefresh } = await mount({ nodes: nestedTree });
    const expandAll = toolbar(t("ui.expandAll"));
    expect(expandAll).toBeInstanceOf(HTMLButtonElement);
    expect((expandAll as HTMLButtonElement).disabled).toBe(false);
    expect((expandAll as HTMLButtonElement).dataset.icon).toBe("chevrons-up-down");
    expandAll.click();
    expect(row("Work").classList.contains("is-expanded")).toBe(true);
    expect(row("Work/Notes").classList.contains("is-expanded")).toBe(true);
    expect(toolbar(t("ui.collapseAll"))).toBeTruthy();
    expect((toolbar(t("ui.collapseAll")) as HTMLButtonElement).dataset.icon).toBe(
      "chevrons-down-up",
    );
    expect(requestRefresh).not.toHaveBeenCalled();
    toolbar(t("ui.collapseAll")).click();
    expect(row("Work").classList.contains("is-expanded")).toBe(false);
    expect(row("Work/Notes").classList.contains("is-expanded")).toBe(false);
    expect(toolbar(t("ui.expandAll"))).toBeTruthy();
    expect(requestRefresh).not.toHaveBeenCalled();
  });

  it("disables expand-all on an empty tree or a tree with no children", async () => {
    await mount({ nodes: [] });
    expect((toolbar(t("ui.expandAll")) as HTMLButtonElement).disabled).toBe(true);

    document.body.replaceChildren();
    await mount({ nodes: [node("Inbox", "Inbox")] });
    expect((toolbar(t("ui.expandAll")) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches the toolbar toggle after every expandable node is opened", async () => {
    await mount();
    expect(toolbar(t("ui.expandAll"))).toBeTruthy();
    action("Work", t("ui.expand")).click();
    expect(toolbar(t("ui.collapseAll"))).toBeTruthy();
  });

  it("moves a document when dropped on another row", async () => {
    const moved = node("Inbox", "Work/Inbox");
    const { documents, requestRefresh, view } = await mount({
      documents: {
        move: vi.fn().mockResolvedValue(moved),
      },
    });
    (requestRefresh as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      view.render([node("Work", "Work", [moved])]);
    });
    dispatchDrag(nodeRow("Work"), "drop", "Inbox");
    await flush();
    expect(documents.move).toHaveBeenCalledWith("Inbox", "Work");
    expect(requestRefresh).toHaveBeenCalled();
    expect(row("Work/Inbox").classList.contains("is-selected")).toBe(true);
    expect(row("Work").classList.contains("is-expanded")).toBe(true);
  });

  it("stores the source path on dragstart from a row, not from action buttons", async () => {
    const { documents } = await mount();
    const start = dispatchDrag(nodeRow("Inbox"), "dragstart");
    expect(start.dataTransfer?.getData(NESTNOTE_DOCUMENT_DRAG_MIME)).toBe("Inbox");
    const blocked = dispatchDrag(
      action("Work", t("command.newChildDocument")),
      "dragstart",
    );
    expect(blocked.defaultPrevented).toBe(true);
    expect(documents.move).not.toHaveBeenCalled();
  });

  it("moves a document to the vault root when dropped on empty tree space", async () => {
    const moved = node("Notes", "Notes");
    const { documents, view, requestRefresh } = await mount({
      documents: { move: vi.fn().mockResolvedValue(moved) },
    });
    (requestRefresh as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      view.render([node("Work", "Work"), moved, node("Inbox", "Inbox")]);
    });
    const tree = view.contentEl.querySelector(".nestnote-tree");
    if (!(tree instanceof HTMLElement)) {
      throw new Error("tree missing");
    }
    dispatchDrag(tree, "drop", "Work/Notes");
    await flush();
    expect(documents.move).toHaveBeenCalledWith("Work/Notes", null);
  });

  it("keeps the tree and notifies when move rejects", async () => {
    const { documents, requestRefresh, notice } = await mount({
      documents: {
        move: vi.fn().mockRejectedValue(new Error("blocked")),
      },
    });
    dispatchDrag(nodeRow("Work"), "drop", "Inbox");
    await flush();
    expect(documents.move).toHaveBeenCalledWith("Inbox", "Work");
    expect(requestRefresh).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalled();
    expect(row("Inbox")).toBeTruthy();
  });
});
