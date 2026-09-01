# Auto-Fix Document Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default-on setting that gates background scan rewrites of complete-document `index.md` files, while create/delete/rename/move still update parent child-link regions.

**Architecture:** Extend `NestNoteSettings` with `autoFixDocumentFormat`. `performScanAndSync` calls `syncDocumentMetadata` only when the flag is true. Document service writes are unchanged. Settings tab gets a third toggle; i18n keys match the spec table.

**Tech Stack:** TypeScript, Obsidian `PluginSettingTab` / `Setting.addToggle`, Vitest + happy-dom. No new dependencies.

## Global Constraints

- Setting field name is exactly `autoFixDocumentFormat: boolean`; default `true`.
- Normalize: use the value only when it is a boolean; missing/`null`/strings fall back to `true`.
- Toggle copy keys: `setting.autoFixDocumentFormatName` / `setting.autoFixDocumentFormatDesc` (zh/en exactly as in spec §4.2).
- Scan/refresh/layout-ready/vault-event `scanAndSync` must not `vault.modify` existing files when the flag is false.
- Create/delete/rename/move still run `updateChildrenLinks` on the parent regardless of the flag.
- Auto-fix still uses existing `transformDocumentIndex` (frontmatter + children region); do not add a second rewrite path.
- Metadata scan depth remains `9`; UI tree still uses `maxChildDepth`.
- Attachment archival is not gated by this setting.
- Tests: `npx vitest run` (Windows PowerShell). Do not skip hooks on commit.

---

### Task 1: Settings field, i18n, and settings tab

**Files:**
- Modify: `src/settings.ts`
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/ui/settings-tab.ts`
- Modify: `tests/settings.test.ts`
- Modify: `tests/plugin-lifecycle.test.ts` (persist assertion only)

**Interfaces:**
- Consumes: existing `NestNoteSettings`, `NestNoteSettingTab`, `t()`
- Produces: `NestNoteSettings.autoFixDocumentFormat: boolean`; `DEFAULT_NESTNOTE_SETTINGS.autoFixDocumentFormat === true`; `normalizeNestNoteSettings` always returns the field; settings tab third toggle

- [ ] **Step 1: Write the failing tests**

In `tests/settings.test.ts`, update every full-object `toEqual` to include `autoFixDocumentFormat: true` unless the case is proving `false` is kept. Add these cases (keep existing ones, just extend expected objects):

```ts
  it("returns defaults for missing data", () => {
    expect(normalizeNestNoteSettings(undefined)).toEqual({
      maxChildDepth: 5,
      openPanelOnStartup: true,
      autoFixDocumentFormat: true,
    });
  });

  it("keeps valid values from persisted data", () => {
    expect(
      normalizeNestNoteSettings({
        maxChildDepth: 9,
        openPanelOnStartup: false,
        autoFixDocumentFormat: false,
      }),
    ).toEqual({
      maxChildDepth: 9,
      openPanelOnStartup: false,
      autoFixDocumentFormat: false,
    });
  });

  it("falls back only invalid fields", () => {
    expect(
      normalizeNestNoteSettings({
        maxChildDepth: 10,
        openPanelOnStartup: "yes",
        autoFixDocumentFormat: "yes",
      }),
    ).toEqual(DEFAULT_NESTNOTE_SETTINGS);
  });

  it("accepts zero as the minimum depth", () => {
    expect(normalizeNestNoteSettings({ maxChildDepth: 0 })).toEqual({
      maxChildDepth: 0,
      openPanelOnStartup: true,
      autoFixDocumentFormat: true,
    });
  });

  it("defaults auto-fix to true when the field is missing", () => {
    expect(
      normalizeNestNoteSettings({
        maxChildDepth: 3,
        openPanelOnStartup: false,
      }),
    ).toEqual({
      maxChildDepth: 3,
      openPanelOnStartup: false,
      autoFixDocumentFormat: true,
    });
  });
```

Add tab helpers after `startupToggle`:

```ts
function switchAt(tab: NestNoteSettingTab, index: number): HTMLElement {
  const toggles = tab.containerEl.querySelectorAll('[role="switch"]');
  const toggle = toggles[index];
  if (!(toggle instanceof HTMLElement)) {
    throw new Error(`missing settings toggle at ${index}`);
  }
  return toggle;
}

