import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App, Plugin } from "obsidian";
import type { NestNoteSettings } from "../settings";

export interface NestNoteSettingsHost {
  settings: NestNoteSettings;
  saveSettings(): Promise<void>;
  onSettingsChanged(): void;
}

type DepthSlider = { setValue(value: number): unknown };
type StartupToggle = { setValue(on: boolean): unknown };

export class NestNoteSettingTab extends PluginSettingTab {
  private readonly host: NestNoteSettingsHost;

  constructor(app: App, plugin: Plugin & NestNoteSettingsHost) {
    super(app, plugin);
    this.host = plugin;
  }

  display(): void {
    this.containerEl.replaceChildren();

    new Setting(this.containerEl)
      .setName("最大子文档层级")
      .setDesc("根文档为第 0 级，可设置 0～9")
      .addSlider((slider) => {
        slider.setLimits(0, 9, 1);
        slider.setValue(this.host.settings.maxChildDepth);
        slider.onChange((value) => {
          this.commitMaxChildDepth(slider, value).catch((error) => {
            this.noticeSaveFailure(error);
          });
        });
      });

    new Setting(this.containerEl)
      .setName("启动时打开 NestNote 面板")
      .setDesc("仅影响下次启动，不关闭当前面板")
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.openPanelOnStartup);
        toggle.onChange((value) => {
          this.commitOpenPanelOnStartup(toggle, value).catch((error) => {
            this.noticeSaveFailure(error);
          });
        });
      });
  }

  private async commitMaxChildDepth(
    slider: DepthSlider,
    value: number,
  ): Promise<void> {
    if (!Number.isInteger(value) || value < 0 || value > 9) {
      slider.setValue(this.host.settings.maxChildDepth);
      new Notice("最大子文档层级必须是 0～9 的整数");
      return;
    }
    const previous = this.host.settings.maxChildDepth;
    this.host.settings.maxChildDepth = value;
    try {
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.maxChildDepth = previous;
      slider.setValue(previous);
      this.noticeSaveFailure(error);
      return;
    }
    this.host.onSettingsChanged();
  }

  private async commitOpenPanelOnStartup(
    toggle: StartupToggle,
    value: boolean,
  ): Promise<void> {
    const previous = this.host.settings.openPanelOnStartup;
    this.host.settings.openPanelOnStartup = value;
    try {
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.openPanelOnStartup = previous;
      toggle.setValue(previous);
      this.noticeSaveFailure(error);
      return;
    }
    this.host.onSettingsChanged();
  }

  private noticeSaveFailure(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    new Notice(`设置保存失败，已恢复为上次有效值：${detail}`);
  }
}
