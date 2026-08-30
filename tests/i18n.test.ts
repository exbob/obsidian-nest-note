import { afterEach, describe, expect, it } from "vitest";
import {
  detectLanguage,
  resolveLocale,
  setLocaleForTests,
  t,
} from "../src/i18n";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";
import { MESSAGE_KEYS } from "../src/i18n/types";

describe("resolveLocale", () => {
  it("maps zh prefixes to zh", () => {
    expect(resolveLocale("zh")).toBe("zh");
    expect(resolveLocale("zh-TW")).toBe("zh");
    expect(resolveLocale("zh-cn")).toBe("zh");
    expect(resolveLocale("ZH")).toBe("zh");
  });

  it("maps missing and non-zh codes to en", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("")).toBe("en");
    expect(resolveLocale(null)).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale("ja")).toBe("en");
    expect(resolveLocale("fr")).toBe("en");
  });
});

describe("detectLanguage", () => {
  const storage = (value: string | null) => ({
    getItem: (key: string) => (key === "language" ? value : null),
  });

  it("prefers getLanguage over localStorage", () => {
    expect(
      detectLanguage({ getLanguage: () => "ja" }, storage("zh")),
    ).toBe("ja");
  });

  it("falls back to localStorage when getLanguage is missing", () => {
    expect(detectLanguage({}, storage("zh"))).toBe("zh");
  });

  it("falls back to localStorage when getLanguage returns a blank string", () => {
    expect(
      detectLanguage({ getLanguage: () => "  " }, storage("fr")),
    ).toBe("fr");
  });

  it("defaults to en when both sources are missing", () => {
    expect(detectLanguage({}, storage(null))).toBe("en");
    expect(detectLanguage({}, null)).toBe("en");
  });
});

describe("message catalogs", () => {
  it("uses the same keys in zh, en, and MESSAGE_KEYS", () => {
    expect(Object.keys(zh).sort()).toEqual([...MESSAGE_KEYS].sort());
    expect(Object.keys(en).sort()).toEqual([...MESSAGE_KEYS].sort());
  });
});

describe("t", () => {
  afterEach(() => {
    setLocaleForTests("zh");
  });

  it("interpolates known placeholders", () => {
    setLocaleForTests("zh");
    expect(t("error.targetExists", { path: "Work" })).toBe("目标已存在：Work");
    setLocaleForTests("en");
    expect(t("error.targetExists", { path: "Work" })).toBe(
      "Target already exists: Work",
    );
  });

  it("leaves unknown placeholders unchanged", () => {
    setLocaleForTests("en");
    expect(t("error.targetExists", { name: "Work" })).toBe(
      "Target already exists: {path}",
    );
  });

  it("translates move cycle errors", () => {
    setLocaleForTests("zh");
    expect(t("error.cannotMoveIntoSelf")).toBe("不能将文档移动到自身");
    expect(t("error.cannotMoveIntoDescendant")).toBe(
      "不能将文档移动到自己的子文档中",
    );
    setLocaleForTests("en");
    expect(t("error.cannotMoveIntoSelf")).toBe(
      "Cannot move a document into itself",
    );
    expect(t("error.cannotMoveIntoDescendant")).toBe(
      "Cannot move a document into its descendant",
    );
  });
});
