import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest, WorkspaceLeaf } from "obsidian";
import { Notice } from "obsidian";
import NestNotePlugin from "../src/main";
import {
  DEFAULT_NESTNOTE_SETTINGS,
  type NestNoteSettings,
} from "../src/settings";
import { VIEW_TYPE_NESTNOTE } from "../src/ui/document-tree-view";

interface NoticeHarness {
  messages: string[];
}

function noticeHarness(): NoticeHarness {
  return Notice as unknown as NoticeHarness;
}

const COMMAND_IDS = [
  "nestnote:open-document-tree",
  "nestnote:new-document",
  "nestnote:new-child-document",
  "nestnote:refresh",
  "nestnote:archive-current-attachment",
] as const;

interface FileRef {
  path: string;
  name: string;
  basename: string;
  extension: string;
}

interface FolderRef {
  path: string;
  name: string;
  children: Array<FileRef | FolderRef>;
}

type AbstractRef = FileRef | FolderRef;

interface EventRef {
  event: string;
}

interface PluginHarness {
  commands: Array<{
    id: string;
    name: string;
    callback?: () => unknown;
  }>;
  ribbonIcons: Array<{
    icon: string;
    title: string;
    callback: (evt: MouseEvent) => unknown;
  }>;
  views: Map<string, (leaf: WorkspaceLeaf) => unknown>;
  registeredEvents: unknown[];
  registeredCleanups: Array<() => unknown>;
  settingTabs: unknown[];
  persistedData: unknown;
}

class FakeVault {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  readonly renameCalls: Array<{ from: string; to: string }> = [];
  readonly trashLocalCalls: Array<{ path: string; system: boolean }> = [];
  readonly trashFileCalls: string[] = [];
  modifyCount = 0;
  readHold: Promise<void> | null = null;

  private readonly listeners = new Map<
    string,
    Array<{ callback: (...args: unknown[]) => unknown; ref: EventRef }>
  >();

  getAbstractFileByPath(path: string): AbstractRef | null {
    const normalized = normalize(path);
    if (this.files.has(normalized)) {
      return fileRef(normalized);
    }
    if (this.folders.has(normalized)) {
      return folderRef(normalized);
    }
    return null;
  }

  getFileByPath(path: string): FileRef | null {
    const normalized = normalize(path);
    return this.files.has(normalized) ? fileRef(normalized) : null;
  }

  getFolderByPath(path: string): FolderRef | null {
    const normalized = normalize(path);
    return this.folders.has(normalized) ? folderRef(normalized) : null;
  }

  getAllLoadedFiles(): AbstractRef[] {
    return [
      ...[...this.folders].map((folder) => folderRef(folder)),
      ...[...this.files.keys()].map((file) => fileRef(file)),
    ];
  }

  async createFolder(path: string): Promise<FolderRef> {
    const normalized = normalize(path);
    if (this.folders.has(normalized) || this.files.has(normalized)) {
      throw new Error(`Folder already exists: ${normalized}`);
    }
    this.folders.add(normalized);
    const folder = folderRef(normalized);
    this.emit("create", folder);
    return folder;
  }

  async create(path: string, data: string): Promise<FileRef> {
    const normalized = normalize(path);
    if (this.files.has(normalized) || this.folders.has(normalized)) {
      throw new Error(`File already exists: ${normalized}`);
    }
    this.files.set(normalized, data);
    const file = fileRef(normalized);
    this.emit("create", file);
    return file;
  }

  async read(file: { path: string }): Promise<string> {
    if (this.readHold !== null) {
      await this.readHold;
    }
    const content = this.files.get(normalize(file.path));
    if (content === undefined) {
      throw new Error(`File not found: ${file.path}`);
    }
    return content;
  }

  async modify(file: { path: string }, data: string): Promise<void> {
    const normalized = normalize(file.path);
    if (!this.files.has(normalized)) {
      throw new Error(`File not found: ${normalized}`);
    }
    this.modifyCount += 1;
    this.files.set(normalized, data);
    this.emit("modify", fileRef(normalized));
  }

  async rename(file: { path: string }, newPath: string): Promise<void> {
    const from = normalize(file.path);
    const to = normalize(newPath);
    this.renameCalls.push({ from, to });
    movePrefix(this.folders, from, to);
    movePrefixMap(this.files, from, to);
    const next = this.getAbstractFileByPath(to);
    if (next !== null) {
      this.emit("rename", next, from);
    }
  }

