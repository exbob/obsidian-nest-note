export class Notice {
  static messages: string[] = [];

  constructor(message: string | DocumentFragment) {
    Notice.messages.push(typeof message === "string" ? message : message.textContent ?? "");
  }

  setMessage(message: string | DocumentFragment): this {
    Notice.messages.push(typeof message === "string" ? message : message.textContent ?? "");
    return this;
  }

  hide(): void {}
}

export class Plugin {
  app: unknown;
  manifest: unknown;
  readonly commands: Array<{
    id: string;
    name: string;
    callback?: () => unknown;
    checkCallback?: (checking: boolean) => boolean | void;
  }> = [];
  readonly ribbonIcons: Array<{
    icon: string;
    title: string;
    callback: (evt: MouseEvent) => unknown;
  }> = [];
  readonly views = new Map<string, (leaf: unknown) => unknown>();
  readonly registeredEvents: unknown[] = [];
  readonly registeredCleanups: Array<() => unknown> = [];

  constructor(app: unknown, manifest: unknown) {
    this.app = app;
    this.manifest = manifest;
  }

  addCommand(command: {
    id: string;
    name: string;
    callback?: () => unknown;
    checkCallback?: (checking: boolean) => boolean | void;
  }): typeof command {
    this.commands.push(command);
    return command;
  }

  addRibbonIcon(
    icon: string,
    title: string,
    callback: (evt: MouseEvent) => unknown,
  ): HTMLElement {
    this.ribbonIcons.push({ icon, title, callback });
    return document.createElement("div");
  }

  registerView(type: string, viewCreator: (leaf: unknown) => unknown): void {
    this.views.set(type, viewCreator);
  }

  registerEvent(eventRef: unknown): void {
    this.registeredEvents.push(eventRef);
  }

  register(cb: () => unknown): void {
    this.registeredCleanups.push(cb);
  }
}

export class ItemView {
  app: unknown;
  contentEl: HTMLElement;

  constructor(leaf: { app?: unknown }) {
    this.app = leaf.app ?? {};
    this.contentEl = document.createElement("div");
  }
}

export class Modal {
  app: unknown;
  contentEl: HTMLElement;
  titleEl: HTMLElement;
  modalEl: HTMLElement;

  constructor(app: unknown) {
    this.app = app;
    this.modalEl = document.createElement("div");
    this.titleEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.modalEl.append(this.titleEl, this.contentEl);
  }

  open(): void {
    document.body.appendChild(this.modalEl);
    void this.onOpen();
  }

  close(): void {
    this.modalEl.remove();
    this.onClose();
  }

  onOpen(): void | Promise<void> {}

  onClose(): void {}

  setTitle(title: string): this {
    this.titleEl.textContent = title;
    return this;
  }
}

export function setIcon(parent: HTMLElement, iconId: string): void {
  parent.dataset.icon = iconId;
}

export type WorkspaceLeaf = { app?: unknown };
