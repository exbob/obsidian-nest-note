import { afterEach, describe, expect, it, vi } from "vitest";
import { NestNoteVaultEventCoordinator } from "../src/services/vault-event-coordinator";
import type { CoordinatorApp } from "../src/services/vault-event-coordinator";

interface EventRef {
  event: string;
}

interface FileRef {
  path: string;
  name: string;
  basename: string;
  extension?: string;
  children?: FileRef[];
}

class FakeVault {
  private readonly listeners = new Map<
    string,
    Array<{ callback: (...args: unknown[]) => unknown; ref: EventRef }>
  >();
  readonly offrefCalls: EventRef[] = [];

  on(
    name: string,
    callback: (...args: unknown[]) => unknown,
  ): EventRef {
    const ref: EventRef = { event: name };
    const list = this.listeners.get(name) ?? [];
    list.push({ callback, ref });
    this.listeners.set(name, list);
    return ref;
  }

  offref(ref: EventRef): void {
    this.offrefCalls.push(ref);
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
  layoutReady = true;
}

interface FakeApp extends CoordinatorApp {
  vault: FakeVault;
  workspace: FakeWorkspace;
}

class FakePlugin {
  readonly registered: EventRef[] = [];

  registerEvent(ref: EventRef): void {
    this.registered.push(ref);
  }
}

function fileRef(path: string): FileRef {
  const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  const dot = name.lastIndexOf(".");
  return {
    path,
    name,
    basename: dot === -1 ? name : name.slice(0, dot),
    extension: dot === -1 ? "" : name.slice(dot + 1),
  };
}

function folderRef(path: string): FileRef {
  const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return { path, name, basename: name, children: [] };
}

function createHarness(): {
  app: FakeApp;
  plugin: FakePlugin;
  refreshCalls: string[][];
  createdFiles: Array<{ path: string }>;
  coordinator: NestNoteVaultEventCoordinator;
} {
  const app: FakeApp = {
    vault: new FakeVault(),
    workspace: new FakeWorkspace(),
  };
  const plugin = new FakePlugin();
  const refreshCalls: string[][] = [];
  const createdFiles: Array<{ path: string }> = [];
  const coordinator = new NestNoteVaultEventCoordinator(app, plugin, {
    handleCreatedFile: async (file) => {
      createdFiles.push(file);
    },
    onRefresh: (paths) => {
      refreshCalls.push([...paths]);
    },
  });
  return { app, plugin, refreshCalls, createdFiles, coordinator };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("NestNoteVaultEventCoordinator", () => {
  it("merges create, modify, rename, and delete events into one refresh after 100ms", async () => {
    vi.useFakeTimers();
    const { app, plugin, refreshCalls, createdFiles, coordinator } =
      createHarness();
    coordinator.start();

    expect(plugin.registered.map((ref) => ref.event).sort()).toEqual([
      "create",
      "delete",
      "modify",
      "rename",
    ]);

    app.vault.emit("create", fileRef("Work/photo.png"));
    app.vault.emit("modify", fileRef("Work/index.md"));
    app.vault.emit("rename", fileRef("Work/Renamed/index.md"), "Work/index.md");
    app.vault.emit("delete", fileRef("Old/index.md"));

    expect(refreshCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(99);
    expect(refreshCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0]?.slice().sort()).toEqual(
      [
        "Old/index.md",
        "Work/Renamed/index.md",
        "Work/index.md",
        "Work/photo.png",
      ].sort(),
    );
    expect(createdFiles.map((file) => file.path)).toEqual(["Work/photo.png"]);
  });

  it("records events during internal writes and refreshes once afterwards", async () => {
    vi.useFakeTimers();
    const { app, refreshCalls, createdFiles, coordinator } = createHarness();
    coordinator.start();

    await coordinator.runInternal(async () => {
      app.vault.emit("create", fileRef("Work/photo.png"));
      app.vault.emit("modify", fileRef("Work/index.md"));
      app.vault.emit("rename", fileRef("Work/Renamed/index.md"), "Work/index.md");
      app.vault.emit("delete", fileRef("Old/index.md"));
      expect(refreshCalls).toEqual([]);
    });

    expect(refreshCalls).toEqual([]);
    expect(createdFiles).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);

    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0]?.slice().sort()).toEqual(
      [
        "Old/index.md",
        "Work/Renamed/index.md",
        "Work/index.md",
        "Work/photo.png",
      ].sort(),
    );
  });

  it("ignores vault events until layoutReady", async () => {
    vi.useFakeTimers();
    const { app, refreshCalls, createdFiles, coordinator } = createHarness();
    app.workspace.layoutReady = false;
    coordinator.start();

    app.vault.emit("create", fileRef("Work/photo.png"));
    app.vault.emit("modify", fileRef("Work/index.md"));
    await vi.advanceTimersByTimeAsync(100);

    expect(refreshCalls).toEqual([]);
    expect(createdFiles).toEqual([]);

    app.workspace.layoutReady = true;
    app.vault.emit("create", fileRef("Work/photo.png"));
    await vi.advanceTimersByTimeAsync(100);

    expect(refreshCalls).toHaveLength(1);
    expect(createdFiles.map((file) => file.path)).toEqual(["Work/photo.png"]);
  });

  it("does not treat folder create events as attachments", async () => {
    vi.useFakeTimers();
    const { app, refreshCalls, createdFiles, coordinator } = createHarness();
    coordinator.start();

    app.vault.emit("create", folderRef("Work/attachments"));
    await vi.advanceTimersByTimeAsync(100);

    expect(createdFiles).toEqual([]);
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0]).toEqual(["Work/attachments"]);
  });

  it("requestRefresh still schedules a scan after internal writes", async () => {
    vi.useFakeTimers();
    const { app, refreshCalls, coordinator } = createHarness();
    coordinator.start();

    await coordinator.runInternal(async () => {
      app.vault.emit("modify", fileRef("Work/index.md"));
    });
    coordinator.requestRefresh(["Work/index.md", "Work/attachments/photo.png"]);

    expect(refreshCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);

    expect(refreshCalls).toEqual([
      ["Work/index.md", "Work/attachments/photo.png"],
    ]);
  });

  it("stop unregisters listeners and cancels a pending refresh", async () => {
    vi.useFakeTimers();
    const { app, plugin, refreshCalls, coordinator } = createHarness();
    coordinator.start();

    app.vault.emit("modify", fileRef("Work/index.md"));
    coordinator.stop();

    expect(app.vault.offrefCalls).toHaveLength(plugin.registered.length);
    await vi.advanceTimersByTimeAsync(100);
    expect(refreshCalls).toEqual([]);

    app.vault.emit("modify", fileRef("Work/index.md"));
    await vi.advanceTimersByTimeAsync(100);
    expect(refreshCalls).toEqual([]);

    coordinator.requestRefresh(["Work/index.md"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(refreshCalls).toEqual([]);
  });

  it("notifies when handleCreatedFile rejects instead of leaving an unhandled rejection", async () => {
    vi.useFakeTimers();
    const app: FakeApp = {
      vault: new FakeVault(),
      workspace: new FakeWorkspace(),
    };
    const plugin = new FakePlugin();
    const errors: string[] = [];
    const coordinator = new NestNoteVaultEventCoordinator(app, plugin, {
      handleCreatedFile: async () => {
        throw new Error("archive failed");
      },
      onError: (message) => {
        errors.push(message);
      },
    });
    coordinator.start();

    app.vault.emit("create", fileRef("Work/photo.png"));
    await Promise.resolve();
    await Promise.resolve();

    expect(errors).toEqual(["archive failed"]);
  });
});