function startupToggle(tab: NestNoteSettingTab): HTMLElement {
  return switchAt(tab, 0);
}

function autoFixToggle(tab: NestNoteSettingTab): HTMLElement {
  return switchAt(tab, 1);
}
```

Extend `"renders the depth and startup settings"` to also assert auto-fix copy and default checked state (rename the test to `"renders depth, startup, and auto-fix settings"`):

```ts
    expect(text).toContain(t("setting.autoFixDocumentFormatName"));
    expect(text).toContain(t("setting.autoFixDocumentFormatDesc"));
    expect(autoFixToggle(tab).getAttribute("aria-checked")).toBe("true");
```

Add:

```ts
  it("saves auto-fix toggle changes and notifies the host", async () => {
    const { tab, host } = mountTab({ autoFixDocumentFormat: true });
    autoFixToggle(tab).click();
    await Promise.resolve();

    expect(host.settings.autoFixDocumentFormat).toBe(false);
    expect(host.saveSettings).toHaveBeenCalledTimes(1);
    expect(host.onSettingsChanged).toHaveBeenCalledTimes(1);
  });

  it("rolls back the auto-fix toggle and shows a Notice when saveSettings fails", async () => {
    const { tab, host } = mountTab({ autoFixDocumentFormat: true });
    host.saveSettings.mockRejectedValueOnce(new Error("persist failed"));
    autoFixToggle(tab).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(host.settings.autoFixDocumentFormat).toBe(true);
    expect(autoFixToggle(tab).getAttribute("aria-checked")).toBe("true");
    expect(host.saveSettings).toHaveBeenCalledTimes(1);
    expect(host.onSettingsChanged).not.toHaveBeenCalled();
    expect(noticeHarness().messages.length).toBeGreaterThan(0);
  });
