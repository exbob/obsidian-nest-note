# NestNote 侧边栏同级拖动排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 NestNote 面板把文档拖到同级兄弟的上方或下方即可改子文档顺序；顺序写在父文档 children 标记区，根文档仍按名称排序。

**Architecture:** `parseChildrenOrder` / `mergeChildrenOrder` / `placeChild` 成为顺序原语。扫描后用父 `index.md` 重排 `children`，再跑自动修正。`DocumentService.move` 增加 `insertBeforePath`：同父只改列表，换父搬目录后再按位置插入。面板用行上沿/下沿/正中热区调用 `move`。

**Tech Stack:** TypeScript、Obsidian HTML5 拖放、Vitest + happy-dom。不引入拖放库，不新增 i18n key。

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-01-nestnote-sibling-reorder-design.md`
- 顺序只存在父文档 `<!-- nestnote:children:start/end -->` 标记区；不改目录名、不写 `order` 字段、不另建索引
- 根文档仍按 `name.localeCompare` 排序；根文档行没有前/后插入热区
- `updateChildrenLinks` 按传入数组顺序写，不再 `localeCompare`
- `move(documentPath, newParentPath, insertBeforePath?: string | null)`；省略/`null` 表示接到末尾
- 不新增 i18n key；非法 `insertBeforePath` 接到末尾；同父且等于源路径则 no-op
- 自动修正仍只走 `transformDocumentIndex`；必须先 `applyChildrenOrder` 再 sync
- UI：`.nestnote-*` + Obsidian CSS 变量；MIME 仍为 `application/x-nestnote-document-path`
- Tests: `npm test`（Windows PowerShell）。用户未明确要求时跳过每个 Task 末尾的 git commit（本仓库规则）

## File map

- `src/domain/children-links.ts` — 解析、merge、placeChild、renameInOrder、applyChildrenOrder；写入不再按名称排序
- `src/types.ts` — `DocumentService.move` 第三参数
- `src/services/document-service.ts` — 父文档写入走 merge；rename 保位置；move 同父重排 / 换父插入
- `src/main.ts` — `wrapWithInternal.move` 传第三参数；扫描后 apply order 再 auto-fix
- `src/ui/document-tree-view.ts` — 行热区、高亮、调用三参数 `move`
- `styles.css` — `is-drop-before` / `is-drop-after`
- `README.md`、`README_zh.md` — 拖动排序与子链接顺序
- Tests: `tests/children-links.test.ts`、`tests/document-service.test.ts`、`tests/plugin-lifecycle.test.ts`、`tests/document-tree-view.test.ts`

---

### Task 1: 顺序原语与按传入数组写入

**Files:**
- Modify: `src/domain/children-links.ts`
- Test: `tests/children-links.test.ts`

**Interfaces:**
- Consumes: 现有 `updateChildrenLinks`、围栏内标记跳过逻辑、`DocumentNode`
- Produces:

```ts
parseChildrenOrder(content: string): string[]
mergeChildrenOrder(orderedNames: readonly string[], live: readonly DocumentNode[]): DocumentNode[]
placeChild<T extends { path: string }>(
  siblings: readonly T[],
  node: T,
  insertBeforePath?: string | null,
): T[]
renameInOrder(orderedNames: readonly string[], fromName: string, toName: string): string[]
applyChildrenOrder(
  nodes: readonly DocumentNode[],
  indexContents: ReadonlyMap<string, string>,
): DocumentNode[]
```

- [ ] **Step 1: 写失败测试并改掉旧的「按名称排序」断言**

把 `tests/children-links.test.ts` 里 `"sorts children by name and uses paths relative to the parent index directory"` 改成保留传入顺序：

```ts
  it("writes children in the given order and uses paths relative to the parent index directory", () => {
    const parentPath = "Work/父";
    const unsorted = [child("文档2", parentPath), child("文档1", parentPath)];

    const result = updateChildrenLinks(
      "<!-- nestnote:children:start -->\n<!-- nestnote:children:end -->\n",
      parentPath,
      unsorted,
    );

    expect(result).toBe(`<!-- nestnote:children:start -->

- [文档2](文档2/index.md)
- [文档1](文档1/index.md)

<!-- nestnote:children:end -->
`);
  });
