# NestNote 侧边栏同级拖动排序

## 1. 目标

在 NestNote 面板里，把文档拖到同级兄弟的上方或下方即可改子文档顺序。拖到另一篇文档正中，仍然是变成它的子文档。顺序写在父文档 `index.md` 的 children 标记区，不另建索引库，不改目录名。

根文档没有父 `index.md`，第一版不支持自定义顺序，仍按名称排序。

## 2. 已确认的选择

- **顺序来源：** 父文档 `<!-- nestnote:children:start -->` 与 `<!-- nestnote:children:end -->` 之间的链接顺序。侧边栏与正文子链接共用这份顺序。
- **根文档：** 仍按 `name.localeCompare` 排序。整行都是「成为它的子文档」。要变成根文档，仍拖到树的空白处。
- **新建：** 新子文档接到该父文档列表末尾。多个同时出现的未知子文档之间按名称排。
- **扫描 / 自动修正：** 保留已有顺序；列表里没有的真实子文档按名称追加；失效链接删掉。不再按名称重排整份列表。
- **手改列表：** 改标记区内顺序会反映到侧边栏；自动修正只规范化格式并补全/删除链接，不按名称改回去。
- **Obsidian 文件列表：** 不改目录名，资源管理器顺序不变。
- **拖放：** 继续用面板内 HTML5 拖放，不引入拖放库。行上沿/下沿插入同级，行正中改嵌套。
- **非法 `insertBeforePath`：** 接到末尾，不另报错。拖到自己的前/后不调用 `move`。

不做：根文档自定义顺序、多选、键盘拖放、目录名前缀、frontmatter `order`、从面板拖到编辑器、改 Obsidian 文件列表顺序。

## 3. 落点与拖放

可拖元素、MIME、`effectAllowed`、按钮不能启动拖动，均与现有拖动改嵌套相同。

### 3.1 行内热区

指针在目标 `.nestnote-row` 上的垂直位置（相对该行 `getBoundingClientRect()`）：

| 指针位置 | 含义 | 高亮 |
|----------|------|------|
| 上沿 25%（`y < height * 0.25`） | 插到该文档前面，成为它的同级 | `.nestnote-node.is-drop-before` |
| 中间 50% | 成为该文档的子文档 | 现有 `.nestnote-node.is-drop-target` |
| 下沿 25%（`y >= height * 0.75`） | 插到该文档后面，成为它的同级 | `.nestnote-node.is-drop-after` |

插入相对的是目标在**其父节点下的兄弟列表**，不是屏幕上拍扁后的下一行。折叠节点的「下方」仍是它的下一个兄弟，不会插进子树末尾。

**根文档行没有前/后热区。** 整行只走「成为子文档」（`is-drop-target`）。

其它落点：

| 放到哪 | 行为 |
|--------|------|
| 已展开的 `.nestnote-children` 空白处 | 成为该文档的子文档，接到末尾 |
| `.nestnote-tree` 内、任何 `.nestnote-node` 之外的空白 | 成为根文档（根仍按名称排序） |
| 工具栏、面板外 | 不是一次操作：不调用服务、不 Notice |

节点上的 `drop` 必须 `stopPropagation`，避免冒泡成「放到根」。`dragover` 对合法容器 `preventDefault`。同时只显示一种高亮；`clearDropHighlights` 须清掉 `is-drop-target`、`is-drop-before`、`is-drop-after`、`is-drop-root`。

插入线用现有 Obsidian 变量和 `.nestnote-*` 前缀，例如行顶/行底 `box-shadow` 用 `--interactive-accent`。不引入新主题。不绘制禁止落点样式。

### 3.2 面板如何调用 `move`

根据落点计算 `(newParentPath, insertBeforePath)`，然后：

```ts
await documents.move(sourcePath, newParentPath, insertBeforePath);
await requestRefresh();
this.reveal(moved.path);
```

| 落点 | `newParentPath` | `insertBeforePath` |
|------|-----------------|-------------------|
| 行上沿（非根） | 目标的父路径 | 目标路径 |
| 行下沿（非根） | 目标的父路径 | 目标的下一个兄弟路径；没有下一个兄弟则为 `null` |
| 行正中，或根文档整行 | 目标路径 | `null`（接到新父末尾） |
| 展开子列表空白 | 该文档路径 | `null` |
| 树空白 | `null` | 忽略 |

