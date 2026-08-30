# NestNote 新建后打开与拖动改嵌套 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建文档成功后打开并在面板中揭示该节点；NestNote 面板支持拖动文档只改父子嵌套。

**Architecture:** `DocumentService.move` 用 `vault.rename` 搬整个文档目录，并更新旧父/新父受控链接。面板 HTML5 拖放调用 `move`；四个新建入口在 `create` 成功后 `open`，`await requestRefresh()`，再 `reveal`。`create` 本身不调用 `open`。

**Tech Stack:** Obsidian Plugin API、Vitest + happy-dom、现有 `NestNoteDocumentService` / `DocumentTreeView` 测试。

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-30-nestnote-open-and-drag-design.md`
- 拖动只改父子关系，同级仍按名称排序；非法移动 Notice，不绘制禁止落点样式。
- MIME：`application/x-nestnote-document-path`
- 新文案：`error.cannotMoveIntoSelf` / `error.cannotMoveIntoDescendant`（zh/en 与 spec 第 5 节逐字一致）
- UI：`setIcon()` + `aria-label` + `.nestnote-*` + Obsidian CSS 变量，不引入拖放库
- `create` 不在内部 `open`；`move` 经 `coordinator.runInternal`；`open` 不包
- 用户未明确要求时跳过每个 Task 末尾的 git commit（本仓库规则）

## File map

- `src/i18n/types.ts`、`src/i18n/zh.ts`、`src/i18n/en.ts` — 新错误文案
- `src/types.ts` — `DocumentService.move`
- `src/services/document-service.ts` — `move` 实现
- `src/ui/document-tree-view.ts` — `reveal`、新建后打开、HTML5 拖放
- `src/main.ts` — `wrapWithInternal.move`、命令入口 `create` 后打开、`requestRefresh` 返回 Promise
- `styles.css` — `is-drop-target` / `is-drop-root`
- `README.md`、`README_zh.md` — 新建后打开、拖动改嵌套
- Tests: `tests/i18n.test.ts`、`tests/document-service.test.ts`、`tests/document-tree-view.test.ts`、`tests/plugin-lifecycle.test.ts`

---

### Task 1: 移动错误文案

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Test: `tests/i18n.test.ts`（已有 catalogs 对齐测试；本任务补插值断言）

**Interfaces:**
- Consumes: 现有 `MESSAGE_KEYS` / `t()`
- Produces: `t("error.cannotMoveIntoSelf")`、`t("error.cannotMoveIntoDescendant")`

- [ ] **Step 1: 写失败测试**

在 `tests/i18n.test.ts` 的 `describe("t")` 中增加：

```ts
it("translates move cycle errors", () => {
  setLocaleForTests("zh");
  expect(t("error.cannotMoveIntoSelf")).toBe("不能将文档移动到自身");
  expect(t("error.cannotMoveIntoDescendant")).toBe(
    "不能将文档移动到自己的子文档中",
  );
  setLocaleForTests("en");
  expect(t("error.cannotMoveIntoSelf")).toBe(
    "Cannot move a document into itself",
  );
  expect(t("error.cannotMoveIntoDescendant")).toBe(
    "Cannot move a document into its descendant",
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/i18n.test.ts`

Expected: FAIL，`error.cannotMoveIntoSelf` 不是合法 `MessageKey`。

- [ ] **Step 3: 加入 key 与文案**

`src/i18n/types.ts` 的 `MESSAGE_KEYS` 在 `error.notCompleteDocument` 后追加：

```ts
  "error.cannotMoveIntoSelf",
  "error.cannotMoveIntoDescendant",
```

`src/i18n/zh.ts`：

```ts
  "error.cannotMoveIntoSelf": "不能将文档移动到自身",
  "error.cannotMoveIntoDescendant": "不能将文档移动到自己的子文档中",
```

`src/i18n/en.ts`：

```ts
  "error.cannotMoveIntoSelf": "Cannot move a document into itself",
  "error.cannotMoveIntoDescendant":
    "Cannot move a document into its descendant",
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/i18n.test.ts`

Expected: PASS

- [ ] **Step 5: Commit（用户要求时）**

```bash
git add src/i18n/types.ts src/i18n/zh.ts src/i18n/en.ts tests/i18n.test.ts
git commit -m "feat(i18n): add document move cycle error strings"
```

---

### Task 2: `DocumentService.move`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/document-service.ts`
- Modify: `src/main.ts`（`wrapWithInternal` 必须同步加上 `move`，否则 `DocumentService` 字面量不完整）
- Test: `tests/document-service.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `t("error.cannotMoveIntoSelf")` 等；现有 `requireDocument`、`resolveParent`、`assertParentWritable`、`freshParentWrite`、`flushWrites`、`documentDepth`、`scan`、`getParentPath`、`getName`
- Produces:

```ts
interface DocumentService {
  create(parentPath: string | null, name: string): Promise<DocumentNode>;
  rename(documentPath: string, newName: string): Promise<DocumentNode>;
  trash(documentPath: string): Promise<void>;
  move(documentPath: string, newParentPath: string | null): Promise<DocumentNode>;
  open(documentPath: string): Promise<void>;
}
```

`wrapWithInternal`：

```ts
move: (documentPath, newParentPath) =>
  coordinator.runInternal(() => inner.move(documentPath, newParentPath)),
```

- [ ] **Step 1: 写失败测试**

`src/types.ts` 的 `DocumentService` **先不要改**。在 `tests/document-service.test.ts` 的 `trash` describe 与 `open` describe 之间插入 `describe("NestNoteDocumentService.move", ...)`。

用已有 `createHarness` / `seedDocument` / `workIndex`。`parentIndex` 辅助：

```ts
function parentIndex(name: string, body = "# Body\n"): string {
  return `---
name: ${name}
created: 2020-01-01T00:00:00Z
---
${body}`;
}
```

测试（全部 `async`）：

1. **根搬到另一根下**

```ts
it("moves a root document under another root and updates parent links", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
    seedDocument(vault, "Inbox", parentIndex("Inbox", "# Inbox\n"));
  });
  const node = await service.move("Inbox", "Work");
  expect(app.vault.renameCalls).toEqual([{ from: "Inbox", to: "Work/Inbox" }]);
  expect(node.path).toBe("Work/Inbox");
  expect(app.vault.getFolderByPath("Inbox")).toBeNull();
  expect(app.vault.files.get("Work/index.md")).toContain("- [Inbox](Inbox/index.md)");
  expect(app.vault.files.get("Work/index.md")).toContain("# Body");
  expect(app.vault.files.get("Work/Inbox/index.md")).toContain("# Inbox");
});
```

2. **子文档换父、再搬回根**

```ts
it("moves a child to another parent then back to the vault root", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
    seedDocument(vault, "Office", parentIndex("Office", "# Office\n"));
    seedDocument(vault, "Work/Notes", parentIndex("Notes", "# Notes\n"));
  });
  await service.move("Work/Notes", "Office");
  expect(app.vault.getFolderByPath("Office/Notes")).not.toBeNull();
  expect(app.vault.files.get("Work/index.md")).not.toContain("Notes");
  expect(app.vault.files.get("Office/index.md")).toContain("- [Notes](Notes/index.md)");
  const rooted = await service.move("Office/Notes", null);
  expect(rooted.path).toBe("Notes");
  expect(app.vault.getFolderByPath("Notes")).not.toBeNull();
  expect(app.vault.files.get("Office/index.md")).not.toContain("Notes");
});
```

3. **同父 no-op**

```ts
it("returns the same node without renaming when already under that parent", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
    seedDocument(vault, "Work/Notes", parentIndex("Notes"));
    seedDocument(vault, "Inbox", parentIndex("Inbox"));
  });
  const beforeWork = app.vault.files.get("Work/index.md");
  await service.move("Work/Notes", "Work");
  await service.move("Inbox", null);
  expect(app.vault.renameCalls).toEqual([]);
  expect(app.vault.files.get("Work/index.md")).toBe(beforeWork);
});
```

4. **搬到自己 / 子孙**

```ts
it("rejects moving into itself or a descendant without renaming", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
    seedDocument(vault, "Work/Notes", parentIndex("Notes"));
  });
  await expect(service.move("Work", "Work")).rejects.toThrow(
    t("error.cannotMoveIntoSelf"),
  );
  await expect(service.move("Work", "Work/Notes")).rejects.toThrow(
    t("error.cannotMoveIntoDescendant"),
  );
  expect(app.vault.renameCalls).toEqual([]);
  expect(app.vault.getFolderByPath("Work")).not.toBeNull();
});
```

5. **目标同名**

```ts
it("rejects when the destination name already exists", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
    seedDocument(vault, "Office", parentIndex("Office"));
    seedDocument(vault, "Work/Office", parentIndex("Office", "# nested\n"));
  });
  await expect(service.move("Office", "Work")).rejects.toThrow(
    t("error.targetExists", { path: "Work/Office" }),
  );
  expect(app.vault.renameCalls).toEqual([]);
});
```

6. **深度：叶子超限 + 子树加深超限**

```ts
it("rejects a move that would exceed maxChildDepth including hidden descendants", async () => {
  const app = createSeededAppWithDocumentChain(5);
  seedDocument(
    app.vault,
    "Other",
    parentIndex("Other"),
  );
  const service = new NestNoteDocumentService(app, {
    getMaxChildDepth: () => 5,
  });
  await expect(service.move("Other", "Level0/Level1/Level2/Level3/Level4/Level5"))
    .rejects.toThrow(t("error.maxDepthReached", { max: 5 }));
  expect(app.vault.renameCalls).toEqual([]);

  const shallow = createApp((vault) => {
    seedDocument(vault, "A", parentIndex("A"));
    seedDocument(vault, "B", parentIndex("B"));
    seedDocument(vault, "B/C", parentIndex("C"));
    seedDocument(vault, "B/C/D", parentIndex("D"));
    seedDocument(vault, "B/C/D/E", parentIndex("E"));
  });
  const limited = new NestNoteDocumentService(shallow, {
    getMaxChildDepth: () => 2,
  });
  await expect(limited.move("B", "A")).rejects.toThrow(
    t("error.maxDepthReached", { max: 2 }),
  );
  expect(shallow.vault.renameCalls).toEqual([]);
});
```

说明：`B` 相对高度为 3（C/D/E），搬到 `A` 下后最深为 `1+3=4 > 2`。`scan` 在 `maxChildDepth: 2` 时会隐藏 D/E，但 `move` 必须按磁盘完整文档子树计算。

7. **被搬文档自己的相对子链接仍在**

```ts
it("keeps relative child links inside the moved document", async () => {
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", workIndex());
    seedDocument(vault, "Office", parentIndex("Office"));
    seedDocument(
      vault,
      "Work/Parent",
      `---
name: Parent
created: 2020-01-01T00:00:00Z
---
# Parent

<!-- nestnote:children:start -->
- [Kid](Kid/index.md)
<!-- nestnote:children:end -->
`,
    );
    seedDocument(vault, "Work/Parent/Kid", parentIndex("Kid", "# Kid\n"));
  });
  await service.move("Work/Parent", "Office");
  expect(app.vault.files.get("Office/Parent/index.md")).toContain(
    "- [Kid](Kid/index.md)",
  );
  expect(app.vault.files.get("Office/Parent/Kid/index.md")).toContain("# Kid");
});
```

8. **父文档损坏 Frontmatter 时不 rename**

```ts
it("does not rename when the new parent metadata cannot be written", async () => {
  const original = "---\nname: Broken\n# still body\n";
  const { app, service } = createHarness((vault) => {
    seedDocument(vault, "Work", original);
    seedDocument(vault, "Inbox", parentIndex("Inbox"));
  });
  await expect(service.move("Inbox", "Work")).rejects.toThrow(DocumentServiceError);
  expect(app.vault.renameCalls).toEqual([]);
  expect(app.vault.getFolderByPath("Inbox")).not.toBeNull();
  expect(app.vault.files.get("Work/index.md")).toBe(original);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/document-service.test.ts`

Expected: FAIL，`service.move is not a function`。

- [ ] **Step 3: 实现 `move`**

`src/types.ts` 在 `trash` 与 `open` 之间加入：

```ts
  move(documentPath: string, newParentPath: string | null): Promise<DocumentNode>;
```

`src/services/document-service.ts` 在 `trash` 之后、`open` 之前加入 `move`。完整方法：

```ts
  async move(
    documentPath: string,
    newParentPath: string | null,
  ): Promise<DocumentNode> {
    const from = this.requireDocument(documentPath);
    const newParent = this.resolveParent(newParentPath);
    const oldParent = getParentPath(from);
    if (oldParent === newParent) {
      return this.requireScannedNode(from);
    }
    if (newParent === from) {
      throw new DocumentServiceError(t("error.cannotMoveIntoSelf"));
    }
    if (newParent !== null && newParent.startsWith(`${from}/`)) {
      throw new DocumentServiceError(t("error.cannotMoveIntoDescendant"));
    }

    const name = getName(from);
    const to = newParent === null ? name : `${newParent}/${name}`;
    if (this.app.vault.getAbstractFileByPath(to) !== null) {
      throw new DocumentServiceError(t("error.targetExists", { path: to }));
    }

    const maxChildDepth =
      this.options.getMaxChildDepth?.() ??
      DEFAULT_NESTNOTE_SETTINGS.maxChildDepth;
    const newRootDepth =
      newParent === null ? 0 : this.documentDepth(newParent) + 1;
    const deepest = newRootDepth + this.subtreeRelativeHeight(from);
    if (deepest > maxChildDepth) {
      throw new DocumentServiceError(
        t("error.maxDepthReached", { max: maxChildDepth }),
      );
    }

    const folder = this.app.vault.getFolderByPath(from);
    if (folder === null) {
      throw new DocumentServiceError(t("error.documentNotFound", { path: from }));
    }

    const preview: DocumentNode = {
      name,
      path: to,
      indexPath: `${to}/index.md`,
      attachmentsPath: `${to}/attachments`,
      children: [],
    };
    if (oldParent !== null && this.isCompleteDocument(oldParent)) {
      const current = this.requireScannedNode(oldParent);
      await this.assertParentWritable(
        oldParent,
        current.children.filter((child) => child.path !== from),
      );
    }
    if (newParent !== null) {
      const current = this.requireScannedNode(newParent);
      await this.assertParentWritable(newParent, [...current.children, preview]);
    }

    await this.app.vault.rename(folder, to);

    const pendingWrites: PendingWrite[] = [];
    if (oldParent !== null && this.isCompleteDocument(oldParent)) {
      pendingWrites.push(await this.freshParentWrite(oldParent));
    }
    if (newParent !== null && this.isCompleteDocument(newParent)) {
      pendingWrites.push(await this.freshParentWrite(newParent));
    }
    await this.flushWrites(pendingWrites);
    return this.requireScannedNode(to);
  }
```

`subtreeRelativeHeight` 必须扫描 **上限 9**（设置允许的最大层级），不能用用户当前的 `maxChildDepth`：

```ts
  private subtreeRelativeHeight(path: string): number {
    const entries: VaultEntry[] = this.app.vault.getAllLoadedFiles().flatMap(
      (entry) => {
        const normalized = normalizePath(entry.path);
        if (normalized === "") {
          return [];
        }
        return [
          {
            kind: Array.isArray(entry.children) ? "folder" : "file",
            path: normalized,
          } satisfies VaultEntry,
        ];
      },
    );
    const node = findNode(scanDocuments(entries, { maxChildDepth: 9 }), path);
    if (node === null) {
      return 0;
    }
    return relativeHeight(node);
  }
```

文件底部（`findNode` 附近）增加：

```ts
function relativeHeight(node: DocumentNode): number {
  if (node.children.length === 0) {
    return 0;
  }
  return Math.max(
    ...node.children.map((child) => 1 + relativeHeight(child)),
  );
}
```

`src/main.ts` 的 `wrapWithInternal` 返回对象加入上面的 `move` 包装。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/document-service.test.ts tests/plugin-lifecycle.test.ts`

Expected: PASS（lifecycle 仍能编译）

- [ ] **Step 5: Commit（用户要求时）**

```bash
git add src/types.ts src/services/document-service.ts src/main.ts tests/document-service.test.ts
git commit -m "feat(documents): move folders to a new parent"
```

---

### Task 3: 面板 `reveal` 与新建后打开

**Files:**
- Modify: `src/ui/document-tree-view.ts`
- Modify: `src/main.ts`（`requestRefresh` 改为返回 `this.scanAndSync()`）
- Test: `tests/document-tree-view.test.ts`

**Interfaces:**
- Consumes: `documents.create` 返回 `DocumentNode`；`documents.open(path)`；`requestRefresh(): Promise<void>`
- Produces:

```ts
export interface DocumentTreeViewOptions {
  documents: DocumentService;
  getNodes: () => readonly DocumentNode[];
  requestRefresh: () => Promise<void>;
  notice?: (message: string) => void;
}

class DocumentTreeView {
  reveal(path: string): void
}
```

`reveal`：`selected = path`；对 `Work/Notes/A` 把 `Work`、`Work/Notes` 加入 `expanded`；再 `this.render(this.nodes)`。只在刷新之后调用。

- [ ] **Step 1: 更新测试夹具并写失败测试**

`tests/document-tree-view.test.ts` 的 `mount`：

```ts
  const documents: DocumentService = {
    create: vi.fn().mockResolvedValue(node("Work", "Work")),
    rename: vi.fn().mockResolvedValue(node("Work", "Work")),
    trash: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(node("Work", "Work")),
    open: vi.fn().mockResolvedValue(undefined),
    ...options.documents,
  };
  const requestRefresh = vi.fn(async () => undefined);
```

把现有「creates a root document」改成期望 `open`；把「creates a child document」里的 `expect(documents.open).not.toHaveBeenCalled()` 删掉，改为 `toHaveBeenCalledWith`。

新增：

```ts
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

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
```

`reveal` 单测：

```ts
it("selects a path and expands its ancestors", async () => {
  const { view } = await mount();
  view.reveal("Work/Notes");
  expect(row("Work").classList.contains("is-expanded")).toBe(true);
  expect(row("Work/Notes").classList.contains("is-selected")).toBe(true);
});
```

工具栏刷新仍调用 `requestRefresh`；`run()` 里 `await this.options.requestRefresh()`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/document-tree-view.test.ts`

Expected: FAIL，未调用 `open` 或没有 `reveal`。

- [ ] **Step 3: 实现**

`DocumentTreeViewOptions.requestRefresh` 改为 `() => Promise<void>`。

```ts
  reveal(path: string): void {
    this.selected = path;
    for (const ancestor of ancestorPaths(path)) {
      this.expanded.add(ancestor);
    }
    this.render(this.nodes);
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
```

`openNameModal` **不要再内部包 `run()`**（否则 `createAndOpen` 吞掉 create 错误后 `run` 仍会 refresh）。改为只调用 `submit`：

```ts
  private openNameModal(
    title: string,
    initial: string,
    submit: (name: string) => Promise<unknown>,
  ): void {
    new NestNoteNameModal(this.app, title, initial, (name) => {
      void submit(name);
    }).open();
  }
```

```ts
      iconButton("plus", t("command.newDocument"), () => {
        this.openNameModal(t("command.newDocument"), "", (name) =>
          this.createAndOpen(null, name),
        );
      }),
```

```ts
        this.openNameModal(t("command.newChildDocument"), "", (name) =>
          this.createAndOpen(node.path, name),
        );
```

重命名继续自己包 `run`：

```ts
            this.openNameModal(t("ui.rename"), node.name, (name) =>
              this.run(() => this.options.documents.rename(node.path, name)),
            );
```

```ts
  private async run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      await this.options.requestRefresh();
    } catch (error) {
      this.fail(error);
    }
  }
```

文件底部：

```ts
function ancestorPaths(path: string): string[] {
  const parts = path.split("/").filter((part) => part !== "");
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join("/"));
  }
  return ancestors;
}
```

`src/main.ts` 注册视图：

```ts
          requestRefresh: () => this.scanAndSync(),
