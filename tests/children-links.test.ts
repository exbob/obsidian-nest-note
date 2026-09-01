import { describe, expect, it } from "vitest";
import {
  applyChildrenOrder,
  ChildrenLinksError,
  mergeChildrenOrder,
  parseChildrenOrder,
  placeChild,
  renameInOrder,
  updateChildrenLinks,
} from "../src/domain/children-links";
import { FrontmatterParseError } from "../src/domain/frontmatter";
import type { DocumentNode } from "../src/types";

function child(name: string, parentPath = "Work"): DocumentNode {
  return {
    name,
    path: `${parentPath}/${name}`,
    indexPath: `${parentPath}/${name}/index.md`,
    attachmentsPath: `${parentPath}/${name}/attachments`,
    children: [],
  };
}

describe("updateChildrenLinks", () => {
  it("inserts the controlled region after frontmatter when markers are missing", () => {
    const content = `---
name: Work
created: 2026-08-28T19:00:00+08:00
---
# Body
`;

    const result = updateChildrenLinks(content, "Work", [child("文档1")]);

    expect(result).toBe(`---
name: Work
created: 2026-08-28T19:00:00+08:00
---
<!-- nestnote:children:start -->

- [文档1](文档1/index.md)

<!-- nestnote:children:end -->
# Body
`);
  });

  it("inserts the region at the start when there is no frontmatter", () => {
    const result = updateChildrenLinks("# Body\n", "Work", [child("文档1")]);

    expect(result).toBe(`<!-- nestnote:children:start -->

- [文档1](文档1/index.md)

<!-- nestnote:children:end -->
# Body
`);
  });

  it("leaves an empty controlled region when there are no children", () => {
    const content = `---
name: Work
created: 2026-08-28T19:00:00+08:00
---
`;

    const result = updateChildrenLinks(content, "Work", []);

    expect(result).toBe(`---
name: Work
created: 2026-08-28T19:00:00+08:00
---
<!-- nestnote:children:start -->


<!-- nestnote:children:end -->
`);
  });

  it("replaces only marker interior and leaves surrounding body, handwritten links, and code unchanged", () => {
    const content = `# Intro
See [手工](other.md)

\`\`\`md
- [示例](示例/index.md)
\`\`\`

<!-- nestnote:children:start -->
- [旧文档](旧文档/index.md)
<!-- nestnote:children:end -->

# Outro
`;

    const result = updateChildrenLinks(content, "Work", [child("文档1")]);

    expect(result).toBe(`# Intro
See [手工](other.md)

\`\`\`md
- [示例](示例/index.md)
\`\`\`

<!-- nestnote:children:start -->

- [文档1](文档1/index.md)

<!-- nestnote:children:end -->

# Outro
`);
  });

  it("writes children in the given order and uses paths relative to the parent index directory", () => {
    const parentPath = "Work/父";
    const unsorted = [child("文档2", parentPath), child("文档1", parentPath)];

    const result = updateChildrenLinks(
      "<!-- nestnote:children:start -->\n<!-- nestnote:children:end -->\n",
      parentPath,
      unsorted,
    );

    expect(result).toBe(`<!-- nestnote:children:start -->

- [文档2](文档2/index.md)
- [文档1](文档1/index.md)

<!-- nestnote:children:end -->
`);
  });

  it("URI-encodes spaces and special characters in link targets", () => {
    const result = updateChildrenLinks(
      "<!-- nestnote:children:start -->\n<!-- nestnote:children:end -->\n",
      "Work",
      [child("My Doc"), child("C#Note")],
    );

    expect(result).toContain("- [My Doc](My%20Doc/index.md)");
    expect(result).toContain("- [C#Note](C%23Note/index.md)");
  });

  it("does not list nested grandchildren from child nodes", () => {
    const nested: DocumentNode = {
      ...child("文档1"),
      children: [child("孙文档", "Work/文档1")],
    };

    const result = updateChildrenLinks(
      "<!-- nestnote:children:start -->\n<!-- nestnote:children:end -->\n",
      "Work",
      [nested],
    );

    expect(result).toContain("- [文档1](文档1/index.md)");
    expect(result).not.toContain("孙文档");
  });

  it("ignores paired markers inside fenced code and inserts after frontmatter", () => {
    const content = `---
name: Work
created: 2026-08-28T19:00:00+08:00
---
# Intro

\`\`\`md
<!-- nestnote:children:start -->
- [示例](示例/index.md)
<!-- nestnote:children:end -->
\`\`\`

# Outro
`;

    const result = updateChildrenLinks(content, "Work", [child("文档1")]);

    expect(result).toBe(`---
name: Work
created: 2026-08-28T19:00:00+08:00
---
<!-- nestnote:children:start -->

- [文档1](文档1/index.md)

<!-- nestnote:children:end -->
# Intro

\`\`\`md
<!-- nestnote:children:start -->
- [示例](示例/index.md)
<!-- nestnote:children:end -->
\`\`\`

# Outro
`);
  });

  it("updates the region outside fenced code and leaves example markers unchanged", () => {
    const content = `\`\`\`md
<!-- nestnote:children:start -->
- [示例](示例/index.md)
<!-- nestnote:children:end -->
\`\`\`

<!-- nestnote:children:start -->
- [旧文档](旧文档/index.md)
<!-- nestnote:children:end -->
`;

    const result = updateChildrenLinks(content, "Work", [child("文档1")]);

    expect(result).toBe(`\`\`\`md
<!-- nestnote:children:start -->
- [示例](示例/index.md)
<!-- nestnote:children:end -->
\`\`\`

<!-- nestnote:children:start -->

- [文档1](文档1/index.md)

<!-- nestnote:children:end -->
`);
  });

  it("uses the original CRLF newline style when generating and inserting the region", () => {
    const content = [
      "---",
      "name: Work",
      "created: 2026-08-28T19:00:00+08:00",
      "---",
      "# Body",
      "",
    ].join("\r\n");

    const result = updateChildrenLinks(content, "Work", [child("文档1")]);

    expect(result).toBe(
      [
        "---",
        "name: Work",
        "created: 2026-08-28T19:00:00+08:00",
        "---",
        "<!-- nestnote:children:start -->",
        "",
        "- [文档1](文档1/index.md)",
        "",
        "<!-- nestnote:children:end -->",
        "# Body",
        "",
      ].join("\r\n"),
    );
    expect(result.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("replaces an existing region using CRLF without mixing in LF", () => {
    const content = [
      "<!-- nestnote:children:start -->",
      "- [旧文档](旧文档/index.md)",
      "<!-- nestnote:children:end -->",
      "# Body",
      "",
    ].join("\r\n");

    const result = updateChildrenLinks(content, "Work", [child("文档1")]);

    expect(result).toBe(
      [
        "<!-- nestnote:children:start -->",
        "",
        "- [文档1](文档1/index.md)",
        "",
        "<!-- nestnote:children:end -->",
        "# Body",
        "",
      ].join("\r\n"),
    );
    expect(result.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });

  it("throws an identifiable error when opening frontmatter is unclosed", () => {
    const original = "---\nname: Work\n# Body\n";

    expect(() =>
      updateChildrenLinks(original, "Work", [child("文档1")]),
    ).toThrow(FrontmatterParseError);

    try {
      updateChildrenLinks(original, "Work", [child("文档1")]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FrontmatterParseError);
      expect((error as Error).name).toBe("FrontmatterParseError");
    }
  });

  it("keeps a UTF-8 BOM before an inserted region when frontmatter is missing", () => {
    const bom = "\uFEFF";
    const result = updateChildrenLinks(`${bom}# Body\n`, "Work", [
      child("文档1"),
    ]);

    expect(result).toBe(
      `${bom}<!-- nestnote:children:start -->

- [文档1](文档1/index.md)

<!-- nestnote:children:end -->
# Body
`,
    );
    expect(result.startsWith(bom)).toBe(true);
    expect(result.slice(1)).not.toContain(bom);
  });

  it("throws ChildrenLinksError when start marker is unmatched outside fences", () => {
    const original = `<!-- nestnote:children:start -->
- [旧文档](旧文档/index.md)

# Body
`;

    expect(() =>
      updateChildrenLinks(original, "Work", [child("文档1")]),
    ).toThrow(ChildrenLinksError);

    try {
      updateChildrenLinks(original, "Work", [child("文档1")]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ChildrenLinksError);
      expect((error as Error).name).toBe("ChildrenLinksError");
    }
  });

  it("inserts a new child link between the two blank lines of an empty region", () => {
    const result = updateChildrenLinks(
      "<!-- nestnote:children:start -->\n\n\n<!-- nestnote:children:end -->\n",
      "Work",
      [child("文档1")],
    );

    expect(result).toBe(`<!-- nestnote:children:start -->

- [文档1](文档1/index.md)

<!-- nestnote:children:end -->
`);
  });

  it("parses adjacent markers with no blank lines and still rewrites with spacing", () => {
    const result = updateChildrenLinks(
      "<!-- nestnote:children:start -->\n<!-- nestnote:children:end -->\n",
      "Work",
      [child("文档1")],
    );

    expect(result).toBe(`<!-- nestnote:children:start -->

- [文档1](文档1/index.md)

<!-- nestnote:children:end -->
`);
  });

  it("escapes square brackets in children link labels", () => {
    const result = updateChildrenLinks("# Body\n", "Work", [child("foo[bar]")]);

    expect(result).toContain("- [foo\\[bar\\]](");
    expect(result).toContain("foo%5Bbar%5D/index.md");
    expect(result).not.toContain("- [foo[bar]](");
  });
});

describe("child order", () => {
  it("parses document names from marker links, not labels, and decodes %20", () => {
    const content = `<!-- nestnote:children:start -->
- [旧标题](项目%20B/index.md)
not a link
- [A](项目%20A/index.md)
<!-- nestnote:children:end -->`;
    expect(parseChildrenOrder(content)).toEqual(["项目 B", "项目 A"]);
  });

  it("returns an empty order when markers are missing or unmatched", () => {
    expect(parseChildrenOrder("# Body\n")).toEqual([]);
    expect(
      parseChildrenOrder("<!-- nestnote:children:start -->\n- [A](A/index.md)\n"),
    ).toEqual([]);
  });

  it("ignores paired markers inside fenced code", () => {
    const content = `# Intro
\`\`\`md
<!-- nestnote:children:start -->
- [示例](示例/index.md)
<!-- nestnote:children:end -->
\`\`\`
<!-- nestnote:children:start -->
- [真](真/index.md)
<!-- nestnote:children:end -->
`;
    expect(parseChildrenOrder(content)).toEqual(["真"]);
  });

  it("merges live nodes in listed order and appends unknown names sorted", () => {
    const live = [child("C"), child("A"), child("B")];
    const merged = mergeChildrenOrder(["B", "gone", "A"], live);
    expect(merged.map((node) => node.name)).toEqual(["B", "A", "C"]);
    expect(live.map((node) => node.name)).toEqual(["C", "A", "B"]);
  });

  it("sorts live children by name when orderedNames is empty", () => {
    expect(mergeChildrenOrder([], [child("B"), child("A")]).map((n) => n.name)).toEqual([
      "A",
      "B",
    ]);
  });

  it("places a node before a sibling or appends when the path is missing", () => {
    const a = child("A");
    const b = child("B");
    const c = child("C");
    expect(placeChild([a, c], b, c.path).map((n) => n.name)).toEqual(["A", "B", "C"]);
    expect(placeChild([a, c], b, null).map((n) => n.name)).toEqual(["A", "C", "B"]);
    expect(placeChild([a, c], b, b.path).map((n) => n.name)).toEqual(["A", "C", "B"]);
    expect(placeChild([a, c], b, "Work/missing").map((n) => n.name)).toEqual([
      "A",
      "C",
      "B",
    ]);
  });

  it("renames one entry in an order list", () => {
    expect(renameInOrder(["B", "A", "C"], "A", "Alpha")).toEqual(["B", "Alpha", "C"]);
  });

  it("reorders each node's children from that node's index contents; roots stay as given", () => {
    const tree: DocumentNode[] = [
      {
        name: "Work",
        path: "Work",
        indexPath: "Work/index.md",
        attachmentsPath: "Work/attachments",
        children: [child("A", "Work"), child("B", "Work")],
      },
      {
        name: "Inbox",
        path: "Inbox",
        indexPath: "Inbox/index.md",
        attachmentsPath: "Inbox/attachments",
        children: [],
      },
    ];
    const contents = new Map([
      [
        "Work/index.md",
        `<!-- nestnote:children:start -->
- [B](B/index.md)
- [A](A/index.md)
<!-- nestnote:children:end -->`,
      ],
    ]);
    const ordered = applyChildrenOrder(tree, contents);
    expect(ordered.map((n) => n.path)).toEqual(["Work", "Inbox"]);
    expect(ordered[0].children.map((n) => n.name)).toEqual(["B", "A"]);
  });
});
