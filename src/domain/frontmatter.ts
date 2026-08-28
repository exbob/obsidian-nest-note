export interface DocumentMetadata {
  name: string;
  created: string;
}

export class FrontmatterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterParseError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface YamlEntry {
  kind: "other" | "key";
  key?: string;
  lines: string[];
}

interface ParsedFrontmatter {
  bom: string;
  newline: "\n" | "\r\n";
  yaml: string;
  body: string;
}

export function ensureDocumentFrontmatter(
  content: string,
  metadata: DocumentMetadata,
): string {
  const parsed = parseFrontmatter(content);
  if (parsed === null) {
    const { bom, rest } = stripBom(content);
    const newline = rest.includes("\r\n") ? "\r\n" : "\n";
    return serializeFrontmatter([], metadata, newline, rest, bom);
  }

  const entries = parseYamlEntries(parsed.yaml, parsed.newline);
  return serializeFrontmatter(
    entries,
    metadata,
    parsed.newline,
    parsed.body,
    parsed.bom,
  );
}

function stripBom(content: string): { bom: string; rest: string } {
  if (content.charCodeAt(0) === 0xfeff) {
    return { bom: content[0], rest: content.slice(1) };
  }
  return { bom: "", rest: content };
}

function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const { bom, rest: source } = stripBom(content);

  const newline = openingNewline(source);
  if (newline === null) {
    return null;
  }

  const rest = source.slice("---".length + newline.length);
  const closeStart = findClosingFence(rest, newline);
  if (closeStart === -1) {
    throw new FrontmatterParseError("Unclosed YAML frontmatter");
  }

  const yaml = rest.slice(0, closeStart);
  let body = rest.slice(closeStart + "---".length);
  if (body.startsWith("\r\n")) {
    body = body.slice(2);
  } else if (body.startsWith("\n")) {
    body = body.slice(1);
  }

  return { bom, newline, yaml, body };
}

function openingNewline(source: string): "\n" | "\r\n" | null {
  if (source.startsWith("---\r\n")) {
    return "\r\n";
  }
  if (source.startsWith("---\n")) {
    return "\n";
  }
  return null;
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

function parseYamlEntries(yaml: string, newline: "\n" | "\r\n"): YamlEntry[] {
  const lines = yamlToLines(yaml, newline);
  const entries: YamlEntry[] = [];
  const seen = new Set<string>();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!/^\s/.test(line)) {
      if (line.trim() === "" || line.trimStart().startsWith("#")) {
        entries.push({ kind: "other", lines: [line] });
        i += 1;
        continue;
      }

      const match = line.match(/^([^:]+):(.*)$/);
      if (match === null || match[1].trim() === "") {
        throw new FrontmatterParseError("Invalid frontmatter YAML");
      }

      const key = match[1].trim();
      if (seen.has(key)) {
        throw new FrontmatterParseError(`Duplicate frontmatter key: ${key}`);
      }
      seen.add(key);

      const block = [line];
      i += 1;
      while (i < lines.length && /^\s/.test(lines[i])) {
        block.push(lines[i]);
        i += 1;
      }
      entries.push({ kind: "key", key, lines: block });
      continue;
    }

    throw new FrontmatterParseError("Invalid frontmatter YAML");
  }

  return entries;
}

function yamlToLines(yaml: string, newline: "\n" | "\r\n"): string[] {
  if (yaml.length === 0) {
    return [];
  }
  const lines = yaml.split(newline);
  if (yaml.endsWith(newline) && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function serializeFrontmatter(
  entries: YamlEntry[],
  metadata: DocumentMetadata,
  newline: "\n" | "\r\n",
  body: string,
  bom: string,
): string {
  const next = applyMetadata(entries, metadata);
  const yamlLines = next.flatMap((entry) => entry.lines);
  const yaml = yamlLines.join(newline);
  const block =
    yaml.length === 0
      ? `---${newline}---`
      : `---${newline}${yaml}${newline}---`;
  return `${bom}${block}${newline}${body}`;
}

function applyMetadata(
  entries: YamlEntry[],
  metadata: DocumentMetadata,
): YamlEntry[] {
  const result: YamlEntry[] = entries.map((entry) => ({
    kind: entry.kind,
    key: entry.key,
    lines: [...entry.lines],
  }));

  const nameEntry: YamlEntry = {
    kind: "key",
    key: "name",
    lines: [`name: ${formatYamlScalar(metadata.name)}`],
  };
  const createdEntry: YamlEntry = {
    kind: "key",
    key: "created",
    lines: [`created: ${metadata.created}`],
  };

  const nameIndex = result.findIndex(
    (entry) => entry.kind === "key" && entry.key === "name",
  );
  if (nameIndex >= 0) {
    result[nameIndex] = nameEntry;
  } else {
    result.unshift(nameEntry);
  }

  const createdIndex = result.findIndex(
    (entry) => entry.kind === "key" && entry.key === "created",
  );
  if (createdIndex < 0) {
    const insertAt = result.findIndex(
      (entry) => entry.kind === "key" && entry.key === "name",
    );
    result.splice(insertAt + 1, 0, createdEntry);
  }

  return result;
}

function formatYamlScalar(value: string): string {
  if (value === "") {
    return '""';
  }
  if (/[\n\r]/.test(value)) {
    return JSON.stringify(value);
  }
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(value)) {
    return JSON.stringify(value);
  }
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    return JSON.stringify(value);
  }
  if (
    /[:#{}[\],&*!|>'"%@`]/.test(value) ||
    /^-/.test(value) ||
    /^\s|\s$/.test(value) ||
    value.includes("\\")
  ) {
    return JSON.stringify(value);
  }
  return value;
}