```

不要 `void this.scanAndSync()`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/document-tree-view.test.ts`

Expected: PASS

- [ ] **Step 5: Commit（用户要求时）**

```bash
git add src/ui/document-tree-view.ts src/main.ts tests/document-tree-view.test.ts
git commit -m "feat(sidebar): open and reveal documents after create"
```

---

### Task 4: 面板 HTML5 拖放

**Files:**
- Modify: `src/ui/document-tree-view.ts`
- Modify: `styles.css`
- Test: `tests/document-tree-view.test.ts`

**Interfaces:**
- Consumes: `documents.move(documentPath, newParentPath)` 返回搬后的 `DocumentNode`
- Produces: 导出常量 `NESTNOTE_DOCUMENT_DRAG_MIME = "application/x-nestnote-document-path"`；行 `draggable="true"`；放到行上 → `move(源, 目标路径)`；放到树空白 → `move(源, null)`；失败不 `requestRefresh`

- [ ] **Step 1: 写失败测试**

```ts
export const NESTNOTE_DOCUMENT_DRAG_MIME =
  "application/x-nestnote-document-path";
```

测试 helper（同一文件）：

```ts
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
```

测试：

```ts
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
```

`drop` 事件的 `dataTransfer.getData` 由 helper 填入 `path`（模拟浏览器带上 dragstart 的数据）。`dragstart` 的 `setData` 另测：

