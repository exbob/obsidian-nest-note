import { FileSystemAdapter } from "obsidian";
import type { App } from "obsidian";

export interface DesktopFileActions {
  copyText(text: string): Promise<void>;
  resolveAbsolutePath(vaultRelativePath: string): string | null;
  openWithDefaultApp(absolutePath: string): Promise<void>;
  showInSystemExplorer(absolutePath: string): Promise<void>;
  /**
   * 将本地绝对路径写入系统「文件」剪贴板。
   * 非 Windows 平台不支持，会抛错（上层应提示 `notice.clipboardFilesUnavailable`）。
   */
  copyFiles(absolutePaths: string[]): Promise<void>;
  /**
   * 读取系统文件剪贴板中的绝对路径列表；无则返回 []。
   * 非 Windows 平台不支持，返回 []。
   */
  readClipboardFiles(): Promise<string[]>;
  /** 把库外绝对路径复制到 vault 相对目标（文件或递归文件夹）；目标父目录须已存在 */
  importAbsolutePath(
    absoluteSource: string,
    vaultDestPath: string,
  ): Promise<void>;
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

/** 转义 PowerShell 单引号字符串内的 `'`（`'` → `''`）。 */
export function escapePowerShellSingleQuoted(path: string): string {
  return path.replace(/'/g, "''");
}

/**
 * 构造写入文件剪贴板的 PowerShell 命令。
 * 使用 `-LiteralPath`，避免 `[` `]` 等字符被当作通配符。
 */
export function buildSetClipboardFilesCommand(
  absolutePaths: string[],
): string {
  const items = absolutePaths
    .map((p) => `'${escapePowerShellSingleQuoted(p)}'`)
    .join(",");
  return `Set-Clipboard -LiteralPath @(${items})`;
}

const GET_CLIPBOARD_FILES_COMMAND =
  "Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }";

/** 按行拆分 PowerShell 输出，去除空白行。 */
export function parseClipboardFileList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

type CopyFn = (
  source: string,
  destination: string,
  options: { recursive: boolean },
) => Promise<void>;

/** 可注入依赖，便于单测 mock（不跑真实 PowerShell / fs）。 */
export interface DesktopFileActionsDeps {
  platform?: string;
  /** 执行 PowerShell 命令并返回 stdout */
  runPowerShell?: (command: string) => Promise<string>;
  /** 等价于 fs.promises.cp */
  copy?: CopyFn;
}

type ElectronModule = {
  shell: {
    openPath(path: string): Promise<string>;
    showItemInFolder(path: string): void;
  };
};

type NodeRequire = (id: string) => unknown;

function nodeRequire(): NodeRequire {
  const requireFn = (globalThis as { require?: NodeRequire }).require;
  if (typeof requireFn !== "function") {
    throw new Error("Electron is not available");
  }
  return requireFn;
}

function electronShell(): ElectronModule["shell"] {
  return (nodeRequire()("electron") as ElectronModule).shell;
}

function encodeUtf16LeBase64(text: string): string {
  let binary = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    binary += String.fromCharCode(code & 0xff, code >> 8);
  }
  return btoa(binary);
}

function currentPlatform(): string {
  return (
    (globalThis as { process?: { platform?: string } }).process?.platform ?? ""
  );
}

function defaultRunPowerShell(command: string): Promise<string> {
  const { execFile } = nodeRequire()("child_process") as {
    execFile(
      file: string,
      args: string[],
      options: { windowsHide: boolean; maxBuffer: number; encoding: "utf8" },
      callback: (error: Error | null, stdout: string) => void,
    ): void;
  };
  // 强制 UTF-8 输出，并用 -EncodedCommand 规避命令行引号转义问题。
  const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`;
  const encoded = encodeUtf16LeBase64(script);
  return new Promise((resolve, reject) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function defaultCopy(
  source: string,
  destination: string,
  options: { recursive: boolean },
): Promise<void> {
  const fs = nodeRequire()("fs") as {
    promises: { cp: CopyFn };
  };
  return fs.promises.cp(source, destination, options);
}

export function createDesktopFileActions(
  app: App,
  deps: DesktopFileActionsDeps = {},
): DesktopFileActions {
  const isWindows = (deps.platform ?? currentPlatform()) === "win32";
  const runPowerShell = deps.runPowerShell ?? defaultRunPowerShell;
  const copy = deps.copy ?? defaultCopy;
  const resolveAbsolutePath = (vaultRelativePath: string): string | null =>
    absolutePathFromAdapter(app.vault.adapter, vaultRelativePath);

  return {
    async copyText(text: string): Promise<void> {
      await navigator.clipboard.writeText(text);
    },
    resolveAbsolutePath,
    async openWithDefaultApp(absolutePath: string): Promise<void> {
      const error = await electronShell().openPath(absolutePath);
      if (error !== "") {
        throw new Error(error);
      }
    },
    async showInSystemExplorer(absolutePath: string): Promise<void> {
      electronShell().showItemInFolder(absolutePath);
    },
    async copyFiles(absolutePaths: string[]): Promise<void> {
      if (!isWindows) {
        // macOS / Linux：暂未实现（macOS 可后续用 osascript）。
        throw new Error("File clipboard is only supported on Windows");
      }
      if (absolutePaths.length === 0) return;
      await runPowerShell(buildSetClipboardFilesCommand(absolutePaths));
    },
    async readClipboardFiles(): Promise<string[]> {
      if (!isWindows) return [];
      const output = await runPowerShell(GET_CLIPBOARD_FILES_COMMAND);
      return parseClipboardFileList(output);
    },
    async importAbsolutePath(
      absoluteSource: string,
      vaultDestPath: string,
    ): Promise<void> {
      const absoluteDest = resolveAbsolutePath(vaultDestPath);
      if (absoluteDest === null) {
        throw new Error("Vault is not backed by the local file system");
      }
      await copy(absoluteSource, absoluteDest, { recursive: true });
    },
  };
}
