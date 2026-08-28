export type VaultEntry =
  | { kind: "file"; path: string }
  | { kind: "folder"; path: string };

export interface DocumentNode {
  name: string;
  path: string;
  indexPath: string;
  attachmentsPath: string;
  children: DocumentNode[];
}

export interface DocumentService {
  create(parentPath: string | null, name: string): Promise<DocumentNode>;
  rename(documentPath: string, newName: string): Promise<DocumentNode>;
  trash(documentPath: string): Promise<void>;
  open(documentPath: string): Promise<void>;
}
