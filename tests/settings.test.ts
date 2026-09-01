import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { Notice, Plugin } from "obsidian";
import {
  DEFAULT_NESTNOTE_SETTINGS,
  normalizeNestNoteSettings,
  type NestNoteSettings,
} from "../src/settings";
import { t } from "../src/i18n";
import {
  NestNoteSettingTab,
  type NestNoteSettingsHost,
} from "../src/ui/settings-tab";

describe("normalizeNestNoteSettings", () => {
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
});

interface NoticeHarness {
  messages: string[];
}

function noticeHarness(): NoticeHarness {
  return Notice as unknown as NoticeHarness;
}

class FakeSettingsPlugin extends Plugin implements NestNoteSettingsHost {
  settings: NestNoteSettings;
  saveSettings = vi.fn(async (): Promise<void> => {});
  onSettingsChanged = vi.fn((): void => {});

  constructor(settings: Partial<NestNoteSettings> = {}) {
    super({} as App, {
      id: "nest-note",
      name: "NestNote",
      version: "1.0.1",
      minAppVersion: "1.7.2",
      description: "",
      author: "",
    });
    this.settings = { ...DEFAULT_NESTNOTE_SETTINGS, ...settings };
  }
}

function mountTab(
  settings: Partial<NestNoteSettings> = {},
): {
  tab: NestNoteSettingTab;
  host: FakeSettingsPlugin;
} {
  const host = new FakeSettingsPlugin(settings);
  const tab = new NestNoteSettingTab({} as App, host);
  tab.display();
  document.body.appendChild(tab.containerEl);
  return { tab, host };
}

function depthInput(tab: NestNoteSettingTab): HTMLInputElement {
  const input = tab.containerEl.querySelector("input[type='range']");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("missing max child depth input");
  }
  return input;
}

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

afterEach(() => {
  document.body.replaceChildren();
  noticeHarness().messages = [];
});

describe("NestNoteSettingTab", () => {
  it("renders depth, startup, and auto-fix settings", () => {
    const { tab } = mountTab({ maxChildDepth: 3, openPanelOnStartup: false });
    const text = tab.containerEl.textContent ?? "";
    expect(text).toContain(t("setting.maxChildDepthName"));
    expect(text).toContain(t("setting.maxChildDepthDesc"));
    expect(text).toContain(t("setting.openPanelOnStartupName"));
    expect(text).toContain(t("setting.openPanelOnStartupDesc"));
    expect(text).toContain(t("setting.autoFixDocumentFormatName"));
    expect(text).toContain(t("setting.autoFixDocumentFormatDesc"));

    const input = depthInput(tab);
    expect(input.min).toBe("0");
    expect(input.max).toBe("9");
    expect(input.step).toBe("1");
    expect(input.value).toBe("3");
    expect(startupToggle(tab).getAttribute("aria-checked")).toBe("false");
    expect(autoFixToggle(tab).getAttribute("aria-checked")).toBe("true");
  });

  it("saves a valid depth change and notifies the host", async () => {
    const { tab, host } = mountTab();
    const input = depthInput(tab);
    input.value = "7";
    input.dispatchEvent(new Event("change"));
    await Promise.resolve();

    expect(host.settings.maxChildDepth).toBe(7);
    expect(host.saveSettings).toHaveBeenCalledTimes(1);
    expect(host.onSettingsChanged).toHaveBeenCalledTimes(1);
    expect(host.saveSettings.mock.invocationCallOrder[0]).toBeLessThan(
      host.onSettingsChanged.mock.invocationCallOrder[0],
    );
  });

  it("restores the current depth and shows a Notice for invalid values", async () => {
    const { tab, host } = mountTab({ maxChildDepth: 5 });
    const input = depthInput(tab);
    input.dispatchEvent(
      new CustomEvent("nestnote-test-change", { detail: 1.5 }),
    );
    await Promise.resolve();

    expect(host.settings.maxChildDepth).toBe(5);
    expect(input.value).toBe("5");
    expect(host.saveSettings).not.toHaveBeenCalled();
    expect(host.onSettingsChanged).not.toHaveBeenCalled();
    expect(noticeHarness().messages.length).toBeGreaterThan(0);
  });

  it("saves startup toggle changes and notifies the host", async () => {
    const { tab, host } = mountTab({ openPanelOnStartup: true });
    startupToggle(tab).click();
    await Promise.resolve();

    expect(host.settings.openPanelOnStartup).toBe(false);
    expect(host.saveSettings).toHaveBeenCalledTimes(1);
    expect(host.onSettingsChanged).toHaveBeenCalledTimes(1);
  });

  it("saves auto-fix toggle changes and notifies the host", async () => {
    const { tab, host } = mountTab({ autoFixDocumentFormat: true });
    autoFixToggle(tab).click();
    await Promise.resolve();

    expect(host.settings.autoFixDocumentFormat).toBe(false);
    expect(host.saveSettings).toHaveBeenCalledTimes(1);
    expect(host.onSettingsChanged).toHaveBeenCalledTimes(1);
  });

  it("rolls back depth and shows a Notice when saveSettings fails", async () => {
    const { tab, host } = mountTab({ maxChildDepth: 5 });
    host.saveSettings.mockRejectedValueOnce(new Error("persist failed"));
    const input = depthInput(tab);
    input.value = "7";
    input.dispatchEvent(new Event("change"));
    await Promise.resolve();
    await Promise.resolve();

    expect(host.settings.maxChildDepth).toBe(5);
    expect(input.value).toBe("5");
    expect(host.saveSettings).toHaveBeenCalledTimes(1);
    expect(host.onSettingsChanged).not.toHaveBeenCalled();
    expect(noticeHarness().messages.length).toBeGreaterThan(0);
  });

  it("rolls back the startup toggle and shows a Notice when saveSettings fails", async () => {
    const { tab, host } = mountTab({ openPanelOnStartup: true });
    host.saveSettings.mockRejectedValueOnce(new Error("persist failed"));
    startupToggle(tab).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(host.settings.openPanelOnStartup).toBe(true);
    expect(startupToggle(tab).getAttribute("aria-checked")).toBe("true");
    expect(host.saveSettings).toHaveBeenCalledTimes(1);
    expect(host.onSettingsChanged).not.toHaveBeenCalled();
    expect(noticeHarness().messages.length).toBeGreaterThan(0);
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
});
