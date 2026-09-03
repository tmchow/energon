# Golden provenance

Frozen outputs for documents that are too large to assert field-by-field. Each diff is a behavior change: review it, then commit or fix the producer.

## Generate

```bash
UPDATE_GOLDENS=1 npm run test:unit -- test/unit/golden.spec.ts
git diff test/golden/
```

Do not set `UPDATE_GOLDENS` in CI. GitHub Actions sets `CI=true`, and the helper refuses to write goldens when that is set.

## Fixture

`help/default.json` and `llms/default.txt` match `GET /v1/help` and `GET /llms.txt` in the worker suite: origins from `vitest.config.ts`, company-shaped policy from `wrangler.toml`.

- origin / `PUBLIC_ORIGIN`: `https://hub.energon.example.com`
- `CONTENT_ORIGIN`: `https://energon.example.com`
- `ALLOWED_EMAIL_DOMAINS`: `esperlabs.app,esperlabs.ai`
- `ALLOW_UNLIMITED_RETENTION=true`, `DEFAULT_TTL=never`, `MAX_TTL=never`, `WRITE_POLICY=instance`, `ALLOW_UNLIMITED_TOKENS=true`

Markdown goldens are `renderMarkdown(source).html` only — not the chrome page shell. Sources live next to the `.html.golden` files.

## Confidence

| Artifact | Deterministic | Platform-dependent | Volatility | Strategy |
| --- | --- | --- | --- | --- |
| `/v1/help` JSON | Y | N | 3 | exact, pretty-printed |
| `/llms.txt` | Y | N | 3 | exact |
| markdown HTML | Y | N | 2 | exact, LF canonicalized |

Hub / tokens / setup HTML stays in `test/pages.spec.ts` (DOM contracts). Do not snapshot those pages here.

## Compare leftovers

Mismatch writes a sibling `*.actual`. Those files are gitignored. Remove them after a passing run; the helper unlinks a matching leftover itself.
