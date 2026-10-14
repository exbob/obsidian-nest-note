# NestNote 资源管理器面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立侧边栏资源管理器，浏览当前 NestNote 文档下可配置资源文件夹（默认 `files/`），支持逐层浏览、插入链接、系统剪贴板复制/粘贴、关联检查删除，以及设置分区与启动自动打开。

**Architecture:** 独立 `ItemView`（`nestnote-file-explorer`）+ `FileExplorerService` 负责 vault 读写与链接/关联逻辑；扩展 `DesktopFileActions` 做系统剪贴板与外部打开；插件监听活动文件与 vault 变化刷新面板。设置项与文档树启动开关独立。

**Tech Stack:** Obsidian `ItemView` / `Menu` / `MarkdownView` / `Setting`、Electron `shell` + Windows PowerShell FileDropList（系统文件剪贴板）、Vitest + happy-dom、现有 i18n。

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-14-nestnote-file-explorer-design.md`
- View type: `nestnote-file-explorer`；图标 `folder`
- 默认：`fileExplorerSide = "right"`，`fileExplorerRoot = "files"`，`openFileExplorerOnStartup = true`
- 插入链接 path 相对当前 `index.md`；音视频用 `![[path|name]]`，其余 `[[path|name]]`
- 删除只查当前文档 `index.md`；二次确认；`trash` 走 Obsidian 偏好
- 非 NestNote：空状态，不建目录；是 NestNote：自动创建资源根
- 资源管理器设置与现有三项用分隔标题分开
- UI：`setIcon()` + `.nestnote-files-*`，不引入 UI 框架
- Tests: `npm test`（Windows PowerShell）。用户未明确要求时跳过每个 Task 末尾的 git commit（本仓库规则）

## File map

- `src/settings.ts` — 三个新设置字段与归一化
- `src/i18n/types.ts`、`zh.ts`、`en.ts` — 命令/设置/UI/Notice 文案
- `src/domain/file-explorer-path.ts` — 根目录名校验、相对链接 path、音视频判定、wiki 链接生成、关联检测、目录项排序
- `src/services/file-explorer-service.ts` — 文档解析、确保根、列一层、插入、删除、粘贴进库
- `src/ui/desktop-file-actions.ts` — 系统文件剪贴板 copy/read
- `src/ui/file-explorer-view.ts` — 面板 UI
- `src/ui/settings-tab.ts` — 设置分区 UI
- `src/main.ts` — 注册视图/命令/启动/刷新/侧栏迁移
- `styles.css` — 面板样式
- `tests/settings.test.ts`、`tests/file-explorer-path.test.ts`、`tests/file-explorer-service.test.ts`、`tests/file-explorer-view.test.ts`、`tests/desktop-file-actions.test.ts`
- `README.md`、`README_zh.md` — 使用说明

---

### Task 1: 设置字段与归一化

**Files:**
- Modify: `src/settings.ts`
- Modify: `tests/settings.test.ts`

**Interfaces:**
- Consumes: 现有 `NestNoteSettings` / `normalizeNestNoteSettings`
- Produces:

```ts
export type FileExplorerSide = "left" | "right";

export interface NestNoteSettings {
  maxChildDepth: number;
  openPanelOnStartup: boolean;
  autoFixDocumentFormat: boolean;
  openFileExplorerOnStartup: boolean;
  fileExplorerSide: FileExplorerSide;
  fileExplorerRoot: string;
}
```

- [ ] **Step 1: 写失败测试（新字段默认值）**

在 `tests/settings.test.ts` 的 `returns defaults for missing data` 期望中加入：

```ts
openFileExplorerOnStartup: true,
fileExplorerSide: "right",
fileExplorerRoot: "files",
```

并新增用例：

```ts
it("falls back invalid file explorer fields", () => {
  expect(
    normalizeNestNoteSettings({
      fileExplorerSide: "top",
      fileExplorerRoot: "../x",
      openFileExplorerOnStartup: "yes",
    }),
  ).toMatchObject({
    openFileExplorerOnStartup: true,
    fileExplorerSide: "right",
    fileExplorerRoot: "files",
  });
});

