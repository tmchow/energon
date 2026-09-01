import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    name: "worker",
    include: ["test/**/*.spec.ts"],
    exclude: ["test/unit/**", "**/node_modules/**"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            PUBLIC_ORIGIN: "https://energon.example.com",
            DEV_ACCESS_EMAIL: "dev@esperlabs.app",
            // Fixture emails in the worker suite. Production wrangler leaves this unset.
            ALLOWED_EMAIL_DOMAINS: "esperlabs.app,esperlabs.ai",
          },
        },
      },
    },
  },
});
