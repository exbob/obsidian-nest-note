# NestNote 自动修正文档格式

## 1. 目标

增加一项设置，控制插件是否在**后台扫描**时把完整文档的 `index.md` 修正为模板规范格式。

默认开启，行为与现在的扫描写入一致。关闭后，启动、刷新、库文件变动都不再改已有文件；通过插件新建、删除、重命名、移动子文档时，仍更新父文档里那对 children 标记之间的列表。

不改变新建文档自己的初始模板，不改变附件归档，不引入「只改空行、不同步链接」的第二种写入路径。

## 2. 已确认的选择

- 采用「扫描门闩」：开关只约束 `syncDocumentMetadata` 这类后台修正，不约束用户操作触发的父文档链接更新。
- 默认开启（`true`）。已有用户不改设置时，扫描仍会补头部、插入或重写 children 区域。
- 关闭后仍允许：新建 / 删除 / 重命名 / 移动子文档时改写父文档的 children 区域（写成规范空行与排序列表）。
- 不采用「关闭后保留原空行习惯」或「仅当链接集合变化才写入」。

## 3. 模板规范格式（写入时）

插件写入的 `index.md` 规范形态与当前实现一致。

新建文档（根文档与子文档相同）：

```markdown
---
name: 目录名
created: 2026-09-01T15:00:00+08:00
---
# 目录名


## 子文档

<!-- nestnote:children:start -->


<!-- nestnote:children:end -->
```

- `name` 默认等于目录名；`created` 为带时区的 ISO 时间，只在缺失时由扫描补上。
- 一级标题与「子文档」标题之间两个空行。界面为英文时二级标题为 `Child Document`。
- children 标记中间两个空行。有子文档时，链接插在这两个空行中间，按文档名排序，列表与上下标记各隔一行。
- 解析不依赖空行；标记不成对或位于围栏代码内时按现有规则处理。

有子文档时的 children 区域：

```markdown
<!-- nestnote:children:start -->

- [项目 A](项目%20A/index.md)
- [项目 B](项目%20B/index.md)

<!-- nestnote:children:end -->
```

## 4. 设置

### 4.1 字段

`NestNoteSettings` 增加：

```ts
autoFixDocumentFormat: boolean;
```

- 默认值：`true`
- 归一化：仅当值为布尔时采用；缺失、`null`、字符串等一律回退为 `true`
- 持久化：与现有设置一起经 `saveData` / `loadData`

### 4.2 界面

设置页在现有两项之后增加一个 Toggle，文案走 i18n：

| Key | 中文 | English |
|-----|------|---------|
| `setting.autoFixDocumentFormatName` | 自动修正文档格式 | Auto-fix document format |
| `setting.autoFixDocumentFormatDesc` | 扫描时补全缺失的头部字段和子文档标记，并把子文档列表写成规范格式。关闭后，只有新建、删除、重命名、移动子文档时才会更新父文档链接。 | During scans, fill missing header fields and child-link markers, and rewrite the child list to the canonical format. When off, parent links update only when you create, delete, rename, or move a child document. |

保存失败时与现有开关相同：回滚到上次有效值，Notice `setting.saveFailed`。

保存成功后调用现有 `onSettingsChanged()`。因此：**把开关从关拨到开，会立刻再扫描一次**；若此时格式与规范不一致，会立即修正。从开拨到关后，后续扫描不再写入。

## 5. 开启时：后台修正

`performScanAndSync` 在 `autoFixDocumentFormat === true` 时继续调用 `syncDocumentMetadata`。

修正对象：扫描得到的完整文档（目录内同时有 `index.md` 与 `attachments/`）。与现在一样，元数据扫描深度固定为 9，不受「最大子文档层级」裁剪；被 UI 隐藏的深层文档仍会被修正。

每篇文档只改它的 `index.md`，沿用现有 `transformDocumentIndex`：

1. `ensureDocumentFrontmatter`：没有头部则在正文前插入；已有头部则保证 `name` 等于目录名，缺失 `created` 时补上。不改正文，不删其他 YAML 键。
2. `updateChildrenLinks`：围栏代码外第一对 children 标记整段换成规范区域；没有 start 标记则插到头部之后（无头部则文件开头，保留 BOM）。

### 5.1 允许写入的范围

| 允许 | 不允许 |
|------|--------|
| 完整文档的 `index.md` | 不完整目录、非 `index.md`、附件 |
| 补缺失的 `name` / `created`；已有 `name` 与目录名对齐 | 改正文、标记外的手写链接、代码块内的示例标记 |
| 已有成对标记时替换标记之间（含标记本身）的内容 | 标记不成对、头部 YAML 损坏时写入 |
| 没有 start 标记时在头部后插入规范区域 | 把修正范围扩到用户操作以外的任意 Markdown |

写入前比较内容：算出来与磁盘相同则不调用 `modify`。

### 5.2 失败时不写

`FrontmatterParseError` 或 `ChildrenLinksError`：Notice `notice.metadataUnchanged`，该文件不写入。其他错误仍按现有扫描错误处理。

## 6. 关闭时：不自动改已有文件

`autoFixDocumentFormat === false` 时：

- 仍扫描目录并刷新侧边栏。
- **不**调用 `syncDocumentMetadata`（或等价地：对每篇文档都不 `vault.modify`）。
- 刷新命令、启动 layout ready、Vault 事件触发的 `scanAndSync` 均遵守此规则。

仍会改文件的情况（不是后台修正）：

| 操作 | 写入 |
|------|------|
| 插件新建文档 | 只写新文档自己的规范 `index.md`（以及父文档的 children 区域，见下） |
| 新建 / 删除 / 重命名 / 移动子文档 | 父文档 children 区域仍经 `updateChildrenLinks` 写成规范格式 |
| 附件归档 | 不受此开关影响 |

关闭时，手写「两个标记紧挨着、中间没有空行」的 `index.md` 在打开库或刷新后必须保持原样。

## 7. 非目标

- 不提供「只规范化空行、不同步子文档列表」的选项。
- 关闭时不保留父文档原有空行风格；用户操作一旦更新链接，即写成规范区域。
- 不修正不完整目录，不把任意 Markdown 变成 NestNote 文档。
- 不改变附件自动归档与「归档当前附件」命令。
- 不增加独立「立即修正全部文档」命令；开启后下一次扫描即修正。

## 8. 测试要点

- 默认与缺省归一化为 `true`；非法值回退为 `true`。
- 设置页能开关，保存失败回滚。
- 开启：现有「layout ready 后补 name、补 children 区域」用例仍成立。
- 关闭：手写无空行的成对标记、缺少 `name` 的头部，在 `onload` + layout ready / refresh 后内容不变。
- 关闭：`create` 子文档仍更新父文档 children 列表（规范空行）。
- 代码块内的标记、不成对 start、损坏 YAML：开启时仍不误写。