it("keeps valid file explorer fields", () => {
  expect(
    normalizeNestNoteSettings({
      openFileExplorerOnStartup: false,
      fileExplorerSide: "left",
      fileExplorerRoot: "assets",
    }),
  ).toMatchObject({
    openFileExplorerOnStartup: false,
    fileExplorerSide: "left",
    fileExplorerRoot: "assets",
  });
});
```

根名合法规则（与实现一致）：非空、不含 `/` `\`、不等于 `.` 或 `..`、不含 `:`。

Run: `npm test -- tests/settings.test.ts`

Expected: FAIL（缺字段）

- [ ] **Step 2: 实现设置**

更新 `src/settings.ts`：

```ts
export type FileExplorerSide = "left" | "right";

export interface NestNoteSettings {
  maxChildDepth: number;
  openPanelOnStartup: boolean;
  autoFixDocumentFormat: boolean;
  openFileExplorerOnStartup: boolean;
  fileExplorerSide: FileExplorerSide;
  fileExplorerRoot: string;
}

export const DEFAULT_NESTNOTE_SETTINGS: NestNoteSettings = {
  maxChildDepth: 5,
  openPanelOnStartup: true,
  autoFixDocumentFormat: true,
  openFileExplorerOnStartup: true,
  fileExplorerSide: "right",
  fileExplorerRoot: "files",
};

export function isValidFileExplorerRoot(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes(":")
  );
}

// 在 normalizeNestNoteSettings 中：
const openFileExplorerOnStartup =
  typeof record.openFileExplorerOnStartup === "boolean"
    ? record.openFileExplorerOnStartup
    : DEFAULT_NESTNOTE_SETTINGS.openFileExplorerOnStartup;
const fileExplorerSide =
  record.fileExplorerSide === "left" || record.fileExplorerSide === "right"
    ? record.fileExplorerSide
    : DEFAULT_NESTNOTE_SETTINGS.fileExplorerSide;
const fileExplorerRoot =
  typeof record.fileExplorerRoot === "string" &&
  isValidFileExplorerRoot(record.fileExplorerRoot)
    ? record.fileExplorerRoot
    : DEFAULT_NESTNOTE_SETTINGS.fileExplorerRoot;
```

同步更新本文件内所有 `toEqual({...})` 期望，补上三个新字段。

Run: `npm test -- tests/settings.test.ts`

Expected: PASS

- [ ] **Step 3: Commit（仅当用户要求）**

---

### Task 2: i18n 文案

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`

**Interfaces:**
- Produces: 下列 key 可供 `t()` 使用

```
command.openFileExplorer
setting.fileExplorerHeading
setting.openFileExplorerOnStartupName
setting.openFileExplorerOnStartupDesc
setting.fileExplorerSideName
setting.fileExplorerSideDesc
setting.fileExplorerSideLeft
setting.fileExplorerSideRight
setting.fileExplorerRootName
setting.fileExplorerRootDesc
setting.fileExplorerRootInvalid
ui.fileExplorer
ui.fileExplorerNeedDocument
ui.fileExplorerEmpty
ui.fileExplorerError
ui.fileExplorerGoUp
ui.insertIntoDocument
ui.copy
ui.paste
ui.deleteFile
ui.deleteFileConfirm
ui.deleteFileConfirmLinked
notice.insertRequiresEditor
notice.pasteConflict
notice.pasteFailed
notice.clipboardFilesUnavailable
notice.deleteFailed
notice.fileExplorerRootCreateFailed
```

- [ ] **Step 1: 写入 `MESSAGE_KEYS` 与中英文**

`types.ts` 在 `command.archiveCurrentAttachment` 后加 `command.openFileExplorer`；在 `setting.autoFixDocumentFormatDesc` 后加全部 `setting.fileExplorer*` / `setting.openFileExplorer*`；在 UI/notice 区按字母/现有分组追加上表其余 key。

中文示例：

