import { FileSystemAdapter } from "obsidian";
import type { App } from "obsidian";

export interface DesktopFileActions {
  copyText(text: string): Promise<void>;
  resolveAbsolutePath(vaultRelativePath: string): string | null;
  openWithDefaultApp(absolutePath: string): Promise<void>;
  showInSystemExplorer(absolutePath: string): Promise<void>;
}

export function absolutePathFromAdapter(
  adapter: object,
  vaultRelativePath: string,
): string | null {
  if (adapter instanceof FileSystemAdapter) {
    return adapter.getFullPath(vaultRelativePath);
  }
  return null;
}

type ElectronModule = {
  shell: {
    openPath(path: string): Promise<string>;
    showItemInFolder(path: string): void;
  };
};

function electronShell(): ElectronModule["shell"] {
  const requireFn = (globalThis as { require?: (id: string) => ElectronModule })
    .require;
  if (typeof requireFn !== "function") {
    throw new Error("Electron is not available");
  }
  return requireFn("electron").shell;
}

export function createDesktopFileActions(app: App): DesktopFileActions {
  return {
    async copyText(text: string): Promise<void> {
      await navigator.clipboard.writeText(text);
    },
    resolveAbsolutePath(vaultRelativePath: string): string | null {
      return absolutePathFromAdapter(app.vault.adapter, vaultRelativePath);
    },
    async openWithDefaultApp(absolutePath: string): Promise<void> {
      const error = await electronShell().openPath(absolutePath);
      if (error !== "") {
        throw new Error(error);
      }
    },
    async showInSystemExplorer(absolutePath: string): Promise<void> {
      electronShell().showItemInFolder(absolutePath);
    },
  };
}
