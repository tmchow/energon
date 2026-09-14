import { readFileSync } from "node:fs";
import { buildUI } from "./scripts/build-ui.mjs";
import { defineConfig } from "vitest/config";

await buildUI();

export default defineConfig({
  plugins: [
    {
      name: "txt-as-string",
      enforce: "pre",
      load(id) {
        const file = id.split("?")[0];
        if (file.endsWith(".txt")) {
          return `export default ${JSON.stringify(readFileSync(file, "utf8"))};`;
        }
      },
    },
  ],
  test: {
    name: "unit",
    include: ["test/unit/**/*.spec.ts", "src/ui/**/*.spec.ts"],
    environment: "node",
  },
});
