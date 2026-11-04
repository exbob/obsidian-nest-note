# 在新标签页或新窗口中打开文档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在文档树右键菜单和「更多」菜单中加入「在新标签页中打开」和「在新窗口中打开」；文档已打开时只切换到现有编辑页。

**Architecture:** `documents.open(path, "tab" | "window")` 先在全部叶子里按 `index.md` 路径查找编辑页，找到就 `activate()`，找不到再 `getLeaf(target)` 并 `openFile`。视图只加菜单项。`main.ts` 把 Obsidian 叶子包成 `getFilePath` / `activate`。单击文档名仍走无 `target` 的 `pickOpenLeaf`。

**Tech Stack:** Obsidian `Menu`、`Workspace.getLeaf` / `iterateAllLeaves` / `revealLeaf` / `FileView`、现有 i18n `t()`、Vitest + happy-dom。

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-04-open-in-new-tab-and-window-design.md`
- 有子文档时菜单第一项仍是全部展开或全部折叠，后面保留分隔线；然后才是两项新菜单和又一条分隔线
- 无子文档时从「在新标签页中打开」开始
- 右键和「更多」共用 `showDocumentMenu`
- 已打开（主窗口或弹出窗口）时只 `activate()`，不 `openFile`，不 `getLeaf`
- 多处打开时，若 `getMostRecentLeaf()` 的文件路径就是该 `index.md` 且不是文档树侧边栏，激活它；比较路径，不用包装对象的引用相等
- 否则激活本次遍历的第一个匹配编辑页
- 有 `iterateAllLeaves` 时用它，否则 `iterateRootLeaves`
- 未打开时 `getLeaf("tab")` 或 `getLeaf("window")`，然后 `openFile`，再 `activate()`
- 省略 `target` 的 `open(path)` 与 `pickOpenLeaf` 不变，且不调用 `activate()`
- 菜单打开后先选中该行再调用 `open`
- 单击名称仍是 `open(path)` 一个参数，不夺走侧边栏焦点
- 图标：`file-plus`、`app-window`
- 文案：`ui.openInNewTab` = 在新标签页中打开 / Open in new tab；`ui.openInNewWindow` = 在新窗口中打开 / Open in new window
- 不新增命令、设置、失败文案、生命周期测试场景，不改截图
- Tests: `npx vitest run` 与 `npx tsc --noEmit`（Windows PowerShell）。用户未明确要求时跳过每个 Task 末尾的 git commit

## File map

- `src/i18n/types.ts`、`src/i18n/zh.ts`、`src/i18n/en.ts` — 两个文案键
- `tests/i18n.test.ts` — 中英文断言
- `src/types.ts` — `DocumentOpenTarget` 与 `open` 签名
- `src/services/document-service.ts` — 叶子接口、`open`、`findOpenLeaf`
- `tests/document-service.test.ts` — 假叶子与打开目标
- `src/main.ts` — `getFilePath`、`activate`、`iterateAllLeaves`
- `src/ui/document-tree-view.ts` — 菜单项
- `tests/document-tree-view.test.ts` — 菜单顺序与调用
- `README.md`、`README_zh.md` — 侧边栏操作表

---

### Task 1: 中英文文案

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Test: `tests/i18n.test.ts`

**Interfaces:**
- Consumes: `t(key: MessageKey)`、`setLocaleForTests`
- Produces: `ui.openInNewTab`、`ui.openInNewWindow`

- [x] **Step 1: 写失败测试**

在 `tests/i18n.test.ts` 的 `describe("t")` 内、现有 `translates new-folder copy` 测试之后加入：

```ts
it("translates open-in-new-leaf copy in zh and en", () => {
  setLocaleForTests("zh");
  expect(t("ui.openInNewTab")).toBe("在新标签页中打开");
  expect(t("ui.openInNewWindow")).toBe("在新窗口中打开");

  setLocaleForTests("en");
  expect(t("ui.openInNewTab")).toBe("Open in new tab");
  expect(t("ui.openInNewWindow")).toBe("Open in new window");
});
```

- [x] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/i18n.test.ts -t "translates open-in-new-leaf copy"`

