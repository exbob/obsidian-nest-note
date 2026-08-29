export interface CoordinatorFileRef {
  path: string;
  name: string;
  basename?: string;
  extension?: string;
  children?: unknown;
}

export interface EventRefLike {
  event?: string;
}

export interface VaultEventCoordinator {
  start(): void;
  stop(): void;
  requestRefresh(paths: readonly string[]): void;
}

export interface CoordinatorApp {
  vault: {
    on(
      name: string,
      callback: (...args: unknown[]) => unknown,
    ): EventRefLike;
    offref(ref: EventRefLike): void;
  };
  workspace: {
    layoutReady: boolean;
  };
}

export interface EventRegistrar {
  registerEvent(ref: EventRefLike): void;
}

export interface VaultEventCoordinatorOptions {
  handleCreatedFile?: (file: CoordinatorFileRef) => Promise<void>;
  onRefresh?: (paths: readonly string[]) => void;
  onError?: (message: string) => void;
}

const DEBOUNCE_MS = 100;

export class InternalOperationGuard {
  private depth = 0;

  isActive(): boolean {
    return this.depth > 0;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.depth += 1;
    try {
      return await fn();
    } finally {
      this.depth -= 1;
    }
  }
}

export class NestNoteVaultEventCoordinator implements VaultEventCoordinator {
  private readonly guard = new InternalOperationGuard();
  private readonly pending = new Set<string>();
  private readonly refs: EventRefLike[] = [];
  private timer: number | undefined;
  private started = false;

  constructor(
    private readonly app: CoordinatorApp,
    private readonly registrar: EventRegistrar,
    private readonly options: VaultEventCoordinatorOptions = {},
  ) {}

  start(): void {
    if (this.started) {
      this.stop();
    }
    this.started = true;
    this.listen("create", (...args) => {
      void this.onCreate(args[0]);
    });
    this.listen("modify", (...args) => {
      this.onPathEvent(args[0]);
    });
    this.listen("delete", (...args) => {
      this.onPathEvent(args[0]);
    });
    this.listen("rename", (...args) => {
      this.onRename(args[0], args[1]);
    });
  }

  stop(): void {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pending.clear();
    for (const ref of this.refs.splice(0)) {
      this.app.vault.offref(ref);
    }
    this.started = false;
  }

  requestRefresh(paths: readonly string[]): void {
    for (const path of paths) {
      this.queue(path);
    }
    this.maybeSchedule();
  }

  async runInternal<T>(fn: () => Promise<T>): Promise<T> {
    const result = await this.guard.run(fn);
    this.maybeSchedule();
    return result;
  }

  isInternalOperation(): boolean {
    return this.guard.isActive();
  }

  private listen(
    name: string,
    callback: (...args: unknown[]) => unknown,
  ): void {
    const ref = this.app.vault.on(name, callback);
    this.registrar.registerEvent(ref);
    this.refs.push(ref);
  }

  private async onCreate(file: unknown): Promise<void> {
    if (!this.app.workspace.layoutReady) {
      return;
    }
    if (
      !this.guard.isActive() &&
      isFile(file) &&
      this.options.handleCreatedFile !== undefined
    ) {
      try {
        await this.options.handleCreatedFile(file);
      } catch (error) {
        this.options.onError?.(errorMessage(error));
      }
    }
    this.queueUnknown(file);
    this.maybeSchedule();
  }

  private onPathEvent(file: unknown): void {
    if (!this.app.workspace.layoutReady) {
      return;
    }
    this.queueUnknown(file);
    this.maybeSchedule();
  }

  private onRename(file: unknown, oldPath: unknown): void {
    if (!this.app.workspace.layoutReady) {
      return;
    }
    this.queueUnknown(file);
    if (typeof oldPath === "string") {
      this.queue(oldPath);
    }
    this.maybeSchedule();
  }

  private maybeSchedule(): void {
    if (!this.started || this.guard.isActive()) {
      return;
    }
    this.schedule();
  }

  private queueUnknown(file: unknown): void {
    const path = getPath(file);
    if (path !== null) {
      this.queue(path);
    }
  }

  private queue(path: string): void {
    const normalized = normalizePath(path);
    if (normalized !== "") {
      this.pending.add(normalized);
    }
  }

  private schedule(): void {
    if (!this.started) {
      return;
    }
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
    }
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, DEBOUNCE_MS);
  }

  private flush(): void {
    if (!this.started) {
      return;
    }
    const paths = [...this.pending];
    this.pending.clear();
    if (paths.length === 0) {
      return;
    }
    this.options.onRefresh?.(paths);
  }
}

function isFile(value: unknown): value is CoordinatorFileRef {
  if (!isRecord(value) || typeof value.path !== "string") {
    return false;
  }
  if (Array.isArray(value.children)) {
    return false;
  }
  return typeof value.extension === "string";
}

function getPath(value: unknown): string | null {
  if (isRecord(value) && typeof value.path === "string") {
    return value.path;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
