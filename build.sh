#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

usage() {
  printf '用法: %s [clean]\n' "$0" >&2
  exit 2
}

if [[ "${1:-}" == "clean" ]]; then
  if [[ $# -ne 1 ]]; then
    usage
  fi
  rm -f main.js main.js.map
  rm -rf nest-note
  exit 0
fi

if [[ $# -ne 0 ]]; then
  usage
fi

npm run build

STAGING_DIR="$(mktemp -d "$ROOT_DIR/nest-note.staging.XXXXXX")"
BACKUP_DIR=""
published=0

cleanup() {
  if [[ "$published" -eq 0 ]]; then
    rm -rf "$STAGING_DIR"
    if [[ -n "$BACKUP_DIR" && -e "$BACKUP_DIR" && ! -e nest-note ]]; then
      mv "$BACKUP_DIR" nest-note || true
    fi
  else
    if [[ -n "$BACKUP_DIR" && -e "$BACKUP_DIR" ]]; then
      rm -rf "$BACKUP_DIR"
    fi
  fi
}
trap cleanup EXIT

cp main.js manifest.json styles.css "$STAGING_DIR/"

if [[ -e nest-note ]]; then
  BACKUP_DIR="$(mktemp -d "$ROOT_DIR/nest-note.backup.XXXXXX")"
  rmdir "$BACKUP_DIR"
  mv nest-note "$BACKUP_DIR"
fi

mv "$STAGING_DIR" nest-note
published=1

trap - EXIT
if [[ -n "$BACKUP_DIR" ]]; then
  rm -rf "$BACKUP_DIR"
fi
printf 'NestNote 发布文件已写入 ./nest-note/\n'
