import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App, Plugin } from "obsidian";
import { t } from "../i18n";
import type { NestNoteSettings } from "../settings";

export interface NestNoteSettingsHost {
  settings: NestNoteSettings;
  saveSettings(): Promise<void>;
  onSettingsChanged(): void;
}

type DepthSlider = { setValue(value: number): unknown };
type BooleanToggle = { setValue(on: boolean): unknown };

export class NestNoteSettingTab extends PluginSettingTab {
  private readonly host: NestNoteSettingsHost;

  constructor(app: App, plugin: Plugin & NestNoteSettingsHost) {
    super(app, plugin);
    this.host = plugin;
  }

  display(): void {
    this.containerEl.replaceChildren();

    new Setting(this.containerEl)
      .setName(t("setting.maxChildDepthName"))
      .setDesc(t("setting.maxChildDepthDesc"))
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
      .setName(t("setting.openPanelOnStartupName"))
      .setDesc(t("setting.openPanelOnStartupDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.openPanelOnStartup);
        toggle.onChange((value) => {
          this.commitOpenPanelOnStartup(toggle, value).catch((error) => {
            this.noticeSaveFailure(error);
          });
        });
      });

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
  }

  private async commitMaxChildDepth(
    slider: DepthSlider,
    value: number,
  ): Promise<void> {
    if (!Number.isInteger(value) || value < 0 || value > 9) {
      slider.setValue(this.host.settings.maxChildDepth);
      new Notice(t("setting.maxChildDepthInvalid"));
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
    toggle: BooleanToggle,
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

  private noticeSaveFailure(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    new Notice(t("setting.saveFailed", { detail }));
  }
}