```

在同一文件增加 import：`parseChildrenOrder`、`mergeChildrenOrder`、`placeChild`、`renameInOrder`、`applyChildrenOrder`。然后加 `describe("child order")`：

```ts
describe("child order", () => {
  it("parses document names from marker links, not labels, and decodes %20", () => {
    const content = `<!-- nestnote:children:start -->
- [旧标题](项目%20B/index.md)
not a link
- [A](项目%20A/index.md)
<!-- nestnote:children:end -->`;
    expect(parseChildrenOrder(content)).toEqual(["项目 B", "项目 A"]);
  });

  it("returns an empty order when markers are missing or unmatched", () => {
    expect(parseChildrenOrder("# Body\n")).toEqual([]);
    expect(
      parseChildrenOrder("<!-- nestnote:children:start -->\n- [A](A/index.md)\n"),
    ).toEqual([]);
  });

  it("ignores paired markers inside fenced code", () => {
    const content = `# Intro
\`\`\`md
<!-- nestnote:children:start -->
- [示例](示例/index.md)
<!-- nestnote:children:end -->
\`\`\`
<!-- nestnote:children:start -->
- [真](真/index.md)
<!-- nestnote:children:end -->
`;
    expect(parseChildrenOrder(content)).toEqual(["真"]);
  });

  it("merges live nodes in listed order and appends unknown names sorted", () => {
    const live = [child("C"), child("A"), child("B")];
    const merged = mergeChildrenOrder(["B", "gone", "A"], live);
    expect(merged.map((node) => node.name)).toEqual(["B", "A", "C"]);
    expect(live.map((node) => node.name)).toEqual(["C", "A", "B"]);
  });

  it("sorts live children by name when orderedNames is empty", () => {
    expect(mergeChildrenOrder([], [child("B"), child("A")]).map((n) => n.name)).toEqual([
      "A",
      "B",
    ]);
  });

  it("places a node before a sibling or appends when the path is missing", () => {
    const a = child("A");
    const b = child("B");
    const c = child("C");
    expect(placeChild([a, c], b, c.path).map((n) => n.name)).toEqual(["A", "B", "C"]);
    expect(placeChild([a, c], b, null).map((n) => n.name)).toEqual(["A", "C", "B"]);
    expect(placeChild([a, c], b, b.path).map((n) => n.name)).toEqual(["A", "C", "B"]);
    expect(placeChild([a, c], b, "Work/missing").map((n) => n.name)).toEqual([
      "A",
      "C",
      "B",
    ]);
  });

  it("renames one entry in an order list", () => {
    expect(renameInOrder(["B", "A", "C"], "A", "Alpha")).toEqual(["B", "Alpha", "C"]);
  });

  it("reorders each node's children from that node's index contents; roots stay as given", () => {
    const tree: DocumentNode[] = [
      {
        name: "Work",
        path: "Work",
        indexPath: "Work/index.md",
        attachmentsPath: "Work/attachments",
        children: [child("A", "Work"), child("B", "Work")],
      },
      {
        name: "Inbox",
        path: "Inbox",
        indexPath: "Inbox/index.md",
        attachmentsPath: "Inbox/attachments",
        children: [],
      },
    ];
    const contents = new Map([
      [
        "Work/index.md",
        `<!-- nestnote:children:start -->
- [B](B/index.md)
- [A](A/index.md)
<!-- nestnote:children:end -->`,
      ],
    ]);
    const ordered = applyChildrenOrder(tree, contents);
    expect(ordered.map((n) => n.path)).toEqual(["Work", "Inbox"]);
    expect(ordered[0].children.map((n) => n.name)).toEqual(["B", "A"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/children-links.test.ts`

Expected: FAIL。旧排序测试若尚未改实现会先挂在「文档2 应在 文档1 前」；新符号未导出。

- [ ] **Step 3: 实现原语并去掉写入排序**

在 `src/domain/children-links.ts`：

1. 删除 `renderChildrenRegion` 里的 `[...children].sort((a, b) => a.name.localeCompare(b.name))`，改为按传入 `children` 原样 `map`。
2. 导出下列函数（围栏查找复用文件内已有 `findFencedCodeRanges` / `indexOfOutsideFences`）。

`parseChildrenOrder`：围栏外找第一对 start/end；找不到 start、或找不到匹配 end，返回 `[]`（不要 throw）。标记之间按行处理，行 trim 后匹配 `^- \[.*\]\((.+)\)$`（label 可含字符；不要用 label）。捕获的 path：`decodeURIComponent` 失败则用原串；反斜杠改 `/`；若最后一段是 `index.md` 且前面还有一段，则该段为文档名，否则忽略该行。

`mergeChildrenOrder`：按 `orderedNames` 从 `live` 里按 `name` 各取一次；剩余 live 按 `name.localeCompare` 追加；返回新数组。

`placeChild`：`insertBeforePath` 为 `null`/`undefined`/等于 `node.path`/不在 `siblings` 的 `path` 中 → 追加；否则插到该 path 之前。不要修改传入数组。

`renameInOrder`：把 `orderedNames` 里等于 `fromName` 的项换成 `toName`。

`applyChildrenOrder`：不重排传入的根数组。对每个 node，用 `indexContents.get(node.indexPath)` 做 `parseChildrenOrder`（缺文件当 `[]`），`mergeChildrenOrder` 得到新 `children`，再递归 `applyChildrenOrder`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/children-links.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add src/domain/children-links.ts tests/children-links.test.ts
git commit -m "feat(children-links): preserve child list order"
```

---

### Task 2: 父文档写入走 merge；新建末尾、重命名保位置

**Files:**
- Modify: `src/services/document-service.ts`
- Test: `tests/document-service.test.ts`

**Interfaces:**
- Consumes: `parseChildrenOrder`、`mergeChildrenOrder`、`renameInOrder`、`updateChildrenLinks`
- Produces: `computeParentWrite` / `freshParentWrite` 以文件中的顺序 merge live 子节点；`rename` 在 merge 前把旧名换成新名

- [ ] **Step 1: 写失败测试**

在 `tests/document-service.test.ts` 的 create 相关 `describe` 中追加（`workIndex` / `seedDocument` / `parentIndex` 已存在）：

```ts
  it("appends a new child after the existing custom child-link order", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
# Body
<!-- nestnote:children:start -->

- [B](B/index.md)
- [A](A/index.md)

<!-- nestnote:children:end -->
`,
      );
      seedDocument(vault, "Work/B", parentIndex("B"));
      seedDocument(vault, "Work/A", parentIndex("A"));
    });

    await service.create("Work", "C");

    const parent = app.vault.files.get("Work/index.md") ?? "";
    const start = parent.indexOf("<!-- nestnote:children:start -->");
    const end = parent.indexOf("<!-- nestnote:children:end -->");
    const region = parent.slice(start, end);
    expect(region.indexOf("- [B](B/index.md)")).toBeLessThan(
      region.indexOf("- [A](A/index.md)"),
    );
    expect(region.indexOf("- [A](A/index.md)")).toBeLessThan(
      region.indexOf("- [C](C/index.md)"),
    );
    expect(parent).toContain("# Body");
  });
```

在 rename 测试附近追加：

```ts
  it("keeps a renamed child in the same list position", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
<!-- nestnote:children:start -->

- [B](B/index.md)
- [A](A/index.md)

<!-- nestnote:children:end -->
`,
      );
      seedDocument(vault, "Work/B", parentIndex("B"));
      seedDocument(vault, "Work/A", parentIndex("A"));
    });

    await service.rename("Work/A", "Alpha");

    const parent = app.vault.files.get("Work/index.md") ?? "";
    expect(parent).toContain("- [B](B/index.md)");
    expect(parent).toContain("- [Alpha](Alpha/index.md)");
    expect(parent).not.toContain("- [A](A/index.md)");
    expect(parent.indexOf("- [B](B/index.md)")).toBeLessThan(
      parent.indexOf("- [Alpha](Alpha/index.md)"),
    );
  });
```

先在文件中搜现有 `rename(` 测试，紧挨着放；没有独立 describe 就放在 `NestNoteDocumentService` 主 describe 末尾、`move` describe 之前。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/document-service.test.ts`

Expected: FAIL。新建后列表被写成 A、B、C 或 C 插在按名称位置；重命名后 Alpha 被接到末尾或整表按名称排。

- [ ] **Step 3: 父文档写入改为 merge**

`src/services/document-service.ts` 增加 import：`parseChildrenOrder`、`mergeChildrenOrder`、`renameInOrder`（以及 Task 3 还要用的 `placeChild`，本任务可以先不 import `placeChild`）。

替换 `computeParentWrite` / `freshParentWrite`：

```ts
  private async freshParentWrite(parentPath: string): Promise<PendingWrite> {
    const parent = this.requireScannedNode(parentPath);
    return this.mergeParentWrite(parentPath, parent.children);
  }

  private async mergeParentWrite(
    parentPath: string,
    liveChildren: readonly DocumentNode[],
    orderedNames?: readonly string[],
  ): Promise<PendingWrite> {
    const indexFile = this.requireIndex(parentPath);
    const content = await this.app.vault.read(indexFile);
    const names = orderedNames ?? parseChildrenOrder(content);
    const ordered = mergeChildrenOrder(names, liveChildren);
    return this.writeParentChildren(parentPath, content, ordered);
  }

  private writeParentChildren(
    parentPath: string,
    content: string,
    children: readonly DocumentNode[],
  ): PendingWrite {
    const indexFile = this.requireIndex(parentPath);
    return {
      path: indexFile.path,
      content: this.runMetadata(() => {
        const withFrontmatter = ensureDocumentFrontmatter(content, {
          name: getName(parentPath),
          created: this.createdTimestamp(),
        });
        return updateChildrenLinks(withFrontmatter, parentPath, children);
      }),
    };
  }
```

删除旧的 `computeParentWrite`。所有 `assertParentWritable(..., children)` 仍可调用 `updateChildrenLinks` 做预演（不写盘）；预演不必强调顺序，但预演用的 children 应与即将写入的集合一致。把 `assertParentWritable` 改为读文件 merge 后再 `updateChildrenLinks`，避免未实现顺序时预演通过、写入却抛错。

`assertParentWritable` 最小改法：内部改为 `await this.mergeParentWrite(parentPath, children)` 并丢掉返回值（仍会读盘；不会 `modify`）。不要在 assert 里 `vault.modify`。

`rename` 在写父文档处不要 `freshParentWrite(parent)`。改为：

```ts
    if (parent !== null && this.isCompleteDocument(parent)) {
      const live = this.requireScannedNode(parent).children;
      const indexFile = this.requireIndex(parent);
      const content = await this.app.vault.read(indexFile);
      const names = renameInOrder(
        parseChildrenOrder(content),
        getName(from),
        documentName,
      );
      pendingWrites.push(await this.mergeParentWrite(parent, live, names));
    }
```

注意：`vault.rename` 已经发生，所以 `from` 的旧名来自 rename 开始时保存的 `getName(from)`；`live` 扫描结果里该节点已是新名。`mergeParentWrite` 第三参传入替换后的 names。

`create` / `trash` 继续 `freshParentWrite` 即可（新节点不在旧 names 里 → 末尾；删除的不在 live 里 → 消失）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/document-service.test.ts`

Expected: PASS（含原有 create/trash/rename）

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add src/services/document-service.ts tests/document-service.test.ts
git commit -m "fix(documents): keep custom child order on create and rename"
```

---

### Task 3: `move` 支持插入位置与同父重排

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/document-service.ts`
- Modify: `src/main.ts`（`wrapWithInternal` 传递第三参数）
- Test: `tests/document-service.test.ts`

**Interfaces:**
- Consumes: `placeChild`、`mergeChildrenOrder`、`parseChildrenOrder`、Task 2 的 `mergeParentWrite` / `writeParentChildren`
- Produces:

```ts
move(
  documentPath: string,
  newParentPath: string | null,
  insertBeforePath?: string | null,
): Promise<DocumentNode>
```

- [ ] **Step 1: 写失败测试**

在 `describe("NestNoteDocumentService.move")` 追加：

```ts
  it("reorders siblings in the parent list without renaming", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
<!-- nestnote:children:start -->

- [A](A/index.md)
- [B](B/index.md)
- [C](C/index.md)

<!-- nestnote:children:end -->
`,
      );
      seedDocument(vault, "Work/A", parentIndex("A"));
      seedDocument(vault, "Work/B", parentIndex("B"));
      seedDocument(vault, "Work/C", parentIndex("C"));
    });

    const node = await service.move("Work/C", "Work", "Work/A");

    expect(node.path).toBe("Work/C");
    expect(app.vault.renameCalls).toEqual([]);
    const parent = app.vault.files.get("Work/index.md") ?? "";
    expect(parent.indexOf("- [C](C/index.md)")).toBeLessThan(
      parent.indexOf("- [A](A/index.md)"),
    );
    expect(parent.indexOf("- [A](A/index.md)")).toBeLessThan(
      parent.indexOf("- [B](B/index.md)"),
    );
  });

  it("does not write when the sibling is already in the requested position", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
<!-- nestnote:children:start -->

- [A](A/index.md)
- [B](B/index.md)

<!-- nestnote:children:end -->
`,
      );
      seedDocument(vault, "Work/A", parentIndex("A"));
      seedDocument(vault, "Work/B", parentIndex("B"));
    });
    const before = app.vault.files.get("Work/index.md");
    await service.move("Work/A", "Work", "Work/B");
    await service.move("Work/B", "Work", "Work/B");
    expect(app.vault.renameCalls).toEqual([]);
    expect(app.vault.files.get("Work/index.md")).toBe(before);
  });

  it("inserts at the given sibling when moving to a new parent", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
<!-- nestnote:children:start -->

- [Keep](Keep/index.md)

<!-- nestnote:children:end -->
`,
      );
      seedDocument(
        vault,
        "Office",
        `---
name: Office
created: 2020-01-01T00:00:00Z
---
<!-- nestnote:children:start -->

- [B](B/index.md)
- [A](A/index.md)

<!-- nestnote:children:end -->
`,
      );
      seedDocument(vault, "Work/Keep", parentIndex("Keep"));
      seedDocument(vault, "Office/B", parentIndex("B"));
      seedDocument(vault, "Office/A", parentIndex("A"));
    });

    await service.move("Work/Keep", "Office", "Office/A");

    expect(app.vault.renameCalls).toEqual([
      { from: "Work/Keep", to: "Office/Keep" },
    ]);
    expect(app.vault.files.get("Work/index.md")).not.toContain("Keep");
    const office = app.vault.files.get("Office/index.md") ?? "";
    expect(office.indexOf("- [B](B/index.md)")).toBeLessThan(
      office.indexOf("- [Keep](Keep/index.md)"),
    );
    expect(office.indexOf("- [Keep](Keep/index.md)")).toBeLessThan(
      office.indexOf("- [A](A/index.md)"),
    );
  });

  it("ignores insert position when moving to the vault root", async () => {
    const { app, service } = createHarness((vault) => {
      seedDocument(vault, "Work", workIndex());
      seedDocument(vault, "Inbox", parentIndex("Inbox"));
      seedDocument(vault, "Work/Notes", parentIndex("Notes"));
    });
    const rooted = await service.move("Work/Notes", null, "Inbox");
    expect(rooted.path).toBe("Notes");
    expect(app.vault.getFolderByPath("Notes")).not.toBeNull();
  });