Expected: FAIL。`t("ui.openInNewTab")` 不是「在新标签页中打开」（键尚未进入目录，值为 `undefined`）。

- [x] **Step 3: 加入三份目录**

`src/i18n/types.ts` 的 `MESSAGE_KEYS`：在 `"ui.more"` 后加入 `"ui.openInNewTab"`、`"ui.openInNewWindow"`。

`src/i18n/zh.ts` 在 `"ui.more": "更多",` 后加入：

```ts
"ui.openInNewTab": "在新标签页中打开",
"ui.openInNewWindow": "在新窗口中打开",
```

`src/i18n/en.ts` 在 `"ui.more": "More",` 后加入：

```ts
"ui.openInNewTab": "Open in new tab",
"ui.openInNewWindow": "Open in new window",
```

- [x] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/i18n.test.ts`

Expected: PASS。

---

### Task 2: 按目标打开文档

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/document-service.ts`
- Test: `tests/document-service.test.ts`

**Interfaces:**
- Consumes: 现有 `requireDocument`、`requireIndex`、`pickOpenLeaf`、`SIDEBAR_VIEW_TYPE`
- Produces:
  - `export type DocumentOpenTarget = "tab" | "window"`
  - `DocumentService.open(documentPath: string, target?: DocumentOpenTarget): Promise<void>`
  - `DocumentWorkspaceLeaf.getFilePath(): string | null`
  - `DocumentWorkspaceLeaf.activate(): void`
  - `DocumentServiceApp["workspace"].getLeaf(newLeaf?: boolean | DocumentOpenTarget)`
  - `DocumentServiceApp["workspace"].iterateAllLeaves?(callback: (leaf: DocumentWorkspaceLeaf) => void): void`

- [x] **Step 1: 扩展假工作区并写失败测试**

把 `tests/document-service.test.ts` 里的 `FakeWorkspace` 整类换成下面这一版。现有 `open` 用例依赖：`sidebarFocused === false` 时 `getMostRecentLeaf()` 为 `null`、`iterateRootLeaves` 不产出叶子、`getLeaf(false)` 记入 `lastNewLeaf`；`sidebarFocused === true` 时最近叶子是 `nestnote-document-tree`，`iterateRootLeaves` 产出一个 `markdown` 叶子。

