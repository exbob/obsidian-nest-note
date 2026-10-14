import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App, Plugin } from "obsidian";
import { t } from "../i18n";
import {
  DEFAULT_NESTNOTE_SETTINGS,
  isValidFileExplorerRoot,
  type FileExplorerSide,
  type NestNoteSettings,
} from "../settings";

export interface NestNoteSettingsHost {
  settings: NestNoteSettings;
  saveSettings(): Promise<void>;
  onSettingsChanged(): void;
}

type DepthSlider = { setValue(value: number): unknown };
type BooleanToggle = { setValue(on: boolean): unknown };
type StringControl = { setValue(value: string): unknown };

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

    new Setting(this.containerEl)
      .setName(t("setting.fileExplorerHeading"))
      .setHeading();

    new Setting(this.containerEl)
      .setName(t("setting.openFileExplorerOnStartupName"))
      .setDesc(t("setting.openFileExplorerOnStartupDesc"))
      .addToggle((toggle) => {
        toggle.setValue(this.host.settings.openFileExplorerOnStartup);
        toggle.onChange((value) => {
          this.commitOpenFileExplorerOnStartup(toggle, value).catch(
            (error) => {
              this.noticeSaveFailure(error);
            },
          );
        });
      });

    new Setting(this.containerEl)
      .setName(t("setting.fileExplorerSideName"))
      .setDesc(t("setting.fileExplorerSideDesc"))
      .addDropdown((dropdown) => {
        dropdown
          .addOption("left", t("setting.fileExplorerSideLeft"))
          .addOption("right", t("setting.fileExplorerSideRight"));
        dropdown.setValue(this.host.settings.fileExplorerSide);
        dropdown.onChange((value) => {
          this.commitFileExplorerSide(dropdown, value).catch((error) => {
            this.noticeSaveFailure(error);
          });
        });
      });

    new Setting(this.containerEl)
      .setName(t("setting.fileExplorerRootName"))
      .setDesc(t("setting.fileExplorerRootDesc"))
      .addText((text) => {
        text.setValue(this.host.settings.fileExplorerRoot);
        // 不使用 onChange（逐键触发）：仅在失焦 / change / Enter 时提交，
        // 避免输入过程中反复保存并创建中间文件夹。
        const commit = (): void => {
          this.commitFileExplorerRoot(text, text.inputEl.value).catch(
            (error) => {
              this.noticeSaveFailure(error);
            },
          );
        };
        text.inputEl.addEventListener("change", commit);
        text.inputEl.addEventListener("blur", commit);
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
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

  private async commitOpenFileExplorerOnStartup(
    toggle: BooleanToggle,
    value: boolean,
  ): Promise<void> {
    const previous = this.host.settings.openFileExplorerOnStartup;
    this.host.settings.openFileExplorerOnStartup = value;
    try {
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.openFileExplorerOnStartup = previous;
      toggle.setValue(previous);
      this.noticeSaveFailure(error);
      return;
    }
    this.host.onSettingsChanged();
  }

  private async commitFileExplorerSide(
    dropdown: StringControl,
    value: string,
  ): Promise<void> {
    if (value !== "left" && value !== "right") {
      dropdown.setValue(this.host.settings.fileExplorerSide);
      return;
    }
    const side = value as FileExplorerSide;
    const previous = this.host.settings.fileExplorerSide;
    this.host.settings.fileExplorerSide = side;
    try {
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.fileExplorerSide = previous;
      dropdown.setValue(previous);
      this.noticeSaveFailure(error);
      return;
    }
    this.host.onSettingsChanged();
  }

  private async commitFileExplorerRoot(
    text: StringControl,
    raw: string,
  ): Promise<void> {
    const previous = this.host.settings.fileExplorerRoot;
    const value = raw.trim();
    if (value === previous) {
      if (raw !== previous) {
        text.setValue(previous);
      }
      return;
    }
    if (!isValidFileExplorerRoot(value)) {
      // 非法输入：回显已保存的值，不改内存设置，也不保存/刷新
      text.setValue(previous);
      new Notice(t("setting.fileExplorerRootInvalid"));
      return;
    }
    text.setValue(value);
    this.host.settings.fileExplorerRoot = value;
    try {
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.fileExplorerRoot = previous;
      text.setValue(previous);
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