```

现有 `"returns the same node without renaming when already under that parent"` 覆盖 `move("Work/Notes", "Work")`（无第三参 = 末尾）。若 Notes 已在列表末尾，应仍 no-op。`workIndex()` 默认没有 children 链接，Notes 作为未知项 merge 后只有它自己，接到末尾与 current 相同 → 不写盘。保持该测试。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/document-service.test.ts`

Expected: FAIL。同父 `move` 仍提前 return，列表不变。

- [ ] **Step 3: 扩展 `move` 与类型**

`src/types.ts`：

```ts
  move(
    documentPath: string,
    newParentPath: string | null,
    insertBeforePath?: string | null,
  ): Promise<DocumentNode>;
```

`src/main.ts` 的 `wrapWithInternal`：

```ts
    move: (documentPath, newParentPath, insertBeforePath) =>
      coordinator.runInternal(() =>
        inner.move(documentPath, newParentPath, insertBeforePath),
      ),
```

`move` 实现替换同父提前 return。结构：

```ts
  async move(
    documentPath: string,
    newParentPath: string | null,
    insertBeforePath?: string | null,
  ): Promise<DocumentNode> {
    const from = this.requireDocument(documentPath);
    const newParent = this.resolveParent(newParentPath);
    const oldParent = getParentPath(from);

    if (oldParent === newParent) {
      if (newParent === null) {
        return this.requireScannedNode(from);
      }
      if (insertBeforePath === from) {
        return this.requireScannedNode(from);
      }
      return this.reorderUnderParent(from, newParent, insertBeforePath);
    }

    // 现有换父拒绝条件 + rename 不变
    // 写旧父：mergeParentWrite(oldParent, liveWithoutSource)
    // 写新父（非根）：见下
  }
```

