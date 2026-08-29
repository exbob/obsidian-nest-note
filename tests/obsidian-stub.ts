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
  readonly settingTabs: unknown[] = [];
  persistedData: unknown = null;

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

  async loadData(): Promise<unknown> {
    return this.persistedData;
  }

  async saveData(data: unknown): Promise<void> {
    this.persistedData = data;
  }

  addSettingTab(settingTab: unknown): void {
    this.settingTabs.push(settingTab);
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

export class MenuItem {
  title = "";
  icon = "";
  clickHandler: ((evt: MouseEvent) => unknown) | null = null;

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }

  onClick(callback: (evt: MouseEvent) => unknown): this {
    this.clickHandler = callback;
    return this;
  }
}

export class Menu {
  private readonly items: MenuItem[] = [];

  addItem(cb: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    cb(item);
    this.items.push(item);
    return this;
  }

  showAtMouseEvent(_event: MouseEvent): void {
    document.querySelector(".menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "menu";
    for (const item of this.items) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", item.title);
      if (item.icon !== "") {
        button.dataset.icon = item.icon;
      }
      button.addEventListener("click", (event) => {
        item.clickHandler?.(event);
      });
      menu.append(button);
    }
    document.body.append(menu);
  }
}

export class SettingTab {
  app: unknown;
  containerEl: HTMLElement;

  constructor(app: unknown) {
    this.app = app;
    this.containerEl = document.createElement("div");
  }

  display(): void {}

  hide(): void {}
}

export class PluginSettingTab extends SettingTab {
  plugin: Plugin;

  constructor(app: unknown, plugin: Plugin) {
    super(app);
    this.plugin = plugin;
  }
}

export class SliderComponent {
  sliderEl: HTMLInputElement;
  private value = 0;
  private changeCallback: ((value: number) => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    this.sliderEl = document.createElement("input");
    this.sliderEl.type = "range";
    this.sliderEl.addEventListener("change", () => {
      this.value = Number(this.sliderEl.value);
      void this.changeCallback?.(this.value);
    });
    this.sliderEl.addEventListener("nestnote-test-change", (event) => {
      void this.changeCallback?.((event as CustomEvent<number>).detail);
    });
    containerEl.appendChild(this.sliderEl);
  }

  setLimits(min: number, max: number, step: number): this {
    this.sliderEl.min = String(min);
    this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  }

  setValue(value: number): this {
    this.value = value;
    this.sliderEl.value = String(value);
    return this;
  }

  getValue(): number {
    return this.value;
  }

  onChange(callback: (value: number) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export class ToggleComponent {
  toggleEl: HTMLElement;
  private value = false;
  private changeCallback: ((value: boolean) => unknown) | null = null;

  constructor(containerEl: HTMLElement) {
    this.toggleEl = document.createElement("div");
    this.toggleEl.setAttribute("role", "switch");
    this.toggleEl.setAttribute("aria-checked", "false");
    this.toggleEl.addEventListener("click", () => {
      this.setValue(!this.value);
      void this.changeCallback?.(this.value);
    });
    containerEl.appendChild(this.toggleEl);
  }

  setValue(on: boolean): this {
    this.value = on;
    this.toggleEl.setAttribute("aria-checked", String(on));
    return this;
  }

  getValue(): boolean {
    return this.value;
  }

  onChange(callback: (value: boolean) => unknown): this {
    this.changeCallback = callback;
    return this;
  }
}

export class Setting {
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement("div");
    this.nameEl = document.createElement("div");
    this.descEl = document.createElement("div");
    this.controlEl = document.createElement("div");
    this.settingEl.append(this.nameEl, this.descEl, this.controlEl);
    containerEl.appendChild(this.settingEl);
  }

  setName(name: string): this {
    this.nameEl.textContent = name;
    return this;
  }

  setDesc(desc: string | DocumentFragment): this {
    if (typeof desc === "string") {
      this.descEl.textContent = desc;
    } else {
      this.descEl.append(desc);
    }
    return this;
  }

  addSlider(cb: (component: SliderComponent) => unknown): this {
    cb(new SliderComponent(this.controlEl));
    return this;
  }

  addToggle(cb: (component: ToggleComponent) => unknown): this {
    cb(new ToggleComponent(this.controlEl));
    return this;
  }
}

export type WorkspaceLeaf = { app?: unknown };
