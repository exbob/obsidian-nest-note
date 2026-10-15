# 资源管理器空白处新建文件夹 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在资源管理器空白处右键菜单增加「新建文件夹」，用户填写名称后在当前浏览路径创建文件夹，刷新并选中它。

**Architecture:** 文案进入现有 `zh` / `en` 目录。`NestNoteFileExplorerService.createFolder` 负责校验和 `vault.createFolder`。`FileExplorerView` 只增加空白处菜单项、本地命名对话框，以及把服务错误映射成 Notice。不改条目菜单，不抽公共对话框。

**Tech Stack:** Obsidian `Menu` / `Modal` / `setIcon`、现有 i18n `t()`、Vitest + happy-dom、`tests/obsidian-stub.ts`。

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-15-file-explorer-new-folder-design.md`
- 空白处菜单顺序：`新建文件夹`、分隔线、`粘贴`。图标 `folder-plus`
- 条目右键仍为：插入文档、分隔线、复制、分隔线、删除
- 对话框标题 `ui.newFolder`；输入框 `aria-label` 为 `ui.folderName`；空名称（trim 后）不提交、不关闭
- `createFolder(documentPath: string, relativeWithinRoot: string, name: string): Promise<void>`
- 非法名（trim 后为空、`.`、`..`、含 `/` 或 `\`）抛 `new Error(t("notice.folderNameInvalid"))`，不调用 `vault.createFolder`
- 同名大小写不敏感，检测范围与 `existingNamesLower` 相同；抛 `new Error(t("notice.folderExists"))`
- 其余失败 Notice `notice.createFolderFailed`
- 成功后 `refresh(false)`，选中 trim 后的名称，停留在当前路径，不进入新文件夹
- 中英文文案以 spec 第 6 节表格为准，不复用 `error.nameInvalid` 或 `notice.pasteConflict`
- Tests: `npm test`（Windows PowerShell）。用户未明确要求时跳过每个 Task 末尾的 git commit（本仓库规则）

## File map

- `src/i18n/types.ts`、`src/i18n/zh.ts`、`src/i18n/en.ts` — 五个新文案键
- `tests/i18n.test.ts` — 中英文断言
- `src/services/file-explorer-service.ts` — `createFolder`
- `tests/file-explorer-service.test.ts` — 校验与创建
- `src/ui/file-explorer-view.ts` — 菜单、对话框、错误映射
- `tests/file-explorer-view.test.ts` — 菜单、提交、取消、选中、Notice

---

### Task 1: 中英文文案

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Test: `tests/i18n.test.ts`

**Interfaces:**
- Consumes: 现有 `t(key: MessageKey)` 与 `setLocaleForTests`
- Produces: `ui.newFolder`、`ui.folderName`、`notice.folderNameInvalid`、`notice.folderExists`、`notice.createFolderFailed`

- [ ] **Step 1: 写失败测试**

在 `tests/i18n.test.ts` 的 `describe("t")` 内、`afterEach` 之后加入：

```ts
it("translates new-folder copy in zh and en", () => {
  setLocaleForTests("zh");
  expect(t("ui.newFolder")).toBe("新建文件夹");
  expect(t("ui.folderName")).toBe("文件夹名称");
  expect(t("notice.folderNameInvalid")).toBe("文件夹名称无效");
  expect(t("notice.folderExists")).toBe("当前路径已存在同名文件或文件夹");
  expect(t("notice.createFolderFailed")).toBe("无法创建文件夹");

  setLocaleForTests("en");
  expect(t("ui.newFolder")).toBe("New folder");
  expect(t("ui.folderName")).toBe("Folder name");
  expect(t("notice.folderNameInvalid")).toBe("Invalid folder name");
  expect(t("notice.folderExists")).toBe(
    "A file or folder with that name already exists",
  );
  expect(t("notice.createFolderFailed")).toBe("Could not create the folder");
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/i18n.test.ts -t "translates new-folder copy"`

Expected: FAIL。`t("ui.newFolder")` 得不到「新建文件夹」（键尚未进入目录，返回值为空）。

- [ ] **Step 3: 加入三份目录**

`src/i18n/types.ts` 的 `MESSAGE_KEYS`：在 `"ui.paste"` 后加入 `"ui.newFolder"`、`"ui.folderName"`；在 `"notice.pasteFailed"` 后加入三个 notice 键。

```ts
  "ui.paste",
  "ui.newFolder",
  "ui.folderName",
  "ui.childrenHeading",
```

```ts
  "notice.pasteFailed",
  "notice.folderNameInvalid",
  "notice.folderExists",
  "notice.createFolderFailed",
  "error.targetExists",
```

`src/i18n/zh.ts` 同样位置：

```ts
  "ui.paste": "粘贴",
  "ui.newFolder": "新建文件夹",
  "ui.folderName": "文件夹名称",
  "ui.childrenHeading": "子文档",
```

```ts
  "notice.pasteFailed": "无法粘贴文件",
  "notice.folderNameInvalid": "文件夹名称无效",
  "notice.folderExists": "当前路径已存在同名文件或文件夹",
  "notice.createFolderFailed": "无法创建文件夹",
  "error.targetExists": "目标已存在：{path}",
```

`src/i18n/en.ts` 同样位置：

```ts
  "ui.paste": "Paste",
  "ui.newFolder": "New folder",
  "ui.folderName": "Folder name",
  "ui.childrenHeading": "Child Document",
```

```ts
  "notice.pasteFailed": "Could not paste the file",
  "notice.folderNameInvalid": "Invalid folder name",
  "notice.folderExists": "A file or folder with that name already exists",
  "notice.createFolderFailed": "Could not create the folder",
  "error.targetExists": "Target already exists: {path}",
```

三份数组/对象的键集合必须一致，否则已有用例 `uses the same keys in zh, en, and MESSAGE_KEYS` 会失败。

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/i18n.test.ts`

Expected: PASS

---

### Task 2: 服务创建文件夹

**Files:**
- Modify: `src/services/file-explorer-service.ts`
- Test: `tests/file-explorer-service.test.ts`

**Interfaces:**
- Consumes: `vaultPath`、`existingNamesLower`、`vault.createFolder`、Task 1 的 notice 文案
- Produces:

```ts
async createFolder(
  documentPath: string,
  relativeWithinRoot: string,
  name: string,
): Promise<void>
```

- [ ] **Step 1: 写失败测试**

在 `tests/file-explorer-service.test.ts` 的 `describe` 末尾、最后一个 `});` 之前加入：

```ts
it("creates a trimmed folder in the current relative path", async () => {
  const fake = createFakeVault(["Doc", "Doc/assets", "Doc/assets/sub"]);
  const createFolder = vi.spyOn(fake.vault, "createFolder");
  const { service } = createService(fake);
  await service.createFolder("Doc", "sub", "  notes  ");
  expect(createFolder).toHaveBeenCalledWith("Doc/assets/sub/notes");
  expect(fake.folders.has("Doc/assets/sub/notes")).toBe(true);
});

it.each(["", "   ", ".", "..", "a/b", "a\\b"])(
  "rejects invalid folder name %j",
  async (name) => {
    const fake = createFakeVault(["Doc", "Doc/assets"]);
    const createFolder = vi.spyOn(fake.vault, "createFolder");
    const { service } = createService(fake);
    await expect(service.createFolder("Doc", "", name)).rejects.toThrow(
      t("notice.folderNameInvalid"),
    );
    expect(createFolder).not.toHaveBeenCalled();
  },
);

it("rejects a file or folder that differs only by case", async () => {
  const fake = createFakeVault(["Doc", "Doc/assets", "Doc/assets/Pics"], {
    "Doc/assets/Photo.PNG": "",
  });
  const createFolder = vi.spyOn(fake.vault, "createFolder");
  const { service } = createService(fake);
  await expect(service.createFolder("Doc", "", "pics")).rejects.toThrow(
    t("notice.folderExists"),
  );
  await expect(service.createFolder("Doc", "", "photo.png")).rejects.toThrow(
    t("notice.folderExists"),
  );
  expect(createFolder).not.toHaveBeenCalled();
});

it("rejects a hidden name reported only by adapter.list", async () => {
  const fake = createFakeVault(["Doc", "Doc/assets"]);
  fake.vault.adapter.list = async () => ({
    files: ["Doc/assets/.Secret"],
    folders: [],
  });
  const createFolder = vi.spyOn(fake.vault, "createFolder");
  const { service } = createService(fake);
  await expect(service.createFolder("Doc", "", ".secret")).rejects.toThrow(
    t("notice.folderExists"),
  );
  expect(createFolder).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/file-explorer-service.test.ts -t "folder"`

Expected: FAIL。`service.createFolder is not a function`。

- [ ] **Step 3: 实现 `createFolder`**

在 `NestNoteFileExplorerService` 中、`trashEntry` 之后加入。非法名与冲突都在调用 `vault.createFolder` 之前返回。同名检测只走已有的 `existingNamesLower`。

```ts
async createFolder(
  documentPath: string,
  relativeWithinRoot: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (
    trimmed === "" ||
    trimmed === "." ||
    trimmed === ".." ||
    /[/\\]/.test(trimmed)
  ) {
    throw new Error(t("notice.folderNameInvalid"));
  }
  const existing = await this.existingNamesLower(
    documentPath,
    relativeWithinRoot,
  );
  if (existing.has(trimmed.toLowerCase())) {
    throw new Error(t("notice.folderExists"));
  }
  await this.deps.vault.createFolder(
    this.vaultPath(documentPath, relativeWithinRoot, trimmed),
  );
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/file-explorer-service.test.ts`

Expected: PASS

---

### Task 3: 空白处菜单与命名对话框

**Files:**
- Modify: `src/ui/file-explorer-view.ts`
- Test: `tests/file-explorer-view.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `service.createFolder(documentPath, relativeWithinRoot, name)`；Task 1 的文案
- Produces: 空白处菜单第一项调用本地 `NestNoteFolderNameModal`；成功后 `this.selected = name` 再 `refresh(false)`

- [ ] **Step 1: 改菜单期望并写行为测试**

把 `tests/file-explorer-view.test.ts` 里的用例 `offers paste only on the blank area context menu` 换成：

```ts
it("orders the blank area context menu: new folder, then paste", async () => {
  await mount();
  openBlankContextMenu();
  expect(menuStructure()).toEqual([
    t("ui.newFolder"),
    "separator",
    t("ui.paste"),
  ]);
  const item = document.querySelector(
    `.menu [aria-label="${t("ui.newFolder")}"]`,
  );
  expect(item).toBeInstanceOf(HTMLElement);
  expect((item as HTMLElement).dataset.icon).toBe("folder-plus");
});
```

`openBlankContextMenu` 目前定义在该用例后面。把函数挪到 `openContextMenu` 旁边，删除原位置的内嵌函数，让后面的粘贴用例继续调用它。

在 `fakeService` 的默认对象里、`pasteAbsolutePaths` 之后加入：

```ts
createFolder: vi.fn().mockResolvedValue(undefined),
```

在文件末尾的 `describe` 结束前加入：

```ts
async function submitFolderName(name: string): Promise<void> {
  const modal = document.querySelector(".nestnote-modal");
  if (!(modal instanceof HTMLElement)) {
    throw new Error("modal was not opened");
  }
  const input = modal.querySelector("input");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("name input missing");
  }
  input.value = name;
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  await flush();
}

function cancelFolderModal(): void {
  const cancel = document.querySelector(
    `.nestnote-modal [aria-label="${t("ui.cancel")}"]`,
  );
  if (!(cancel instanceof HTMLElement)) {
    throw new Error("cancel button missing");
  }
  cancel.click();
}

it("creates a folder from the blank menu, refreshes, and selects it", async () => {
  const service = fakeService();
  let entries = rootEntries;
  service.listEntries = vi.fn(async () => entries);
  service.createFolder = vi.fn(async (_doc: string, _rel: string, name: string) => {
    entries = [...entries, { name, kind: "folder" }];
  });
  const { notice } = await mount({ service });
  const callsBefore = vi.mocked(service.listEntries).mock.calls.length;
  openBlankContextMenu();
  clickMenu(t("ui.newFolder"));
  const input = document.querySelector(".nestnote-modal input");
  expect(input).toBeInstanceOf(HTMLInputElement);
  expect((input as HTMLInputElement).getAttribute("aria-label")).toBe(
    t("ui.folderName"),
  );
  expect(document.activeElement).toBe(input);
  await submitFolderName("  notes  ");
  expect(service.createFolder).toHaveBeenCalledWith(DOC, "", "notes");
  expect(vi.mocked(service.listEntries).mock.calls.length).toBe(callsBefore + 1);
  expect(vi.mocked(service.listEntries).mock.lastCall?.[1]).toBe("");
  expect(rowEl("notes").classList.contains("is-selected")).toBe(true);
  expect(pathText()).toBe("files");
  expect(notice).not.toHaveBeenCalled();
  expect(document.querySelector(".nestnote-modal")).toBeNull();
});

it("creates the folder in the folder currently being browsed", async () => {
  const { service } = await mount();
  rowEl("images").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await flush();
  openBlankContextMenu();
  clickMenu(t("ui.newFolder"));
  await submitFolderName("album");
  expect(service.createFolder).toHaveBeenCalledWith(DOC, "images", "album");
  expect(pathText()).toBe("files/images");
});

it("keeps the name dialog open when the trimmed name is empty", async () => {
  const { service } = await mount();
  openBlankContextMenu();
  clickMenu(t("ui.newFolder"));
  await submitFolderName("   ");
  expect(service.createFolder).not.toHaveBeenCalled();
  expect(document.querySelector(".nestnote-modal")).not.toBeNull();
});

it("does not create a folder when the dialog is cancelled", async () => {
  const { service } = await mount();
  openBlankContextMenu();
  clickMenu(t("ui.newFolder"));
  cancelFolderModal();
  await flush();
  expect(service.createFolder).not.toHaveBeenCalled();
  expect(document.querySelector(".nestnote-modal")).toBeNull();
});

it.each([
  ["notice.folderNameInvalid", t("notice.folderNameInvalid")],
  ["notice.folderExists", t("notice.folderExists")],
] as const)("notices %s from the service", async (_key, message) => {
  const service = fakeService({
    createFolder: vi.fn().mockRejectedValue(new Error(message)),
  });
  const { notice } = await mount({ service });
  const callsBefore = vi.mocked(service.listEntries).mock.calls.length;
  openBlankContextMenu();
  clickMenu(t("ui.newFolder"));
  await submitFolderName("notes");
  expect(notice).toHaveBeenCalledWith(message);
  expect(vi.mocked(service.listEntries).mock.calls.length).toBe(callsBefore);
});

it("notices a generic failure when creating a folder throws", async () => {
  const service = fakeService({
    createFolder: vi.fn().mockRejectedValue(new Error("disk full")),
  });
  const { notice } = await mount({ service });
  openBlankContextMenu();
  clickMenu(t("ui.newFolder"));
  await submitFolderName("notes");
  expect(notice).toHaveBeenCalledWith(t("notice.createFolderFailed"));
});

it("notices a generic failure when the rejection is not an Error", async () => {
  const service = fakeService({
    createFolder: vi.fn().mockRejectedValue("nope"),
  });
  const { notice } = await mount({ service });
  openBlankContextMenu();
  clickMenu(t("ui.newFolder"));
  await submitFolderName("notes");
  expect(notice).toHaveBeenCalledWith(t("notice.createFolderFailed"));
});
```

不要改 `orders the entry context menu: insert, copy, delete`。它锁定条目菜单不含「新建文件夹」。

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/file-explorer-view.test.ts -t "blank area context menu"`

Expected: FAIL。空白处菜单仍只有 `t("ui.paste")`。

Run: `npx vitest run tests/file-explorer-view.test.ts -t "creates a folder from the blank menu"`

Expected: FAIL。`clickMenu` 抛出 `missing menu item`，因为菜单里还没有「新建文件夹」。

- [ ] **Step 3: 实现菜单、对话框和错误映射**

在 `showBackgroundMenu` 里，粘贴项之前插入新建文件夹和分隔线：

```ts
private showBackgroundMenu(event: MouseEvent): void {
  const menu = new Menu();
  menu.addItem((item) => {
    item.setTitle(t("ui.newFolder"));
    item.setIcon("folder-plus");
    item.onClick(() => {
      this.openNewFolderModal();
    });
  });
  menu.addSeparator();
  menu.addItem((item) => {
    item.setTitle(t("ui.paste"));
    item.setIcon("clipboard-paste");
    item.onClick(() => {
      void this.pasteFromClipboard();
    });
  });
  menu.showAtMouseEvent(event);
}
```

在 `FileExplorerView` 中加入：

```ts
private openNewFolderModal(): void {
  const documentPath = this.documentPath;
  if (documentPath === null) {
    return;
  }
  const relative = this.relativeWithinRoot;
  new NestNoteFolderNameModal(this.app, (name) => {
    void this.createFolder(documentPath, relative, name);
  }).open();
}

private async createFolder(
  documentPath: string,
  relative: string,
  name: string,
): Promise<void> {
  try {
    await this.options.service.createFolder(documentPath, relative, name);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message === t("notice.folderNameInvalid") ||
      message === t("notice.folderExists")
    ) {
      this.options.notice(message);
    } else {
      this.options.notice(t("notice.createFolderFailed"));
    }
    return;
  }
  this.selected = name;
  await this.refresh(false);
}
```

在文件末尾的 `NestNoteConfirmModal` 之后加入本地对话框。空名称直接返回，不设 `submitted`，因此可以再次确认。确认时把已经 trim 的名称交给回调。

```ts
class NestNoteFolderNameModal extends Modal {
  constructor(
    app: App,
    private readonly onSubmit: (name: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.classList.add("nestnote-modal");
    this.setTitle(t("ui.newFolder"));

    const input = createEl("input", {
      type: "text",
      value: "",
      attr: { "aria-label": t("ui.folderName") },
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
  }

  onClose(): void {
    this.contentEl.replaceChildren();
  }
}
```

`showEntryMenu` 保持不变。

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/file-explorer-view.test.ts tests/file-explorer-service.test.ts tests/i18n.test.ts`

Expected: PASS

再跑一遍全量：

Run: `npm test`

Expected: PASS