`reorderUnderParent(from, parentPath, insertBeforePath)`：

1. 读父 index；`live = requireScannedNode(parentPath).children`（含源）
2. `current = mergeChildrenOrder(parseChildrenOrder(content), live)`
3. `without = current.filter((c) => c.path !== from)`
4. `source = current.find((c) => c.path === from)`，找不到则 `requireScannedNode(from)`
5. `next = placeChild(without, source, insertBeforePath ?? null)`
6. 若 `next.map(c => c.path)` 与 `current` 相同：return `requireScannedNode(from)`，不 `modify`
7. 否则 `flushWrites([writeParentChildren(parentPath, content, next)])`

换父成功 rename 之后，新父（非 null）：

```ts
    const live = this.requireScannedNode(newParent).children; // 已含搬过去的节点
    const indexFile = this.requireIndex(newParent);
    const content = await this.app.vault.read(indexFile);
    const without = live.filter((c) => c.path !== to);
    const merged = mergeChildrenOrder(parseChildrenOrder(content), without);
    const moved = live.find((c) => c.path === to);
    if (moved === undefined) {
      throw new DocumentServiceError(t("error.documentNotFound", { path: to }));
    }
    const next = placeChild(merged, moved, insertBeforePath ?? null);
    pendingWrites.push(this.writeParentChildren(newParent, content, next));
```

