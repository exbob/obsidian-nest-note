# NestNote 功能增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 NestNote 增加 `0～9` 可配置的子文档层级限制、启动时面板开关、批量展开/折叠和可靠的发布构建脚本。

**Architecture:** 新增独立的设置模块负责默认值、持久化数据规范化和设置页；扫描器与文档服务通过同一份动态设置读取最大子文档层级。视图只管理展开状态和交互，插件生命周期负责在布局准备后扫描并按设置激活面板；`build.sh` 将成功构建结果原子地整理到 `./nest-note/`。

**Tech Stack:** TypeScript、Obsidian Plugin API、原生 DOM/CSS、esbuild、Vitest、Bash。

## Global Constraints

- `maxChildDepth` 的有效范围固定为 `0～9`，默认值为 `5`。
- 根文档深度为 `0`；扫描和创建都必须遵守同一最大深度。
- `openPanelOnStartup` 默认值为 `true`。
- `build.sh clean` 只清除 `main.js`、`main.js.map`（若存在）和 `./nest-note/`，不执行构建。
- `build.sh` 仅在 `npm run build` 成功后发布 `main.js`、`manifest.json`、`styles.css`。
- 不引入第三方 Obsidian 插件、UI 框架或独立索引数据库。
- 保留 Obsidian 原生“插入附件”命令和现有附件、链接、回收站行为。

---

### Task 1: 配置模型与 Obsidian 设置页

**Files:**
- Create: `src/settings.ts`
- Create: `src/ui/settings-tab.ts`
- Create: `tests/settings.test.ts`
- Modify: `src/main.ts:1-60`（导入设置模型并加载配置）

**Interfaces:**
- Produces `NestNoteSettings`、`DEFAULT_NESTNOTE_SETTINGS` 和 `normalizeNestNoteSettings(value: unknown): NestNoteSettings`。
- Produces `NestNoteSettingTab extends PluginSettingTab`，保存设置并通过回调通知插件刷新。
- Consumes Obsidian `Plugin.loadData()`、`Plugin.saveData()` 和 `Setting`。

- [ ] **Step 1: 写配置规范化失败测试**

在 `tests/settings.test.ts` 中写入：

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_NESTNOTE_SETTINGS,
  normalizeNestNoteSettings,
} from "../src/settings";

