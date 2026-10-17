import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // the videos are React: tests that draw them need the same JSX runtime the app uses
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  // the database tests make Shorts, draw frames and run fights: on a busy machine some take longer
  // than vitest's 5 seconds with nothing wrong, so a test only counts as stuck after 30
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 30_000 },
});
