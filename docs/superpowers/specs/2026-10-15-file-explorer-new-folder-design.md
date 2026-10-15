# 资源管理器空白处新建文件夹

## 1. 目标

在资源管理器面板的空白处右键菜单中增加「新建文件夹」。用户填写名称后，在当前浏览路径下创建一个文件夹，列表刷新并选中它。

文件或文件夹行上的右键菜单不变。不新建空文件，不提供重命名。

## 2. 已确认的选择

- **命名：** 弹出输入框，由用户填写名称。交互与文档树「新建文档」同类：标题、文本框、确认、取消。
- **实现边界：** 创建与校验放在 `NestNoteFileExplorerService.createFolder`。视图只负责菜单、对话框、刷新和 Notice。
- **不抽公共命名对话框。** 资源管理器沿用本面板已有的 `Modal` 写法，不改文档树的 `NestNoteNameModal`。

## 3. 菜单

仅当面板状态为 `ready` 时，空白处右键有效（与现有「粘贴」相同）。顺序：

```
新建文件夹
─────────────
粘贴
```

- 文案键 `ui.newFolder`：中文「新建文件夹」，英文 `New folder`。
- 图标：`folder-plus`。
- 条目右键仍为：插入文档、复制、删除。不出现「新建文件夹」。

## 4. 命名对话框

点击「新建文件夹」后打开模态框：

- 标题与菜单相同：`ui.newFolder`。
- 输入框初始为空，获得焦点。无障碍名称 `ui.folderName`：中文「文件夹名称」，英文 `Folder name`。
- 回车或确认：去掉首尾空白后，名称为空则不提交、不关闭。
- 取消或关闭：不调用创建。
- 确认按钮、取消按钮沿用 `ui.confirm` / `ui.cancel`。

## 5. 创建

`createFolder(documentPath, relativeWithinRoot, name): Promise<void>`

目标路径为 `vaultPath(documentPath, relativeWithinRoot, trimmedName)`，即当前正在浏览的那一层，不是资源根（除非当前就在根上）。

校验顺序：

1. `trim` 后为空：`throw new Error(t("notice.folderNameInvalid"))`。对话框本身已拦住空名；服务仍拒绝，避免绕过界面。
2. 名称为 `.` 或 `..`，或包含 `/` 或 `\`：同样抛出 `notice.folderNameInvalid`。其余字符允许，包括空格、中文和后缀名形式的名字。
3. 当前目录已有同名文件或文件夹：大小写不敏感，与粘贴冲突检测一致（vault 子项，以及 adapter `list` 能列出的隐藏项）。`throw new Error(t("notice.folderExists"))`。
4. 通过后调用 `vault.createFolder`。不自动进入新文件夹。

以上拒绝路径都不调用 `vault.createFolder`。

成功后视图 `refresh(false)`，再选中新文件夹名称。停留在当前路径。

视图捕获错误时：若 `error instanceof Error` 且 `message` 等于 `notice.folderNameInvalid` 或 `notice.folderExists`，原样 Notice；其余失败（含 `vault.createFolder` 抛错、非 `Error`）一律 Notice `notice.createFolderFailed`。

## 6. 文案

| 键 | 中文 | 英文 | 何时出现 |
|----|------|------|----------|
| `ui.newFolder` | 新建文件夹 | New folder | 菜单与对话框标题 |
| `ui.folderName` | 文件夹名称 | Folder name | 输入框无障碍名称 |
| `notice.folderNameInvalid` | 文件夹名称无效 | Invalid folder name | `.`、`..`、含 `/` 或 `\`、或服务收到的空名 |
| `notice.folderExists` | 当前路径已存在同名文件或文件夹 | A file or folder with that name already exists | 同名冲突 |
| `notice.createFolderFailed` | 无法创建文件夹 | Could not create the folder | `createFolder` 失败或其他异常 |

不复用 `error.nameInvalid`（那是文档名称）和 `notice.pasteConflict`（那是粘贴）。

## 7. 测试

对齐现有 vitest + stub：

- 空白处菜单顺序为「新建文件夹」、分隔线、「粘贴」。
- 条目菜单不含「新建文件夹」。
- 确认合法名称后调用 `createFolder(documentPath, relativeWithinRoot, name)`，刷新当前层，并选中新名称。
- 取消不调用 `createFolder`。
- 空名称不关闭对话框，不调用 `createFolder`。
- 服务：`.`、`..`、含 `/` 或 `\`、空名抛出 `notice.folderNameInvalid` 的文案，且不调用 `vault.createFolder`。
- 服务：同名（含大小写不同）抛出 `notice.folderExists` 的文案，且不调用 `vault.createFolder`。
- 视图：`notice.folderNameInvalid` 与 `notice.folderExists` 原样显示；`vault.createFolder` 失败以及其他异常显示 `notice.createFolderFailed`。

## 8. 非目标

- 不在文件或文件夹行的菜单里提供「新建文件夹」。
- 不新建文件，不重命名，不自动生成「新建文件夹 2」。
- 不进入新建的文件夹。
- 不把命名对话框抽成文档树与资源管理器共用组件。