  async delete(file: { path: string }): Promise<void> {
    const normalized = normalize(file.path);
    const existing = this.getAbstractFileByPath(normalized);
    this.files.delete(normalized);
    this.folders.delete(normalized);
    for (const child of [...this.files.keys()]) {
      if (child.startsWith(`${normalized}/`)) {
        this.files.delete(child);
      }
    }
    for (const child of [...this.folders]) {
      if (child.startsWith(`${normalized}/`)) {
        this.folders.delete(child);
      }
    }
    if (existing !== null) {
      this.emit("delete", existing);
    }
  }

  async trash(file: { path: string }, system: boolean): Promise<void> {
    this.trashLocalCalls.push({ path: normalize(file.path), system });
    await this.delete(file);
  }

  on(name: string, callback: (...args: unknown[]) => unknown): EventRef {
    const ref: EventRef = { event: name };
    const list = this.listeners.get(name) ?? [];
    list.push({ callback, ref });
    this.listeners.set(name, list);
    return ref;
  }

  offref(ref: EventRef): void {
    for (const [name, list] of this.listeners) {
      this.listeners.set(
        name,
        list.filter((entry) => entry.ref !== ref),
      );
    }
  }

  emit(name: string, ...args: unknown[]): void {
    for (const entry of this.listeners.get(name) ?? []) {
      void entry.callback(...args);
    }
  }
}

class FakeWorkspace {
  layoutReady = false;
  activeFile: FileRef | null = null;
  owner: FakeApp | undefined;
  readonly leaves: FakeLeaf[] = [];
  readonly revealCalls: FakeLeaf[] = [];
  readonly setActiveLeafCalls: FakeLeaf[] = [];
  private readonly readyCallbacks: Array<() => unknown> = [];
  getViewCreator: ((type: string) => ((leaf: WorkspaceLeaf) => unknown) | undefined) | undefined;
  getRightLeafSplits: boolean[] = [];
  readonly rightSidebarLeaves: FakeLeaf[] = [];
  getLeftLeafSplits: boolean[] = [];
  readonly leftSidebarLeaves: FakeLeaf[] = [];
  opened: string[] = [];
  lastNewLeaf: boolean | undefined;

  onLayoutReady(callback: () => unknown): void {
    if (this.layoutReady) {
      callback();
      return;
    }
    this.readyCallbacks.push(callback);
  }

  markReady(): void {
    this.layoutReady = true;
    for (const callback of this.readyCallbacks.splice(0)) {
      callback();
    }
  }

  getActiveFile(): FileRef | null {
    return this.activeFile;
  }

  getLeaf(newLeaf?: boolean): FakeLeaf {
    this.lastNewLeaf = newLeaf;
    const leaf = new FakeLeaf(this);
    this.leaves.push(leaf);
    return leaf;
  }

  getRightLeaf(split: boolean): FakeLeaf {
    this.getRightLeafSplits.push(split);
    if (!split && this.rightSidebarLeaves[0] !== undefined) {
      return this.rightSidebarLeaves[0];
    }
    const leaf = new FakeLeaf(this);
    this.leaves.push(leaf);
    this.rightSidebarLeaves.push(leaf);
    return leaf;
  }

  getLeftLeaf(split: boolean): FakeLeaf {
    this.getLeftLeafSplits.push(split);
    if (!split && this.leftSidebarLeaves[0] !== undefined) {
      return this.leftSidebarLeaves[0];
    }
    const leaf = new FakeLeaf(this);
    this.leaves.push(leaf);
    this.leftSidebarLeaves.push(leaf);
    return leaf;
  }

  getLeavesOfType(viewType: string): FakeLeaf[] {
    return this.leaves.filter((leaf) => leaf.viewType === viewType);
  }

  async revealLeaf(leaf: FakeLeaf): Promise<void> {
    this.revealCalls.push(leaf);
  }

  setActiveLeafFocusArgs: unknown[] = [];

  setActiveLeaf(leaf: FakeLeaf, ...args: unknown[]): void {
    this.setActiveLeafCalls.push(leaf);
    this.setActiveLeafFocusArgs = args;
  }
}

