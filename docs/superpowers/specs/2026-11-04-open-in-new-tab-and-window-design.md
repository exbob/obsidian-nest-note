# NestNote 在新标签页或新窗口中打开文档

## 1. 目标

在侧边栏文档树的右键菜单和「更多」菜单中增加两项。两条入口弹出同一份菜单。两项都打开该文档的 `index.md`。

- **在新标签页中打开：** 文档尚未打开时，在新标签页中打开。
- **在新窗口中打开：** 文档尚未打开时，在新的 Obsidian 弹出窗口中打开（同一个库，不是第二个进程）。

文档已经在主窗口或弹出窗口的某个编辑页里打开时，两项都只激活那个编辑页，不新建标签，也不新建窗口。

单击文档名的打开方式不变。不新增命令或设置。

## 2. 已确认的选择

- **菜单来源：** 「更多」与行上右键继续共用 `showDocumentMenu`。
- **展开/折叠：** 有子文档时仍是菜单第一项，后面保留现有分隔线。无子文档时不显示该项，也不显示它后面的分隔线。
- **新项位置：** 紧跟在展开/折叠分组之后；没有该分组时，两项就是菜单开头。两项后面始终有一条分隔线，再接现有的复制路径等项。
- **已打开：** 主窗口标签和弹出窗口都算。找到已打开的 `index.md` 后只激活，不调用 `openFile`，以免重置光标和滚动位置。
- **多处同时打开：** 优先 `getMostRecentLeaf()` 里已经打开该 `index.md` 的那个。最近使用的是文档树侧边栏，或不在匹配集合里时，用本次遍历到的第一个匹配编辑页。有 `iterateAllLeaves` 时用它遍历，否则用 `iterateRootLeaves`。
- **未打开：** `getLeaf("tab")` 或 `getLeaf("window")`，再 `openFile`。不用 `getLeaf(true)` 表示新标签，以便和弹出窗口区分。
- **焦点：** 这两项把焦点交给目标编辑页。单击文档名仍只激活、不夺走侧边栏焦点。
- **选中：** 菜单打开后，树里选中该文档，时机与单击名称相同（先选中，再打开）。
- **实现位置：** 查找、激活、新建都在 `NestNoteDocumentService.open`。视图只组菜单并调用。

## 3. 菜单内容与顺序

有子文档时：

```
全部展开  或  全部折叠
─────────────
在新标签页中打开
在新窗口中打开
─────────────
复制相对路径
复制绝对路径
─────────────
使用默认应用打开
在系统资源管理器中打开
─────────────
重命名
删除
```

无子文档时从「在新标签页中打开」起。

| 项 | 图标 | 行为 |
|----|------|------|
| 全部展开 / 全部折叠 | 现有 | 不变 |
| 在新标签页中打开 | `file-plus` | `documents.open(path, "tab")` |
| 在新窗口中打开 | `app-window` | `documents.open(path, "window")` |
| 其余项 | 现有 | 不变 |

两项始终显示，不因文档已经打开而改文案或隐藏。

### 3.1 文案

| Key | 中文 | 英文 |
|-----|------|------|
| `ui.openInNewTab` | 在新标签页中打开 | Open in new tab |
| `ui.openInNewWindow` | 在新窗口中打开 | Open in new window |

不新增失败文案。失败沿用 `open` 现有错误。

## 4. 打开行为

`DocumentService.open` 签名改为：

```ts
open(documentPath: string, target?: "tab" | "window"): Promise<void>
```

省略 `target` 时仍走现有 `pickOpenLeaf`，供单击名称、新建后打开使用。`pickOpenLeaf` 继续使用 `getLeaf(false)` / `getLeaf(true)`，不改。

传入 `"tab"` 或 `"window"` 时：

1. 用现有 `requireDocument` 与 `requireIndex` 确认这是完整文档并取得 `index.md`。不完整或缺少索引时抛出现有 `DocumentServiceError`，不创建叶子。
2. 在全部叶子里查找已打开该索引路径的编辑页。
3. 找到则 `activate()`，返回。不调用 `getLeaf`，不调用 `openFile`。
4. 找不到则 `getLeaf(target)`，对该叶子 `openFile(indexFile)`，再 `activate()`。

查找规则：

- 生产适配器提供 `iterateAllLeaves`，转发 `app.workspace.iterateAllLeaves`，从而包含弹出窗口。
- 适配器没有 `iterateAllLeaves` 时，回退到现有 `iterateRootLeaves`（只覆盖主窗口）。
- 跳过视图类型为 `nestnote-document-tree` 的叶子。
- 匹配条件是叶子当前文件路径与索引路径字符串相等，例如 `Work/Notes/index.md`。
- 匹配集合为空则视为未打开。
- 否则若 `getMostRecentLeaf()` 属于匹配集合，用它；不然用遍历顺序中的第一个。

