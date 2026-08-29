import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import {
  DocumentTreeView,
  VIEW_TYPE_NESTNOTE,
} from "../src/ui/document-tree-view";
import type { DocumentNode, DocumentService } from "../src/types";
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
    open: vi.fn().mockResolvedValue(undefined),
    ...options.documents,
  };
  const requestRefresh = vi.fn();
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
  action(path, "更多").click();
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
  const confirm = modal.querySelector('[aria-label="确认"]');
  if (!(confirm instanceof HTMLElement)) {
    throw new Error("confirm button missing");
  }
  confirm.click();
  await Promise.resolve();
  await Promise.resolve();
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
    toolbar("新建文档").click();
    await confirmModal("Journal");
    expect(documents.create).toHaveBeenCalledWith(null, "Journal");
    expect(requestRefresh).toHaveBeenCalled();
  });

  it("creates a child document from a node action", async () => {
    const { documents } = await mount();
    action("Work", "新建子文档").click();
    await confirmModal("Drafts");
    expect(documents.create).toHaveBeenCalledWith("Work", "Drafts");
    expect(documents.open).not.toHaveBeenCalled();
  });

  it("renames a document from the more menu", async () => {
    const { documents } = await mount();
    menuItem("Inbox", "重命名").click();
    await confirmModal("Archive");
    expect(documents.rename).toHaveBeenCalledWith("Inbox", "Archive");
  });

  it("trashes a document after modal confirmation about the subtree", async () => {
    const { documents } = await mount();
    menuItem("Work", "删除").click();
    const modal = document.querySelector(".nestnote-modal");
    expect(modal?.textContent).toMatch(/整个子树/);
    expect(modal?.textContent).toMatch(/回收站/);
    await confirmModal();
    expect(documents.trash).toHaveBeenCalledWith("Work");
  });

  it("keeps expand and selection after a refresh when nodes still exist", async () => {
    const { view } = await mount();
    action("Work", "展开").click();
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
    action("Work", "展开").click();
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
    for (const label of ["新建文档", "全部展开", "刷新"]) {
      const button = toolbar(label);
      expect(button.tagName).toBe("BUTTON");
      expect(button.dataset.icon).toBeTruthy();
    }
    for (const label of ["新建子文档", "更多"]) {
      const button = action("Work", label);
      expect(button.tagName).toBe("BUTTON");
      expect(button.dataset.icon).toBeTruthy();
    }
    expect(action("Work", "更多").dataset.icon).toBe("ellipsis-vertical");
    expect(action("Work", "展开").dataset.icon).toBeTruthy();
    action("Work", "更多").click();
    for (const label of ["重命名", "删除"]) {
      const item = document.querySelector(`.menu [aria-label="${label}"]`);
      expect(item).toBeInstanceOf(HTMLButtonElement);
      expect((item as HTMLElement).dataset.icon).toBeTruthy();
    }
  });

  it("requests a refresh from the toolbar without changing local tree state", async () => {
    const { requestRefresh } = await mount();
    action("Work", "展开").click();
    toolbar("刷新").click();
    expect(requestRefresh).toHaveBeenCalled();
    expect(row("Work").classList.contains("is-expanded")).toBe(true);
  });

  it("keeps sidebar state and notifies when trash fails", async () => {
    const { documents, requestRefresh, notice } = await mount({
      documents: {
        trash: vi.fn().mockRejectedValue(new Error("trash failed")),
      },
    });
    action("Work", "展开").click();
    menuItem("Work", "删除").click();
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
    menuItem("Work", "删除").click();
    await confirmModal();
    expect(documents.trash).toHaveBeenCalledWith("Work");
    expect(notice).not.toHaveBeenCalled();
  });

  it("submits and closes the name modal on Enter", async () => {
    const { documents } = await mount();
    action("Work", "新建子文档").click();
    const modal = document.querySelector(".nestnote-modal");
    const input = modal?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("input missing");
    const confirm = modal?.querySelector('[aria-label="确认"]');
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
    const expandAll = toolbar("全部展开");
    expect(expandAll).toBeInstanceOf(HTMLButtonElement);
    expect((expandAll as HTMLButtonElement).disabled).toBe(false);
    expect((expandAll as HTMLButtonElement).dataset.icon).toBe("chevrons-down");
    expandAll.click();
    expect(row("Work").classList.contains("is-expanded")).toBe(true);
    expect(row("Work/Notes").classList.contains("is-expanded")).toBe(true);
    expect(toolbar("全部折叠")).toBeTruthy();
    expect((toolbar("全部折叠") as HTMLButtonElement).dataset.icon).toBe(
      "chevrons-up",
    );
    expect(requestRefresh).not.toHaveBeenCalled();
    toolbar("全部折叠").click();
    expect(row("Work").classList.contains("is-expanded")).toBe(false);
    expect(row("Work/Notes").classList.contains("is-expanded")).toBe(false);
    expect(toolbar("全部展开")).toBeTruthy();
    expect(requestRefresh).not.toHaveBeenCalled();
  });

  it("disables expand-all on an empty tree or a tree with no children", async () => {
    await mount({ nodes: [] });
    expect((toolbar("全部展开") as HTMLButtonElement).disabled).toBe(true);

    document.body.replaceChildren();
    await mount({ nodes: [node("Inbox", "Inbox")] });
    expect((toolbar("全部展开") as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches the toolbar toggle after every expandable node is opened", async () => {
    await mount();
    expect(toolbar("全部展开")).toBeTruthy();
    action("Work", "展开").click();
    expect(toolbar("全部折叠")).toBeTruthy();
  });
});
