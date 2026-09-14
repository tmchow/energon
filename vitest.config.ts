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
          TOKEN_ENV: "ENERGON_TOKEN",
          TOKEN_PREFIX: "ee_live_",
          SKILL_NAME: "energon",
          MARKETPLACE_NAME: "energon",
          MARKETPLACE_REPO: "tmchow/energon",
          ALLOW_UNLIMITED_RETENTION: "true",
          DEFAULT_TTL: "never",
          MAX_TTL: "never",
          WRITE_POLICY: "org",
          ALLOW_UNLIMITED_TOKENS: "true",
          FOOTER_TEXT: "",
          DEV_ACCESS_EMAIL: "dev@esperlabs.app",
          // Fixture emails in the worker suite. Production wrangler leaves this unset.
          ALLOWED_EMAIL_DOMAINS: "esperlabs.app,esperlabs.ai",
          ADMIN_EMAILS: "admin@esperlabs.app,tok-ops@esperlabs.app",
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