`activate()` 先 `revealLeaf`（若运行时存在），再 `setActiveLeaf(leaf, { focus: true })`，让被挡住的标签或弹出窗口来到前面并获得焦点。

现有 `openFile` 包装仍是 `openFile(file, { active: true })` 然后 `setActiveLeaf(leaf, { focus: false })`。只有这两个菜单目标在 `openFile` 之后再 `activate()`。单击路径不调用 `activate()`。

## 5. 实现

### 5.1 服务侧叶子

`DocumentWorkspaceLeaf` 增加：

```ts
getFilePath(): string | null
activate(): void
```

`DocumentServiceApp["workspace"].getLeaf` 的参数改为 `boolean | "tab" | "window"`。增加可选的 `iterateAllLeaves`，形态与现有 `iterateRootLeaves` 相同。

`src/main.ts` 的 `wrapWorkspaceLeaf`：

- `getFilePath`：叶子视图是 `FileView` 且 `file` 非空时返回 `file.path`，否则 `null`。
- `activate`：调用 `revealLeaf`（存在时）和 `setActiveLeaf(leaf, { focus: true })`。

`createDocumentWorkspace` 把 `getLeaf` 的参数原样传给 `app.workspace.getLeaf`，并转发 `iterateAllLeaves`。

### 5.2 视图

`showDocumentMenu` 在展开/折叠分组（若有）之后加入上述两项和分隔线。

`openDocument(path, target?)` 仍先把 `selected` 设为该路径并 `render`，再 `documents.open(path, target)`。失败仍走现有 `fail`：服务已经提示过的错误不再提示，其余用 `notice`。菜单项不 `requestRefresh`。

## 6. 错误处理

| 情况 | 行为 |
|------|------|
| 打开成功，或激活已打开的编辑页 | 无 Notice。树选中该文档。不刷新树 |
| 不是完整文档，或缺少 `index.md` | 现有 `DocumentServiceError`，经 `fail` 提示。不新建叶子 |
| `openFile` 抛出 | 现有 `fail`。若错误已提示过则不再提示 |
| 同一文档已在多处打开 | 按第 4 节选一个并激活，不新建 |

## 7. 测试

`document-tree-view`：

- 「更多」与右键的菜单结构相同。
- 有子文档：第一项仍是全部展开或全部折叠，接着分隔线，然后是两项新菜单，再分隔线，然后是复制相对路径。
- 无子文档：第一项是「在新标签页中打开」，没有展开项。
- 点击两项分别调用 `documents.open(path, "tab")` 与 `documents.open(path, "window")`，并选中该行。
- 子行右键仍不弹出父行菜单。
- 现有复制、外部打开、重命名、删除、展开/折叠用例保持通过；断言整份菜单顺序的用例改为新顺序。

`document-service` 的 `open`：

- 不传 `target` 的现有用例保持不变。
- 已有编辑页打开该 `index.md` 时，`"tab"` 和 `"window"` 都只 `activate` 那个叶子，不调用 `getLeaf("tab")` / `getLeaf("window")`，不 `openFile`。
- 最近使用的叶子是文档树侧边栏时，激活遍历到的第一个匹配编辑页。
- 最近使用的叶子本身已打开该文件时，激活它，而不是更早遍历到的另一个叶子。
- 未打开时，`"tab"` 调用 `getLeaf("tab")`，`"window"` 调用 `getLeaf("window")`，两者都 `openFile` 该 `index.md`，然后 `activate`。
- 只出现在 `iterateAllLeaves`、不出现在 `iterateRootLeaves` 的叶子（弹出窗口）会被复用。
- 打开 `attachments` 这类保留路径仍然抛出 `DocumentServiceError`，且不打开文件。

现有测试假叶子补上 `getFilePath`（默认 `null`）和空的 `activate`，`getLeaf` 参数放宽为 `boolean | "tab" | "window"`。`plugin-lifecycle` 的假 `getLeaf` 仅在类型检查需要时同样放宽，不新增生命周期场景。

i18n 的「中英与 `MESSAGE_KEYS` 键一致」测试覆盖两个新 key。

## 8. 文档

更新 `README.md` 与 `README_zh.md` 侧边栏操作表：在「展开 / 折叠全部子文档」之后、「复制相对路径」之前，加入这两项。写明入口是「更多」或右键，对象是该文档的 `index.md`；已经打开时切换到现有编辑页，未打开时才新建标签或弹出窗口。

不更换侧边栏截图。现有图注仍是「更多或右键菜单」，不用改。

## 9. 不做

- 改变单击文档名、新建后打开、命令面板的打开方式。
- 文档已打开时再开一个标签或再开一个窗口。
- 打开文档目录或附件，而不是 `index.md`。
- 启动第二个 Obsidian 进程。
- 新增命令、设置、快捷键。
- 按是否已打开改菜单文案。
- 聚焦已打开的编辑页时重新 `openFile`。
