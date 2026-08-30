# NestNote 新建后打开与拖动改嵌套

## 1. 目标

在现有「文件夹即文档」模型上增加两项行为：

1. 新建文档成功后，默认打开该文档，并在 NestNote 面板中选中它、展开其祖先。
2. 在 NestNote 面板中拖动文档，只调整父子嵌套（搬目录），不改变同级顺序。

数据源仍是 Vault 目录结构。父文档受控子链接仍按名称排序。不引入拖放库，不改编辑器、文件列表或命令面板。

## 2. 已确认的选择

- 拖动只改父子关系：放到某文档上成为其子文档；放到树空白处成为根文档。同级仍按名称排序。
- 非法移动：树与 Vault 均不变，松开后用 Notice 说明原因。不在拖动过程中绘制「禁止落点」样式。
- `create` 不在内部调用 `open`。所有新建入口在成功后由调用方打开。
- 使用 HTML5 拖放，不用自绘指针拖放，也不做「只改元数据、不搬目录」。

## 3. 新建后打开

### 3.1 入口

以下四个入口在 `create` 成功后都必须打开新文档：

| 入口 | 父路径 |
|------|--------|
| 侧边栏工具栏「新建文档」 | `null`（Vault 根） |
| 命令 `nestnote:new-document` | `null` |
| 侧边栏行内「新建子文档」 | 该行文档 |
| 命令 `nestnote:new-child-document` | 当前活动 `index.md` 所属文档 |

`create(parentPath, name)` 仍只负责建目录并返回 `DocumentNode`。

### 3.2 成功后的顺序

四个入口共用同一控制流。`open` 失败不回滚创建：

```ts
const node = await documents.create(parentPath, name);
try {
  await documents.open(node.path);
} catch (error) {
  // 现有 fail() / Notice；文档已在磁盘上
}
await requestRefresh(); // 或插件的 scanAndSync()
reveal(node.path);
```

`open` 使用现有 `pickOpenLeaf` 逻辑，避免把文档打开到 NestNote 侧边栏 leaf。

### 3.3 面板 API

`DocumentTreeView` 增加：

```ts
reveal(path: string): void
```

调用方必须在刷新完成、新树已交给视图之后再调用。行为：`selected = path`；把 `path` 的每一级祖先路径（去掉最后一段后的所有前缀，如 `Work/Notes/A` → `Work`、`Work/Notes`）加入 `expanded`；再 `render(this.nodes)`。现有 `render` 仍会丢掉树中不存在的选中路径，因此不要在刷新前 `reveal`。

`DocumentTreeViewOptions.requestRefresh` 改为 `() => Promise<void>`。面板在新建、移动成功后必须 `await` 刷新，再 `reveal`。

插件在命令入口创建成功后，对所有 `VIEW_TYPE_NESTNOTE` 视图调用 `reveal`。

## 4. 拖动改嵌套

### 4.1 服务接口

`DocumentService` 增加：

```ts
move(documentPath: string, newParentPath: string | null): Promise<DocumentNode>
```

`newParentPath === null` 表示搬到 Vault 根。插件装配时与 `create` / `rename` / `trash` 一样包进 `coordinator.runInternal`，避免自己的 rename 与链接写入触发同步循环。`open` 仍不包。

### 4.2 `move` 步骤

与现有 `rename` 同一套路，顺序固定：

1. 规范化路径；源必须是完整文档。目标为根时跳过父文档完整性检查，否则目标必须是完整文档。
2. 若源已在目标父节点下（根到根、或当前父路径等于 `newParentPath`）：直接返回当前扫描节点，不写盘、不 Notice。
3. 拒绝搬到自己，或搬到自己的子孙（按路径前缀：`target === source` 或 `target` 以 `source + "/"` 开头）。
4. 目标处不能已有同名项：`vault.getAbstractFileByPath(destination)` 非空则 `error.targetExists`。根下目标为 `name`，子文档下为 `` `${parent}/${name}` ``。
5. 计算搬完后子树最深完整文档的深度；若大于 `maxChildDepth` 则 `error.maxDepthReached`。深度定义与创建一致：根为 `0`，子文档为 `documentDepth(parent) + 1`。检查必须走磁盘上的完整文档子树（与扫描完整度规则相同），不限于当前面板因 `maxChildDepth` 而隐藏的节点。子树相对高度 = 源节点到其最深完整子孙的深度差；新深度 = `newRootDepth + 相对高度`。
6. 预演旧父、新父的受控链接写入（与 `assertParentWritable` 相同）。任一步失败则在 `vault.rename` 之前中止。
7. `vault.rename` 整个文档目录到新路径（含子文档与附件）。
8. 再读盘并写入：旧父（若存在且仍是完整文档）去掉该子项；新父（若不是根）加上该子项。受控区外正文不改。被搬文档内部的相对子链接不必改写。

不调用 `fileManager.renameFile`，与现有文档 `rename` 保持一致。

### 4.3 面板拖放

只在 NestNote 面板内使用 HTML5 拖放。

