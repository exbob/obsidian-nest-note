# NestNote

[中文](README.md) | English

NestNote is an [Obsidian](https://obsidian.md/) plugin that treats **folders as documents**. Each document is a directory that contains `index.md` and `attachments/`. Child documents can nest according to settings (default maximum depth 5, adjustable from `0` to `9`). The plugin shows and operates the document tree in a custom sidebar. The vault filesystem is the only data source; there is no extra index database.

- **Display name:** NestNote
- **Plugin ID:** `nest-note`
- **Minimum Obsidian version:** 1.5.0
- **UI language:** Follows the Obsidian app language. Simplified Chinese and Traditional Chinese show Simplified Chinese; all other languages show English.

## Install

### Build from source

```bash
git clone https://github.com/exbob/obsidian-nest-note.git
cd obsidian-nest-note
npm install
./build.sh
```

After the build, copy the `nest-note/` directory into your vault’s `.obsidian/plugins/` folder (that is, `.obsidian/plugins/nest-note/`). That directory contains:

| File | Description |
|------|-------------|
| `main.js` | Plugin entry (build output) |
| `manifest.json` | Plugin manifest |
| `styles.css` | Sidebar and dialog styles |

`./build.sh clean` only removes `main.js`, `main.js.map` (if present), and `./nest-note/`. It does not build.

In Obsidian, open **Settings → Community plugins** and enable **NestNote**.

## Submit to Obsidian Community Plugins

1. Make sure the GitHub repository is public and includes `README.md`, `LICENSE`, and `manifest.json` at the repo root.
2. Run `bash build.sh`, then create a GitHub Release from `main.js`, `manifest.json`, and `styles.css` in `nest-note/`. The release tag must match `manifest.json` `version` exactly (for example `0.2.0`, with no `v` prefix).
3. Sign in to [Obsidian Community](https://community.obsidian.md/), link your GitHub account, and submit the repository `exbob/obsidian-nest-note` for automated review.

Later versions only need a `manifest.json` version bump, a code push, and a GitHub Release with the same tag. You do not need to resubmit to the community directory. See the [Obsidian plugin publishing docs](https://docs.obsidian.md/plugins/releasing/submit-plugin).

### Development

```bash
npm run dev    # watch source and rebuild
npm test       # unit / integration tests
npx tsc --noEmit   # TypeScript typecheck
```

## Document directory structure

A **complete document directory** must satisfy all of:

1. The directory contains `index.md`
2. The directory contains an `attachments/` subdirectory
3. The directory name is the document name

`attachments/` is a reserved directory name and is never treated as a child document.

### Complete example (three nested levels)

```text
Vault root/
├── Work/                          ← root document
│   ├── index.md
│   ├── attachments/
│   ├── 项目 A/                    ← first-level child
│   │   ├── index.md
│   │   ├── attachments/
│   │   └── 里程碑 1/              ← second-level child
│   │       ├── index.md
│   │       └── attachments/
│   └── 项目 B/
│       ├── index.md
│       └── attachments/
├── 笔记 草稿/                     ← name with spaces and Chinese
│   ├── index.md
│   └── attachments/
└── random-note.md                 ← ordinary Markdown, ignored
```

### Ignored content

| Kind | Example | Reason |
|------|---------|--------|
| Ordinary Markdown file | `notes/ideas.md` | Not a complete document directory |
| Directory missing `index.md` | `draft/` (only `attachments/`) | Incomplete |
| Directory missing `attachments/` | `draft/` (only `index.md`) | Incomplete |
| Directory named `attachments` | `Work/attachments/` | Reserved name, not a document |

## Frontmatter

When a document is created, the plugin writes this header into `index.md`:

```yaml
---
name: Work
created: 2026-08-28T19:00:00+08:00
---
```

| Field | Description |
|-------|-------------|
| `name` | Defaults to the directory name; synced after a directory rename |
| `created` | ISO 8601 timestamp written on first create; not updated later |

**Behavior:**

- The directory name is the **only authority** for the document name
- If frontmatter is missing, the plugin inserts a complete frontmatter block before the body and **does not change the original body**
- If YAML frontmatter cannot be parsed, the plugin **does not overwrite the body** and shows a metadata Notice

## Controlled child links

A parent document’s `index.md` contains a plugin-owned region:

```markdown
<!-- nestnote:children:start -->
- [项目 A](项目%20A/index.md)
- [项目 B](项目%20B/index.md)
<!-- nestnote:children:end -->

This is user body text. The plugin does not modify content outside the region.
```

**Rules:**

- Creating, deleting, or renaming a child updates only the link list inside the controlled region
- Links are sorted by document name
- Links use standard Markdown relative paths; spaces and special characters are encoded per RFC 3986 (for example `%20`)
- Hand-written links in the user body are **not scanned, deleted, or rewritten**
- If the controlled region is missing, it is created after the frontmatter

## Native attachment compatibility

The plugin **does not register** a command named “Insert attachment”. Obsidian’s native paste, insert, and drag-and-drop attachment behavior is unchanged.

When all of the following hold, the plugin archives a newly created attachment into the current document’s `attachments/` directory:

1. The active file is `index.md` of a recognized complete document
2. Obsidian created an attachment (image, PDF, audio, video, and similar)
3. The attachment is not already under that document’s `attachments/`
4. The source is one of:
   - A direct child of the current document directory (same folder as `index.md`)
   - The vault root
   - The resolved Obsidian `attachmentFolderPath` (`vault.getConfig("attachmentFolderPath")` or `vault.config.attachmentFolderPath`, including `./` relative to the current document directory). `fileManager.getNewFileParent(sourcePath)` is the 1.5.x new-note location API. It must not be treated as the attachment folder and must not override `attachmentFolderPath`. It is used only as a fallback probe that includes an attachment path when that config cannot be read.

**Never moved:** files already under another complete document’s `attachments/`, files inside another complete document directory, and paths that cannot be attributed (for example `Inbox/`). On the vault `create` event these stay in place **silently** to avoid Notice spam. The manual command **NestNote: Archive current attachment** still shows a Notice on failure.

Archive uses an available-path strategy for name conflicts (for example `image 1.png`).

**Fallback command:** `NestNote: Archive current attachment` (`nestnote:archive-current-attachment`) — manually move the currently open attachment into its owning document’s `attachments/`. Ownership is still resolved by walking up from the attachment path. If resolution fails or the move is unsafe, the plugin shows a Notice and leaves the file in place.

## Sidebar and actions

Click the left ribbon icon (folder-tree) or run **NestNote: Open document tree** to open the custom sidebar.

| Action | How |
|--------|-----|
| Open document | Click the document name in the sidebar |
| New child document | Button on the sidebar row |
| Rename | Sidebar row **More** → Rename |
| Delete | Sidebar row **More** → Delete; **every delete requires confirmation** |
| Expand all / Collapse all | Toolbar button. If any expandable node is collapsed, the label is **Expand all**; after everything is expanded it becomes **Collapse all**. The button is disabled when there are no expandable nodes. This only updates view expansion state and does not scan files |
| Refresh | Toolbar button, command **NestNote: Refresh**, or a full rescan after vault file changes |

### New-document entry points

| Entry | Creates under | Notes |
|-------|---------------|--------|
| Sidebar toolbar **New document** | Vault root | Ignores sidebar selection |
| Command **NestNote: New document** (`nestnote:new-document`) | Vault root | Same as the toolbar button |
| **New child document** on a sidebar row | That row’s document | Uses the target node as parent |
| Command **NestNote: New child document** (`nestnote:new-child-document`) | The active document | **The parent’s `index.md` must be open first**; uses the editor’s active file, not sidebar selection |

In the name dialog, press **Enter** or click Confirm to create and close the dialog. Empty names are not submitted. Names with path-forbidden characters (`/ \ : * ? " < > |`), Windows reserved device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9, including case and extension forms), a trailing dot or trailing space, or a name that already exists are rejected with a reason. After the configured maximum child depth, creating a deeper child is refused and nothing is written to the vault.

## Settings

Configure these under Obsidian **Settings → NestNote**:

| Setting | Description |
|---------|-------------|
| Max child document depth | Range `0`–`9`, default `5`. Root documents are depth `0`. Directories beyond the limit are hidden and cannot be created as deeper children. `0` shows only root documents |
| Open the NestNote pane on startup | On by default. After layout is ready and the first scan finishes, the plugin opens the NestNote pane. If turned off, the next launch does not open it automatically |

## Delete and trash

- **Every delete shows a confirmation** (whether or not the document has children)
- After confirm, the **entire document directory** (`index.md`, attachments, and all child documents) is moved to the Obsidian trash
- Prefer `fileManager.trashFile`; older Obsidian versions fall back to `vault.trash(folder, false)` (local trash)
- After restoring a directory from trash, the plugin fully rescans and re-identifies it when vault events fire
- On delete failure, sidebar state is kept and an error Notice is shown

## Commands

| Command ID | Display name |
|------------|--------------|
| `nestnote:open-document-tree` | Open document tree |
| `nestnote:new-document` | New document |
| `nestnote:new-child-document` | New child document |
| `nestnote:refresh` | Refresh |
| `nestnote:archive-current-attachment` | Archive current attachment |

> Obsidian may prefix the command ID with the plugin ID (for example `nest-note:nestnote:open-document-tree`). Use whatever the command palette actually shows.

## Verification

### Automated checks (passed)

These commands were run in this repository’s development environment and passed:

```bash
npm test              # full Vitest suite
npx tsc --noEmit      # TypeScript typecheck
npm run build         # production build
bash build.sh clean   # remove artifacts only, no build
bash build.sh         # write nest-note/ on success
```

| Check | Result |
|-------|--------|
| Full Vitest suite | 10 test files, 149 tests, all passed |
| Unit tests (directory recognition, frontmatter, controlled links, path encoding, settings normalization, depth clipping, and similar) | Passed |
| Integration tests (create / rename / delete, attachment archive, event sync, plugin lifecycle, pane interaction) | Passed |
| TypeScript typecheck (`tsc --noEmit`) | Passed, no diagnostics |
| Production build (`esbuild` → `main.js`) | Passed |
| `bash build.sh clean` | Passed; removes `main.js`, `main.js.map` (if present), and `./nest-note/`; does not build |
| `bash build.sh` | Passed; `nest-note/` contains only `main.js`, `manifest.json`, and `styles.css` |

### Manual checks (must be verified in Obsidian)

The following items **were not run in this development environment** and must not be treated as passed. Confirm them in a real Obsidian vault:

| # | Check | Status |
|---|--------|--------|
| 1 | Create a root document and three nested child levels | **Not run — verify in Obsidian** |
| 2 | Parent link region contains only current children and body is unchanged | **Not run — verify in Obsidian** |
| 3 | Open, rename, and delete a document that has children | **Not run — verify in Obsidian** |
| 4 | Paste/insert an image with native Obsidian commands and confirm it lands in the current `attachments/` | **Not run — verify in Obsidian** |
| 5 | Create ordinary Markdown files and incomplete directories and confirm they do not appear | **Not run — verify in Obsidian** |
| 6 | Restore a directory from trash and confirm it reappears after refresh | **Not run — verify in Obsidian** |
| 7 | Perform file operations in quick succession and confirm no duplicate links or refresh loops | **Not run — verify in Obsidian** |
| 8 | Use document names with spaces, Chinese, and special characters | **Not run — verify in Obsidian** |
| 9 | NestNote pane appears automatically after default startup | **Not run — verify in Obsidian** |
| 10 | After turning off “Open the NestNote pane on startup” and restarting, the pane does not open automatically | **Not run — verify in Obsidian** |
| 11 | At the default maximum depth, level 5 can be created and level 6 is refused | **Not run — verify in Obsidian** |
| 12 | With max child depth `0`, only root documents are shown | **Not run — verify in Obsidian** |
| 13 | With max child depth `9`, level 9 is allowed | **Not run — verify in Obsidian** |
| 14 | Pressing Enter after typing a name creates the document and closes the dialog | **Not run — verify in Obsidian** |
| 15 | Expand all and collapse all cover the whole tree | **Not run — verify in Obsidian** |
| 16 | Settings and new buttons follow the current Obsidian theme | **Not run — verify in Obsidian** |
| 17 | Copying `nest-note/` into the vault plugin folder enables the plugin successfully | **Not run — verify in Obsidian** |
| 18 | After setting Obsidian to Simplified or Traditional Chinese and restarting, settings, commands, sidebar, dialogs, and Notices are Simplified Chinese | **Not run — verify in Obsidian** |
| 19 | After setting Obsidian to English or another language and restarting, those surfaces are English; `NestNote` and command IDs are unchanged | **Not run — verify in Obsidian** |

### Known limits

- The plugin does not auto-repair incomplete directories or convert ordinary Markdown files
- **Full scan:** vault events trigger a full vault rescan and tree rebuild. This MVP does not incrementally refresh only the affected branch
- **New-document entry differences:**
  - Sidebar toolbar **New document** and command `nestnote:new-document` always create at the vault root
  - Sidebar row **New child document** uses that row as parent
  - Command `nestnote:new-child-document` requires the parent’s `index.md` to be open and uses the active file’s document, not sidebar selection
- Auto-archive runs only when the file can be safely tied to the active `index.md`. Allowed sources are a direct child of the current document directory, the vault root, or the resolved `attachmentFolderPath` (including `./` relative paths). `getNewFileParent(sourcePath)` is not used as the attachment folder. Other complete document directories / `attachments/` and unattributable paths are never moved; vault create events keep them silently
- Delete prefers `fileManager.trashFile`; older Obsidian versions fall back to `vault.trash(..., false)` (local trash)
- **Child depth:** complete document directories beyond “Max child document depth” remain on disk but are omitted from the scan and cannot be created as deeper children through the plugin

## Project layout

```text
build.sh                             # production build into nest-note/; clean removes artifacts only
main.js                              # build output (plugin entry)
manifest.json                        # plugin manifest
styles.css                           # sidebar and dialog styles
nest-note/                           # install directory to copy into a vault
src/
├── main.ts                          # plugin entry, commands, wiring
├── types.ts                         # shared types
├── settings.ts                      # settings model, defaults, normalization
├── i18n/                            # zh/en catalogs and t()
├── domain/
│   ├── document-scanner.ts          # complete-document detection and tree build
│   ├── frontmatter.ts               # frontmatter read/write
│   └── children-links.ts            # controlled child links
├── services/
│   ├── document-service.ts          # create, rename, delete, open
│   ├── attachment-service.ts        # attachment watch and archive
│   └── vault-event-coordinator.ts   # vault event coalesce and refresh
└── ui/
    ├── document-tree-view.ts        # sidebar view
    └── settings-tab.ts              # settings tab
tests/                               # Vitest tests
docs/superpowers/specs/              # design specs
```