```ts
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
```

树空白：

```ts
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
```

失败：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/document-tree-view.test.ts`

Expected: FAIL，行不可拖或未调用 `move`。

- [ ] **Step 3: 实现拖放与样式**

`src/ui/document-tree-view.ts` 顶部：

```ts
export const NESTNOTE_DOCUMENT_DRAG_MIME =
  "application/x-nestnote-document-path";
```

`buildNode` 中 `row.draggable = true`。

```ts
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
      item.classList.add("is-drop-target");
    });
    item.addEventListener("dragleave", (event) => {
      if (event.currentTarget instanceof HTMLElement) {
        event.currentTarget.classList.remove("is-drop-target");
      }
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.clearDropHighlights();
      const source = event.dataTransfer?.getData(NESTNOTE_DOCUMENT_DRAG_MIME) ?? "";
      void this.handleDrop(source, node.path);
    });
```

`onOpen` 里对 `tree`：

```ts
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
      const closestNode =
        event.target instanceof Element
          ? event.target.closest(".nestnote-node")
          : null;
      const parent =
        closestNode instanceof HTMLElement
          ? (closestNode.dataset.path ?? null)
          : null;
      void this.handleDrop(source, parent);
    });
```

节点 `drop` 已 `stopPropagation`，树空白的 `drop` 不会冒泡自节点。若事件落在 `.nestnote-children` 空白且未停在子 `li` 上，`closest(".nestnote-node")` 是父节点，符合 spec。

```ts
  private clearDropHighlights(): void {
    this.treeEl?.classList.remove("is-drop-root");
    this.treeEl
      ?.querySelectorAll(".is-drop-target")
      .forEach((el) => el.classList.remove("is-drop-target"));
  }

  private async handleDrop(
    sourcePath: string,
    newParentPath: string | null,
  ): Promise<void> {
    if (sourcePath === "") {
      return;
    }
    try {
      const moved = await this.options.documents.move(
        sourcePath,
        newParentPath,
      );
      await this.options.requestRefresh();
      this.reveal(moved.path);
    } catch (error) {
      this.fail(error);
    }
  }
