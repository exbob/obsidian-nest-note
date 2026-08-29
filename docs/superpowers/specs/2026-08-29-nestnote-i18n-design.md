# NestNote 中英界面语言设计

## 1. 目标

NestNote 界面支持简体中文和英文。语言跟随 Obsidian 应用语言自动选择：中文界面用简体中文，其余语言用英文。插件不提供独立的语言设置，不引入第三方 i18n 库。

## 2. 语言判定

插件加载时读取一次界面语言并缓存，不监听运行时切换。Obsidian 更改语言后需重启才会生效，与官方行为一致。

判定顺序：

1. 若存在官方 `getLanguage()`（Obsidian 1.8.7+），使用其返回的 ISO 代码。
2. 否则读取 `localStorage.language`。
3. 仍缺失时视为 `en`。

映射规则：

- 代码大小写不敏感，且以 `zh` 开头（含 `zh`、`zh-TW`、`zh-cn`）→ 简体中文。
- 其他一切（含 `en`、`ja`、`fr`、空值）→ 英文。

`minAppVersion` 保持 `1.5.0`。`getLanguage` 仅作运行时探测，不作为编译期硬依赖。

## 3. 模块结构

新增目录：

```text
src/i18n/
  types.ts      # MessageKey 与插值参数类型
  zh.ts         # 简体文案
  en.ts         # 英文文案
  index.ts      # detectLanguage()、resolveLocale()、t()、setLocaleForTests()
```

- `zh.ts` 与 `en.ts` 导出同一形状的文案对象，用 TypeScript 约束为完整的 `Record<MessageKey, string>`。缺 key、多 key 或拼错会编译失败。
- `t(key, vars?)` 按缓存 locale 取值，并将模板中的 `{name}` 替换为 `vars` 对应字段。未知占位符原样保留。
- `setLocaleForTests("zh" | "en")` 仅测试使用，用于固定语言，避免宿主环境干扰。

UI 与服务在需要文案处 `import { t } from ".../i18n"`，不经设置项、不经构造函数注入翻译表。

不修改 `NestNoteSettings`，不增加「界面语言」选项。

## 4. 替换范围

所有用户可见文案改为 `t()`：命令显示名、设置项名称与说明、侧边栏按钮与菜单、对话框标题与正文、`aria-label`、Notice。

不翻译：

- 品牌名 `NestNote`（含侧边栏 `getDisplayText()`、ribbon tooltip）。
- 命令 ID（如 `nestnote:new-document`）。
- 目录与文件约定：`index.md`、`attachments/`。
- 受控标记：`<!-- nestnote:children:start -->` / `<!-- nestnote:children:end -->`。
- Frontmatter 字段名 `name`、`created`。
- 领域层内部错误字符串（见第 5 节）。

README 仍以中文为主，补充一句：界面语言跟随 Obsidian；简体/繁体中文显示简体中文，其他语言显示英文。

## 5. 错误处理

`document-service` 与 `attachment-service` 继续抛 `DocumentServiceError`，`message` 改为 `t(...)` 的结果。现有 `notice()` 回调与 `isAlreadyNoticed` 行为不变。

领域层 `FrontmatterParseError`、`ChildrenLinksError` 以及 `File not found` 等内部英文错误保持英文。展示给用户时使用已翻译的外壳，例如「文档元数据异常，未写入任何更改：{detail}」，`{detail}` 为内部英文原文。

## 6. 文案 key

中英两套必须使用下表中的 key 名，不可改名或省略：

