# NestNote 文档行右键菜单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧边栏文档行保留「新建子文档」和「更多」；右键整行弹出与「更多」完全相同的菜单，并增加对 `index.md` 的复制路径 / 默认应用打开 / 资源管理器定位。

**Architecture:** `DocumentTreeView.showDocumentMenu` 是唯一组菜单入口。「更多」click 与 `.nestnote-row` 的 `contextmenu` 都调用它。四个新功能经 `DesktopFileActions`（`src/ui/desktop-file-actions.ts`）完成；生产实现用 `FileSystemAdapter.getFullPath` + Electron `shell`，测试注入假实现。

**Tech Stack:** Obsidian `Menu` / `FileSystemAdapter`、Electron `shell`（esbuild 已 external）、Vitest + happy-dom、现有 i18n。

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-02-nestnote-row-context-menu-design.md`
- 行上控件：加号和「更多」都保留；不改命令、设置、拖放
- 「更多」与右键共用 `showDocumentMenu(node, event)`，禁止两套菜单
- 四个新功能只操作该文档 `index.md`（`node.indexPath`）
- 不触发 `file-menu`，不调用未公开的 `App.openWithDefaultApp` / `App.showInFolder`
- 展开/折叠文案仍为 `ui.expandAll` / `ui.collapseAll`；无子文档时不显示该项且无顶部分隔线
- 中英固定文案，不按 OS 切换；成功不 Notice；失败用 spec 中的三个 `notice.*` key
- UI：`setIcon()` + `aria-label` + `.nestnote-*`，不引入 UI 框架
- Tests: `npm test`（Windows PowerShell）。用户未明确要求时跳过每个 Task 末尾的 git commit（本仓库规则）

## File map

- `src/i18n/types.ts`、`src/i18n/zh.ts`、`src/i18n/en.ts` — 四个菜单项 + 三条失败提示
- `src/ui/desktop-file-actions.ts` — 剪贴板、绝对路径、`openPath`、`showItemInFolder`
- `src/ui/document-tree-view.ts` — `showDocumentMenu`、行 `contextmenu`、`options.desktop`
- `tests/obsidian-stub.ts` — `Menu.addSeparator`、`FileSystemAdapter`
- `tests/desktop-file-actions.test.ts` — `absolutePathFromAdapter`
- `tests/document-tree-view.test.ts` — 菜单入口、顺序、四个新功能
- `README.md`、`README_zh.md` — 侧边栏操作表与项目结构

---

### Task 1: i18n 文案

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Test: `tests/i18n.test.ts`（已有键集合测试，不必改断言）

**Interfaces:**
- Consumes: 现有 `MESSAGE_KEYS` / `t()`
- Produces: 下列 key 可被 `t()` 使用

```
ui.copyRelativePath
ui.copyAbsolutePath
ui.openWithDefaultApp
ui.showInSystemExplorer
notice.copyFailed
notice.localPathUnavailable
notice.openExternallyFailed
```

- [ ] **Step 1: 先把新 key 写进 `MESSAGE_KEYS`，确认测试失败**

在 `src/i18n/types.ts` 的 `"ui.more"` 后插入四个 `ui.*`，在 `"notice.metadataUnchanged"` 后插入三个 `notice.*`：

```ts
  "ui.more",
  "ui.copyRelativePath",
  "ui.copyAbsolutePath",
  "ui.openWithDefaultApp",
  "ui.showInSystemExplorer",
  "ui.rename",
```

```ts
  "notice.metadataUnchanged",
  "notice.copyFailed",
  "notice.localPathUnavailable",
  "notice.openExternallyFailed",
  "error.targetExists",
```

Run: `npm test -- tests/i18n.test.ts`

Expected: FAIL，`uses the same keys in zh, en, and MESSAGE_KEYS` 因为 `zh`/`en` 缺这些 key。

- [ ] **Step 2: 补中英文案**

`src/i18n/zh.ts` 在 `"ui.more"` 后、`"notice.metadataUnchanged"` 后加入：

```ts
  "ui.copyRelativePath": "复制相对路径",
  "ui.copyAbsolutePath": "复制绝对路径",
  "ui.openWithDefaultApp": "使用默认应用打开",
  "ui.showInSystemExplorer": "在系统资源管理器中打开",