class FakeLeaf {
  view: {
    onOpen?: () => Promise<void>;
    render?: (nodes: unknown) => void;
    contentEl?: HTMLElement;
  } | null = null;
  viewType: string | null = null;
  app: unknown;

  constructor(private readonly workspace: FakeWorkspace) {
    this.app = workspace.owner;
  }

  async setViewState(state: { type: string; active?: boolean }): Promise<void> {
    this.viewType = state.type;
    const creator = this.workspace.getViewCreator?.(state.type);
    if (creator !== undefined) {
      this.view = creator(this as unknown as WorkspaceLeaf) as {
        onOpen?: () => Promise<void>;
        render?: (nodes: unknown) => void;
        contentEl?: HTMLElement;
      };
      await this.view.onOpen?.();
      if (this.view.contentEl instanceof HTMLElement) {
        document.body.appendChild(this.view.contentEl);
      }
    }
  }

  async openFile(file: { path: string }): Promise<void> {
    this.workspace.opened.push(file.path);
  }
}

interface FakeFileManager {
  renameFile?: (file: { path: string }, newPath: string) => Promise<void>;
  trashFile?: (file: { path: string }) => Promise<void>;
  renameFileCalls: Array<{ from: string; to: string }>;
  trashFileCalls: string[];
}

function createFileManager(vault: FakeVault): FakeFileManager {
  const renameFileCalls: Array<{ from: string; to: string }> = [];
  const trashFileCalls: string[] = [];
  return {
    renameFileCalls,
    trashFileCalls,
    async renameFile(file: { path: string }, newPath: string): Promise<void> {
      renameFileCalls.push({ from: normalize(file.path), to: normalize(newPath) });
      await vault.rename(file, newPath);
    },
    async trashFile(file: { path: string }): Promise<void> {
      trashFileCalls.push(normalize(file.path));
      await vault.delete(file);
    },
  };
}

interface FakeApp {
  vault: FakeVault;
  workspace: FakeWorkspace;
  fileManager: FakeFileManager;
}

function normalize(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function fileRef(path: string): FileRef {
  const normalized = normalize(path);
  const name = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;
  const dot = name.lastIndexOf(".");
  return {
    path: normalized,
    name,
    basename: dot === -1 ? name : name.slice(0, dot),
    extension: dot === -1 ? "" : name.slice(dot + 1),
  };
}

function folderRef(path: string): FolderRef {
  const normalized = normalize(path);
  const name = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;
  return { path: normalized, name, children: [] };
}

function movePrefix(set: Set<string>, from: string, to: string): void {
  const next = [...set].filter(
    (entry) => entry === from || entry.startsWith(`${from}/`),
  );
  for (const entry of next) {
    set.delete(entry);
    set.add(to + entry.slice(from.length));
  }
}

function movePrefixMap(map: Map<string, string>, from: string, to: string): void {
  const next = [...map.keys()].filter(
    (entry) => entry === from || entry.startsWith(`${from}/`),
  );
  for (const entry of next) {
    const value = map.get(entry)!;
    map.delete(entry);
    map.set(to + entry.slice(from.length), value);
  }
}

function seedDocument(
  vault: FakeVault,
  folder: string,
  indexContent: string,
): void {
  vault.folders.add(folder);
  vault.folders.add(`${folder}/attachments`);
  vault.files.set(`${folder}/index.md`, indexContent);
}

const manifest: PluginManifest = {
  id: "nest-note",
  name: "NestNote",
  "version": "0.2.0",
  minAppVersion: "1.5.0",
  description: "Treat folders as nested documents in Obsidian.",
  author: "NestNote contributors",
};

function createApp(seed?: (vault: FakeVault, workspace: FakeWorkspace) => void): FakeApp {
  const vault = new FakeVault();
  const workspace = new FakeWorkspace();
  seed?.(vault, workspace);
  const app: FakeApp = {
    vault,
    workspace,
    fileManager: createFileManager(vault),
  };
  workspace.owner = app;
  return app;
}

function loadPlugin(
  app: FakeApp,
  data?: Partial<NestNoteSettings>,
): NestNotePlugin {
  const plugin = new NestNotePlugin(app as unknown as App, manifest);
  const pluginHarness = plugin as unknown as PluginHarness;
  if (data !== undefined) {
    pluginHarness.persistedData = data;
  }
  app.workspace.getViewCreator = (type) =>
    pluginHarness.views.get(type) as
      | ((leaf: WorkspaceLeaf) => unknown)
      | undefined;
  return plugin;
}

function harness(plugin: NestNotePlugin): PluginHarness {
  return plugin as unknown as PluginHarness;
}

function command(plugin: NestNotePlugin, id: string): () => unknown {
  const found = harness(plugin).commands.find((entry) => entry.id === id);
  if (found?.callback === undefined) {
    throw new Error(`missing command ${id}`);
  }
  return found.callback;
}

async function confirmNameModal(name: string): Promise<void> {
  const modal = document.querySelector(".nestnote-modal");
  if (!(modal instanceof HTMLElement)) {
    throw new Error("modal was not opened");
  }
  const input = modal.querySelector("input");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("name input missing");
  }
  input.value = name;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const confirm = modal.querySelector('[aria-label="确认"]');
  if (!(confirm instanceof HTMLElement)) {
    throw new Error("confirm button missing");
  }
  confirm.click();
  await Promise.resolve();
  await Promise.resolve();
}