```ts
"command.openFileExplorer": "打开资源管理器",
"setting.fileExplorerHeading": "资源管理器",
"setting.openFileExplorerOnStartupName": "启动时打开资源管理器面板",
"setting.openFileExplorerOnStartupDesc": "只影响下次启动，不会关掉当前已经打开的面板。与「启动时打开 NestNote 面板」相互独立。",
"setting.fileExplorerSideName": "面板位置",
"setting.fileExplorerSideDesc": "资源管理器显示在左侧或右侧边栏。",
"setting.fileExplorerSideLeft": "左侧",
"setting.fileExplorerSideRight": "右侧",
"setting.fileExplorerRootName": "文档内资源文件夹",
"setting.fileExplorerRootDesc": "相对文档目录的文件夹名，默认 files。",
"setting.fileExplorerRootInvalid": "资源文件夹名无效，已恢复为默认值。",
"ui.fileExplorer": "资源管理器",
"ui.fileExplorerNeedDocument": "请打开一篇 NestNote 文档",
"ui.fileExplorerEmpty": "此文件夹为空",
"ui.fileExplorerError": "无法加载资源文件夹",
"ui.fileExplorerGoUp": "向上",
"ui.insertIntoDocument": "插入文档",
"ui.copy": "复制",
"ui.paste": "粘贴",
"ui.deleteFile": "删除",
"ui.deleteFileConfirm": "确定将「{name}」移入回收站？",
"ui.deleteFileConfirmLinked": "「{name}」在当前文档中仍有引用。确定移入回收站？",
"notice.insertRequiresEditor": "请先将光标放在 Markdown 编辑器中",
"notice.pasteConflict": "目标路径已存在同名文件或文件夹",
"notice.pasteFailed": "无法粘贴文件",
"notice.clipboardFilesUnavailable": "系统剪贴板中没有可粘贴的文件",
"notice.deleteFailed": "无法删除该文件",
"notice.fileExplorerRootCreateFailed": "无法创建资源文件夹",
```

英文对应写成自然英文（`File explorer`、`Open file explorer`、`Open file explorer panel on startup` 等）。

Run: `npm test -- tests/i18n.test.ts`

Expected: PASS

- [ ] **Step 2: Commit（仅当用户要求）**

---

### Task 3: 纯函数 — 路径、链接、关联、排序

**Files:**
- Create: `src/domain/file-explorer-path.ts`
- Create: `tests/file-explorer-path.test.ts`

**Interfaces:**
- Produces:

```ts
export const AUDIO_VIDEO_EXTENSIONS: ReadonlySet<string>; // 小写无点

export function isAudioVideoFileName(name: string): boolean;

/** relativePath 相对 index.md，如 files/a.png；displayName 带后缀 */
export function buildFileWikiLink(
  relativePath: string,
  displayName: string,
): string;

/** 在 markdown 正文中查找是否引用 vaultRelative 路径或其子孙（用于文件夹） */
export function markdownReferencesPath(
  markdown: string,
  relativeToIndex: string,
): boolean;

export type ExplorerEntryKind = "folder" | "file";

export interface ExplorerEntry {
  name: string;
  kind: ExplorerEntryKind;
}

export function sortExplorerEntries(
  entries: readonly ExplorerEntry[],
): ExplorerEntry[];

/** 当前浏览相对资源根的显示路径；根层返回 rootName */
export function displayExplorerPath(
  rootName: string,
  relativeWithinRoot: string,
): string;

/** wiki 链接用：相对 index.md */
export function linkPathFromRoot(
  rootName: string,
  relativeWithinRoot: string,
  entryName: string,
): string;
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import {
  buildFileWikiLink,
  displayExplorerPath,
  isAudioVideoFileName,
  linkPathFromRoot,
  markdownReferencesPath,
  sortExplorerEntries,
} from "../src/domain/file-explorer-path";

describe("file-explorer-path", () => {
  it("detects audio and video by extension", () => {
    expect(isAudioVideoFileName("a.mp3")).toBe(true);
    expect(isAudioVideoFileName("b.MP4")).toBe(true);
    expect(isAudioVideoFileName("c.png")).toBe(false);
    expect(isAudioVideoFileName("folder")).toBe(false);
  });

  it("builds embed links for media and wiki links otherwise", () => {
    expect(buildFileWikiLink("files/clip.mp3", "clip.mp3")).toBe(
      "![[files/clip.mp3|clip.mp3]]",
    );
    expect(buildFileWikiLink("files/photo.png", "photo.png")).toBe(
      "[[files/photo.png|photo.png]]",
    );
    expect(buildFileWikiLink("files/images", "images")).toBe(
      "[[files/images|images]]",
    );
  });

  it("detects references in index markdown", () => {
    const md = "see [[files/a.png|a.png]] and ![[files/v.mp4|v.mp4]]";
    expect(markdownReferencesPath(md, "files/a.png")).toBe(true);
    expect(markdownReferencesPath(md, "files/missing.png")).toBe(false);
    expect(markdownReferencesPath(md, "files")).toBe(true); // 子孙引用也算目录关联
  });

  it("sorts folders before files then by name", () => {
    expect(
      sortExplorerEntries([
        { name: "z.txt", kind: "file" },
        { name: "b", kind: "folder" },
        { name: "a.png", kind: "file" },
        { name: "a", kind: "folder" },
      ]).map((e) => e.name),
    ).toEqual(["a", "b", "a.png", "z.txt"]);
  });

  it("builds display and link paths", () => {
    expect(displayExplorerPath("files", "")).toBe("files");
    expect(displayExplorerPath("files", "images")).toBe("files/images");
    expect(linkPathFromRoot("files", "", "photo.png")).toBe("files/photo.png");
    expect(linkPathFromRoot("files", "images", "photo.png")).toBe(
      "files/images/photo.png",
    );
  });
});
```