```

```ts
  "notice.copyFailed": "无法复制到剪贴板",
  "notice.localPathUnavailable": "无法取得该文件的本地路径",
  "notice.openExternallyFailed": "无法用系统打开该文件",
```

`src/i18n/en.ts` 对应：

```ts
  "ui.copyRelativePath": "Copy relative path",
  "ui.copyAbsolutePath": "Copy absolute path",
  "ui.openWithDefaultApp": "Open in default app",
  "ui.showInSystemExplorer": "Show in system explorer",
```

```ts
  "notice.copyFailed": "Could not copy to the clipboard",
  "notice.localPathUnavailable": "Could not get the local path for this file",
  "notice.openExternallyFailed": "Could not open this file with the system",
```

- [ ] **Step 3: 跑 i18n 测试**

Run: `npm test -- tests/i18n.test.ts`

Expected: PASS

- [ ] **Step 4: Commit（仅当用户要求）**

```bash
git add src/i18n/types.ts src/i18n/zh.ts src/i18n/en.ts
git commit -m "feat(i18n): add row context menu copy"
```

---

### Task 2: 桌面文件辅助模块与测试桩

**Files:**
- Create: `src/ui/desktop-file-actions.ts`
- Create: `tests/desktop-file-actions.test.ts`
- Modify: `tests/obsidian-stub.ts`

**Interfaces:**
- Consumes: `FileSystemAdapter`、`navigator.clipboard`、Electron `shell`（仅生产工厂）
- Produces:

```ts
export interface DesktopFileActions {
  copyText(text: string): Promise<void>;
  resolveAbsolutePath(vaultRelativePath: string): string | null;
  openWithDefaultApp(absolutePath: string): Promise<void>;
  showInSystemExplorer(absolutePath: string): Promise<void>;
}

export function absolutePathFromAdapter(
  adapter: object,
  vaultRelativePath: string,
): string | null;

export function createDesktopFileActions(app: App): DesktopFileActions;
```

- [ ] **Step 1: stub 增加 `FileSystemAdapter` 和 `Menu.addSeparator`**

`tests/obsidian-stub.ts` 在 `MenuItem` 之前加入：

```ts
export class FileSystemAdapter {
  constructor(private readonly basePath = "") {}

  getFullPath(normalizedPath: string): string {
    const prefix = this.basePath === "" ? "" : `${this.basePath}/`;
    return `${prefix}${normalizedPath}`;
  }
}
```

把 `Menu` 改成能渲染分隔线。用联合类型存条目，`addSeparator()` 插入 `div.menu-separator`：

```ts
type MenuEntry =
  | { kind: "item"; item: MenuItem }
  | { kind: "separator" };

export class Menu {
  private readonly entries: MenuEntry[] = [];

  addItem(cb: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    cb(item);
    this.entries.push({ kind: "item", item });
    return this;
  }

  addSeparator(): this {
    this.entries.push({ kind: "separator" });
    return this;
  }