describe("normalizeNestNoteSettings", () => {
  it("returns defaults for missing data", () => {
    expect(normalizeNestNoteSettings(undefined)).toEqual({
      maxChildDepth: 5,
      openPanelOnStartup: true,
    });
  });

  it("keeps valid values from persisted data", () => {
    expect(
      normalizeNestNoteSettings({
        maxChildDepth: 9,
        openPanelOnStartup: false,
      }),
    ).toEqual({
      maxChildDepth: 9,
      openPanelOnStartup: false,
    });
  });

  it("falls back only invalid fields", () => {
    expect(
      normalizeNestNoteSettings({
        maxChildDepth: 10,
        openPanelOnStartup: "yes",
      }),
    ).toEqual(DEFAULT_NESTNOTE_SETTINGS);
  });

  it("accepts zero as the minimum depth", () => {
    expect(normalizeNestNoteSettings({ maxChildDepth: 0 })).toEqual({
      maxChildDepth: 0,
      openPanelOnStartup: true,
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行：

```text
npx vitest run tests/settings.test.ts
```

预期：因 `src/settings.ts` 尚不存在而失败。

- [ ] **Step 3: 实现设置模型**

在 `src/settings.ts` 中实现以下接口和常量：

```ts
export interface NestNoteSettings {
  maxChildDepth: number;
  openPanelOnStartup: boolean;
}

export const DEFAULT_NESTNOTE_SETTINGS: NestNoteSettings = {
  maxChildDepth: 5,
  openPanelOnStartup: true,
};

export function normalizeNestNoteSettings(value: unknown): NestNoteSettings {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const maxChildDepth =
    typeof record.maxChildDepth === "number" &&
    Number.isInteger(record.maxChildDepth) &&
    record.maxChildDepth >= 0 &&
    record.maxChildDepth <= 9
      ? record.maxChildDepth
      : DEFAULT_NESTNOTE_SETTINGS.maxChildDepth;
  const openPanelOnStartup =
    typeof record.openPanelOnStartup === "boolean"
      ? record.openPanelOnStartup
      : DEFAULT_NESTNOTE_SETTINGS.openPanelOnStartup;
  return { maxChildDepth, openPanelOnStartup };
}
```

- [ ] **Step 4: 实现设置页**

让 `NestNoteSettingTab` 接受以下宿主接口：

```ts
export interface NestNoteSettingsHost {
  settings: NestNoteSettings;
  saveSettings(): Promise<void>;
  onSettingsChanged(): void;
}
```

设置页使用 Obsidian 原生 `Setting`：

- 数字输入标题为“最大子文档层级”，说明文字包含“根文档为第 0 级，可设置 0～9”；
- 输入值使用 `setLimits(0, 9, 1)`，保存前通过 `Number.isInteger()` 校验；
- 非法值恢复为当前有效值并显示 Notice；
- 开关标题为“启动时打开 NestNote 面板”；
- 每次有效变更都更新宿主 `settings`、调用 `saveSettings()`，再调用 `onSettingsChanged()`。

- [ ] **Step 5: 运行配置测试**

运行：

```text
npx vitest run tests/settings.test.ts
```

预期：4 个配置测试全部通过。

- [ ] **Step 6: 提交配置单元**

```bash
git add src/settings.ts src/ui/settings-tab.ts tests/settings.test.ts
git commit -m "feat: add NestNote settings model"
```

### Task 2: 让扫描器遵守最大子文档层级

**Files:**
- Modify: `src/domain/document-scanner.ts:1-100`
- Modify: `tests/document-scanner.test.ts:1-160`
- Modify: `src/types.ts:1-15`（如需导出扫描选项类型）

**Interfaces:**
- `scanDocuments(entries: readonly VaultEntry[], options?: { maxChildDepth?: number }): DocumentNode[]`
- 未传 `options.maxChildDepth` 时使用默认值 `5`。
- 过滤发生在扫描结果形成后，超限节点及其整棵子树都不返回。

- [ ] **Step 1: 写超限扫描失败测试**

在现有扫描器测试中加入深度链和以下断言：

```ts
it("hides documents deeper than the configured child depth", () => {
  const entries = documentChainEntries(6);
  expect(scanDocuments(entries, { maxChildDepth: 5 })).toHaveLength(1);
  expect(collectNodes(scanDocuments(entries, { maxChildDepth: 5 })).map((node) => node.path))
    .toEqual(["Level0", "Level0/Level1", "Level0/Level1/Level2", "Level0/Level1/Level2/Level3", "Level0/Level1/Level2/Level3/Level4", "Level0/Level1/Level2/Level3/Level4/Level5"]);
});

it("shows only root documents when the limit is zero", () => {
  expect(collectNodes(scanDocuments(documentChainEntries(2), { maxChildDepth: 0 })))
    .toEqual([expect.objectContaining({ path: "Level0" })]);
});
```

`documentChainEntries(count)` 必须为每一级生成目录、`index.md` 和 `attachments/` 三类条目。

- [ ] **Step 2: 运行测试确认失败**

运行：

```text
npx vitest run tests/document-scanner.test.ts
```

预期：新增断言失败，因为当前扫描器没有接收层级配置。

- [ ] **Step 3: 实现深度过滤**

保留现有完整文档识别、父节点挂载和排序逻辑。先构建完整树，再递归按树深度裁剪：

```ts
function pruneToDepth(
  nodes: DocumentNode[],
  maxChildDepth: number,
  depth: number,
): DocumentNode[] {
  if (depth > maxChildDepth) {
    return [];
  }
  return nodes.map((node) => ({
    ...node,
    children: pruneToDepth(node.children, maxChildDepth, depth + 1),
  }));
}
```

`scanDocuments()` 使用 `options?.maxChildDepth ?? DEFAULT_NESTNOTE_SETTINGS.maxChildDepth`，并在调用方传入前保证配置已经规范化。

- [ ] **Step 4: 运行扫描器测试**

运行：

```text
npx vitest run tests/document-scanner.test.ts
```

预期：既有扫描器测试和新增层级测试全部通过。

- [ ] **Step 5: 提交扫描器单元**

```bash
git add src/domain/document-scanner.ts tests/document-scanner.test.ts src/types.ts
git commit -m "feat: limit scanned document depth"
```

### Task 3: 禁止在最大层级下创建子文档

**Files:**
- Modify: `src/services/document-service.ts:65-145`
- Modify: `tests/document-service.test.ts`
- Modify: `src/main.ts:75-95`（传入动态设置读取器）

**Interfaces:**
- 扩展 `DocumentServiceOptions`：`getMaxChildDepth?: () => number`
- `NestNoteDocumentService.create()` 在任何 Vault 写入前拒绝 `parentDepth + 1 > getMaxChildDepth()`。
- 根文档创建仍使用深度 `0`，不因最大子文档层级为 `0` 而被禁止。

- [ ] **Step 1: 写深度限制失败测试**

使用现有 fake Vault 和 `createdAt` 测试辅助，加入：

```ts
it("rejects a child whose depth exceeds the configured maximum", async () => {
  const app = createSeededAppWithDocumentChain(5);
  const service = new NestNoteDocumentService(app, {
    getMaxChildDepth: () => 5,
  });

  await expect(service.create("Level0/Level1/Level2/Level3/Level4/Level5", "TooDeep"))
    .rejects.toThrow("层级");
  expect(app.vault.folders.has("Level0/Level1/Level2/Level3/Level4/Level5/TooDeep"))
    .toBe(false);
  expect(app.vault.files.has("Level0/Level1/Level2/Level3/Level4/Level5/TooDeep/index.md"))
    .toBe(false);
});
```

测试还应验证 `getMaxChildDepth: () => 0` 时根文档可创建、任意子文档创建被拒绝。

- [ ] **Step 2: 运行测试确认失败**

运行：

```text
npx vitest run tests/document-service.test.ts
```

预期：因服务尚未读取最大深度而失败。

- [ ] **Step 3: 实现父路径深度计算**

增加仅处理路径字符串的辅助函数：

```ts
function documentDepth(path: string): number {
  return normalizePath(path).split("/").length - 1;
}
```

在 `create()` 的父文档校验之后、`createFolder()` 之前执行：

```ts
const childDepth = parent === null ? 0 : documentDepth(parent) + 1;
if (
  parent !== null &&
  childDepth > (this.options.getMaxChildDepth?.() ?? DEFAULT_NESTNOTE_SETTINGS.maxChildDepth)
) {
  throw new DocumentServiceError(
    `已达到最大子文档层级（${this.options.getMaxChildDepth?.() ?? DEFAULT_NESTNOTE_SETTINGS.maxChildDepth}）`,
  );
}
```

实际实现应先保存局部 `const maxChildDepth`，避免一次操作读取两次动态配置。

- [ ] **Step 4: 运行文档服务测试**

运行：

```text
npx vitest run tests/document-service.test.ts
```

预期：服务原有测试和新增边界测试全部通过，并确认限制失败不会留下文件或目录。

- [ ] **Step 5: 提交服务单元**

```bash
git add src/services/document-service.ts tests/document-service.test.ts src/main.ts
git commit -m "feat: enforce document depth limit"
```

### Task 4: 修复 Enter 提交并增加全部展开/折叠

**Files:**
- Modify: `src/ui/document-tree-view.ts:1-340`
- Modify: `tests/document-tree-view.test.ts:1-270`
- Modify: `styles.css:1-130`

**Interfaces:**
- 工具栏增加 `aria-label="全部展开"` 或 `aria-label="全部折叠"` 的按钮。
- 输入框 Enter 提交与“确认”按钮共用同一个提交函数。
- `DocumentTreeView` 内部保留既有 `expanded` 和 `selected` 状态。

- [ ] **Step 1: 写 Enter 交互失败测试**

打开“新建子文档”操作后，向输入框发送键盘事件：

```ts
it("submits and closes the name modal on Enter", async () => {
  const { documents } = await mount();
  action("Work", "新建子文档").click();
  const modal = document.querySelector(".nestnote-modal");
  const input = modal?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) throw new Error("input missing");
  input.value = "From Enter";
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await Promise.resolve();
  expect(documents.create).toHaveBeenCalledWith("Work", "From Enter");
  expect(document.querySelector(".nestnote-modal")).toBeNull();
});
```

- [ ] **Step 2: 写批量展开/折叠失败测试**

加入：

```ts
it("expands and collapses every expandable document", async () => {
  const { view } = await mount();
  const expandAll = toolbar("全部展开");
  expandAll.click();
  expect(row("Work").classList.contains("is-expanded")).toBe(true);
  expect(toolbar("全部折叠")).toBeTruthy();
  toolbar("全部折叠").click();
  expect(row("Work").classList.contains("is-expanded")).toBe(false);
});
```

同时断言空树或无子节点树上的批量按钮为 `disabled`。

- [ ] **Step 3: 运行视图测试确认失败**

运行：

```text
npx vitest run tests/document-tree-view.test.ts
```

预期：Enter 测试可能暴露当前事件未阻止默认行为，批量展开测试因按钮不存在而失败。

- [ ] **Step 4: 实现共享提交函数**

在两个名称 Modal 中使用同一结构：

```ts
let submitted = false;
const submit = (): void => {
  if (submitted) return;
  const name = input.value.trim();
  if (name === "") return;
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
```

确认按钮继续调用 `event.preventDefault(); submit()`。

- [ ] **Step 5: 实现批量展开/折叠**

在视图中保存工具栏按钮引用，并增加：

```ts
private allToggleButton: HTMLButtonElement | null = null;

private expandablePaths(nodes: readonly DocumentNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.children.length > 0 ? [node.path] : []),
    ...this.expandablePaths(node.children),
  ]);
}
```

渲染工具栏状态时：

- 可展开路径为空：按钮 `disabled = true`，标签为“全部展开”；
- 存在未展开路径：按钮标签为“全部展开”，点击后将全部路径加入 `expanded`；
- 全部已展开：按钮标签为“全部折叠”，点击后从 `expanded` 清除全部路径；
- 每次标签变化都同步 `aria-label` 和 `setIcon()` 图标（分别使用 `chevrons-down` 和 `chevrons-up`）。

批量操作调用 `render(this.nodes)`，不调用 `requestRefresh()`。

- [ ] **Step 6: 补充主题一致样式**

确保新按钮复用 `.nestnote-icon-button`，为禁用状态补充：

```css
.nestnote-icon-button:disabled {
  opacity: 0.35;
  cursor: default;
}

.nestnote-icon-button:disabled:hover {
  background-color: transparent;
  color: var(--text-muted);
}
```

继续使用 `var(--background-modifier-hover)`、`var(--interactive-accent)` 等 Obsidian 主题变量。

- [ ] **Step 7: 运行视图测试**

运行：

```text
npx vitest run tests/document-tree-view.test.ts
```

预期：所有视图测试通过，且原有展开、选中、错误 Notice 行为不回归。

- [ ] **Step 8: 提交视图单元**

```bash
git add src/ui/document-tree-view.ts tests/document-tree-view.test.ts styles.css
git commit -m "feat: improve NestNote tree interactions"
```

### Task 5: 装配设置、启动面板和动态扫描

**Files:**
- Modify: `src/main.ts:1-280`
- Modify: `tests/plugin-lifecycle.test.ts:1-1000`

**Interfaces:**
- `NestNotePlugin.settings: NestNoteSettings`
- `NestNotePlugin.saveSettings(): Promise<void>`
- `NestNotePlugin.onSettingsChanged(): void`
- `NestNoteSettingTab` 通过宿主回调触发 `scanAndSync()`。

- [ ] **Step 1: 写插件设置生命周期失败测试**

在 fake App/Plugin harness 中补充可控的 `loadData`/`saveData`，加入：

```ts
it("opens the NestNote panel by default after layout is ready", async () => {
  const app = createApp();
  const plugin = loadPlugin(app);
  await plugin.onload();
  expect(app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)).toHaveLength(0);
  app.workspace.markReady();
  await settle();
  expect(app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)).toHaveLength(1);
});

it("does not open the panel when startup opening is disabled", async () => {
  const app = createApp();
  const plugin = loadPlugin(app, {
    openPanelOnStartup: false,
  });
  await plugin.onload();
  app.workspace.markReady();
  await settle();
  expect(app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)).toHaveLength(0);
});
```

同时断言服务使用动态最大深度：修改 `plugin.settings.maxChildDepth` 后触发设置回调，树刷新并隐藏超限节点。

- [ ] **Step 2: 运行生命周期测试确认失败**

运行：

```text
npx vitest run tests/plugin-lifecycle.test.ts
```

预期：默认启动测试失败，因为当前布局回调只扫描不激活面板。

- [ ] **Step 3: 实现配置加载和保存**

在 `onload()` 最早阶段执行：

```ts
this.settings = normalizeNestNoteSettings(await this.loadData());
this.addSettingTab(new NestNoteSettingTab(this.app, this));
```

实现：

```ts
async saveSettings(): Promise<void> {
  await this.saveData(this.settings);
}

onSettingsChanged(): void {
  void this.scanAndSync();
}
```

设置页必须通过 `this.addSettingTab()` 注册，卸载由 Obsidian Plugin 生命周期自动处理。

- [ ] **Step 4: 将设置传给扫描器和文档服务**

修改文档服务装配：

```ts
const innerDocuments = new NestNoteDocumentService(
  createDocumentServiceApp(this.app),
  {
    notice: notify,
    getMaxChildDepth: () => this.settings.maxChildDepth,
  },
);
```

修改扫描入口：

```ts
this.nodes = scanFromApp(this.app, this.settings.maxChildDepth);
```

并将 `scanFromApp` 签名改为 `scanFromApp(app: App, maxChildDepth: number)`，传给 `scanDocuments(entries, { maxChildDepth })`。

- [ ] **Step 5: 实现默认启动面板**

将布局回调改为调用一个异步初始化函数：

```ts
this.app.workspace.onLayoutReady(() => {
  void this.initializeAfterLayout();
});
```

实现：

```ts
private async initializeAfterLayout(): Promise<void> {
  await this.scanAndSync();
  if (!this.stopped && this.settings.openPanelOnStartup) {
    await this.activateView();
  }
}
```

若 `activateView()` 失败，使用现有 Notice 处理，不影响插件卸载标记。

- [ ] **Step 6: 运行生命周期测试**

运行：

```text
npx vitest run tests/plugin-lifecycle.test.ts
```

预期：新增启动开关、配置扫描和原有生命周期测试全部通过。

- [ ] **Step 7: 运行完整 TypeScript 检查**

运行：

```text
npx tsc --noEmit
```

预期：无类型错误。

- [ ] **Step 8: 提交插件装配单元**

```bash
git add src/main.ts src/ui/settings-tab.ts tests/plugin-lifecycle.test.ts
git commit -m "feat: configure NestNote startup behavior"
```

### Task 6: 新增发布构建脚本

**Files:**
- Create: `build.sh`
- Modify: `README.md:1-35`

**Interfaces:**
- `./build.sh`：构建并原子更新 `./nest-note/`。
- `./build.sh clean`：只清除约定产物并退出成功。
- 任意未知参数：输出用法并返回非零状态。

- [ ] **Step 1: 编写脚本验收场景**

在实现前准备以下命令级验收：

```text
./build.sh clean
test ! -e main.js
test ! -e main.js.map
test ! -e nest-note
./build.sh
test -f nest-note/main.js
test -f nest-note/manifest.json
test -f nest-note/styles.css
./build.sh unsupported
test "$?" -ne 0
```

在 Windows 环境使用 Git Bash 或 WSL 执行；PowerShell 只能运行 `npm` 构建本身，不能替代 Bash 脚本解释器。

- [ ] **Step 2: 实现 `clean` 分支**

脚本开头使用：

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ "${1:-}" == "clean" ]]; then
  rm -f main.js main.js.map
  rm -rf nest-note
  exit 0
fi

if [[ $# -ne 0 ]]; then
  printf '用法: %s [clean]\n' "$0" >&2
  exit 2
fi
```

- [ ] **Step 3: 实现成功构建后的原子发布**

在参数校验后执行：

```bash
npm run build

STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nest-note.XXXXXX")"
trap 'rm -rf "$STAGING_DIR"' EXIT

cp main.js manifest.json styles.css "$STAGING_DIR/"
rm -rf nest-note
mv "$STAGING_DIR" nest-note
trap - EXIT
printf 'NestNote 发布文件已写入 ./nest-note/\n'
```

`npm run build` 失败时由 `set -e` 立即退出，旧的 `nest-note/` 不会被删除或更新。复制失败时同样不会把不完整目录移动到最终路径。

- [ ] **Step 4: 更新 README 安装说明**

将源码构建章节改为：

```bash
npm install
./build.sh
```

说明构建后直接将 `nest-note/` 复制到 Vault 的 `.obsidian/plugins/` 下；补充 `./build.sh clean` 只清除构建产物。

- [ ] **Step 5: 运行脚本验收**

运行：

```text
bash build.sh clean
bash build.sh
bash build.sh unsupported
```

预期：前两条分别清理和成功产生三个安装文件，第三条返回非零状态且不改动发布目录。

- [ ] **Step 6: 提交构建单元**

```bash
git add build.sh README.md
git commit -m "build: package NestNote release files"
```

### Task 7: 文档、全量测试与最终验证

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-29-nestnote-enhancements-design.md`（记录最终实现差异，仅在有差异时修改）
- Modify: `tests/*.test.ts`（只保留必要的测试辅助调整）

- [ ] **Step 1: 更新 README 功能说明**

补充以下可操作说明：

- 设置 → NestNote → 最大子文档层级，范围 `0～9`，默认 `5`；
- 根文档为 `0` 级，超出限制的目录不显示；
- 设置 → NestNote → 启动时打开 NestNote 面板；
- 工具栏“全部展开/全部折叠”按钮；
- 按 Enter 可提交新建子文档名称；
- `nest-note/` 是可直接复制的安装目录。

- [ ] **Step 2: 运行完整自动化测试**

运行：

```text
npm test
npx tsc --noEmit
npm run build
```

预期：Vitest 全部通过、TypeScript 无诊断、生产构建成功。

- [ ] **Step 3: 检查发布目录内容**

运行：

```text
bash build.sh clean
bash build.sh
```

确认 `nest-note/` 只包含 `main.js`、`manifest.json`、`styles.css`，没有临时目录或源码文件。

- [ ] **Step 4: 进行真实 Obsidian 手工验收**

在真实 Vault 中验证：

1. 默认启动后 NestNote 面板自动出现；
2. 关闭启动开关后重启，面板不自动出现；
3. 默认创建到第 5 级，第 6 级被拒绝；
4. 设置为 `0` 时只显示根文档；
5. 设置为 `9` 时允许第 9 级；
6. 输入名称后按 Enter 能创建并关闭对话框；
7. 全部展开、全部折叠覆盖整棵树；
8. 设置和新增按钮遵循当前 Obsidian 主题；
9. 从 `nest-note/` 复制到 Vault 插件目录后可正常启用。

- [ ] **Step 5: 记录验证结果**

将实际通过的自动化命令和未能在本地执行的 Obsidian 手工项目记录到 README 验证章节，不把未执行项目写成已通过。

## 执行顺序

按 Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 执行。每个任务先写失败测试或命令级验收，再实现最小行为，随后运行该任务验证；Task 5 完成后运行完整 TypeScript 检查，Task 7 完成后执行全部构建和手工验收。

## 计划自检

- 配置默认值、`0～9` 范围和根深度定义只在设置模型中统一，扫描器和服务都读取同一配置。
- 超限节点在扫描时隐藏，超限创建在任何 Vault 写入前拒绝。
- Enter 与确认按钮共享提交逻辑并有重复提交保护。
- 批量展开/折叠只修改视图状态，不触发文件扫描。
- 启动面板只在布局准备、首次扫描完成且设置开启时激活。
- `build.sh clean` 不构建，默认构建只在成功后更新发布目录。
- 没有 `TBD`、`TODO` 或未定义的接口名；所有验证命令和预期均已列出。