「下一个兄弟」取当前已渲染树里、与目标同父的下一项。源自己不算下一个兄弟：若视觉上下一项就是源，则再取再下一个；没有则 `null`。

**空操作（不调用 `move`）：**

- `sourcePath` 为空
- 拖到自己的前/后热区（目标路径等于源路径，且落点是上沿或下沿）

拖到自己正中仍调用 `move(源, 源, null)`，由服务层抛 `error.cannotMoveIntoSelf`。

失败走现有 `fail()`：不 `requestRefresh`，不改本地树。

## 4. 顺序的读写

### 4.1 解析

在 `children-links.ts` 增加解析：从围栏代码外第一对 children 标记之间取出链接顺序。每条认 Markdown 列表链接 `- [label](path)`，顺序键是链接路径里的子文档目录名（`项目%20A/index.md` → `项目 A`），不认显示文字。解码 `%20` 等百分号编码。不是该形式的行忽略。

找不到成对标记、标记在围栏内、或解析抛错：视为「没有自定义顺序」。

### 4.2 合并

纯函数 `mergeChildrenOrder(orderedNames: readonly string[], live: readonly DocumentNode[]): DocumentNode[]`：

1. 按 `orderedNames` 依次取出仍存在于 `live` 中的节点（按 `name` 匹配，每个节点只用一次）
2. `live` 中未出现在 `orderedNames` 的节点，按 `name.localeCompare` 排在后面
3. 返回新数组，不改传入的 `live`

没有自定义顺序时，`orderedNames` 为空，结果等于 `live` 按名称排序。

扫描时：先按现有规则建树（结构仍来自文件夹），再对每个**非根**节点读其 `index.md`，用解析出的名字重排 `children`。某一级读失败或无标记，该级按名称排，不打倒整棵树。根级列表始终按名称排。再递归处理每一级。

`performScanAndSync` 必须在 `syncDocumentMetadata` **之前**排好序，这样自动修正写入的是自定义顺序，不会按名称覆盖。

`scanDocuments` 可以继续按名称排序作为结构扫描的默认值；插件和服务在读完 `index.md` 后覆盖 `children` 顺序。

### 4.3 写入

`updateChildrenLinks` **不再**对 `children` 做 `localeCompare`。写出顺序等于传入数组顺序。规范空行、相对路径、`%20`、围栏外第一对标记、缺失标记时插到头部后，均不变。

所有父文档链接写入都先得到「应存在的 live 子节点」，再决定顺序：

| 操作 | 顺序 |
|------|------|
| 新建子文档 | `mergeChildrenOrder(文件中的顺序, 含新节点的 live)`，新节点不在旧列表里故排到末尾 |
| 删除子文档 | merge，被删节点已不在 live 中故从列表消失 |
| 重命名子文档 | 用新 `name`/`path` 替换 live 中对应项后 merge；若旧名仍在解析结果里，按 `path` 对不上的名字视为失效，新名作为未知项接到后面——**不允许**。重命名必须保持该节点在列表中的位置：在 merge 之前把 `orderedNames` 里的旧名换成新名 |
| 同父重排 | 见 5.2，显式 splice，不走「未知项追加」 |
| 换父 | 旧父：merge（源已不在 live）。新父：merge 后再按 `insertBeforePath` 插入源节点 |
| 自动修正 | `mergeChildrenOrder(文件中的顺序, 扫描得到的 live children)` |

`computeParentWrite` / `freshParentWrite` 不得直接使用扫描得到的、可能仍按名称排的 `parent.children` 数组当作写出顺序。必须读当前文件内容并 merge（重排/带插入位置的换父除外，见第 5 节）。

## 5. `DocumentService.move`

```ts
move(
  documentPath: string,
  newParentPath: string | null,
  insertBeforePath?: string | null,
): Promise<DocumentNode>
```

第三个参数省略或 `null` 表示接到目标父节点子列表末尾。插件装配仍包进 `coordinator.runInternal`。

### 5.1 换父（`oldParent !== newParent`）

现有拒绝条件与步骤不变：自己、子孙、目标同名、超深度、预演写入、`vault.rename`、再写旧父/新父链接。

差异：

- **目标为根**（`newParentPath === null`）：忽略 `insertBeforePath`。根顺序不写入任何文件。
- **目标为文档：** 新父写出顺序 = `placeChild(merge(新父文件顺序, 新父 live 且不含源), 源节点, insertBeforePath)`。
- 旧父仍 merge 掉源节点。