Run: `npm test -- tests/file-explorer-path.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 2: 实现 `src/domain/file-explorer-path.ts`**

```ts
export const AUDIO_VIDEO_EXTENSIONS = new Set([
  "mp3", "wav", "ogg", "m4a", "flac", "aac",
  "mp4", "webm", "mov", "mkv", "avi",
]);

export function isAudioVideoFileName(name: string): boolean {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return false;
  return AUDIO_VIDEO_EXTENSIONS.has(name.slice(i + 1).toLowerCase());
}

export function buildFileWikiLink(
  relativePath: string,
  displayName: string,
): string {
  const inner = `[[${relativePath}|${displayName}]]`;
  return isAudioVideoFileName(displayName) ? `!${inner}` : inner;
}

export function markdownReferencesPath(
  markdown: string,
  relativeToIndex: string,
): boolean {
  const target = relativeToIndex.replace(/\\/g, "/");
  // 匹配 wiki/embed：[[path|...]] 或 [[path]]，path 等于 target 或以 target/ 开头
  const re = /!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  for (const match of markdown.matchAll(re)) {
    const path = match[1].trim().replace(/\\/g, "/");
    if (path === target || path.startsWith(`${target}/`)) return true;
  }
  return false;
}

export function sortExplorerEntries(
  entries: readonly ExplorerEntry[],
): ExplorerEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function displayExplorerPath(
  rootName: string,
  relativeWithinRoot: string,
): string {
  const rel = relativeWithinRoot.replace(/^\/+|\/+$/g, "");
  return rel === "" ? rootName : `${rootName}/${rel}`;
}

export function linkPathFromRoot(
  rootName: string,
  relativeWithinRoot: string,
  entryName: string,
): string {
  const rel = relativeWithinRoot.replace(/^\/+|\/+$/g, "");
  return rel === ""
    ? `${rootName}/${entryName}`
    : `${rootName}/${rel}/${entryName}`;
}
```

导出 `ExplorerEntry` / `ExplorerEntryKind` 类型。

Run: `npm test -- tests/file-explorer-path.test.ts`

Expected: PASS

- [ ] **Step 3: Commit（仅当用户要求）**

---

### Task 4: FileExplorerService

**Files:**
- Create: `src/services/file-explorer-service.ts`
- Create: `tests/file-explorer-service.test.ts`

**Interfaces:**
- Consumes: Task 3 纯函数；vault stub API
- Produces:

```ts
export interface FileExplorerVault {
  getFolderByPath(path: string): { path: string } | null;
  getAbstractFileByPath(path: string):
    | { path: string; children?: unknown }
    | null;
  createFolder(path: string): Promise<unknown>;
  read(file: { path: string }): Promise<string>;
  getFileByPath(path: string): { path: string } | null;
  trashFile(file: { path: string }): Promise<void>;
  adapter: {
    exists(path: string): Promise<boolean> | boolean;
    list?(path: string): Promise<{ files: string[]; folders: string[] }>;
    copy?(src: string, dst: string): Promise<void>;
  };
}

export interface FileExplorerServiceDeps {
  vault: FileExplorerVault;
  fileManager: { trashFile(file: { path: string }): Promise<void> };
  resolveDocumentPath(filePath: string | null): string | null;
  getRootName(): string;
  notice: (message: string) => void;
  /** 将绝对路径文件/文件夹复制进 vault 相对路径（桌面实现） */
  importAbsolutePath(absoluteSource: string, vaultDestPath: string): Promise<void>;
}