```ts
type LeafTarget = boolean | "tab" | "window";

interface TrackedLeaf {
  path: string | null;
  viewType: string;
  openFile: (file: FileRef) => Promise<void>;
  getViewType: () => string;
  getFilePath: () => string | null;
  activate: () => void;
}

class FakeWorkspace {
  lastNewLeaf: LeafTarget | undefined;
  opened: string[] = [];
  openedViewTypes: string[] = [];
  sidebarFocused = false;
  readonly activated: TrackedLeaf[] = [];
  readonly getLeafCalls: Array<LeafTarget | undefined> = [];
  readonly events: string[] = [];
  private readonly rootLeaves: TrackedLeaf[] = [];
  private allLeaves: TrackedLeaf[] | null = null;
  private recentOverride: TrackedLeaf | null | undefined = undefined;
  iterateAllLeaves: ((callback: (leaf: TrackedLeaf) => void) => void) | undefined =
    (callback) => {
      const leaves = this.allLeaves ?? this.rootLeaves;
      for (const leaf of leaves) {
        callback(leaf);
      }
    };

  trackLeaf(path: string | null, viewType = "markdown"): TrackedLeaf {
    const leaf: TrackedLeaf = {
      path,
      viewType,
      getViewType: () => leaf.viewType,
      getFilePath: () => leaf.path,
      activate: () => {
        this.activated.push(leaf);
        this.events.push(`activate:${leaf.path ?? leaf.viewType}`);
      },
      openFile: async (file: FileRef) => {
        leaf.path = file.path;
        this.opened.push(file.path);
        this.openedViewTypes.push(leaf.viewType);
        this.events.push(`open:${file.path}`);
      },
    };
    return leaf;
  }

  addRootLeaf(path: string | null, viewType = "markdown"): TrackedLeaf {
    const leaf = this.trackLeaf(path, viewType);
    this.rootLeaves.push(leaf);
    return leaf;
  }

  setAllLeaves(leaves: readonly TrackedLeaf[]): void {
    this.allLeaves = [...leaves];
  }

  setRecent(leaf: TrackedLeaf | null): void {
    this.recentOverride = leaf;
  }

  getLeaf(newLeaf?: LeafTarget): TrackedLeaf {
    this.getLeafCalls.push(newLeaf);
    this.lastNewLeaf = newLeaf;
    const viewType =
      this.sidebarFocused && newLeaf !== true
        ? "nestnote-document-tree"
        : "markdown";
    return this.trackLeaf(null, viewType);
  }

  getMostRecentLeaf(): TrackedLeaf | null {
    if (this.recentOverride !== undefined) {
      return this.recentOverride;
    }
    if (!this.sidebarFocused) {
      return null;
    }
    return this.trackLeaf(null, "nestnote-document-tree");
  }

  iterateRootLeaves(callback: (leaf: TrackedLeaf) => void): void {
    if (this.rootLeaves.length > 0) {
      for (const leaf of this.rootLeaves) {
        callback(leaf);
      }
      return;
    }
    if (!this.sidebarFocused) {
      return;
    }
    callback(this.trackLeaf(null, "markdown"));
  }
}
```

在 `describe("NestNoteDocumentService.open")` 末尾、现有两个 `it` 之后加入：

```ts
it("activates an already open editor instead of creating a tab or window", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
  });
  const open = app.workspace.addRootLeaf("Work/index.md");

  await service.open("Work", "tab");
  await service.open("Work", "window");

  expect(app.workspace.activated).toEqual([open, open]);
  expect(app.workspace.getLeafCalls).toEqual([]);
  expect(app.workspace.opened).toEqual([]);
  expect(app.workspace.events).toEqual([
    "activate:Work/index.md",
    "activate:Work/index.md",
  ]);
});

it("prefers the most recent editor with the same file path over an earlier leaf", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
  });
  const first = app.workspace.addRootLeaf("Work/index.md");
  const second = app.workspace.trackLeaf("Work/index.md");
  app.workspace.setAllLeaves([first, second]);
  const recent = app.workspace.trackLeaf("Work/index.md");
  app.workspace.setRecent(recent);

  await service.open("Work", "window");

  expect(app.workspace.activated).toEqual([recent]);
  expect(app.workspace.getLeafCalls).toEqual([]);
});

it("uses the first matching editor when the most recent leaf is the sidebar", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
  });
  const first = app.workspace.addRootLeaf("Work/index.md");
  app.workspace.addRootLeaf("Work/index.md");
  app.workspace.setRecent(
    app.workspace.trackLeaf(null, "nestnote-document-tree"),
  );

  await service.open("Work", "tab");

  expect(app.workspace.activated).toEqual([first]);
  expect(app.workspace.getLeafCalls).toEqual([]);
});

it("reuses a popout leaf that only iterateAllLeaves can see", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
  });
  const popout = app.workspace.trackLeaf("Work/index.md");
  app.workspace.setAllLeaves([popout]);

  await service.open("Work", "window");

  expect(app.workspace.activated).toEqual([popout]);
  expect(app.workspace.getLeafCalls).toEqual([]);
});

it("falls back to root leaves when iterateAllLeaves is absent", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
  });
  const open = app.workspace.addRootLeaf("Work/index.md");
  app.workspace.iterateAllLeaves = undefined;

  await service.open("Work", "tab");

  expect(app.workspace.activated).toEqual([open]);
  expect(app.workspace.getLeafCalls).toEqual([]);
});

it("opens a new tab when the index is not already open", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
  });

  await service.open("Work", "tab");

  expect(app.workspace.getLeafCalls).toEqual(["tab"]);
  expect(app.workspace.opened).toEqual(["Work/index.md"]);
  expect(app.workspace.events).toEqual([
    "open:Work/index.md",
    "activate:Work/index.md",
  ]);
});

it("opens a new window when the index is not already open", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
    seedDocument(vault, "Inbox", parentIndex("Inbox"));
  });

  await service.open("Inbox", "window");

  expect(app.workspace.getLeafCalls).toEqual(["window"]);
  expect(app.workspace.opened).toEqual(["Inbox/index.md"]);
  expect(app.workspace.events).toEqual([
    "open:Inbox/index.md",
    "activate:Inbox/index.md",
  ]);
});

it("does not open a reserved attachments path in a new tab", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
    seedAttachmentsLookalike(vault, "Work/attachments");
  });

  await expect(service.open("Work/attachments", "tab")).rejects.toThrow(
    DocumentServiceError,
  );
  expect(app.workspace.opened).toEqual([]);
  expect(app.workspace.getLeafCalls).toEqual([]);
  expect(app.workspace.activated).toEqual([]);
});
```

