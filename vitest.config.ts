// Unit tests (vitest). Standalone from vite.config.ts on purpose: the app config sets
// root=client/ and loads browser-only plugins. Run with `npm test`.
import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client", "src"),
    },
  },
  test: {
    include: [
      "shared/**/*.test.ts",
      "server/**/*.test.ts",
      "client/src/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    exclude: ["node_modules/**", "dist/**", "cypress/**"],
    environment: "node",
  },
});