- 可拖元素是 `.nestnote-row`（`draggable="true"`）。工具栏、twistie、「新建子文档」「更多」不能启动拖动：这些控件在 `dragstart` 中 `preventDefault`，或不要从它们开始 drag。
- 点 `.nestnote-name` 仍打开文档。真正发生拖动后，这次指针手势不当成点击打开。
- `dragstart` 用 MIME `application/x-nestnote-document-path` 写入源文档路径，`effectAllowed = "move"`。
- 落点高亮用现有 Obsidian 变量和 `.nestnote-*` 前缀（`.is-drop-target`、`.is-drop-root`），不引入新主题。

落点：

| 放到哪 | `newParentPath` |
|--------|-----------------|
| 另一份文档的 `.nestnote-row` / `.nestnote-node` | 该文档路径 |
| 某文档已展开的 `.nestnote-children` 空白处 | 最近的祖先 `.nestnote-node` 路径 |
| `.nestnote-tree` 内、任何 `.nestnote-node` 之外的空白 | `null`（根） |
| 工具栏、面板外、松开时不在树上 | 不是一次 `move`：不调用服务、不 Notice |

节点上的 `drop` 必须 `stopPropagation`，避免冒泡到树容器后被当成「放到根」。

拖动过程中：指针所在文档行加 `is-drop-target`；指针在树空白上时树加 `is-drop-root`。不绘制禁止落点样式。`dragover` 上对合法放置容器 `preventDefault` 以便落下。

松开后：

1. 解析 `newParentPath`，调用 `documents.move(source, newParentPath)`。
2. 成功：`await requestRefresh()`，再 `reveal(搬后的新路径)`，展开新父及其祖先。不调用 `open`。
3. 失败：不改本地树状态，走现有 `fail()`。Vault 未改，随后刷新也仍是原结构。

不做：同级排序、多选拖动、从面板拖到编辑器、键盘拖放、自定义幽灵图。

## 5. 错误处理与文案

非法 `move` 抛 `DocumentServiceError`。面板与命令沿用现有 `fail()` / `isAlreadyNoticed`：已 Notice 过的不重复，否则再 Notice。

| 情况 | 行为 |
|------|------|
| 已在目标父节点下 | 静默返回，不写盘、不 Notice |
| 搬到自己 | `error.cannotMoveIntoSelf` |
| 搬到自己的子孙 | `error.cannotMoveIntoDescendant` |
| 目标下已有同名项 | `error.targetExists` |
| 搬完后最深节点 `> maxChildDepth` | `error.maxDepthReached` |
| 源不是完整文档 | `error.notCompleteDocument` |
| 目标父不存在或不完整 | `error.parentMissing` |
| Frontmatter / 子链接写入失败 | 与 rename 相同：`notice.metadataUnchanged`，`noticed: true` |
| 放到工具栏或面板外 | 不是移动，不 Notice |

两条 key 加入 `MESSAGE_KEYS` 以及 `zh.ts` / `en.ts`；现有 i18n 完整性测试必须覆盖它们。

中英文新增：

| Key | zh | en |
|-----|----|----|
| `error.cannotMoveIntoSelf` | 不能将文档移动到自身 | Cannot move a document into itself |
| `error.cannotMoveIntoDescendant` | 不能将文档移动到自己的子文档中 | Cannot move a document into its descendant |

## 6. 测试

### 6.1 `DocumentService.move`

- 根文档搬到另一根文档下；子文档搬到另一父文档下；子文档搬回根。
- 已在该父节点下：不 `rename`、不改任何 `index.md`。
- 搬到自己、搬到子孙：抛对应错误，目录仍在原处。
- 目标同名：`error.targetExists`。
- 子树搬完后最深深度超过 `maxChildDepth`：拒绝且不 rename（含「源节点看起来合法、但子孙会超限」）。
- 旧父去掉链接、新父加上链接，双方正文与 Frontmatter 其余部分不变；链接仍按名称排序。
- 被搬文档自己的受控相对子链接在搬后仍正确。

### 6.2 新建后打开

- 四个入口成功后都调用 `open(新文档路径)`。
- 面板在刷新后选中新节点，并展开祖先。
- `open` 失败时仍刷新树并 `reveal`，且不把创建当作失败回滚。

### 6.3 面板拖放

- 拖到另一行：`move(源路径, 目标路径)`。
- 拖到树空白：`move(源路径, null)`。
- 从 twistie / 行内按钮开始的 `dragstart` 被取消，不调用 `move`。
- `move` 拒绝时不 `requestRefresh` 也不断言树被本地改写；调用 `notice`。
- 不测浏览器幽灵图像素，不测面板外松开。

## 7. 文档与非目标

README 补充：

- 新建根文档或子文档后会打开对应 `index.md`。
- 可在 NestNote 面板拖动文档调整嵌套；不能靠拖动改变同级顺序。

非目标：自动修复不完整目录、自定义同级顺序、拖到编辑器、无障碍键盘拖放、用 `fileManager.renameFile` 改写用户正文里的手写链接。