- [x] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/document-service.test.ts -t "already open editor"`

Expected: FAIL。`service.open` 不接受第二个参数，或不会 `activate`（`activated` 仍为空，或 TypeScript 在测试编译前就因签名不匹配失败）。现有两条 `open` 测试仍应能在实现前保持通过；若假叶子缺方法导致旧测试先失败，先补上假叶子方法再看新测试失败。

- [x] **Step 3: 实现查找与打开**

`src/types.ts`：

```ts
export type DocumentOpenTarget = "tab" | "window";
```

`DocumentService.open` 改为：

```ts
open(documentPath: string, target?: DocumentOpenTarget): Promise<void>;
```

`src/services/document-service.ts` 从 `../types` 引入 `DocumentOpenTarget`。

`DocumentWorkspaceLeaf` 增加：

```ts
getFilePath(): string | null;
activate(): void;
```

`workspace.getLeaf` 改为 `getLeaf(newLeaf?: boolean | DocumentOpenTarget)`。增加：

```ts
iterateAllLeaves?: (callback: (leaf: DocumentWorkspaceLeaf) => void) => void;
```

`open` 改为：

```ts
async open(
  documentPath: string,
  target?: DocumentOpenTarget,
): Promise<void> {
  const path = this.requireDocument(documentPath);
  const indexFile = this.requireIndex(path);
  if (target === undefined) {
    await pickOpenLeaf(this.app.workspace).openFile(indexFile);
    return;
  }
  const existing = findOpenLeaf(this.app.workspace, indexFile.path);
  if (existing !== null) {
    existing.activate();
    return;
  }
  const leaf = this.app.workspace.getLeaf(target);
  await leaf.openFile(indexFile);
  leaf.activate();
}
```

在 `pickOpenLeaf` 前面加入：

```ts
function isOpenEditor(
  leaf: DocumentWorkspaceLeaf,
  indexPath: string,
): boolean {
  return (
    leaf.getViewType() !== SIDEBAR_VIEW_TYPE &&
    leaf.getFilePath() === indexPath
  );
}

