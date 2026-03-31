import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    exclude: ["src/test/e2e/**"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
