declare function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  o?: {
    cls?: string | string[];
    attr?: Record<string, string | number | boolean | null>;
    text?: string;
    type?: string;
    value?: string;
  } | string,
): HTMLElementTagNameMap[K];