  showAtMouseEvent(_event: MouseEvent): void {
    document.querySelector(".menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "menu";
    for (const entry of this.entries) {
      if (entry.kind === "separator") {
        const separator = document.createElement("div");
        separator.className = "menu-separator";
        menu.append(separator);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", entry.item.title);
      if (entry.item.icon !== "") {
        button.dataset.icon = entry.item.icon;
      }
      button.addEventListener("click", (event) => {
        entry.item.clickHandler?.(event);
      });
      menu.append(button);
    }
    document.body.append(menu);
  }
}
```

现有 `MenuItem` 类保持不变。改完后先跑一次 `npm test -- tests/document-tree-view.test.ts`，确认旧菜单测试仍 PASS（此时还没有 `addSeparator` 调用）。

- [ ] **Step 2: 写 `absolutePathFromAdapter` 失败测试**

创建 `tests/desktop-file-actions.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { FileSystemAdapter } from "obsidian";
import { absolutePathFromAdapter } from "../src/ui/desktop-file-actions";

describe("absolutePathFromAdapter", () => {
  it("returns getFullPath when the adapter is a FileSystemAdapter", () => {
    const adapter = new FileSystemAdapter("C:/vault");
    expect(absolutePathFromAdapter(adapter, "Work/index.md")).toBe(
      "C:/vault/Work/index.md",
    );
  });

  it("returns null when the adapter is not a FileSystemAdapter", () => {
    expect(absolutePathFromAdapter({}, "Work/index.md")).toBeNull();
  });
});
```

Run: `npm test -- tests/desktop-file-actions.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现模块**

创建 `src/ui/desktop-file-actions.ts`：

```ts
import { FileSystemAdapter } from "obsidian";
import type { App } from "obsidian";

export interface DesktopFileActions {
  copyText(text: string): Promise<void>;
  resolveAbsolutePath(vaultRelativePath: string): string | null;
  openWithDefaultApp(absolutePath: string): Promise<void>;
  showInSystemExplorer(absolutePath: string): Promise<void>;
}

export function absolutePathFromAdapter(
  adapter: object,
  vaultRelativePath: string,
): string | null {
  if (adapter instanceof FileSystemAdapter) {
    return adapter.getFullPath(vaultRelativePath);
  }
  return null;
}

function electronShell(): {
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
} {
  const electron = require("electron") as {
    shell: {
      openPath(path: string): Promise<string>;
      showItemInFolder(path: string): void;
    };
  };
  return electron.shell;
}

export function createDesktopFileActions(app: App): DesktopFileActions {
  return {
    async copyText(text: string): Promise<void> {
      await navigator.clipboard.writeText(text);
    },
    resolveAbsolutePath(vaultRelativePath: string): string | null {
      return absolutePathFromAdapter(app.vault.adapter, vaultRelativePath);
    },
    async openWithDefaultApp(absolutePath: string): Promise<void> {
      const error = await electronShell().openPath(absolutePath);
      if (error !== "") {
        throw new Error(error);
      }
    },
    async showInSystemExplorer(absolutePath: string): Promise<void> {
      electronShell().showItemInFolder(absolutePath);
    },
  };
}
```

不要给 `createDesktopFileActions` 写加载 Electron 的单测。视图测试通过注入 `DesktopFileActions` 覆盖四个操作。

- [ ] **Step 4: 跑辅助模块测试**

Run: `npm test -- tests/desktop-file-actions.test.ts tests/document-tree-view.test.ts`

Expected: PASS

- [ ] **Step 5: Commit（仅当用户要求）**

```bash
git add src/ui/desktop-file-actions.ts tests/desktop-file-actions.test.ts tests/obsidian-stub.ts
git commit -m "feat(ui): add desktop file path helpers"
```

---

### Task 3: 共用菜单、右键与四个新功能

**Files:**
- Modify: `src/ui/document-tree-view.ts`
- Modify: `tests/document-tree-view.test.ts`

**Interfaces:**
- Consumes: `DesktopFileActions`、`createDesktopFileActions`、`t()` 新 key、`Menu.addSeparator`
- Produces:

```ts
export interface DocumentTreeViewOptions {
  documents: DocumentService;
  getNodes: () => readonly DocumentNode[];
  requestRefresh: () => Promise<void>;
  notice?: (message: string) => void;
  desktop?: DesktopFileActions;
}

private showDocumentMenu(node: DocumentNode, event: MouseEvent): void
private fileActions(): DesktopFileActions
```

- [ ] **Step 1: 扩展测试辅助函数并写失败用例**

在 `tests/document-tree-view.test.ts` 增加 import：

```ts
import type { DesktopFileActions } from "../src/ui/desktop-file-actions";
```

扩展 `MountOptions` 与 `mount`：

```ts
interface MountOptions {
  nodes?: readonly DocumentNode[];
  documents?: Partial<DocumentService>;
  desktop?: DesktopFileActions;
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
    desktop: options.desktop,
  });
  await view.onOpen();
  document.body.appendChild(view.contentEl);
  return { view, documents, requestRefresh, notice };
}

function fakeDesktop(
  overrides: Partial<DesktopFileActions> = {},
): DesktopFileActions {
  return {
    copyText: vi.fn().mockResolvedValue(undefined),
    resolveAbsolutePath: vi.fn(
      (vaultRelativePath: string) => `/abs/${vaultRelativePath}`,
    ),
    openWithDefaultApp: vi.fn().mockResolvedValue(undefined),
    showInSystemExplorer: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function openMenu(path: string, via: "more" | "contextmenu" = "more"): void {
  document.querySelector(".menu")?.remove();
  if (via === "more") {
    action(path, t("ui.more")).click();
    return;
  }
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  nodeRow(path).dispatchEvent(event);
}

function menuItem(path: string, label: string): HTMLElement {
  openMenu(path);
  const item = document.querySelector(`.menu [aria-label="${label}"]`);
  if (!(item instanceof HTMLElement)) {
    throw new Error(`missing menu item ${label} for ${path}`);
  }
  return item;
}

function menuLabels(): string[] {
  return [...document.querySelectorAll(".menu [aria-label]")].map(
    (el) => el.getAttribute("aria-label") ?? "",
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
```

把原来的 `function menuItem` 换成上面这个（内部改走 `openMenu`）。删除现有 `"omits expand and collapse from the more menu when a document has no children"`，避免与下面 Inbox 结构测试重复。保留 `"labels toolbar and node actions..."`。

在 `describe("DocumentTreeView")` 里加入：

```ts
  it("keeps more and new-child buttons and opens the same menu from the row context menu", async () => {
    await mount();
    expect(action("Work", t("command.newChildDocument"))).toBeInstanceOf(
      HTMLButtonElement,
    );
    expect(action("Work", t("ui.more"))).toBeInstanceOf(HTMLButtonElement);
    openMenu("Work", "more");
    const fromMore = menuStructure();
    openMenu("Work", "contextmenu");
    expect(menuStructure()).toEqual(fromMore);
    expect(fromMore).toEqual([
      t("ui.expandAll"),
      "separator",
      t("ui.copyRelativePath"),
      t("ui.copyAbsolutePath"),
      "separator",
      t("ui.openWithDefaultApp"),
      t("ui.showInSystemExplorer"),
      "separator",
      t("ui.rename"),
      t("ui.delete"),
    ]);
  });

  it("omits expand-all and the leading separator when a document has no children", async () => {
    await mount();
    openMenu("Inbox", "more");
    expect(menuStructure()).toEqual([
      t("ui.copyRelativePath"),
      t("ui.copyAbsolutePath"),
      "separator",
      t("ui.openWithDefaultApp"),
      t("ui.showInSystemExplorer"),
      "separator",
      t("ui.rename"),
      t("ui.delete"),
    ]);
  });

  it("copies the index.md vault-relative path", async () => {
    const desktop = fakeDesktop();
    await mount({ desktop });
    menuItem("Work/Notes", t("ui.copyRelativePath")).click();
    await flush();
    expect(desktop.copyText).toHaveBeenCalledWith("Work/Notes/index.md");
  });

  it("copies the index.md absolute path from the desktop helper", async () => {
    const desktop = fakeDesktop();
    await mount({ desktop });
    menuItem("Work", t("ui.copyAbsolutePath")).click();
    await flush();
    expect(desktop.resolveAbsolutePath).toHaveBeenCalledWith("Work/index.md");
    expect(desktop.copyText).toHaveBeenCalledWith("/abs/Work/index.md");
  });

  it("opens index.md with the default app and in the system explorer", async () => {
    const desktop = fakeDesktop();
    await mount({ desktop });
    menuItem("Work", t("ui.openWithDefaultApp")).click();
    await flush();
    expect(desktop.openWithDefaultApp).toHaveBeenCalledWith("/abs/Work/index.md");
    menuItem("Work", t("ui.showInSystemExplorer")).click();
    await flush();
    expect(desktop.showInSystemExplorer).toHaveBeenCalledWith(
      "/abs/Work/index.md",
    );
  });

  it("notices clipboard and missing-path failures without refreshing", async () => {
    const desktop = fakeDesktop({
      copyText: vi.fn().mockRejectedValue(new Error("denied")),
      resolveAbsolutePath: vi.fn(() => null),
    });
    const { notice, requestRefresh } = await mount({ desktop });
    menuItem("Work", t("ui.copyRelativePath")).click();
    await flush();
    expect(notice).toHaveBeenCalledWith(t("notice.copyFailed"));
    menuItem("Work", t("ui.copyAbsolutePath")).click();
    await flush();
    expect(notice).toHaveBeenCalledWith(t("notice.localPathUnavailable"));
    menuItem("Work", t("ui.openWithDefaultApp")).click();
    await flush();
    expect(notice).toHaveBeenCalledWith(t("notice.localPathUnavailable"));
    menuItem("Work", t("ui.showInSystemExplorer")).click();
    await flush();
    expect(notice).toHaveBeenCalledWith(t("notice.localPathUnavailable"));
    expect(requestRefresh).not.toHaveBeenCalled();
  });

  it("notices when the default app fails after a path is resolved", async () => {
    const desktop = fakeDesktop({
      openWithDefaultApp: vi.fn().mockRejectedValue(new Error("no app")),
    });
    const { notice, requestRefresh } = await mount({ desktop });
    menuItem("Work", t("ui.openWithDefaultApp")).click();
    await flush();
    expect(notice).toHaveBeenCalledWith(t("notice.openExternallyFailed"));
    expect(requestRefresh).not.toHaveBeenCalled();
  });

  it("does not open a parent menu when right-clicking a child row", async () => {
    await mount();
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    expect(nodeRow("Work/Notes").dispatchEvent(event)).toBe(false);
    expect(menuLabels()).toEqual([
      t("ui.copyRelativePath"),
      t("ui.copyAbsolutePath"),
      t("ui.openWithDefaultApp"),
      t("ui.showInSystemExplorer"),
      t("ui.rename"),
      t("ui.delete"),
    ]);
  });
```

Run: `npm test -- tests/document-tree-view.test.ts`

Expected: FAIL（还没有 `showDocumentMenu` / 右键 / 新菜单项）。

- [ ] **Step 2: 实现视图**

`src/ui/document-tree-view.ts`：

1. import：

```ts
import type { DesktopFileActions } from "./desktop-file-actions";
import { createDesktopFileActions } from "./desktop-file-actions";
```

2. `DocumentTreeViewOptions` 增加 `desktop?: DesktopFileActions`。

3. 在 `buildNode` 里，创建 `row` 后立刻（或在 `row.append(name, actions)` 之前）加上：

```ts
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showDocumentMenu(node, event);
    });
```

4. 「更多」按钮改为：

```ts
      iconButton("ellipsis-vertical", t("ui.more"), (event) => {
        event.stopPropagation();
        this.showDocumentMenu(node, event);
      }),
```

5. 在 class 中加入下列私有方法（放在 `buildNode` 之后、`toggleExpanded` 之前）：

```ts
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
```

测试只要注入 `desktop` 就不会走到 `createDesktopFileActions`，因此现有 `mount` 不必构造完整 `App`。

现有重命名/删除/展开折叠测试应继续通过，因为它们仍点「更多」。

- [ ] **Step 3: 跑树视图测试**

Run: `npm test -- tests/document-tree-view.test.ts`

Expected: PASS

若 `"labels toolbar and node actions"` 仍检查更多菜单里只有三项，改成检查新项也在，且展开图标仍为 `chevrons-up-down`：

```ts
    action("Work", t("ui.more")).click();
    for (const label of [
      t("ui.expandAll"),
      t("ui.copyRelativePath"),
      t("ui.rename"),
      t("ui.delete"),
    ]) {
      const item = document.querySelector(`.menu [aria-label="${label}"]`);
      expect(item).toBeInstanceOf(HTMLButtonElement);
      expect((item as HTMLElement).dataset.icon).toBeTruthy();
    }
```

- [ ] **Step 4: 跑相关测试**

Run: `npm test -- tests/document-tree-view.test.ts tests/plugin-lifecycle.test.ts tests/desktop-file-actions.test.ts tests/i18n.test.ts`

Expected: PASS。`plugin-lifecycle` 的 `clickTrashFromMore` 仍点「更多」再点删除，无需改。

- [ ] **Step 5: Commit（仅当用户要求）**

```bash
git add src/ui/document-tree-view.ts tests/document-tree-view.test.ts
git commit -m "feat(sidebar): add row context menu actions"
```

---

### Task 4: README

**Files:**
- Modify: `README_zh.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: 已实现的菜单行为
- Produces: 侧边栏操作表写明「更多或右键」，并列出四个新功能

- [ ] **Step 1: 更新中文 README 侧边栏表和截图说明**

把 `README_zh.md` 操作表里重命名 / 展开折叠 / 删除三行改成经「更多或右键」，并插入四个新功能（对象写明 `index.md`）：

```md
| 打开文档        | 点击侧边栏中的文档名称                                                           |
| 新建子文档       | 某一行上的按钮，建在该文档下面                                                       |
| 调整嵌套与顺序 | 拖到另一份文档上成为其子文档；拖到树的空白处成为根文档。拖到同级文档的上方或下方可排序。根文档仍按名称排序 |
| 展开 / 折叠全部子文档 | 该行「更多」或右键 → **全部展开** 或 **全部折叠**。只作用于该文档下的整棵子树；没有子文档时不显示此项 |
| 复制相对路径 | 该行「更多」或右键。复制该文档 `index.md` 的库内相对路径 |
| 复制绝对路径 | 该行「更多」或右键。复制该文档 `index.md` 的本地绝对路径 |
| 使用默认应用打开 | 该行「更多」或右键。用系统默认应用打开该文档的 `index.md` |
| 在系统资源管理器中打开 | 该行「更多」或右键。在资源管理器中定位并选中该文档的 `index.md` |
| 重命名         | 该行「更多」或右键 → 重命名                                                           |
| 删除          | 该行「更多」或右键 → 删除；**每次删除都会先确认**                                              |
```

截图说明改为：

```md
![侧边栏文档树，某一行展开「更多」或右键菜单](docs/images/zh-sidebar-row.png)
```

项目结构 `ui/` 下增加：

```text
    ├── desktop-file-actions.ts      # 复制路径、系统打开
    ├── document-tree-view.ts        # 侧边栏
```

- [ ] **Step 2: 更新英文 README**

`README.md` 对应表格：

```md
| Open a document | Click the document name in the sidebar |
| New child document | The button on that row; creates under that document |
| Reparent and reorder | Drag onto another document to nest it, or onto empty space in the tree to make it a root. Drag above or below a sibling to reorder. Root documents stay sorted by name |
| Expand all / Collapse all children | Row **More** or right-click → **Expand all** or **Collapse all**. Toggles every nested child under that document. Hidden when the document has no children |
| Copy relative path | Row **More** or right-click. Copies the vault-relative path of that document's `index.md` |
| Copy absolute path | Row **More** or right-click. Copies the local absolute path of that document's `index.md` |
| Open in default app | Row **More** or right-click. Opens that document's `index.md` with the system default app |
| Show in system explorer | Row **More** or right-click. Reveals that document's `index.md` in the system file manager |
| Rename | Row **More** or right-click → Rename |
| Delete | Row **More** or right-click → Delete; **every delete asks for confirmation** |
```

截图说明：

```md
![Sidebar document tree with the More or right-click menu open on a row](docs/images/zh-sidebar-row.png)
```

项目结构：

```text
    ├── desktop-file-actions.ts      # copy path, open with OS
    ├── document-tree-view.ts        # sidebar
```

- [ ] **Step 3: 全量测试**

Run: `npm test`

Expected: PASS

- [ ] **Step 4: Commit（仅当用户要求）**

```bash
git add README.md README_zh.md
git commit -m "docs(readme): describe row context menu"
```

---

## Self-review vs spec

| Spec 要求 | Task |
|-----------|------|
| 保留加号和「更多」 | 3 |
| 整行右键、preventDefault、stopPropagation | 3 |
| 共用 `showDocumentMenu` | 3 |
| 菜单顺序与分隔线；无子文档无展开项和顶部分隔线 | 3 |
| 四项操作 `index.md`；FileSystemAdapter + Electron shell | 2、3 |
| 不复用 `file-menu` / 未公开 App 方法 | 2（工厂只用公开能力） |
| 失败 Notice、成功静默、不 refresh | 3 |
| i18n 固定中英 | 1 |
| README | 4 |
| plugin-lifecycle 仍点「更多」删除 | 3 Step 4 验证，不改辅助函数 |