| Key | 中文 | English |
|-----|------|---------|
| `command.openDocumentTree` | 打开文档树 | Open document tree |
| `command.newDocument` | 新建文档 | New document |
| `command.newChildDocument` | 新建子文档 | New child document |
| `command.refresh` | 刷新 | Refresh |
| `command.archiveCurrentAttachment` | 归档当前附件 | Archive current attachment |
| `setting.maxChildDepthName` | 最大子文档层级 | Max child document depth |
| `setting.maxChildDepthDesc` | 根文档为第 0 级，可设置 0～9 | Root documents are depth 0. Allowed range: 0–9. |
| `setting.openPanelOnStartupName` | 启动时打开 NestNote 面板 | Open the NestNote pane on startup |
| `setting.openPanelOnStartupDesc` | 仅影响下次启动，不关闭当前面板 | Applies on the next launch; does not close the current pane. |
| `setting.maxChildDepthInvalid` | 最大子文档层级必须是 0～9 的整数 | Max child document depth must be an integer from 0 to 9 |
| `setting.saveFailed` | 设置保存失败，已恢复为上次有效值：{detail} | Could not save settings; restored the last valid values: {detail} |
| `ui.expandAll` | 全部展开 | Expand all |
| `ui.collapseAll` | 全部折叠 | Collapse all |
| `ui.expand` | 展开 | Expand |
| `ui.collapse` | 折叠 | Collapse |
| `ui.more` | 更多 | More |
| `ui.rename` | 重命名 | Rename |
| `ui.delete` | 删除 | Delete |
| `ui.confirm` | 确认 | Confirm |
| `ui.cancel` | 取消 | Cancel |
| `ui.documentName` | 文档名称 | Document name |
| `ui.deleteDocument` | 删除文档 | Delete document |
| `ui.deleteConfirm` | 删除「{name}」会将整个子树移入回收站。 | Deleting "{name}" will move the entire subtree to the trash. |
| `notice.openChildRequiresDocument` | 请先打开一个 NestNote 文档再新建子文档 | Open a NestNote document before creating a child document |
| `notice.attachmentNoActiveFile` | 无法判断附件归属，当前没有活动文件 | Could not determine the attachment owner; no active file |
| `notice.attachmentKept` | 无法判断附件归属，已保留原位置：{path} | Could not determine the attachment owner; left in place: {path} |
| `notice.metadataUnchanged` | 文档元数据异常，未写入任何更改：{detail} | Document metadata is invalid; no changes were written: {detail} |
| `error.targetExists` | 目标已存在：{path} | Target already exists: {path} |
| `error.maxDepthReached` | 已达到最大子文档层级（{max}） | Maximum child document depth reached ({max}) |
| `error.documentNotFound` | 找不到文档：{path} | Document not found: {path} |
| `error.nameEmpty` | 文档名称不能为空 | Document name cannot be empty |
| `error.nameInvalid` | 文档名称无效：{name} | Invalid document name: {name} |
| `error.parentMissing` | 父文档不存在或不完整：{path} | Parent document is missing or incomplete: {path} |
| `error.notCompleteDocument` | 不是完整的 NestNote 文档：{path} | Not a complete NestNote document: {path} |

命令、工具栏、对话框标题复用同一语义 key（例如「新建文档」只用 `command.newDocument`）。

## 7. 测试

新增 `tests/i18n.test.ts`：

- `zh`、`zh-TW`、`zh-cn` → `zh`；`en`、空值、`ja`、`fr` → `en`。
- 存在 `getLanguage` 时以它为准；不存在时回退 `localStorage`；再缺失则为 `en`。
- 中英 key 集合一致。
- `t()` 正确插值；未知占位符原样保留。

现有测试在 setup 中调用 `setLocaleForTests("zh")`，继续断言当前中文文案，避免宿主语言干扰。英文路径只在 `tests/i18n.test.ts` 覆盖。不测 Obsidian 运行时热切换，不做 E2E 截图。

## 8. 手工验收

| 步骤 | 期望 |
|------|------|
| Obsidian 语言设为简体中文或繁体中文后重启 | 设置、命令、侧边栏、对话框、Notice 为简体中文 |
| 设为英文或其他语言后重启 | 上述界面为英文 |
| 检查品牌与约定 | `NestNote`、命令 ID、`index.md` / `attachments/` 不变 |
