# NestNote

NestNote 是一个 [Obsidian](https://obsidian.md/) 插件，将 **文件夹即文档** 作为知识组织模型。每个文档是一个包含 `index.md` 和 `attachments/` 的目录，可按设置嵌套子文档（默认最多 5 级，可在 `0～9` 间调整）。插件通过自定义侧边栏展示和操作文档树，Vault 文件系统是唯一数据源，不引入额外索引数据库。

- **显示名称：** NestNote
- **插件 ID：** `nest-note`
- **最低 Obsidian 版本：** 1.5.0
- **界面语言：** 跟随 Obsidian 应用语言。简体中文和繁体中文显示简体中文，其他语言显示英文。

## 安装

### 从源码构建

```bash
git clone https://github.com/exbob/obsidian-nest-note.git
cd obsidian-nest-note
npm install
./build.sh
```

构建完成后，将 `nest-note/` 目录直接复制到你的 Vault 的 `.obsidian/plugins/` 下（即 `.obsidian/plugins/nest-note/`）。该目录包含：

| 文件 | 说明 |
|------|------|
| `main.js` | 插件入口（构建产物） |
| `manifest.json` | 插件清单 |
| `styles.css` | 侧边栏与对话框样式 |

`./build.sh clean` 只清除 `main.js`、`main.js.map`（若存在）和 `./nest-note/`，不执行构建。

在 Obsidian 中打开 **设置 → 社区插件**，启用 **NestNote**。

## 提交到 Obsidian 社区插件

1. 确保 GitHub 仓库为公开仓库，并包含根目录下的 `README.md`、`LICENSE` 和 `manifest.json`。
2. 运行 `bash build.sh`，使用 `nest-note/` 中的 `main.js`、`manifest.json` 和 `styles.css` 创建 GitHub Release。Release 标签必须与 `manifest.json` 的 `version` 完全一致（例如 `0.2.0`，不要加 `v`）。
3. 登录 [Obsidian Community](https://community.obsidian.md/)，关联 GitHub 账号，提交仓库 `exbob/obsidian-nest-note` 进行自动审核。

后续版本只需更新 `manifest.json` 的版本号、推送代码，并创建相同标签的新 GitHub Release；不需要重复提交社区目录。详见 [Obsidian 插件发布文档](https://docs.obsidian.md/plugins/releasing/submit-plugin)。

### 开发模式

```bash
npm run dev    # 监听源码变更并重新构建
npm test       # 运行单元/集成测试
npx tsc --noEmit   # TypeScript 类型检查
```

## 文档目录结构

一个 **完整文档目录** 必须同时满足：

1. 目录中存在 `index.md`
2. 目录中存在 `attachments/` 子目录
3. 目录名称即文档名称

`attachments/` 是保留目录名，不会被识别为子文档。

### 完整示例（三层嵌套）

```text
Vault 根/
├── Work/                          ← 根文档
│   ├── index.md
│   ├── attachments/
│   ├── 项目 A/                    ← 一级子文档
│   │   ├── index.md
│   │   ├── attachments/
│   │   └── 里程碑 1/              ← 二级子文档
│   │       ├── index.md
│   │       └── attachments/
│   └── 项目 B/
│       ├── index.md
│       └── attachments/
├── 笔记 草稿/                     ← 含空格和中文的文档名
│   ├── index.md
│   └── attachments/
└── random-note.md                 ← 普通 Markdown，被忽略
```

### 会被忽略的内容

| 类型 | 示例 | 原因 |
|------|------|------|
| 普通 Markdown 文件 | `notes/ideas.md` | 不是完整文档目录 |
| 缺少 `index.md` 的目录 | `draft/`（仅有 `attachments/`） | 不完整 |
| 缺少 `attachments/` 的目录 | `draft/`（仅有 `index.md`） | 不完整 |
| 名为 `attachments` 的目录 | `Work/attachments/` | 保留名，不作为文档 |

## Frontmatter

新建文档时，`index.md` 头部自动写入：

```yaml
---
name: Work
created: 2026-08-28T19:00:00+08:00
---
```

| 字段 | 说明 |
|------|------|
| `name` | 默认等于所在目录名称；目录重命名后自动同步 |
| `created` | 首次创建时写入 ISO 8601 时间戳，后续不修改 |

**行为规则：**

- 目录名称是文档名称的 **唯一权威来源**
- 缺少 Frontmatter 时，插件在正文前补充完整 Frontmatter，**不修改原正文**
- Frontmatter YAML 解析异常时，**不覆盖正文**，并通过 Notice 提示元数据异常

## 受控子文档链接

父文档的 `index.md` 包含由插件维护的受控区域：

```markdown
<!-- nestnote:children:start -->
- [项目 A](项目%20A/index.md)
- [项目 B](项目%20B/index.md)
<!-- nestnote:children:end -->

这里是用户正文，插件不会修改此区域以外的内容。
```

**规则：**

- 新建、删除、重命名子文档时，仅更新受控区域内的链接列表
- 链接按文档名称排序
- 使用标准 Markdown 相对路径；空格和特殊字符按 RFC 3986 编码（如 `%20`）
- 用户正文中手写的链接 **不会被扫描、删除或改写**
- 找不到受控区域时，在 Frontmatter 之后自动创建

## 原生附件兼容

插件 **不注册** 名为「插入附件」的命令，Obsidian 原生的粘贴/插入/拖拽附件行为完全保留。

当满足以下条件时，插件自动将新建附件归档到当前文档的 `attachments/` 目录：

1. 当前活动文件是某个已识别完整文档的 `index.md`
2. Obsidian 创建了附件文件（图片、PDF、音视频等）
3. 附件尚未位于该文档的 `attachments/` 下
4. 来源属于以下之一：
   - 当前文档目录的直接子文件（与 `index.md` 同级）
   - Vault 根目录
   - 解析后的 Obsidian `attachmentFolderPath`（`vault.getConfig("attachmentFolderPath")` 或 `vault.config.attachmentFolderPath`，支持 `./` 相对当前文档目录）。`fileManager.getNewFileParent(sourcePath)` 是 1.5.x 新笔记位置 API，不能当作附件目录，也不能覆盖 `attachmentFolderPath`；仅在读不到该配置时可用带附件路径的补充探测。

**绝不移动：** 已位于其他完整文档 `attachments/` 下的文件、位于其他完整文档目录内的文件、以及无法判断的路径（例如 `Inbox/`）。这些情况在 Vault `create` 事件中**静默保留**原位置，避免刷屏；手动命令 **NestNote：归档当前附件** 失败时仍会 Notice。

归档时使用可用路径策略解决文件名冲突（如 `image 1.png`）。

**备用命令：** `NestNote：归档当前附件`（`nestnote:archive-current-attachment`）—— 手动将当前打开的附件移入所属文档的 `attachments/`。所属文档仍按附件路径向上解析；解析失败或无法安全移动时 Notice 并保留原位置。

## 侧边栏与操作

点击左侧 ribbon 图标（folder-tree）或执行命令 **NestNote：打开文档树** 打开自定义侧边栏。

| 操作 | 方式 |
|------|------|
| 打开文档 | 点击侧边栏中的文档名称 |
| 新建子文档 | 侧边栏文档行上的按钮 |
| 重命名 | 侧边栏文档行「更多」→ 重命名 |
| 删除 | 侧边栏文档行「更多」→ 删除；**任何删除均需确认** |
| 全部展开 / 全部折叠 | 工具栏按钮。只要有一个可展开节点未展开，显示「全部展开」；全部展开后切换为「全部折叠」。没有可展开节点时按钮禁用。只更新视图展开状态，不触发文件扫描 |
| 刷新 | 工具栏按钮、命令 **NestNote：刷新**，或 Vault 文件变化后自动全量重新扫描 |

### 新建入口说明

| 入口 | 创建位置 | 说明 |
|------|----------|------|
| 侧边栏工具栏「新建文档」 | Vault 根 | 不受侧边栏选中态影响 |
| 命令 **NestNote：新建文档**（`nestnote:new-document`） | Vault 根 | 与工具栏按钮等效 |
| 侧边栏某文档行「新建子文档」 | 该行文档下 | 以目标节点为父文档 |
| 命令 **NestNote：新建子文档**（`nestnote:new-child-document`） | 当前活动文档下 | **须先打开父文档的 `index.md`**；按编辑器当前活动文件所属文档创建，不读取侧边栏选中态 |

名称对话框中输入名称后按 **Enter** 或点击确认即可创建并关闭对话框；空名称不提交。名称包含路径禁止字符（`/ \ : * ? " < > |`）、Windows 保留设备名（CON、PRN、AUX、NUL、COM1–9、LPT1–9，含大小写与扩展名形式）、尾随点或尾随空格，或目标已存在时，操作被阻止并提示原因。达到当前最大子文档层级后，新建更深子文档会被拒绝且不写入 Vault。

## 设置

在 Obsidian **设置 → NestNote** 中可配置：

| 设置项 | 说明 |
|--------|------|
| 最大子文档层级 | 范围 `0～9`，默认 `5`。根文档为 `0` 级；超出限制的目录不显示，也无法创建更深子文档。设为 `0` 时只显示根文档 |
| 启动时打开 NestNote 面板 | 默认开启。插件在布局准备且首次扫描完成后自动打开 NestNote 面板；关闭后下次启动不再自动打开 |

## 删除与回收站

- **任何删除操作前均显示确认提示**（无论文档是否含子文档）
- 确认后将 **整个文档目录**（含 `index.md`、附件和所有子文档）移入 Obsidian 回收站
- 优先使用 `fileManager.trashFile`；Obsidian 版本不支持时回退 `vault.trash(folder, false)`（本地回收站）
- 从回收站恢复目录后，插件在 Vault 事件触发后自动全量重新扫描并重新识别
- 删除失败时保留侧边栏状态并显示错误 Notice

## 命令列表

| 命令 ID | 显示名称 |
|---------|----------|
| `nestnote:open-document-tree` | 打开文档树 |
| `nestnote:new-document` | 新建文档 |
| `nestnote:new-child-document` | 新建子文档 |
| `nestnote:refresh` | 刷新 |
| `nestnote:archive-current-attachment` | 归档当前附件 |

> Obsidian 可能为命令 ID 自动加上插件前缀（如 `nest-note:nestnote:open-document-tree`），以实际命令面板显示为准。

## 验证

### 自动化验证（已通过）

以下命令在本仓库开发环境中执行并通过：

```bash
npm test              # Vitest 全量测试
npx tsc --noEmit      # TypeScript 类型检查
npm run build         # 生产构建
bash build.sh clean   # 只清除产物，不构建
bash build.sh         # 成功后写入 nest-note/
```

| 检查项 | 结果 |
|--------|------|
| Vitest 全量测试 | 10 个测试文件，149 个用例全部通过 |
| 单元测试（目录识别、Frontmatter、受控链接、路径编码、设置规范化、层级裁剪等） | 通过 |
| 集成测试（创建/重命名/删除、附件归档、事件同步、插件生命周期、面板交互） | 通过 |
| TypeScript 类型检查（`tsc --noEmit`） | 通过，无诊断输出 |
| 生产构建（`esbuild` → `main.js`） | 通过 |
| `bash build.sh clean` | 通过；清除 `main.js`、`main.js.map`（若存在）和 `./nest-note/`，不执行构建 |
| `bash build.sh` | 通过；`nest-note/` 仅含 `main.js`、`manifest.json`、`styles.css` |

### 手工验收（需在 Obsidian 中验证）

以下项目 **未在本开发环境中执行**，不要视为已通过。需要用户在真实 Obsidian Vault 中逐项确认：

| # | 验收项 | 状态 |
|---|--------|------|
| 1 | 创建根文档和三层嵌套子文档 | **未执行 — 需用户在 Obsidian 中验证** |
| 2 | 父文档链接区域只包含当前子文档且正文不变 | **未执行 — 需用户在 Obsidian 中验证** |
| 3 | 打开文档、重命名文档、删除含子文档的文档 | **未执行 — 需用户在 Obsidian 中验证** |
| 4 | 通过 Obsidian 原生命令粘贴/插入图片，确认附件进入当前 `attachments/` | **未执行 — 需用户在 Obsidian 中验证** |
| 5 | 创建普通 Markdown 文件和不完整目录，确认它们不显示 | **未执行 — 需用户在 Obsidian 中验证** |
| 6 | 从回收站恢复目录，确认刷新后重新显示 | **未执行 — 需用户在 Obsidian 中验证** |
| 7 | 快速连续执行文件操作，确认没有重复链接或无限刷新 | **未执行 — 需用户在 Obsidian 中验证** |
| 8 | 使用含空格、中文和特殊字符的文档名称 | **未执行 — 需用户在 Obsidian 中验证** |
| 9 | 默认启动后 NestNote 面板自动出现 | **未执行 — 需用户在 Obsidian 中验证** |
| 10 | 关闭「启动时打开 NestNote 面板」后重启，面板不自动出现 | **未执行 — 需用户在 Obsidian 中验证** |
| 11 | 默认最大层级下可创建到第 5 级，第 6 级被拒绝 | **未执行 — 需用户在 Obsidian 中验证** |
| 12 | 最大子文档层级设为 `0` 时只显示根文档 | **未执行 — 需用户在 Obsidian 中验证** |
| 13 | 最大子文档层级设为 `9` 时允许第 9 级 | **未执行 — 需用户在 Obsidian 中验证** |
| 14 | 输入名称后按 Enter 能创建并关闭对话框 | **未执行 — 需用户在 Obsidian 中验证** |
| 15 | 全部展开、全部折叠覆盖整棵树 | **未执行 — 需用户在 Obsidian 中验证** |
| 16 | 设置页和新增按钮遵循当前 Obsidian 主题 | **未执行 — 需用户在 Obsidian 中验证** |
| 17 | 从 `nest-note/` 复制到 Vault 插件目录后可正常启用 | **未执行 — 需用户在 Obsidian 中验证** |
| 18 | Obsidian 语言设为简体或繁体中文后重启，设置/命令/侧边栏/对话框/Notice 为简体中文 | **未执行 — 需用户在 Obsidian 中验证** |
| 19 | Obsidian 语言设为英文或其他语言后重启，上述界面为英文；`NestNote` 与命令 ID 不变 | **未执行 — 需用户在 Obsidian 中验证** |

### 已知限制

- 插件不自动修复不完整目录，也不转换普通 Markdown 文件
- **全量扫描：** Vault 事件触发后重新扫描整个 Vault 并重建文档树，当前 MVP 未实现按受影响分支的增量刷新
- **新建入口差异：**
  - 侧边栏工具栏「新建文档」与命令 `nestnote:new-document` 始终在 Vault 根创建
  - 侧边栏文档行「新建子文档」以该行文档为父节点
  - 命令 `nestnote:new-child-document` 须先打开父文档 `index.md`，按当前活动文件所属文档创建，不读取侧边栏选中态
- 附件自动归档仅在能安全关联到当前活动 `index.md` 时触发：允许来源为当前文档目录直接子文件、Vault 根目录、或解析后的 `attachmentFolderPath`（含 `./` 相对路径）；`getNewFileParent(sourcePath)` 不作为附件目录。其他完整文档目录/`attachments/` 与无法判断的路径绝不移动，Vault 创建事件对此静默保留
- 删除优先 `fileManager.trashFile`；旧版本 Obsidian 回退 `vault.trash(..., false)`（本地回收站）
- **子文档层级：** 超出「最大子文档层级」的完整文档目录仍留在 Vault 中，但扫描结果不显示，也无法通过插件创建更深子文档

## 项目结构

```text
build.sh                             # 生产构建并写入 nest-note/；clean 只清除产物
main.js                              # 构建产物（插件入口）
manifest.json                        # 插件清单
styles.css                           # 侧边栏与对话框样式
nest-note/                           # 可直接复制到 Vault 的安装目录
src/
├── main.ts                          # 插件源码入口、命令、模块装配
├── types.ts                         # 共享类型
├── settings.ts                      # 设置模型、默认值与规范化
├── domain/
│   ├── document-scanner.ts          # 完整文档识别与树构建
│   ├── frontmatter.ts               # Frontmatter 读写
│   └── children-links.ts            # 受控子文档链接
├── services/
│   ├── document-service.ts          # 创建、重命名、删除、打开
│   ├── attachment-service.ts        # 附件监听与归档
│   └── vault-event-coordinator.ts   # Vault 事件合并与刷新
└── ui/
    ├── document-tree-view.ts        # 侧边栏视图
    └── settings-tab.ts              # 设置页
tests/                               # Vitest 测试
docs/superpowers/specs/              # 设计规格文档
```
