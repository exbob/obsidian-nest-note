# NestNote 文档行右键菜单与路径操作

## 1. 目标

在 NestNote 侧边栏文档行上增加鼠标右键菜单，并扩展现有「更多」菜单。两条入口弹出同一份菜单。四个新项操作该文档的 `index.md`，行为对齐 Obsidian 文件列表里同名功能，但不整段复用文件浏览器菜单。

行上仍保留「新建子文档」和「更多」。不改命令面板、设置、拖放。

## 2. 已确认的选择

- **行上控件：** 加号（新建子文档）和「更多」都保留。
- **右键范围：** 整行，包括名称、空白、加号、「更多」、展开/折叠箭头。
- **菜单来源：** 「更多」左键与行上右键共用 `showDocumentMenu(node, event)`，禁止两套各写一份。
- **不能复用原生文件菜单：** `file-menu` 事件不会带上核心的复制路径 / 默认应用打开 / 资源管理器项，还会被其他插件插入条目，对不上指定顺序。
- **四个新功能的实现：** 公开桌面能力（`FileSystemAdapter.getFullPath` + Electron `shell`），不调用未写入 `obsidian.d.ts` 的 `App` 方法。
- **操作对象：** 四个新功能都针对该文档的 `index.md`，不是文档目录本身。
- **展开/折叠：** 继续用现有开关文案「全部展开」/「全部折叠」（与工具栏一致）。无子文档时不显示该项，并去掉它后面那条分隔线。
- **文案：** 中英固定，不按操作系统切换（例如不做 macOS 的 Reveal in Finder）。
- **成功时：** 复制和系统打开成功不弹 Notice，与原生一致。

## 3. 交互

左键点名称仍打开文档；左键点加号仍新建子文档；左键点「更多」弹出菜单。

整行 `contextmenu`：`preventDefault` 且 `stopPropagation`，阻止浏览器默认菜单，并避免子行右键再弹出父行菜单。右键不是 click，不会打开文档。

工具栏、拖放、命令不变。

## 4. 菜单内容与顺序

有子文档时：

