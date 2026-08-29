import type { MessageKey } from "./types";

export const en: Record<MessageKey, string> = {
  "command.openDocumentTree": "Open document tree",
  "command.newDocument": "New document",
  "command.newChildDocument": "New child document",
  "command.refresh": "Refresh",
  "command.archiveCurrentAttachment": "Archive current attachment",
  "setting.maxChildDepthName": "Max child document depth",
  "setting.maxChildDepthDesc": "Root documents are depth 0. Allowed range: 0–9.",
  "setting.openPanelOnStartupName": "Open the NestNote pane on startup",
  "setting.openPanelOnStartupDesc":
    "Applies on the next launch; does not close the current pane.",
  "setting.maxChildDepthInvalid":
    "Max child document depth must be an integer from 0 to 9",
  "setting.saveFailed":
    "Could not save settings; restored the last valid values: {detail}",
  "ui.expandAll": "Expand all",
  "ui.collapseAll": "Collapse all",
  "ui.expand": "Expand",
  "ui.collapse": "Collapse",
  "ui.more": "More",
  "ui.rename": "Rename",
  "ui.delete": "Delete",
  "ui.confirm": "Confirm",
  "ui.cancel": "Cancel",
  "ui.documentName": "Document name",
  "ui.deleteDocument": "Delete document",
  "ui.deleteConfirm":
    'Deleting "{name}" will move the entire subtree to the trash.',
  "notice.openChildRequiresDocument":
    "Open a NestNote document before creating a child document",
  "notice.attachmentNoActiveFile":
    "Could not determine the attachment owner; no active file",
  "notice.attachmentKept":
    "Could not determine the attachment owner; left in place: {path}",
  "notice.metadataUnchanged":
    "Document metadata is invalid; no changes were written: {detail}",
  "error.targetExists": "Target already exists: {path}",
  "error.maxDepthReached": "Maximum child document depth reached ({max})",
  "error.documentNotFound": "Document not found: {path}",
  "error.nameEmpty": "Document name cannot be empty",
  "error.nameInvalid": "Invalid document name: {name}",
  "error.parentMissing": "Parent document is missing or incomplete: {path}",
  "error.notCompleteDocument": "Not a complete NestNote document: {path}",
};