function clickTrashFromMore(path: string): void {
  const more = document.querySelector(
    `[data-path="${path}"] [aria-label="更多"]`,
  );
  if (!(more instanceof HTMLElement)) {
    throw new Error("more action missing");
  }
  more.click();
  const trash = document.querySelector('.menu [aria-label="删除"]');
  if (!(trash instanceof HTMLElement)) {
    throw new Error("trash action missing");
  }
  trash.click();
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(150);
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  noticeHarness().messages = [];
});

describe("NestNotePlugin assembly", () => {
  it("registers the NestNote view, ribbon, and unique command ids", async () => {
    const app = createApp();
    const plugin = loadPlugin(app);

    await plugin.onload();

    expect(plugin.manifest.minAppVersion).toBe("1.5.0");
    expect(harness(plugin).views.has(VIEW_TYPE_NESTNOTE)).toBe(true);
    expect(harness(plugin).ribbonIcons).toEqual([
      expect.objectContaining({ title: "NestNote" }),
    ]);
    expect(harness(plugin).commands.map((entry) => entry.id).sort()).toEqual(
      [...COMMAND_IDS].sort(),
    );
    expect(
      harness(plugin).commands.some((entry) => entry.name.includes("插入附件")),
    ).toBe(false);
    expect(harness(plugin).registeredEvents.length).toBeGreaterThanOrEqual(4);
    expect(harness(plugin).registeredCleanups.length).toBeGreaterThanOrEqual(1);
    expect(harness(plugin).settingTabs).toHaveLength(1);
  });

  it("falls back to default settings when loadData fails", async () => {
    const app = createApp();
    const plugin = loadPlugin(app);
    vi.spyOn(plugin, "loadData").mockRejectedValue(new Error("read failed"));

    await expect(plugin.onload()).resolves.toBeUndefined();

    expect(plugin.settings).toEqual(DEFAULT_NESTNOTE_SETTINGS);
    expect(harness(plugin).views.has(VIEW_TYPE_NESTNOTE)).toBe(true);
    expect(harness(plugin).settingTabs).toHaveLength(1);
  });

  it("opens the NestNote panel by default after layout is ready", async () => {
    vi.useFakeTimers();
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    expect(app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)).toHaveLength(0);
    app.workspace.markReady();
    await settle();
    expect(app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)).toHaveLength(1);
  });

  it("does not open the panel when startup opening is disabled", async () => {
    vi.useFakeTimers();
    const app = createApp();
    const plugin = loadPlugin(app, {
      openPanelOnStartup: false,
    });
    await plugin.onload();
    app.workspace.markReady();
    await settle();
    expect(app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)).toHaveLength(0);
  });

  it("does not open or close the panel when the startup setting changes later", async () => {
    vi.useFakeTimers();
    const app = createApp();
    const plugin = loadPlugin(app, {
      openPanelOnStartup: false,
    });
    await plugin.onload();
    app.workspace.markReady();
    await settle();
    expect(app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)).toHaveLength(0);

    plugin.settings.openPanelOnStartup = true;
    plugin.onSettingsChanged();
    await settle();
    expect(app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)).toHaveLength(0);

    await plugin.activateView();
    plugin.settings.openPanelOnStartup = false;
    plugin.onSettingsChanged();
    await settle();
    expect(app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)).toHaveLength(1);
  });

  it("persists the current settings through saveSettings", async () => {
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    plugin.settings.maxChildDepth = 2;
    plugin.settings.openPanelOnStartup = false;

    await plugin.saveSettings();

    expect(harness(plugin).persistedData).toEqual({
      maxChildDepth: 2,
      openPanelOnStartup: false,
    });
  });

  it("scans with persisted max child depth after layout is ready", async () => {
    vi.useFakeTimers();
    const app = createApp((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
`,
      );
      seedDocument(
        vault,
        "Work/Notes",
        `---
name: Notes
created: 2020-01-01T00:00:00Z
---
`,
      );
    });
    const plugin = loadPlugin(app, { maxChildDepth: 0 });
    await plugin.onload();
    await plugin.activateView();
    app.workspace.markReady();
    await settle();

    expect(document.querySelector('[data-path="Work"]')).not.toBeNull();
    expect(document.querySelector('[data-path="Work/Notes"]')).toBeNull();
  });

  it("keeps hidden child links when the visible tree is pruned to root depth", async () => {
    vi.useFakeTimers();
    const app = createApp((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
<!-- nestnote:children:start -->
- [Notes](Notes/index.md)
<!-- nestnote:children:end -->
`,
      );
      seedDocument(
        vault,
        "Work/Notes",
        `---
name: Notes
created: 2020-01-01T00:00:00Z
---
`,
      );
    });
    const plugin = loadPlugin(app, { maxChildDepth: 0 });
    await plugin.onload();
    await plugin.activateView();
    app.workspace.markReady();
    await settle();

    expect(app.vault.files.get("Work/index.md")).toContain(
      "[Notes](Notes/index.md)",
    );
    expect(document.querySelector('[data-path="Work"]')).not.toBeNull();
    expect(document.querySelector('[data-path="Work/Notes"]')).toBeNull();
  });

  it("refreshes the tree with the current max child depth after settings change", async () => {
    vi.useFakeTimers();
    const app = createApp((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
`,
      );
      seedDocument(
        vault,
        "Work/Notes",
        `---
name: Notes
created: 2020-01-01T00:00:00Z
---
`,
      );
    });
    const plugin = loadPlugin(app);
    await plugin.onload();
    await plugin.activateView();
    app.workspace.markReady();
    await settle();

    expect(document.querySelector('[data-path="Work"]')).not.toBeNull();
    expect(document.querySelector('[data-path="Work/Notes"]')).not.toBeNull();

    plugin.settings.maxChildDepth = 0;
    plugin.onSettingsChanged();
    await settle();

    expect(document.querySelector('[data-path="Work"]')).not.toBeNull();
    expect(document.querySelector('[data-path="Work/Notes"]')).toBeNull();
  });

  it("notices when opening the panel after layout ready fails", async () => {
    vi.useFakeTimers();
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    vi.spyOn(plugin, "activateView").mockRejectedValue(
      new Error("startup view failed"),
    );
    noticeHarness().messages = [];

    app.workspace.markReady();
    await settle();

    expect(
      noticeHarness().messages.some((message) =>
        message.includes("startup view failed"),
      ),
    ).toBe(true);
    expect(
      noticeHarness().messages.some((message) =>
        message.includes("设置保存失败"),
      ),
    ).toBe(false);
  });

  it("notices a refresh failure after settings change without claiming the save rolled back", async () => {
    vi.useFakeTimers();
    const app = createApp((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
`,
      );
    });
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();
    noticeHarness().messages = [];
    vi.spyOn(app.vault, "getAllLoadedFiles").mockImplementation(() => {
      throw new Error("scan exploded");
    });

    plugin.settings.maxChildDepth = 1;
    plugin.onSettingsChanged();
    await settle();

    expect(
      noticeHarness().messages.some((message) =>
        message.includes("scan exploded"),
      ),
    ).toBe(true);
    expect(
      noticeHarness().messages.some((message) =>
        message.includes("设置保存失败"),
      ),
    ).toBe(false);
    expect(plugin.settings.maxChildDepth).toBe(1);
  });

  it("scans and syncs frontmatter and child links after layout is ready", async () => {
    vi.useFakeTimers();
    const app = createApp((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
created: 2020-01-01T00:00:00Z
---
# Body
`,
      );
      seedDocument(
        vault,
        "Work/Notes",
        `---
name: Notes
created: 2020-01-01T00:00:00Z
---
`,
      );
    });
    const plugin = loadPlugin(app);
    await plugin.onload();
    expect(app.vault.files.get("Work/index.md")).not.toContain("name: Work");

    app.workspace.markReady();
    await settle();

    expect(app.vault.files.get("Work/index.md")).toContain("name: Work");
    expect(app.vault.files.get("Work/index.md")).toContain("# Body");
    expect(app.vault.files.get("Work/index.md")).toContain(
      "<!-- nestnote:children:start -->",
    );
    expect(app.vault.files.get("Work/index.md")).toContain(
      "[Notes](Notes/index.md)",
    );
  });

  it("fills missing created with a timezone-offset ISO timestamp", async () => {
    vi.useFakeTimers();
    const app = createApp((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
---
# Body
`,
      );
    });
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    const content = app.vault.files.get("Work/index.md") ?? "";
    expect(content).toMatch(
      /created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/,
    );
    expect(content).not.toMatch(/created: [^\n]*Z/);
  });

  it("reuses an existing sidebar leaf and otherwise uses the full left panel", async () => {
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();

    await plugin.activateView();
    expect(app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)).toHaveLength(1);
    expect(app.workspace.revealCalls).toHaveLength(1);
    expect(app.workspace.getLeftLeafSplits).toEqual([false]);
    const first = app.workspace.revealCalls[0];

    await plugin.activateView();
    expect(app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)).toHaveLength(1);
    expect(app.workspace.revealCalls[1]).toBe(first);
  });

  it("notices when opening the document tree from a command fails", async () => {
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    noticeHarness().messages = [];
    vi.spyOn(plugin, "activateView").mockRejectedValue(new Error("view failed"));

    command(plugin, "nestnote:open-document-tree")();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      noticeHarness().messages.some((message) => message.includes("view failed")),
    ).toBe(true);
  });

  it("falls back to setActiveLeaf when revealLeaf is unavailable", async () => {
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    const revealLeaf = app.workspace.revealLeaf.bind(app.workspace);
    (app.workspace as { revealLeaf?: unknown }).revealLeaf = undefined;

    await plugin.activateView();

    expect(app.workspace.setActiveLeafCalls).toHaveLength(1);
    expect(app.workspace.setActiveLeafFocusArgs).toEqual([false, true]);
    app.workspace.revealLeaf = revealLeaf;
  });

  it("uses the existing left sidebar panel when opening NestNote", async () => {
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    const existing = app.workspace.getLeftLeaf(false);
    existing.viewType = "markdown";

    await plugin.activateView();

    expect(existing.viewType).toBe(VIEW_TYPE_NESTNOTE);
    expect(app.workspace.getLeavesOfType(VIEW_TYPE_NESTNOTE)).toHaveLength(1);
    const splits = app.workspace.getLeftLeafSplits;
    expect(splits[splits.length - 1]).toBe(false);
  });

  it("archives created attachments with fileManager.renameFile", async () => {
    vi.useFakeTimers();
    const app = createApp((vault, workspace) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
`,
      );
      workspace.activeFile = fileRef("Work/index.md");
    });
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    await app.vault.create("Work/photo.png", "png-bytes");
    await settle();

    expect(app.fileManager.renameFileCalls).toEqual([
      { from: "Work/photo.png", to: "Work/attachments/photo.png" },
    ]);
    expect(app.vault.files.has("Work/attachments/photo.png")).toBe(true);
    expect(app.vault.renameCalls.filter((call) => call.from === "Work/photo.png")).toEqual(
      [{ from: "Work/photo.png", to: "Work/attachments/photo.png" }],
    );
  });

  it("falls back to vault.rename when fileManager.renameFile is missing", async () => {
    vi.useFakeTimers();
    const app = createApp((vault, workspace) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
`,
      );
      workspace.activeFile = fileRef("Work/index.md");
    });
    app.fileManager.renameFile = undefined;
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();
    app.vault.renameCalls.length = 0;

    await app.vault.create("Work/photo.png", "png-bytes");
    await settle();

    expect(app.fileManager.renameFileCalls).toEqual([]);
    expect(app.vault.renameCalls).toEqual([
      { from: "Work/photo.png", to: "Work/attachments/photo.png" },
    ]);
  });

  it("does not call vault.trashFile and uses fileManager.trashFile for document trash", async () => {
    vi.useFakeTimers();
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    command(plugin, "nestnote:new-document")();
    await confirmNameModal("Work");
    await settle();

    await plugin.activateView();
    clickTrashFromMore("Work");
    const confirm = document.querySelector('.nestnote-modal [aria-label="确认"]');
    if (!(confirm instanceof HTMLElement)) {
      throw new Error("confirm missing");
    }
    confirm.click();
    await settle();

    expect(app.fileManager.trashFileCalls).toEqual(["Work"]);
    expect(app.vault.trashFileCalls).toEqual([]);
    expect(app.vault.trashLocalCalls).toEqual([]);
    expect(app.vault.getFolderByPath("Work")).toBeNull();
  });

  it("falls back to vault.trash(folder, false) when fileManager.trashFile is missing", async () => {
    vi.useFakeTimers();
    const app = createApp();
    app.fileManager.trashFile = undefined;
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    command(plugin, "nestnote:new-document")();
    await confirmNameModal("Work");
    await settle();

    await plugin.activateView();
    clickTrashFromMore("Work");
    const confirm = document.querySelector('.nestnote-modal [aria-label="确认"]');
    if (!(confirm instanceof HTMLElement)) {
      throw new Error("confirm missing");
    }
    confirm.click();
    await settle();

    expect(app.fileManager.trashFileCalls).toEqual([]);
    expect(app.vault.trashLocalCalls).toEqual([{ path: "Work", system: false }]);
    expect(app.vault.trashFileCalls).toEqual([]);
  });

  it("notifies DocumentService and view errors through Notice", async () => {
    vi.useFakeTimers();
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    command(plugin, "nestnote:new-document")();
    await confirmNameModal("..");
    await settle();

    expect(
      noticeHarness().messages.some((message) => message.includes("无效")),
    ).toBe(true);
  });

  it("shares internal write protection so vault events do not refresh forever", async () => {
    vi.useFakeTimers();
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    command(plugin, "nestnote:new-document")();
    await confirmNameModal("Work");
    await settle();
    const afterCreate = app.vault.modifyCount;

    await vi.advanceTimersByTimeAsync(400);
    expect(app.vault.modifyCount).toBe(afterCreate);
  });

  it("submits the command name modal on Enter once and prevents default", async () => {
    vi.useFakeTimers();
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    const createSpy = vi.spyOn(
      (plugin as unknown as { documents: { create: (...args: unknown[]) => Promise<unknown> } })
        .documents,
      "create",
    );

    command(plugin, "nestnote:new-document")();
    const modal = document.querySelector(".nestnote-modal");
    const input = modal?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("input missing");
    }
    const confirm = modal?.querySelector('[aria-label="确认"]');
    if (!(confirm instanceof HTMLElement)) {
      throw new Error("confirm missing");
    }
    input.value = "From Enter";
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(enter);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    confirm.click();
    await settle();

    expect(enter.defaultPrevented).toBe(true);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith(null, "From Enter");
    expect(document.querySelector(".nestnote-modal")).toBeNull();
    expect(app.vault.folders.has("From Enter")).toBe(true);
  });

  it("creates a child document from the active document via command", async () => {
    vi.useFakeTimers();
    const app = createApp((vault, workspace) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
`,
      );
      workspace.activeFile = fileRef("Work/index.md");
    });
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    command(plugin, "nestnote:new-child-document")();
    await confirmNameModal("Notes");
    await settle();

    expect(app.vault.folders.has("Work/Notes")).toBe(true);
    expect(app.vault.files.has("Work/Notes/index.md")).toBe(true);
    expect(app.vault.files.get("Work/index.md")).toContain(
      "[Notes](Notes/index.md)",
    );
  });

  it("does not create a child document unless the active file is the document index.md", async () => {
    vi.useFakeTimers();
    const app = createApp((vault, workspace) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
`,
      );
      vault.files.set("Work/notes.md", "# notes\n");
      vault.files.set("Work/attachments/photo.png", "png");
      workspace.activeFile = fileRef("Work/notes.md");
    });
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();
    noticeHarness().messages = [];

    command(plugin, "nestnote:new-child-document")();
    expect(document.querySelector(".nestnote-modal")).toBeNull();
    expect(noticeHarness().messages.length).toBeGreaterThan(0);
    expect(app.vault.folders.has("Work/Notes")).toBe(false);

    app.workspace.activeFile = fileRef("Work/attachments/photo.png");
    noticeHarness().messages = [];
    command(plugin, "nestnote:new-child-document")();
    expect(document.querySelector(".nestnote-modal")).toBeNull();
    expect(noticeHarness().messages.length).toBeGreaterThan(0);
    expect(app.vault.folders.has("Work/Child")).toBe(false);
  });

  it("does not let an overlapping scan overwrite a newer index body", async () => {
    vi.useFakeTimers();
    const app = createApp((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
# Original
`,
      );
    });
    const plugin = loadPlugin(app);
    await plugin.onload();

    let releaseFirstRead: (() => void) | undefined;
    let held = false;
    const originalRead = app.vault.read.bind(app.vault);
    app.vault.read = async (file: { path: string }) => {
      const content = await originalRead(file);
      if (!held && normalize(file.path) === "Work/index.md") {
        held = true;
        await new Promise<void>((resolve) => {
          releaseFirstRead = resolve;
        });
      }
      return content;
    };

    app.workspace.markReady();
    await Promise.resolve();
    await Promise.resolve();
    expect(releaseFirstRead).toBeTypeOf("function");

    app.vault.files.set(
      "Work/index.md",
      `---
name: Work
created: 2020-01-01T00:00:00Z
---
# Edited
`,
    );
    command(plugin, "nestnote:refresh")();
    releaseFirstRead?.();
    await settle();

    expect(app.vault.files.get("Work/index.md")).toContain("# Edited");
    expect(app.vault.files.get("Work/index.md")).not.toContain("# Original");
  });

  it("archives the current attachment with the named backup command", async () => {
    vi.useFakeTimers();
    const app = createApp((vault, workspace) => {
      seedDocument(
        vault,
        "Work",
        `---
name: Work
created: 2020-01-01T00:00:00Z
---
`,
      );
      vault.files.set("Work/photo.png", "png-bytes");
      workspace.activeFile = fileRef("Work/photo.png");
    });
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();
    app.fileManager.renameFileCalls.length = 0;

    command(plugin, "nestnote:archive-current-attachment")();
    await settle();

    expect(app.vault.files.has("Work/attachments/photo.png")).toBe(true);
    expect(app.fileManager.renameFileCalls).toEqual([
      { from: "Work/photo.png", to: "Work/attachments/photo.png" },
    ]);
  });

  it("refreshes the sidebar after vault events once layout is ready", async () => {
    vi.useFakeTimers();
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    await plugin.activateView();
    app.workspace.markReady();
    await settle();

    seedDocument(
      app.vault,
      "Inbox",
      `---
name: Inbox
created: 2020-01-01T00:00:00Z
---
`,
    );
    app.vault.emit("create", folderRef("Inbox"));
    await settle();

    const rendered = document.querySelector('[data-path="Inbox"]');
    expect(rendered).not.toBeNull();
  });

  it("stops event listeners and timers on unload", async () => {
    vi.useFakeTimers();
    const app = createApp();
    const plugin = loadPlugin(app);
    await plugin.onload();
    app.workspace.markReady();
    await settle();

    const listenersBefore = harness(plugin).registeredEvents.length;
    for (const cleanup of harness(plugin).registeredCleanups) {
      cleanup();
    }
    app.vault.emit("create", fileRef("Work/photo.png"));
    await settle();
    expect(app.fileManager.renameFileCalls).toEqual([]);
    expect(listenersBefore).toBeGreaterThan(0);
  });

  it("does not scan on layout ready after the plugin has stopped", async () => {
    vi.useFakeTimers();
    const app = createApp((vault) => {
      seedDocument(
        vault,
        "Work",
        `---
---
# Body
`,
      );
    });
    const plugin = loadPlugin(app);
    await plugin.onload();
    for (const cleanup of harness(plugin).registeredCleanups) {
      cleanup();
    }
    app.workspace.markReady();
    await settle();
    expect(app.vault.files.get("Work/index.md")).not.toContain("name: Work");
  });
});