export class NestNoteFileExplorerService {
  constructor(private readonly deps: FileExplorerServiceDeps) {}

  /** 活动文件 → 文档路径；非 NestNote 返回 null */
  resolveActiveDocument(activeFilePath: string | null): string | null;

  /** 确保 documentPath/root 存在；失败 notice 并抛错或返回 null */
  ensureRoot(documentPath: string): Promise<string | null>;

  listEntries(
    documentPath: string,
    relativeWithinRoot: string,
  ): Promise<ExplorerEntry[]>;

  vaultPath(
    documentPath: string,
    relativeWithinRoot: string,
    entryName?: string,
  ): string;

  buildInsertText(
    documentPath: string,
    relativeWithinRoot: string,
    entry: ExplorerEntry,
  ): string;

  indexReferencesEntry(
    documentPath: string,
    relativeWithinRoot: string,
    entry: ExplorerEntry,
  ): Promise<boolean>;

  trashEntry(
    documentPath: string,
    relativeWithinRoot: string,
    entry: ExplorerEntry,
  ): Promise<void>;

  pasteAbsolutePaths(
    documentPath: string,
    relativeWithinRoot: string,
    absoluteSources: string[],
  ): Promise<void>;
}
```

- [ ] **Step 1: 写失败测试（用内存假 vault）**

覆盖：
1. `resolveActiveDocument` 委托 `resolveDocumentPath`
2. `ensureRoot` 在缺失时 `createFolder`
3. `listEntries` 只返回一层且已排序
4. `buildInsertText` 委托 `buildFileWikiLink`
5. `indexReferencesEntry` 读 `index.md`
6. `pasteAbsolutePaths` 同名冲突时 notice 且不调用 import

最小假 vault 可用 Map 存文件夹与文件内容；测试文件约 150–200 行可接受。

Run: `npm test -- tests/file-explorer-service.test.ts`

Expected: FAIL

- [ ] **Step 2: 实现服务**

要点：
- `vaultPath(doc, rel, name?)` → `doc/root` 或 `doc/root/rel` 或 `doc/root/rel/name`
- `listEntries`：用 `getAbstractFileByPath` 取 `TFolder.children`，映射 name + kind，再 `sortExplorerEntries`
- `pasteAbsolutePaths`：对每个源取 basename；若 `getAbstractFileByPath(dest)` 非 null → `notice(t("notice.pasteConflict"))` 并 **整批取消**（不部分粘贴）；否则 `importAbsolutePath`
- `trashEntry`：`fileManager.trashFile`

Run: `npm test -- tests/file-explorer-service.test.ts`

Expected: PASS

- [ ] **Step 3: Commit（仅当用户要求）**

---

### Task 5: 扩展 DesktopFileActions（系统文件剪贴板）

**Files:**
- Modify: `src/ui/desktop-file-actions.ts`
- Modify: `tests/desktop-file-actions.test.ts`

**Interfaces:**
- Produces（在现有接口上扩展）:

```ts
export interface DesktopFileActions {
  copyText(text: string): Promise<void>;
  resolveAbsolutePath(vaultRelativePath: string): string | null;
  openWithDefaultApp(absolutePath: string): Promise<void>;
  showInSystemExplorer(absolutePath: string): Promise<void>;
  /** 将本地绝对路径写入系统「文件」剪贴板 */
  copyFiles(absolutePaths: string[]): Promise<void>;
  /** 读取系统文件剪贴板中的绝对路径列表；无则返回 [] */
  readClipboardFiles(): Promise<string[]>;
  /** 把库外绝对路径复制到 vault 相对目标（文件或递归文件夹） */
  importAbsolutePath(absoluteSource: string, vaultDestPath: string): Promise<void>;
}
```

- [ ] **Step 1: 扩展接口与可测纯逻辑**

Windows 生产实现（用户主平台）：
- `copyFiles`：`powershell -NoProfile -Command "Set-Clipboard -Path @('p1','p2')"`（路径转义单引号）
- `readClipboardFiles`：`Get-Clipboard -Format FileDropList`，按行拆分非空路径
- `importAbsolutePath`：使用 Node `fs`（`fs.promises.cp(src, absDest, { recursive: true })`），其中 `absDest = resolveAbsolutePath(vaultDestPath)`；复制前目标父目录须已存在

将 `escapePowerShellSingleQuoted(path: string): string` 导出并单测（`'` → `''`）。

