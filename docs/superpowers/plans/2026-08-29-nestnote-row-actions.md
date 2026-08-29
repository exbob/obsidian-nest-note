# NestNote 文档行操作精简 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文档行只保留「新建子文档」和「更多」；重命名与删除放进 Obsidian `Menu`；去掉「打开」按钮。

**Architecture:** `DocumentTreeView.buildNode` 只渲染两个操作按钮。点击「更多」构造 `Menu` 并 `showAtMouseEvent`。测试用 `tests/obsidian-stub.ts` 把菜单渲染进 DOM，以便点击菜单项。

**Tech Stack:** Obsidian Plugin API（`Menu`）、Vitest + happy-dom、现有 `DocumentTreeView` DOM 测试。

## Global Constraints

- 唯一 UI 模式：`setIcon()` + `aria-label` + `.nestnote-*` 类名，不引入 UI 框架。
- 重命名/删除继续走现有 Modal，不改 `DocumentService`。
- 用户未要求提交时不创建 git commit。

---

### Task 1: 测试与 Menu stub

**Files:**
- Modify: `tests/obsidian-stub.ts`
- Modify: `tests/document-tree-view.test.ts`

**Interfaces:**
- Consumes: 现有 `action(path, label)` 按行内 `aria-label` 查找按钮
- Produces: stub `Menu` 在 `showAtMouseEvent` 后于 `document.body` 渲染 `.menu`；菜单项 `aria-label` 为「重命名」「删除」

- [ ] **Step 1: 在 stub 中加入 Menu**

`tests/obsidian-stub.ts` 增加：

```ts
export class MenuItem {
  title = "";
  icon = "";
  clickHandler: ((evt: MouseEvent) => unknown) | null = null;

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }

  onClick(callback: (evt: MouseEvent) => unknown): this {
    this.clickHandler = callback;
    return this;
  }
}

export class Menu {
  private readonly items: MenuItem[] = [];

  addItem(cb: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    cb(item);
    this.items.push(item);
    return this;
  }

  showAtMouseEvent(_event: MouseEvent): void {
    document.querySelector(".menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "menu";
    for (const item of this.items) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", item.title);
      if (item.icon !== "") {
        button.dataset.icon = item.icon;
      }
      button.addEventListener("click", (event) => {
        item.clickHandler?.(event);
      });
      menu.append(button);
    }
    document.body.append(menu);
  }
}
```

- [ ] **Step 2: 改写树视图测试（先失败）**

`tests/document-tree-view.test.ts`：

- 删除 `opens a document from the node open action`。
- 增加 helper：`function menuItem(path: string, label: string)`：点击该行「更多」，再取 `.menu [aria-label="${label}"]`。
- 「重命名」「删除」相关用例改为 `menuItem(...).click()`。
- 可访问性用例：行上标签为 `["新建子文档", "更多"]`；断言没有「打开」。
- 保留「点击文档名打开」。

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test -- tests/document-tree-view.test.ts`

Expected: FAIL，缺少「更多」或仍存在「打开」。

---

### Task 2: 行操作实现

**Files:**
- Modify: `src/ui/document-tree-view.ts`
- Modify: `README.md`（侧边栏操作表）

**Interfaces:**
- Consumes: `Menu` from `"obsidian"`
- Produces: 行操作「新建子文档」「更多」；菜单项触发现有 `openNameModal` / `openTrashModal`

- [ ] **Step 1: 实现行操作**

`src/ui/document-tree-view.ts`：

- `import { ItemView, Menu, Modal, setIcon } from "obsidian";`
- `actions.append` 只保留新建子文档按钮，以及：

```ts
iconButton("ellipsis-vertical", "更多", (event) => {
  event.stopPropagation();
  const menu = new Menu();
  menu.addItem((item) => {
    item.setTitle("重命名");
    item.setIcon("pencil");
    item.onClick(() => {
      this.openNameModal("重命名", node.name, (name) =>
        this.options.documents.rename(node.path, name),
      );
    });
  });
  menu.addItem((item) => {
    item.setTitle("删除");
    item.setIcon("trash-2");
    item.onClick(() => {
      this.openTrashModal(node);
    });
  });
  menu.showAtMouseEvent(event);
});
```

去掉 `file-text` / 「打开」按钮。

- [ ] **Step 2: 跑测试确认通过**

Run: `npm test`

Expected: PASS

- [ ] **Step 3: 更新 README**

侧边栏操作表：

| 打开文档 | 点击侧边栏中的文档名称 |
| 重命名 | 侧边栏文档行「更多」→ 重命名 |
| 删除 | 侧边栏文档行「更多」→ 删除；**任何删除均需确认** |

- [ ] **Step 4: 类型检查**

Run: `npx tsc --noEmit`

Expected: 无错误