旧父：`mergeParentWrite(oldParent, requireScannedNode(oldParent).children)`。

目标为根时不写新父，忽略 `insertBeforePath`。

换父预演 `assertParentWritable`：新父用 `placeChild(merge(...), preview, insertBeforePath)` 的集合，避免预演与写入不一致。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/document-service.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add src/types.ts src/services/document-service.ts src/main.ts tests/document-service.test.ts
git commit -m "feat(documents): reorder siblings via move insert position"
```

---

### Task 4: 扫描后应用顺序，自动修正不再按名称重排

**Files:**
- Modify: `src/main.ts`
- Test: `tests/plugin-lifecycle.test.ts`

**Interfaces:**
- Consumes: `applyChildrenOrder`、`scanFromApp`、`syncDocumentMetadata`
- Produces: `performScanAndSync` 在 auto-fix 之前对 depth-9 树和 UI 树都 `applyChildrenOrder`

- [ ] **Step 1: 写失败测试**

在 `tests/plugin-lifecycle.test.ts` 现有 auto-fix 用例附近增加：

```ts
  it("keeps custom child-link order when auto-fix rewrites the region", async () => {
    vi.useFakeTimers();
    const app = createApp((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
created: 2020-01-01T00:00:00Z
---
# Body
<!-- nestnote:children:start -->
- [B](B/index.md)
- [A](A/index.md)
<!-- nestnote:children:end -->
`,
      );
      seedDocument(
        vault,
        "Work/A",
        `---
name: A
created: 2020-01-01T00:00:00Z
---
`,
      );
      seedDocument(
        vault,
        "Work/B",
        `---
name: B
created: 2020-01-01T00:00:00Z
---
`,
      );
    });
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    const content = app.vault.files.get("Work/index.md") ?? "";
    expect(content).toContain("name: Work");
    expect(content.indexOf("- [B](B/index.md)")).toBeLessThan(
      content.indexOf("- [A](A/index.md)"),
    );

    command(plugin, "nestnote:refresh")();
    await settle();
    const again = app.vault.files.get("Work/index.md") ?? "";
    expect(again.indexOf("- [B](B/index.md)")).toBeLessThan(
      again.indexOf("- [A](A/index.md)"),
    );
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/plugin-lifecycle.test.ts`

Expected: FAIL。auto-fix 把列表写成 A 再 B。

- [ ] **Step 3: 扫描后 apply order**

`src/main.ts` import `applyChildrenOrder`。

在 `scanFromApp` 旁增加：

```ts
function collectIndexPaths(nodes: readonly DocumentNode[]): string[] {
  return nodes.flatMap((node) => [
    node.indexPath,
    ...collectIndexPaths(node.children),
  ]);
}

async function readIndexContents(
  app: App,
  nodes: readonly DocumentNode[],
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();
  for (const indexPath of collectIndexPaths(nodes)) {
    const file = getFile(app, indexPath);
    if (file === null) {
      continue;
    }
    try {
      contents.set(indexPath, await app.vault.read(file));
    } catch {
      // 该级回退按名称：applyChildrenOrder 在缺内容时 parse 为空
    }
  }
  return contents;
}
```

`performScanAndSync` 的 `runInternal` 内：

```ts
        const metadataRaw = scanFromApp(this.app, 9);
        const contents = await readIndexContents(this.app, metadataRaw);
        const metadataNodes = applyChildrenOrder(metadataRaw, contents);
        this.nodes = applyChildrenOrder(
          scanFromApp(this.app, this.settings.maxChildDepth),
          contents,
        );
        if (this.settings.autoFixDocumentFormat) {
          await syncDocumentMetadata(this.app, metadataNodes);
        }
```

`getFile` 已在 `main.ts` 使用。不要在读失败时 throw。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/plugin-lifecycle.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add src/main.ts tests/plugin-lifecycle.test.ts
git commit -m "feat(scan): apply index child order before auto-fix"
```

---

### Task 5: 面板行热区：前/后插入与正中嵌套

**Files:**
- Modify: `src/ui/document-tree-view.ts`
- Modify: `styles.css`
- Test: `tests/document-tree-view.test.ts`

**Interfaces:**
- Consumes: `documents.move(source, newParentPath, insertBeforePath)`
- Produces: 行上沿 → 同级插到目标前；行下沿 → 同级插到目标后；行正中/根整行 → 成为目标子文档；树空白 → 根；自己的前/后不调用 `move`

- [ ] **Step 1: 扩展拖放 helper 并写失败测试**

在 `tests/document-tree-view.test.ts` 把 `dispatchDrag` 改为接受可选 `clientY`，并在创建 `DragEvent` 时写入：

```ts
function dispatchDrag(
  target: EventTarget,
  type: string,
  path?: string,
  clientY = 0,
): DragEvent {
  // 现有 dataTransfer 逻辑不变
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "clientY", { value: clientY });
  target.dispatchEvent(event);
  return event;
}

function stubRowRect(rowEl: HTMLElement, height = 40): void {
  rowEl.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: height,
      width: 100,
      height,
      toJSON() {
        return {};
      },
    }) as DOMRect;
}
```

更新现有断言（实现改为总是传第三参后，两参数匹配会失败）：

- `"moves a document when dropped on another row"`：`Work` 是根，整行都是嵌套 → `toHaveBeenCalledWith("Inbox", "Work", null)`
- `"keeps the tree and notifies when move rejects"`：同样 `("Inbox", "Work", null)`
- `"moves a document to the vault root..."`：`toHaveBeenCalledWith("Work/Notes", null, null)` 或 `("Work/Notes", null)`。计划要求 `handleDrop` 对根目标传 `insertBeforePath` 为 `null`，统一三参数：`("Work/Notes", null, null)`

追加用例。用三节点树，避免只靠根行：

```ts
  const siblingTree: DocumentNode[] = [
    node("Work", "Work", [
      node("A", "Work/A"),
      node("B", "Work/B"),
      node("C", "Work/C"),
    ]),
  ];

  it("inserts before a non-root row when dropped on the top quarter", async () => {
    const moved = node("C", "Work/C");
    const { documents } = await mount({
      nodes: siblingTree,
      documents: { move: vi.fn().mockResolvedValue(moved) },
    });
    const rowEl = nodeRow("Work/A");
    stubRowRect(rowEl);
    dispatchDrag(rowEl, "drop", "Work/C", 5);
    await flush();
    expect(documents.move).toHaveBeenCalledWith("Work/C", "Work", "Work/A");
  });

  it("inserts after a non-root row when dropped on the bottom quarter", async () => {
    const moved = node("A", "Work/A");
    const { documents } = await mount({
      nodes: siblingTree,
      documents: { move: vi.fn().mockResolvedValue(moved) },
    });
    const rowEl = nodeRow("Work/B");
    stubRowRect(rowEl);
    dispatchDrag(rowEl, "drop", "Work/A", 35);
    await flush();
    expect(documents.move).toHaveBeenCalledWith("Work/A", "Work", "Work/C");
  });

  it("nests into a non-root row when dropped on the middle", async () => {
    const moved = node("C", "Work/B/C");
    const { documents } = await mount({
      nodes: siblingTree,
      documents: { move: vi.fn().mockResolvedValue(moved) },
    });
    const rowEl = nodeRow("Work/B");
    stubRowRect(rowEl);
    dispatchDrag(rowEl, "drop", "Work/C", 20);
    await flush();
    expect(documents.move).toHaveBeenCalledWith("Work/C", "Work/B", null);
  });

  it("does not move when dropped on the source row before or after zones", async () => {
    const { documents } = await mount({ nodes: siblingTree });
    const rowEl = nodeRow("Work/B");
    stubRowRect(rowEl);
    dispatchDrag(rowEl, "drop", "Work/B", 5);
    dispatchDrag(rowEl, "drop", "Work/B", 35);
    await flush();
    expect(documents.move).not.toHaveBeenCalled();
  });

  it("treats a root row as nest-only even on the top quarter", async () => {
    const moved = node("Inbox", "Work/Inbox");
    const { documents } = await mount({
      documents: { move: vi.fn().mockResolvedValue(moved) },
    });
    const rowEl = nodeRow("Work");
    stubRowRect(rowEl);
    dispatchDrag(rowEl, "drop", "Inbox", 5);
    await flush();
    expect(documents.move).toHaveBeenCalledWith("Inbox", "Work", null);
  });
```

下沿用例：目标 `Work/B`，源 `Work/A`，下一个兄弟是 `Work/C`（源不是下一项）。`insertBeforePath` 为 `Work/C`。

再加：源是视觉上下一项时跳过源。树 A、B、C，拖 `B` 放到 `A` 下沿：下一兄弟是 B（源），应再取 C → `move("Work/B", "Work", "Work/C")`。若 B 已在 A 后，服务层会 no-op，但面板仍应调用（位置计算在面板；是否写盘在服务）。Spec 3.2 说「源自己不算下一个兄弟」。加上：

```ts
  it("skips the source when resolving the next sibling for an after-drop", async () => {
    const { documents } = await mount({
      nodes: siblingTree,
      documents: { move: vi.fn().mockResolvedValue(node("B", "Work/B")) },
    });
    const rowEl = nodeRow("Work/A");
    stubRowRect(rowEl);
    dispatchDrag(rowEl, "drop", "Work/B", 35);
    await flush();
    expect(documents.move).toHaveBeenCalledWith("Work/B", "Work", "Work/C");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- tests/document-tree-view.test.ts`

Expected: FAIL。现有 drop 仍 `move(源, 目标路径)` 两参数；上沿也会变成嵌套。

- [ ] **Step 3: 实现热区、高亮、三参数 drop**

`styles.css` 在现有 `.is-drop-target` 旁增加（行顶/行底插入线，用 `--interactive-accent`）：

```css
.nestnote-node.is-drop-before > .nestnote-row {
  box-shadow: inset 0 2px 0 0 var(--interactive-accent);
}

.nestnote-node.is-drop-after > .nestnote-row {
  box-shadow: inset 0 -2px 0 0 var(--interactive-accent);
}
```

`document-tree-view.ts`：

热区枚举只用于内部：`"before" | "after" | "into"`。

从 `event.clientY` 与**该节点 `.nestnote-row`** 的 `getBoundingClientRect()` 计算（不要用整个 `li`，展开后 li 含子孙）。`y = clientY - rect.top`；`y < height * 0.25` → before；`y >= height * 0.75` → after；否则 into。高度为 0 时当作 into。

根节点（`this.nodes` 里顶层 path 集合，或 path 不含 `/`）：永远 into。

`dragover`（在 `item` 上）：`preventDefault` + `stopPropagation`；`clearDropHighlights`；若事件目标在该节点的 `.nestnote-children` 内且不是当前 row，高亮 `is-drop-target`（接到该文档末尾）。否则按热区给 `item` 加 `is-drop-before` / `is-drop-after` / `is-drop-target`（根只有 target）。

`clearDropHighlights` 同时去掉 `is-drop-before`、`is-drop-after`、`is-drop-target`、`is-drop-root`。

`drop`（在 `item` 上）：解析 source；若 before/after 且 `sourcePath === node.path`，return。否则：

| 热区 | `newParentPath` | `insertBeforePath` |
|------|-----------------|-------------------|
| before（非根） | 目标父路径（最后一个 `/` 之前；无则 `null`，但非根必有父） | `node.path` |
| after（非根） | 同上 | `nextSiblingPath(node.path, sourcePath)` |
| into，或落在 `.nestnote-children` 空白 | `node.path` | `null` |

`nextSiblingPath`：在 `this.nodes` 找到与目标同父的数组，目标下标之后第一个 `path !== sourcePath` 的节点；没有则 `null`。

树容器 `drop`：`move(source, null, null)`（已在 node 上 stopPropagation）。

`handleDrop(sourcePath, newParentPath, insertBeforePath)` 调用 `documents.move(sourcePath, newParentPath, insertBeforePath ?? null)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- tests/document-tree-view.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add src/ui/document-tree-view.ts styles.css tests/document-tree-view.test.ts
git commit -m "feat(sidebar): drag siblings to reorder"
```

---

### Task 6: README 去掉「同级按名称排序」

**Files:**
- Modify: `README_zh.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: spec 第 8 节
- Produces: 侧边栏操作表与子文档链接段与自动修正说明与实现一致

- [ ] **Step 1: 改中文 README**

`README_zh.md` 操作表「调整嵌套」行改为：

```markdown
| 调整嵌套与顺序 | 拖到另一份文档上成为其子文档；拖到树的空白处成为根文档。拖到同级文档的上方或下方可排序。根文档仍按名称排序 |
```

子文档链接段中「新建、删除、重命名或移动子文档时，只更新这两行标记之间的列表，并按文档名排序。」改为：

```markdown
新建、删除、重命名或移动子文档时，只更新这两行标记之间的列表。顺序与侧边栏一致：自定义顺序写在标记区内，新建接到末尾；扫描和自动修正会保留该顺序，只补缺失、删失效链接，并写成规范空行。列表与两个标记之间各空一行；即使没有空行，也不影响解析。链接是普通的相对路径，名称里的空格会写成 `%20`。你在正文里手写的链接不会被扫描、删除或改写。若开启「自动修正文档格式」（默认开启），扫描时也会把这段区域写成规范格式；找不到标记时插在头部后面。关闭该选项后，扫描不再改已有文件。
```

不要保留「按文档名排序」。设置表里自动修正那行若仍写「规范格式」且未声称按名称排，可不动。

- [ ] **Step 2: 改英文 README**

操作表 `Reparent` 行改为同时说明 reorder：

```markdown
| Reparent and reorder | Drag onto another document to nest it, or onto empty space in the tree to make it a root. Drag above or below a sibling to reorder. Root documents stay sorted by name |
```

Child document links 段中 `sorted by document name` 改为与中文对应：列表顺序与侧边栏相同；新 child 追加在末尾；scans/auto-fix 保留该顺序，只补缺失、删失效、写成规范空行。

- [ ] **Step 3: 全量测试**

Run: `npm test`

Expected: PASS

- [ ] **Step 4: Commit**（用户未要求则跳过）

```bash
git add README.md README_zh.md
git commit -m "docs: describe sidebar sibling reorder"
```

---

## Self-review

**Spec coverage**

| Spec | Task |
|------|------|
| 标记区为顺序来源；根按名称 | 1 `applyChildrenOrder` 不重排根；4 扫描；3 根 move 忽略位置 |
| 新建末尾；rename 保位置 | 2 |
| 扫描/自动修正保留顺序 | 1 merge + 4 apply-before-sync |
| 手改列表生效 | 4 读 index 顺序 |
| 行 25/50/25 热区；根无前/后 | 5 |
| 自己前/后不 `move` | 5 |
| `move` 第三参；同父重排；换父插入 | 3 |
| 非法 insertBefore 追加；同父等于源 no-op | 1 `placeChild` + 3 |
| 不新增 i18n | 全任务 |
| README | 6 |
| 面板测试 clientY | 5 |

**Type consistency:** `move(..., insertBeforePath?: string | null)` 在 types、service、wrapWithInternal、view 中相同。`parseChildrenOrder` 返回 `string[]`（文档名）。`placeChild` 按 `path` 匹配。