非 Windows：`copyFiles` / `readClipboardFiles` 抛错或返回空并由上层 Notice `notice.clipboardFilesUnavailable`（macOS 可后续加 osascript；本任务先实现 win32 + 可注入 mock）。

工厂 `createDesktopFileActions(app)` 按 `process.platform === "win32"` 选择实现；测试继续注入假对象，不跑真实 PowerShell。

Run: `npm test -- tests/desktop-file-actions.test.ts`

Expected: PASS（含 escape 测试）

- [ ] **Step 2: Commit（仅当用户要求）**

---

### Task 6: FileExplorerView UI

**Files:**
- Create: `src/ui/file-explorer-view.ts`
- Create: `tests/file-explorer-view.test.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: Service + DesktopFileActions + i18n
- Produces:

```ts
export const VIEW_TYPE_NESTNOTE_FILES = "nestnote-file-explorer";
export const NESTNOTE_FILES_ICON = "folder";

export interface FileExplorerViewOptions {
  getActiveFilePath(): string | null;
  service: NestNoteFileExplorerService;
  desktop: DesktopFileActions;
  notice: (message: string) => void;
  getEditorInsert?: () => ((text: string) => boolean) | null;
}

export class FileExplorerView extends ItemView {
  getViewType(): string;
  getDisplayText(): string; // t("ui.fileExplorer")
  getIcon(): string; // folder
  /** 活动文档变化或外部请求时调用；resetPath=true 时回到资源根 */
  refresh(resetPath?: boolean): Promise<void>;
}
```

- [ ] **Step 1: 写 UI 行为测试（happy-dom）**

覆盖：
1. 无文档 → 文案含 `ui.fileExplorerNeedDocument`
2. 有文档 → 渲染路径栏与条目名（带后缀）
3. 双击文件夹调用后相对路径进入子层（mock service.listEntries）
4. 右键菜单四项顺序：插入、复制、粘贴、删除（用现有 Menu stub）

可参考 `tests/document-tree-view.test.ts` 的挂载方式。

Run: `npm test -- tests/file-explorer-view.test.ts`

Expected: FAIL

- [ ] **Step 2: 实现 View + CSS**

结构：
```html
.nestnote-files-view
  .nestnote-files-pathbar
    button.up (aria-label go up)
    .nestnote-files-path
    button.reveal (folder-open)
  .nestnote-files-list | .nestnote-files-empty
    .nestnote-files-row (data-name, data-kind)
```

行为：
- `refresh(true)`：清空 `relativeWithinRoot`，解析文档；null → 空状态；否则 `ensureRoot` + `listEntries`
- 双击 folder → 追加相对路径并 refresh(false)
- 双击 file → `desktop.openWithDefaultApp(abs)`
- 向上 → 去掉最后一段
- 揭示 → `showInSystemExplorer` 当前文件夹绝对路径
- 插入 → `getEditorInsert()?.(text)` 失败则 notice
- 复制 → `desktop.copyFiles([abs])`
- 粘贴 → `readClipboardFiles` 空则 notice；否则 `service.pasteAbsolutePaths` 再 refresh
- 删除 → `indexReferencesEntry` → ConfirmModal（可复用 document-tree 内同类 Modal，或抽到 `src/ui/confirm-modal.ts`；若抽取，本任务内完成最小抽取避免循环依赖）→ `trashEntry`

图标：`folder` / `file-image` / `file-audio` / `file-video` / `file-text` / `file`（`setIcon`）。

`styles.css` 增加 `.nestnote-files-*`，风格对齐 `.nestnote-view`。

Run: `npm test -- tests/file-explorer-view.test.ts`

Expected: PASS

- [ ] **Step 3: Commit（仅当用户要求）**

---

### Task 7: 设置页分区 UI

**Files:**
- Modify: `src/ui/settings-tab.ts`
- Modify: `tests/settings.test.ts`

**Interfaces:**
- Consumes: 新 settings + i18n
- Produces: 分隔标题 + 三个控件；保存失败回滚

- [ ] **Step 1: 扩展 settings 测试**

在 `renders depth, startup, and auto-fix settings` 中断言出现 `setting.fileExplorerHeading` 与三个新设置名。

Toggle 索引：原 startup=0、autoFix=1；新增 `openFileExplorerOnStartup` 为 index 2。

增加：侧栏 dropdown / 根名 text 输入保存与非法根名恢复默认 + Notice。

- [ ] **Step 2: 实现 display()**

现有三项之后：

```ts
new Setting(this.containerEl)
  .setName(t("setting.fileExplorerHeading"))
  .setHeading();

