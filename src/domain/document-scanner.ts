import type { DocumentNode, VaultEntry } from "../types";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function getName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function getParentPath(path: string): string | null {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? null : path.slice(0, idx);
}

function hasAttachmentsAncestor(path: string): boolean {
  let current = getParentPath(path);
  while (current !== null) {
    if (getName(current) === "attachments") {
      return true;
    }
    current = getParentPath(current);
  }
  return false;
}

function sortTree(nodes: DocumentNode[]): void {
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  for (const node of nodes) {
    sortTree(node.children);
  }
}

export function scanDocuments(entries: readonly VaultEntry[]): DocumentNode[] {
  const files = new Set<string>();
  const folders = new Set<string>();

  for (const entry of entries) {
    const path = normalizePath(entry.path);
    if (entry.kind === "file") {
      files.add(path);
    } else {
      folders.add(path);
    }
  }

  function isDocument(path: string): boolean {
    if (getName(path) === "attachments" || hasAttachmentsAncestor(path)) {
      return false;
    }
    return (
      files.has(`${path}/index.md`) && folders.has(`${path}/attachments`)
    );
  }

  function findDocumentParent(
    path: string,
    nodes: ReadonlyMap<string, DocumentNode>,
  ): string | null {
    let parentPath = getParentPath(path);
    while (parentPath !== null) {
      if (nodes.has(parentPath)) {
        return parentPath;
      }
      parentPath = getParentPath(parentPath);
    }
    return null;
  }

  const documentPaths = [...folders].filter(isDocument);
  const nodes = new Map<string, DocumentNode>();

  for (const path of documentPaths) {
    nodes.set(path, {
      name: getName(path),
      path,
      indexPath: `${path}/index.md`,
      attachmentsPath: `${path}/attachments`,
      children: [],
    });
  }

  const roots: DocumentNode[] = [];

  for (const path of documentPaths) {
    const node = nodes.get(path)!;
    const documentParent = findDocumentParent(path, nodes);

    if (documentParent !== null) {
      nodes.get(documentParent)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortTree(roots);
  return roots;
}
