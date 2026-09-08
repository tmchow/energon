import { buildUI } from "./scripts/build-ui.mjs";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

await buildUI();

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          PUBLIC_ORIGIN: "https://hub.energon.example.com",
          CONTENT_ORIGIN: "https://energon.example.com",
          DEV_ACCESS_EMAIL: "dev@esperlabs.app",
          // Fixture emails in the worker suite. Production wrangler leaves this unset.
          ALLOWED_EMAIL_DOMAINS: "esperlabs.app,esperlabs.ai",
          ADMIN_EMAILS: "admin@esperlabs.app",
        },
      },
    }),
  ],
  test: {
    name: "worker",
    include: ["test/**/*.spec.ts"],
    exclude: ["test/unit/**", "**/node_modules/**"],
  },
});
