import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(process.cwd(), "tests/obsidian-stub.ts"),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./tests/i18n-setup.ts"],
  },
});
