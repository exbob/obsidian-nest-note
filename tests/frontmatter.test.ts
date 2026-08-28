import { describe, expect, it } from "vitest";
import {
  FrontmatterParseError,
  ensureDocumentFrontmatter,
} from "../src/domain/frontmatter";

const created = "2026-08-28T19:00:00+08:00";

describe("ensureDocumentFrontmatter", () => {
  it("writes name and ISO 8601 created before body when frontmatter is missing", () => {
    const result = ensureDocumentFrontmatter("# Hello\n", {
      name: "Work",
      created,
    });

    expect(result).toBe(`---
name: Work
created: 2026-08-28T19:00:00+08:00
---
# Hello
`);
  });

  it("writes complete frontmatter for empty content", () => {
    const result = ensureDocumentFrontmatter("", {
      name: "Work",
      created,
    });

    expect(result).toBe(`---
name: Work
created: 2026-08-28T19:00:00+08:00
---
`);
  });

  it("updates name but keeps existing created and body verbatim", () => {
    const input = `---
name: Old
created: 2020-01-01T00:00:00Z
---
# Body
`;

    const result = ensureDocumentFrontmatter(input, {
      name: "New",
      created,
    });

    expect(result).toBe(`---
name: New
created: 2020-01-01T00:00:00Z
---
# Body
`);
  });

  it("preserves extra frontmatter keys while updating name", () => {
    const input = `---
tags: keep-me
name: Old
created: 2020-01-01T00:00:00Z
aliases:
  - note
---
Paragraph
`;

    const result = ensureDocumentFrontmatter(input, {
      name: "Renamed",
      created,
    });

    expect(result).toBe(`---
tags: keep-me
name: Renamed
created: 2020-01-01T00:00:00Z
aliases:
  - note
---
Paragraph
`);
  });

  it("fills missing created from metadata without rewriting body", () => {
    const input = `---
name: Work
---
Kept
`;

    const result = ensureDocumentFrontmatter(input, {
      name: "Work",
      created,
    });

    expect(result).toBe(`---
name: Work
created: 2026-08-28T19:00:00+08:00
---
Kept
`);
  });

  it("quotes YAML-special names", () => {
    const result = ensureDocumentFrontmatter("", {
      name: "Chapter: 1",
      created,
    });

    expect(result).toBe(`---
name: "Chapter: 1"
created: 2026-08-28T19:00:00+08:00
---
`);
  });

  it("throws an identifiable error on unclosed frontmatter and does not return partial content", () => {
    const original = "---\nname: Broken\n# still body\n";

    expect(() =>
      ensureDocumentFrontmatter(original, { name: "Work", created }),
    ).toThrow(FrontmatterParseError);

    try {
      ensureDocumentFrontmatter(original, { name: "Work", created });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FrontmatterParseError);
      expect((error as Error).name).toBe("FrontmatterParseError");
    }
  });

  it("throws an identifiable error on invalid YAML mapping lines", () => {
    const original = `---
this is not a mapping
---
# Body
`;

    expect(() =>
      ensureDocumentFrontmatter(original, { name: "Work", created }),
    ).toThrow(FrontmatterParseError);
  });

  it("keeps a UTF-8 BOM before newly written frontmatter and out of the body", () => {
    const bom = "\uFEFF";
    const result = ensureDocumentFrontmatter(`${bom}# Hello\n`, {
      name: "Work",
      created,
    });

    expect(result).toBe(
      `${bom}---
name: Work
created: 2026-08-28T19:00:00+08:00
---
# Hello
`,
    );
    expect(result.startsWith(bom)).toBe(true);
    expect(result.slice(1)).not.toContain(bom);
  });
});
