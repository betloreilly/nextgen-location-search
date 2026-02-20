import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["apps/backend/src/**/*.ts", "packages/search/src/**/*.ts", "packages/planner/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/dist/**", "**/node_modules/**"],
    },
  },
});
