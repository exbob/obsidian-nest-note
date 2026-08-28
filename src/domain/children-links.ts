import type { DocumentNode } from "../types";
import { FrontmatterParseError } from "./frontmatter";

export class ChildrenLinksError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChildrenLinksError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const CHILDREN_START = "<!-- nestnote:children:start -->";
const CHILDREN_END = "<!-- nestnote:children:end -->";

export function updateChildrenLinks(
  content: string,
  parentPath: string,
  children: readonly DocumentNode[],
): string {
  const newline = detectNewline(content);
  const region = renderChildrenRegion(parentPath, children, newline);
  const replaced = replaceControlledRegion(content, region);
  if (replaced !== null) {
    return replaced;
  }
  return insertAfterFrontmatter(content, region, newline);
}

function detectNewline(content: string): "\n" | "\r\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function renderChildrenRegion(
  parentPath: string,
  children: readonly DocumentNode[],
  newline: "\n" | "\r\n",
): string {
  const sorted = [...children].sort((a, b) => a.name.localeCompare(b.name));
  const lines = [CHILDREN_START];
  for (const child of sorted) {
    const relative = relativeChildIndex(parentPath, child);
    lines.push(`- [${escapeLinkLabel(child.name)}](${encodeLinkPath(relative)})`);
  }
  lines.push(CHILDREN_END);
  return lines.join(newline);
}

function replaceControlledRegion(
  content: string,
  region: string,
): string | null {
  const fences = findFencedCodeRanges(content);
  const startIdx = indexOfOutsideFences(content, CHILDREN_START, 0, fences);
  if (startIdx === -1) {
    return null;
  }
  const endIdx = indexOfOutsideFences(
    content,
    CHILDREN_END,
    startIdx + CHILDREN_START.length,
    fences,
  );
  if (endIdx === -1) {
    throw new ChildrenLinksError("Unmatched NestNote children link markers");
  }
  return (
    content.slice(0, startIdx) +
    region +
    content.slice(endIdx + CHILDREN_END.length)
  );
}

function insertAfterFrontmatter(
  content: string,
  region: string,
  newline: "\n" | "\r\n",
): string {
  const insertAt = findClosedFrontmatterEnd(content);
  if (insertAt === -1) {
    const { bom, rest } = stripBom(content);
    if (rest.length === 0) {
      return `${bom}${region}${newline}`;
    }
    return `${bom}${region}${newline}${rest}`;
  }
  return `${content.slice(0, insertAt)}${region}${newline}${content.slice(insertAt)}`;
}

function stripBom(content: string): { bom: string; rest: string } {
  if (content.charCodeAt(0) === 0xfeff) {
    return { bom: content[0], rest: content.slice(1) };
  }
  return { bom: "", rest: content };
}

function findClosedFrontmatterEnd(content: string): number {
  const { bom, rest: source } = stripBom(content);
  const offset = bom.length;

  let newline: "\n" | "\r\n";
  if (source.startsWith("---\r\n")) {
    newline = "\r\n";
  } else if (source.startsWith("---\n")) {
    newline = "\n";
  } else {
    return -1;
  }

  const rest = source.slice("---".length + newline.length);
  const closeStart = findClosingFence(rest, newline);
  if (closeStart === -1) {
    throw new FrontmatterParseError("Unclosed YAML frontmatter");
  }

  let bodyStartInRest = closeStart + "---".length;
  if (rest.startsWith("\r\n", bodyStartInRest)) {
    bodyStartInRest += 2;
  } else if (rest.startsWith("\n", bodyStartInRest)) {
    bodyStartInRest += 1;
  }

  return offset + "---".length + newline.length + bodyStartInRest;
}

function findClosingFence(rest: string, newline: "\n" | "\r\n"): number {
  if (isFenceAt(rest, 0)) {
    return 0;
  }

  let searchFrom = 0;
  while (searchFrom < rest.length) {
    const idx = rest.indexOf(`${newline}---`, searchFrom);
    if (idx === -1) {
      return -1;
    }
    const fenceStart = idx + newline.length;
    if (isFenceAt(rest, fenceStart)) {
      return fenceStart;
    }
    searchFrom = fenceStart + 1;
  }

  return -1;
}

function isFenceAt(source: string, index: number): boolean {
  if (source.slice(index, index + 3) !== "---") {
    return false;
  }
  const after = source.slice(index + 3);
  return after.length === 0 || after.startsWith("\n") || after.startsWith("\r\n");
}

function findFencedCodeRanges(
  content: string,
): ReadonlyArray<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let offset = 0;
  let open: { char: string; length: number; start: number } | null = null;

  while (offset <= content.length) {
    const nl = content.indexOf("\n", offset);
    const lineEnd = nl === -1 ? content.length : nl;
    let line = content.slice(offset, lineEnd);
    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    }

    const fence = parseFenceLine(line);
    if (open === null) {
      if (fence !== null) {
        open = { char: fence.char, length: fence.length, start: offset };
      }
    } else if (
      fence !== null &&
      fence.char === open.char &&
      fence.length >= open.length &&
      fence.info.trim() === ""
    ) {
      ranges.push({
        start: open.start,
        end: nl === -1 ? content.length : nl + 1,
      });
      open = null;
    }

    if (nl === -1) {
      break;
    }
    offset = nl + 1;
  }

  if (open !== null) {
    ranges.push({ start: open.start, end: content.length });
  }

  return ranges;
}

function parseFenceLine(
  line: string,
): { char: "`" | "~"; length: number; info: string } | null {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (match === null) {
    return null;
  }
  const marker = match[2];
  const char = marker[0] as "`" | "~";
  const info = match[3];
  if (char === "`" && info.includes("`")) {
    return null;
  }
  return { char, length: marker.length, info };
}

function indexOfOutsideFences(
  content: string,
  marker: string,
  from: number,
  fences: ReadonlyArray<{ start: number; end: number }>,
): number {
  let searchFrom = from;
  while (searchFrom < content.length) {
    const idx = content.indexOf(marker, searchFrom);
    if (idx === -1) {
      return -1;
    }
    if (!isInsideFence(idx, fences)) {
      return idx;
    }
    searchFrom = idx + marker.length;
  }
  return -1;
}

function isInsideFence(
  index: number,
  fences: ReadonlyArray<{ start: number; end: number }>,
): boolean {
  return fences.some((range) => index >= range.start && index < range.end);
}

function relativeChildIndex(parentPath: string, child: DocumentNode): string {
  const parent = toPosix(parentPath);
  const indexPath = toPosix(child.indexPath);
  if (parent.length === 0) {
    return indexPath;
  }
  const prefix = `${parent}/`;
  if (indexPath.startsWith(prefix)) {
    return indexPath.slice(prefix.length);
  }
  return `${toPosix(child.name)}/index.md`;
}

function toPosix(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function escapeLinkLabel(name: string): string {
  return name.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function encodeLinkPath(relativePath: string): string {
  return relativePath.split("/").map(encodeLinkSegment).join("/");
}

function encodeLinkSegment(segment: string): string {
  let encoded = "";
  for (const char of segment) {
    if (char === " ") {
      encoded += "%20";
      continue;
    }
    const code = char.charCodeAt(0);
    const unreserved =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      char === "-" ||
      char === "." ||
      char === "_" ||
      char === "~" ||
      code > 127;
    encoded += unreserved ? char : encodeURIComponent(char);
  }
  return encoded;
}