```

In `tests/plugin-lifecycle.test.ts` `"persists the current settings through saveSettings"`, extend the expected object:

```ts
    expect(harness(plugin).persistedData).toEqual({
      maxChildDepth: 2,
      openPanelOnStartup: false,
      autoFixDocumentFormat: true,
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/settings.test.ts tests/plugin-lifecycle.test.ts
```

Expected: FAIL — `autoFixDocumentFormat` missing from settings / copy keys not in `t()` / persist object missing the field.

- [ ] **Step 3: Write minimal implementation**

`src/settings.ts`:

```ts
export interface NestNoteSettings {
  maxChildDepth: number;
  openPanelOnStartup: boolean;
  autoFixDocumentFormat: boolean;
}

export const DEFAULT_NESTNOTE_SETTINGS: NestNoteSettings = {
  maxChildDepth: 5,
  openPanelOnStartup: true,
  autoFixDocumentFormat: true,
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
  const autoFixDocumentFormat =
    typeof record.autoFixDocumentFormat === "boolean"
      ? record.autoFixDocumentFormat
      : DEFAULT_NESTNOTE_SETTINGS.autoFixDocumentFormat;
  return { maxChildDepth, openPanelOnStartup, autoFixDocumentFormat };
}
```

`src/i18n/types.ts` — insert after `"setting.openPanelOnStartupDesc"`:

```ts
  "setting.autoFixDocumentFormatName",
  "setting.autoFixDocumentFormatDesc",
```

`src/i18n/zh.ts` — insert after `setting.openPanelOnStartupDesc`:

```ts
  "setting.autoFixDocumentFormatName": "自动修正文档格式",
  "setting.autoFixDocumentFormatDesc":
    "扫描时补全缺失的头部字段和子文档标记，并把子文档列表写成规范格式。关闭后，只有新建、删除、重命名、移动子文档时才会更新父文档链接。",
```

`src/i18n/en.ts` — insert after `setting.openPanelOnStartupDesc`:

```ts
  "setting.autoFixDocumentFormatName": "Auto-fix document format",
  "setting.autoFixDocumentFormatDesc":
    "During scans, fill missing header fields and child-link markers, and rewrite the child list to the canonical format. When off, parent links update only when you create, delete, rename, or move a child document.",
```

`src/ui/settings-tab.ts` — reuse a boolean toggle type; after the startup `Setting`, add:

```ts
type BooleanToggle = { setValue(on: boolean): unknown };
```

Replace `StartupToggle` usages with `BooleanToggle`, or keep `StartupToggle` and add the same shape. After `commitOpenPanelOnStartup` wiring, add a third Setting:

```ts
    new Setting(this.containerEl)
      .setName(t("setting.autoFixDocumentFormatName"))
      .setDesc(t("setting.autoFixDocumentFormatDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.autoFixDocumentFormat);
        toggle.onChange((value) => {
          this.commitAutoFixDocumentFormat(toggle, value).catch((error) => {
            this.noticeSaveFailure(error);
          });
        });
      });
```

Add:

```ts
  private async commitAutoFixDocumentFormat(
    toggle: BooleanToggle,
    value: boolean,
  ): Promise<void> {
    const previous = this.host.settings.autoFixDocumentFormat;
    this.host.settings.autoFixDocumentFormat = value;
    try {
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.autoFixDocumentFormat = previous;
      toggle.setValue(previous);
      this.noticeSaveFailure(error);
      return;
    }
    this.host.onSettingsChanged();
  }
```

Do not change `commitOpenPanelOnStartup` behavior.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run tests/settings.test.ts tests/plugin-lifecycle.test.ts
```

Expected: PASS (plugin-lifecycle still rewrites on scan because the gate is not implemented yet; persist test should pass).

- [ ] **Step 5: Commit**

```bash
git add src/settings.ts src/i18n/types.ts src/i18n/zh.ts src/i18n/en.ts src/ui/settings-tab.ts tests/settings.test.ts tests/plugin-lifecycle.test.ts
git commit -m "feat(settings): add auto-fix document format toggle" -m "Default on so existing scan behavior stays unless the user opts out."
```

---

### Task 2: Gate background metadata sync

**Files:**
- Modify: `src/main.ts` (`performScanAndSync` only)
- Modify: `tests/plugin-lifecycle.test.ts`

**Interfaces:**
- Consumes: `this.settings.autoFixDocumentFormat` from Task 1
- Produces: `performScanAndSync` skips `syncDocumentMetadata` when the flag is false; tree scan and `renderOpenViews` still run

- [ ] **Step 1: Write the failing tests**

In `tests/plugin-lifecycle.test.ts`, after `"scans and syncs frontmatter and child links after layout is ready"`, add:

```ts
  it("does not rewrite index files on scan when auto-fix is disabled", async () => {
    vi.useFakeTimers();
    const original = `---
created: 2020-01-01T00:00:00Z
---
# Body
<!-- nestnote:children:start -->
<!-- nestnote:children:end -->
`;
    const app = createApp((vault) => {
      seedDocument(vault, "Work", original);
    });
    const plugin = loadPlugin(app, { autoFixDocumentFormat: false });
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    expect(app.vault.files.get("Work/index.md")).toBe(original);
    command(plugin, "nestnote:refresh")();
    await settle();
    expect(app.vault.files.get("Work/index.md")).toBe(original);
  });

  it("still updates parent child links when auto-fix is disabled", async () => {
    vi.useFakeTimers();
    const app = createApp((vault, workspace) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
# Body
<!-- nestnote:children:start -->
<!-- nestnote:children:end -->
`,
      );
      workspace.activeFile = fileRef("Work/index.md");
    });
    const plugin = loadPlugin(app, { autoFixDocumentFormat: false });
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    expect(app.vault.files.get("Work/index.md")).toContain(
      "<!-- nestnote:children:start -->\n<!-- nestnote:children:end -->",
    );

    command(plugin, "nestnote:new-child-document")();
    await confirmNameModal("Notes");
    await settle();

    expect(app.vault.folders.has("Work/Notes")).toBe(true);
    expect(app.vault.files.get("Work/index.md")).toContain(
      "- [Notes](Notes/index.md)",
    );
    expect(app.vault.files.get("Work/index.md")).toContain("# Body");
  });
```

Confirm `fileRef` is already defined in this file (it is used by `"creates a child document from the active document via command"`). Do not duplicate that helper.

Keep the existing `"scans and syncs frontmatter and child links after layout is ready"` test unchanged — default `autoFixDocumentFormat: true` must still fill `name` and insert child links.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/plugin-lifecycle.test.ts
```