```
全部展开  或  全部折叠
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

无子文档时从「复制相对路径」起，没有顶部分隔线。

| 项 | 图标 | 行为 |
|----|------|------|
| 全部展开 / 全部折叠 | `chevrons-up-down` / `chevrons-down-up` | 现有：只切换该文档子树展开状态 |
| 复制相对路径 | `copy` | 将该文档 `index.md` 的库内相对路径写入剪贴板 |
| 复制绝对路径 | `copy` | 将该文档 `index.md` 的本地绝对路径写入剪贴板 |
| 使用默认应用打开 | `external-link` | 用系统默认应用打开该 `index.md` |
| 在系统资源管理器中打开 | `folder-open` | 在系统资源管理器中定位并选中该 `index.md` |
| 重命名 | `pencil` | 现有名称对话框，确认后 `documents.rename` |
| 删除 | `trash-2` | 现有删除确认，确认后 `documents.trash`（整棵文档目录进回收站） |

重命名和删除不改成 Obsidian 文件菜单里的同名项：那些只动单个文件，不会处理 NestNote 文档目录。

### 4.1 文案

| Key | 中文 | 英文 |
|-----|------|------|
| `ui.copyRelativePath` | 复制相对路径 | Copy relative path |
| `ui.copyAbsolutePath` | 复制绝对路径 | Copy absolute path |
| `ui.openWithDefaultApp` | 使用默认应用打开 | Open in default app |
| `ui.showInSystemExplorer` | 在系统资源管理器中打开 | Show in system explorer |

失败提示（中英都要有）：

| Key | 中文 | 英文 |
|-----|------|------|
| `notice.copyFailed` | 无法复制到剪贴板 | Could not copy to the clipboard |
| `notice.localPathUnavailable` | 无法取得该文件的本地路径 | Could not get the local path for this file |
| `notice.openExternallyFailed` | 无法用系统打开该文件 | Could not open this file with the system |

复制相对/绝对路径失败用 `notice.copyFailed`。没有本地绝对路径时，复制绝对路径和两个系统打开项用 `notice.localPathUnavailable`。已有绝对路径但 `openPath` / `showItemInFolder` 失败用 `notice.openExternallyFailed`。

现有 `ui.more`、`ui.expandAll`、`ui.collapseAll`、`ui.rename`、`ui.delete` 不变。

## 5. 实现

### 5.1 视图

`DocumentTreeView` 抽出 `showDocumentMenu(node, event)`：用 Obsidian `Menu`，`addSeparator()` 插入横线，`showAtMouseEvent(event)` 弹出。

「更多」按钮的 click 处理器改为调用该方法（仍 `stopPropagation`，避免触发行上其他逻辑）。`.nestnote-row` 上监听 `contextmenu` 并调用同一方法。

### 5.2 桌面文件辅助模块

新建小模块（例如 `src/ui/desktop-file-actions.ts`），视图只组菜单、不直接 `require("electron")`。

职责：

- 相对路径：`node.indexPath`（已是库内相对路径，如 `Work/Notes/index.md`）。
- 绝对路径：若 `app.vault.adapter instanceof FileSystemAdapter`，则 `adapter.getFullPath(indexPath)`；否则视为不可用。
- 复制：`navigator.clipboard.writeText(text)`。
- 默认应用打开：Electron `shell.openPath(absolutePath)`；返回的非空错误字符串视为失败。
- 资源管理器：Electron `shell.showItemInFolder(absolutePath)`。

测试通过可选依赖注入假实现（剪贴板写入、取绝对路径、openPath、showInFolder），不在单测里加载 Electron。

`DocumentService` 不增加这四个操作。库文件变更仍只走现有 rename / trash / open。

## 6. 错误处理

| 情况 | 行为 |
|------|------|
| 复制成功、系统打开成功 | 无 Notice，不刷新树 |
| 剪贴板写入失败 | Notice，侧边栏不变 |
| 无 `FileSystemAdapter`（如移动端）或拿不到绝对路径 | 复制绝对路径 / 两个系统打开项：Notice，侧边栏不变。菜单项仍显示 |
| `shell.openPath` 返回错误 | Notice，侧边栏不变 |
| 重命名 / 删除失败 | 现有逻辑：Notice（若服务尚未提示过），保留侧边栏状态 |

四个新功能失败不调用 `requestRefresh`。

## 7. 测试

`tests/obsidian-stub.ts` 的 `Menu` 要能表示分隔线（例如带 class 的分隔元素），便于断言顺序和有无顶部分隔线。

`document-tree-view` 测试：

- 行上仍有「新建子文档」和「更多」。
- 「更多」与行上 `contextmenu` 弹出相同项、相同顺序、相同分隔。
- 无子文档：无展开/折叠项，无顶部分隔线。
- 复制相对路径：剪贴板为该节点 `indexPath`。
- 复制绝对路径：剪贴板为注入的绝对路径。
- 两个系统打开项调用对应假函数，参数为 `index.md` 的绝对路径。
- 剪贴板或系统打开失败时 `notice`，不 `requestRefresh`。
- 子行右键不弹出父行菜单。
- 现有更多菜单的重命名、删除确认、展开/折叠子树用例改为走共用菜单，行为不变。

`plugin-lifecycle` 里经「更多」删除的辅助函数可继续点「更多」，不必改成右键。

i18n 现有「中英与 `MESSAGE_KEYS` 键一致」测试覆盖新 key。

辅助模块若有纯函数（例如在无 adapter 时拒绝取绝对路径），单独测；Electron 调用只通过注入点测。

## 8. 文档

更新 `README.md` 与 `README_zh.md` 侧边栏操作表：

- 写明菜单可由「更多」或右键打开。
- 列出四个新功能，并写明对象是该文档的 `index.md`。
- 展开/折叠、重命名、删除仍经该菜单；删除仍每次确认。

若截图说明仍写「仅更多」，改为同时提到右键。不新增命令说明。

## 9. 不做

- 去掉「更多」按钮。
- 触发 `file-menu` 或拼出完整的 Obsidian 文件浏览器菜单。
- 调用未公开的 `App.openWithDefaultApp` / `App.showInFolder`。
- 用原生重命名/删除替代 NestNote 的文档目录操作。
- 按操作系统切换菜单文案。
- 在移动端隐藏桌面专用菜单项（点击后再 Notice）。
- 新命令、新设置、改拖放。