// toggle openFileExplorerOnStartup
// dropdown fileExplorerSide: left/right
// text fileExplorerRoot，blur/change 时校验 isValidFileExplorerRoot
```

Run: `npm test -- tests/settings.test.ts`

Expected: PASS

- [ ] **Step 3: Commit（仅当用户要求）**

---

### Task 8: 插件接线

**Files:**
- Modify: `src/main.ts`
- Modify: `tests/plugin-lifecycle.test.ts`（若有视图注册断言则扩展；否则加最小用例或跳过并依赖手工验证说明）

**Interfaces:**
- Consumes: View、Service、Desktop、Settings
- Produces: 命令、启动打开、活动文件刷新、侧栏迁移

- [ ] **Step 1: 注册与打开**

```ts
this.registerView(VIEW_TYPE_NESTNOTE_FILES, (leaf) =>
  new FileExplorerView(leaf, { ... }),
);

this.addCommand({
  id: "nestnote:open-file-explorer",
  name: t("command.openFileExplorer"),
  callback: () => { void this.openFileExplorer(); },
});
```

`openFileExplorer` / `activateFileExplorerView`：
- 已有 leaf → reveal
- 否则按 `settings.fileExplorerSide` 使用 `getRightLeaf(false)` 或 `getLeftLeaf(false)`，再 `setViewState`

`initializeAfterLayout`：在文档树启动逻辑旁增加：

```ts
if (!this.stopped && this.settings.openFileExplorerOnStartup) {
  try { await this.activateFileExplorerView(); }
  catch (error) { new Notice(errorMessage(error)); }
}
```

- [ ] **Step 2: 刷新与设置变更**

- `file-open` / `active-leaf-change`：对所有 `VIEW_TYPE_NESTNOTE_FILES` leaf 调用 `refresh(true)`（换文档重置路径）
- vault coordinator 刷新回调中：若变更路径落在任一打开面板的当前文档资源根下，`refresh(false)`（保持子路径）
- `onSettingsChanged`：若 `fileExplorerSide` 变化，关闭旧 leaf 并在新侧栏 `activateFileExplorerView`（仅当已有资源管理器 leaf 或用户正打开时；简化：**已打开则迁移**）
- 构造 `NestNoteFileExplorerService`，`importAbsolutePath` 委托 `desktop.importAbsolutePath`
- 插入编辑器：

```ts
getEditorInsert: () => {
  const view = this.app.workspace.getActiveViewOfType(MarkdownView);
  if (!view) return null;
  return (text: string) => {
    view.editor.replaceSelection(text);
    return true;
  };
}
```

复用现有 `resolveDocumentPath`（保持 private，经闭包注入 service）。

Run: `npm test`

Expected: PASS（全量）

- [ ] **Step 3: Commit（仅当用户要求）**

---

### Task 9: README

**Files:**
- Modify: `README_zh.md`
- Modify: `README.md`

- [ ] **Step 1: 文档**

中英文增加：
- 打开资源管理器（命令 / 图标说明）
- 侧边栏操作简述（浏览、插入、复制粘贴、删除）
- 设置表：启动打开、位置、资源文件夹名

- [ ] **Step 2: Commit（仅当用户要求）**

---

## Self-review

| Spec 项 | Task |
|---------|------|
| 独立 ItemView、folder 图标、左右边栏 | 6, 8 |
| 默认 files、自动创建根、非 NestNote 空状态 | 4, 6 |
| 逐层浏览、路径栏、系统打开、双击 | 6 |
| 右键插入/复制/粘贴/删除+关联+确认 | 3, 4, 5, 6 |
| 设置分区 + 启动打开默认 on | 1, 2, 7, 8 |
| 切换文档刷新 | 8 |
| 测试：normalize、链接、关联、排序、mock 剪贴板 | 1, 3, 4, 5, 6 |

无 TBD；接口名在 Task 间一致；Windows 文件剪贴板用 PowerShell FileDropList，测试注入 mock。