```

`styles.css` 追加：

```css
.nestnote-node.is-drop-target > .nestnote-row {
  background-color: var(--nav-item-background-hover);
  box-shadow: inset 0 0 0 1px var(--interactive-accent);
}

.nestnote-tree.is-drop-root {
  box-shadow: inset 0 0 0 1px var(--interactive-accent);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/document-tree-view.test.ts`

Expected: PASS

- [ ] **Step 5: Commit（用户要求时）**

```bash
git add src/ui/document-tree-view.ts styles.css tests/document-tree-view.test.ts
git commit -m "feat(sidebar): drag documents to change parent"
```

---

### Task 5: 命令入口打开与测试夹具

**Files:**
- Modify: `src/main.ts`
- Modify: `tests/plugin-lifecycle.test.ts`
- Modify: `README.md`
- Modify: `README_zh.md`

**Interfaces:**
- Consumes: `documents.create` / `documents.open` / `DocumentTreeView.reveal`
- Produces: 命令「新建文档」「新建子文档」走与面板相同的 create → open → scanAndSync → reveal 顺序

- [ ] **Step 1: 补 FakeWorkspace，使 `open` 不炸**

`tests/plugin-lifecycle.test.ts`：

`FakeLeaf` 默认 `view` 带 `getViewType`，因为 `wrapWorkspaceLeaf` 调用 `leaf.view.getViewType()`：

```ts
  view: {
    onOpen?: () => Promise<void>;
    render?: (nodes: unknown) => void;
    reveal?: (path: string) => void;
    contentEl?: HTMLElement;
    getViewType?: () => string;
  } | null = {
    getViewType: () => "markdown",
  };

  getViewType(): string {
    return this.viewType ?? "markdown";
  }
```

`setViewState` 换掉 `view` 后，真实 `DocumentTreeView` 已有 `getViewType`。

`FakeWorkspace`：

```ts
  getMostRecentLeaf(): FakeLeaf | null {
    const last = this.leaves[this.leaves.length - 1];
    return last === undefined ? null : last;
  }

  iterateRootLeaves(callback: (leaf: FakeLeaf) => void): void {
    for (const leaf of this.leaves) {
      callback(leaf);
    }
  }
```

写失败测试（在 assembly/create 相关 describe 中）：

```ts
  it("opens the new document after the new-document command succeeds", async () => {
    vi.useFakeTimers();
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    command(plugin, "nestnote:new-document")();
    await confirmNameModal("Work");
    await settle();

    expect(app.workspace.opened).toContain("Work/index.md");
  });

  it("reveals the new document in an open NestNote pane", async () => {
    vi.useFakeTimers();
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();
    await plugin.activateView();

    command(plugin, "nestnote:new-document")();
    await confirmNameModal("Journal");
    await settle();

    const selected = document.querySelector(
      '.nestnote-node[data-path="Journal"].is-selected',
    );
    expect(selected).not.toBeNull();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/plugin-lifecycle.test.ts`

Expected: FAIL，`opened` 不含 `Work/index.md`（或 `getMostRecentLeaf` 未定义导致 open Notice，断言失败）。

- [ ] **Step 3: 实现命令入口**

替换 `promptAndCreate`：

```ts
  private promptAndCreate(parentPath: string | null): void {
    const title =
      parentPath === null
        ? t("command.newDocument")
        : t("command.newChildDocument");
    new CommandNameModal(this.app, title, (name) => {
      void this.createOpenAndReveal(parentPath, name);
    }).open();
  }

  private async createOpenAndReveal(
    parentPath: string | null,
    name: string,
  ): Promise<void> {
    let created: DocumentNode;
    try {
      created = await this.documents.create(parentPath, name);
    } catch (error) {
      if (!isAlreadyNoticed(error)) {
        new Notice(errorMessage(error));
      }
      return;
    }
    try {
      await this.documents.open(created.path);
    } catch (error) {
      if (!isAlreadyNoticed(error)) {
        new Notice(errorMessage(error));
      }
    }
    await this.scanAndSync();
    this.revealInOpenViews(created.path);
  }

  private revealInOpenViews(path: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)) {
      const view = leaf.view;
      if (view instanceof DocumentTreeView) {
        view.reveal(path);
      }
    }
  }
```

`runAction` 仍给 rename/trash 等用，不要让 create 再走「成功才 refresh、失败就中止 open」的旧路径。

README.md「Create the first document」段落后加一句：

```md
After the document is created, NestNote opens its `index.md` and selects it in the sidebar (expanding ancestors when needed).
```

Sidebar 表增加一行：

```md
| Reparent | Drag a document onto another document to nest it, or onto empty space in the tree to make it a root document. Sibling order stays alphabetical |
```

Commands 表「New document / New child document」改为创建后打开 `index.md`。

`README_zh.md` 对应：

- 创建段：创建成功后打开该文档的 `index.md`，并在侧边栏选中（需要时展开祖先）。
- 侧边栏表：`| 调整嵌套 | 拖到另一份文档上成为其子文档；拖到树的空白处成为根文档。同级仍按名称排序 |`
- 命令表注明创建后打开。

- [ ] **Step 4: 跑全量测试**

Run: `npm test`

Expected: PASS

- [ ] **Step 5: Commit（用户要求时）**

```bash
git add src/main.ts tests/plugin-lifecycle.test.ts README.md README_zh.md
git commit -m "feat(commands): open new documents and document drag reparent"
```

---

## Self-review

| Spec 条目 | Task |
|-----------|------|
| 四个入口 create 后 open + refresh + reveal | 3（面板）、5（命令） |
| `open` 失败不回滚 | 3 |
| `reveal` / `requestRefresh(): Promise<void>` | 3 |
| `move` 步骤 1–8、no-op、cycle、同名、深度含子树 | 2 |
| `wrapWithInternal.move` | 2 |
| HTML5 拖放、MIME、空白为根、stopPropagation、失败不 refresh | 4 |
| 新 i18n key | 1 |
| README | 5 |
| 不测幽灵图、不测面板外松开 | 4 未包含 |

无 TBD。`move` / `reveal` / `NESTNOTE_DOCUMENT_DRAG_MIME` 名称前后一致。