Expected: FAIL on `"does not rewrite index files on scan when auto-fix is disabled"` because scan still injects `name:` and blank lines.

- [ ] **Step 3: Write minimal implementation**

In `src/main.ts` `performScanAndSync`, wrap the metadata write:

```ts
      await this.coordinator.runInternal(async () => {
        const metadataNodes = scanFromApp(this.app, 9);
        this.nodes = scanFromApp(this.app, this.settings.maxChildDepth);
        if (this.settings.autoFixDocumentFormat) {
          await syncDocumentMetadata(this.app, metadataNodes);
        }
      });
```

Do not change `syncDocumentNode` / `transformDocumentIndex`. Do not pass the flag into `NestNoteDocumentService`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run tests/plugin-lifecycle.test.ts tests/document-service.test.ts tests/settings.test.ts
```

Expected: PASS. Create/trash/move tests still rewrite parent children regions.

Then:

```bash
npx vitest run
```

Expected: all files PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts tests/plugin-lifecycle.test.ts
git commit -m "feat(documents): skip scan rewrites when auto-fix is off" -m "Hand-written index files stay intact on refresh; create and delete still update parent child links."
```

---

### Task 3: Document the setting in README

**Files:**
- Modify: `README_zh.md` (设置表 + 子文档链接段)
- Modify: `README.md` (Settings table + child-link paragraph)

**Interfaces:**
- Consumes: setting names/copy from Task 1
- Produces: user-facing docs matching default-on scan fix vs user-action updates

- [ ] **Step 1: Update the settings tables**

`README_zh.md` `### 设置` table, add a row after 启动时打开 NestNote 面板:

```markdown
| 自动修正文档格式 | 默认开启。扫描时补全缺失的头部字段和子文档标记，并把子文档列表写成规范格式。关闭后，只有新建、删除、重命名、移动子文档时才会更新父文档链接 |
```

`README.md` `### Settings` table, add:

```markdown
| Auto-fix document format | On by default. During scans, fill missing header fields and child-link markers, and rewrite the child list to the canonical format. When off, parent links update only when you create, delete, rename, or move a child document |
```

- [ ] **Step 2: Clarify scan vs user-action writes in the child-link section**

Replace the sentence in `README_zh.md` that currently says 如果找不到这段标记，插件会在头部信息后面自动建一份 with:

```markdown
新建、删除、重命名或移动子文档时，只更新这两行标记之间的列表，并按文档名排序。列表与两个标记之间各空一行；即使没有空行，也不影响解析。链接是普通的相对路径，名称里的空格会写成 `%20`。你在正文里手写的链接不会被扫描、删除或改写。若开启「自动修正文档格式」（默认开启），扫描时也会把这段区域写成规范格式；找不到标记时插在头部后面。关闭该选项后，扫描不再改已有文件。
```

Replace the matching paragraph in `README.md` with:

```markdown
Creating, deleting, renaming, or moving a child updates only the list between the two markers, sorted by document name. There is one blank line between the list and each marker; missing blank lines do not affect parsing. Links are ordinary relative paths; spaces in names are written as `%20`. Hand-written links in the body are not scanned, deleted, or rewritten. When Auto-fix document format is on (the default), scans also rewrite this region to the canonical format, inserting it after the header if the markers are missing. When the option is off, scans do not change existing files.
```

- [ ] **Step 3: Commit**

```bash
git add README_zh.md README.md
git commit -m "docs(readme): describe the auto-fix document format setting"
```

No test run required for copy-only README changes. If you edited anything else, run `npx vitest run` first.

---

## Spec coverage

| Spec section | Task |
|--------------|------|
| §4 Setting field, default true, boolean normalize | Task 1 |
| §4.2 i18n keys and toggle; save fail rollback; `onSettingsChanged` | Task 1 |
| §5 Scan still calls `syncDocumentMetadata` when on; depth 9 | Task 2 (default-on existing test + unchanged scan depth) |
| §5.1 / §5.2 Write scope and parse errors | Unchanged `transformDocumentIndex`; covered by existing metadata tests |
| §6 Off: no scan/refresh writes; create still updates parent | Task 2 |
| §7 Non-goals | No extra commands or rewrite paths |
| README | Task 3 |