function findOpenLeaf(
  workspace: DocumentServiceApp["workspace"],
  indexPath: string,
): DocumentWorkspaceLeaf | null {
  const matches: DocumentWorkspaceLeaf[] = [];
  const visit = (leaf: DocumentWorkspaceLeaf): void => {
    if (isOpenEditor(leaf, indexPath)) {
      matches.push(leaf);
    }
  };
  if (workspace.iterateAllLeaves !== undefined) {
    workspace.iterateAllLeaves(visit);
  } else {
    workspace.iterateRootLeaves?.(visit);
  }
  if (matches.length === 0) {
    return null;
  }
  const recent = workspace.getMostRecentLeaf?.() ?? null;
  if (recent !== null && isOpenEditor(recent, indexPath)) {
    return recent;
  }
  return matches[0];
}
```

不要用 `matches.includes(recent)`。`getMostRecentLeaf` 与 `iterateAllLeaves` 会各自包装叶子，引用不相等。

- [x] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/document-service.test.ts`

Expected: PASS。不传 `target` 的两条旧用例仍然是 `lastNewLeaf === false` 与侧边栏被跳过。

---

### Task 3: 接上 Obsidian 工作区

**Files:**
- Modify: `src/main.ts`（`createDocumentWorkspace`、`wrapWorkspaceLeaf`，约 660–687 行）

**Interfaces:**
- Consumes: Task 2 的 `DocumentWorkspaceLeaf.getFilePath` / `activate`，以及 `iterateAllLeaves`
- Produces: 真实 `app.workspace` 上的这两个方法和全部叶子遍历

- [x] **Step 1: 扩展包装**

`src/main.ts` 的 obsidian 值导入加上 `FileView`。

`wrapWorkspaceLeaf` 返回值增加：

```ts
getFilePath: () => {
  const view = leaf.view;
  if (view instanceof FileView && view.file !== null) {
    return view.file.path;
  }
  return null;
},
activate: () => {
  void app.workspace.revealLeaf(leaf).then(() => {
    app.workspace.setActiveLeaf(leaf, { focus: true });
  });
},
```

现有 `openFile` 仍在 `openFile(found, { active: true })` 之后调用 `setActiveLeaf(leaf, { focus: false })`。不要在 `openFile` 里调用 `activate`。

`createDocumentWorkspace` 增加：

```ts
iterateAllLeaves: (callback) => {
  app.workspace.iterateAllLeaves((leaf) => {
    callback(wrapWorkspaceLeaf(app, leaf));
  });
},
```

`getLeaf` 继续把参数原样传给 `app.workspace.getLeaf`。

- [x] **Step 2: 类型检查，并确认现有插件测试仍通过**

Run: `npx tsc --noEmit`

Expected: 退出码 0。

Run: `npx vitest run tests/plugin-lifecycle.test.ts tests/document-service.test.ts`

Expected: PASS。不改 `tests/plugin-lifecycle.test.ts`。该文件的假 `getLeaf` 仍只接收 `boolean`；新参数只在用户点菜单时才会出现，生命周期测试不覆盖这条路径。

---

### Task 4: 文档树菜单

**Files:**
- Modify: `src/ui/document-tree-view.ts`（`showDocumentMenu`、`openDocument`）
- Test: `tests/document-tree-view.test.ts`

**Interfaces:**
- Consumes: `t("ui.openInNewTab")`、`t("ui.openInNewWindow")`、`documents.open(path, "tab" | "window")`
- Produces: 两个菜单项，以及 `openDocument(path, target?: DocumentOpenTarget)`

- [x] **Step 1: 改菜单断言并加调用测试**

`tests/document-tree-view.test.ts` 从 `../src/types` 的导入保持 `DocumentService`。三处完整菜单顺序改为：

有子文档的 `fromMore`：

```ts
expect(fromMore).toEqual([
  t("ui.expandAll"),
  "separator",
  t("ui.openInNewTab"),
  t("ui.openInNewWindow"),
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
```

无子文档的 `menuStructure()`：

```ts
expect(menuStructure()).toEqual([
  t("ui.openInNewTab"),
  t("ui.openInNewWindow"),
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
```

子行右键的 `menuLabels()` 在 `t("ui.copyRelativePath")` 之前加上 `t("ui.openInNewTab")` 和 `t("ui.openInNewWindow")`。

