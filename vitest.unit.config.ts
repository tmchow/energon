import { buildUI } from "./scripts/build-ui.mjs";
import { defineConfig } from "vitest/config";

await buildUI();

export default defineConfig({
  test: {
    name: "unit",
    include: ["test/unit/**/*.spec.ts", "src/ui/**/*.spec.ts"],
    environment: "node",
  },
});