`placeChild(siblings, node, insertBeforePath)`：

- `insertBeforePath` 为 `null`、省略、等于 `node.path`、或不在 `siblings` 里 → 追加
- 否则插到该路径节点之前

### 5.2 同父重排（`oldParent === newParent` 且父不是根）

**不再**因同父而直接 return。不 `vault.rename`。

1. 读父文档，`current = merge(文件顺序, 当前 live)`（live 含源）
2. `without = current.filter(c => c.path !== documentPath)`
3. `next = placeChild(without, 源节点, insertBeforePath)`
4. 若 `next` 与 `current` 的 path 序列相同：不写盘、不 Notice，返回当前扫描节点
5. 否则只把父文档 children 区域写成 `next` 的顺序

面板已禁止拖到自己前/后。服务层再兜底：同父且 `insertBeforePath === documentPath` 视为位置未变，不写盘，**不要**把该文档挪到末尾。

### 5.3 根下的「同父」

源已在根下且 `newParentPath === null`：忽略插入位置，与现在一样直接返回，不写盘。不能靠 `move` 改变根顺序。

## 6. 错误处理

不新增 i18n key。

| 情况 | 行为 |
|------|------|
| 已在目标父下且顺序不变 | 不写盘、不 Notice |
| 同父重排到新位置 | 只改父文档列表 |
| 非法 `insertBeforePath` | 接到末尾；同父且等于源路径则 no-op |
| 搬到自己 / 子孙 / 同名 / 超深度 | 与现在相同 |
| 扫描时某一级标记解析失败 | 该级按名称排 |
| Frontmatter / 不成对标记写入失败 | 与现在相同：`notice.metadataUnchanged` |
| 拖到工具栏或面板外 | 不是操作，不 Notice |

## 7. 测试

### 7.1 解析与 merge（`tests/children-links.test.ts`）

- 按标记区链接顺序取出文档名；认路径不认 label；解码 `%20`
- 忽略非列表链接行
- `mergeChildrenOrder`：保留有效顺序、未知项按名称追加、失效名丢掉
- `updateChildrenLinks` 按传入数组顺序写，不再按名称排
- 空 `orderedNames` 时 merge 结果为按名称排序的 live

### 7.2 扫描顺序

- 父文档列表为 B 再 A 时，树中该父的 `children` 为 B、A
- 无标记或不成对：该级按名称
- 磁盘上多出的子文档按名称接在列表后
- 根节点之间仍按名称，即使某根文档的子列表有自定义顺序

### 7.3 `DocumentService.move` / create / rename

- 同父重排只改列表，不 `rename`；已在目标位置不写盘
- 同父、`insertBeforePath` 等于源路径：不写盘
- 换父并指定插入位置：目录搬走，旧父去掉链接，新父插到指定位置，其余相对顺序保留
- 搬到根：忽略插入位置，根扫描结果仍按名称
- 新建子文档出现在父列表末尾，已有自定义顺序不被名称排序打乱
- 重命名子文档后该条仍在原位置，名字更新

### 7.4 自动修正

- 开启：规范化空行与链接格式，但不把自定义顺序改回按名称
- 关闭：扫描仍不改已有文件；用户新建子文档仍更新父列表且接到末尾

### 7.5 面板（`tests/document-tree-view.test.ts`）

- 行上沿：`move(源, 目标父, 目标)`
- 行下沿：`move(源, 目标父, 下一兄弟或 null)`
- 行正中：`move(源, 目标, null)`
- 树空白：`move(源, null)`
- 根文档行只有正中语义（成为其子文档），没有前/后插入调用
- 拖到自己前/后：不调用 `move`
- 热区用模拟的 `clientY` + stub 的行高度即可，不测真实像素绘制

不测浏览器幽灵图、面板外松开。

## 8. 文档

README / README_zh：

- 侧边栏操作表：「调整嵌套」改为可拖到兄弟上方/下方排序；拖到文档上仍成为其子文档；根文档仍按名称排序
- 子文档链接段：去掉「按文档名排序」；改为按标记区顺序，新建接到末尾，扫描/自动修正保留该顺序
- 自动修正说明与上条一致，不再写「写成按名称排序的规范列表」

## 9. 非目标

根文档自定义顺序、多选拖动、键盘拖放、目录名前缀、`order` YAML 字段、改资源管理器顺序、从面板拖到编辑器、用 `fileManager.renameFile` 改写手写链接。