在「keeps more and new-child buttons...」用例之后加入：

```ts
it("opens the row in a new tab or a new window from the shared menu", async () => {
  const { documents } = await mount();
  menuItem("Work", t("ui.openInNewTab")).click();
  await flush();
  expect(documents.open).toHaveBeenCalledWith("Work", "tab");
  expect(row("Work").classList.contains("is-selected")).toBe(true);

  menuItem("Inbox", t("ui.openInNewWindow")).click();
  await flush();
  expect(documents.open).toHaveBeenCalledWith("Inbox", "window");
  expect(row("Inbox").classList.contains("is-selected")).toBe(true);
});

it("still opens the clicked name without a leaf target", async () => {
  const { documents } = await mount();
  const name = row("Inbox").querySelector(".nestnote-name");
  if (!(name instanceof HTMLElement)) {
    throw new Error("name missing");
  }
  name.click();
  await flush();
  expect(documents.open).toHaveBeenCalledWith("Inbox");
});
```

- [x] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/document-tree-view.test.ts -t "shared menu"`

Expected: FAIL。菜单结构缺少「在新标签页中打开」。

- [x] **Step 3: 加入菜单项**

`src/ui/document-tree-view.ts` 从 `../types` 引入 `DocumentOpenTarget`。

`openDocument` 改为：

```ts
private async openDocument(
  path: string,
  target?: DocumentOpenTarget,
): Promise<void> {
  this.selected = path;
  this.render(this.nodes);
  try {
    await this.options.documents.open(path, target);
  } catch (error) {
    this.fail(error);
  }
}
```

`showDocumentMenu` 在展开/折叠分组（含它后面的 `menu.addSeparator()`）之后、复制相对路径之前插入：

```ts
menu.addItem((item) => {
  item.setTitle(t("ui.openInNewTab"));
  item.setIcon("file-plus");
  item.onClick(() => {
    void this.openDocument(node.path, "tab");
  });
});
menu.addItem((item) => {
  item.setTitle(t("ui.openInNewWindow"));
  item.setIcon("app-window");
  item.onClick(() => {
    void this.openDocument(node.path, "window");
  });
});
menu.addSeparator();
```

名称点击仍调用 `this.openDocument(node.path)`，不传第二个参数。

- [x] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/document-tree-view.test.ts tests/i18n.test.ts`

Expected: PASS。

---

### Task 5: 说明文档

**Files:**
- Modify: `README_zh.md`（侧边栏表，「展开 / 折叠全部子文档」行之后）
- Modify: `README.md`（同一位置）

**Interfaces:**
- Consumes: 无代码接口
- Produces: 两份 README 中的操作说明

- [x] **Step 1: 写入两行说明**

`README_zh.md` 在「展开 / 折叠全部子文档」行后、「复制相对路径」行前加入：

```md
| 在新标签页中打开 | 该行「更多」或右键。打开该文档的 `index.md`。已经在某个编辑页打开时，切换到那个编辑页；否则新建标签页 |
| 在新窗口中打开 | 该行「更多」或右键。打开该文档的 `index.md`。已经在某个编辑页打开时，切换到那个编辑页；否则新建 Obsidian 弹出窗口 |
```

`README.md` 在 `Expand all / Collapse all children` 行后、`Copy relative path` 行前加入：

```md
| Open in new tab | Row **More** or right-click. Opens that document's `index.md`. If an editor already has it open, switches to that editor; otherwise opens a new tab |
| Open in new window | Row **More** or right-click. Opens that document's `index.md`. If an editor already has it open, switches to that editor; otherwise opens a new Obsidian popout window |
```

不改截图和图注。

- [x] **Step 2: 全量核对**

Run: `npx vitest run`

Expected: PASS。

Run: `npx tsc --noEmit`

Expected: 退出码 0。
