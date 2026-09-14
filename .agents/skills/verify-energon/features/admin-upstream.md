# Admin upstream release

Operators listed on `ADMIN_EMAILS` see when this build is behind the latest public GitHub Release. The hub shows a warn **Update** badge on Admin. `/admin` names the newer tag above Health. There is no deploy button and no release-note list. Dismiss is this browser only.

## Sub-features

- `admin-upstream-current` is a matching or newer baked `version.txt` versus latest. Admin kicker is `This Energon · {version}`. No `#admin-update` card, no Admin nav hash, no muted check note.
- `admin-upstream-update` is a lower baked semver than latest. Hub Admin links to `/admin#admin-update` with a warn badge that says `Update`. `#admin-update` sits above `#admin-health`, is not charged, names the newer version, and has Read the release, How to update, and `#admin-update-dismiss`. It does not list release notes.
- `admin-upstream-dismiss` writes `localStorage` `energon:dismissed-release:{tag}`. Badge and card hide until a newer tag. Reload keeps the dismiss.
- `admin-upstream-failed` is a failed latest-release check. `#admin-update-note` says it could not check. No nav badge.
- `admin-upstream-unknown` is a build with no baked semver. Muted note only. No nav badge.
- `admin-upstream-refuse` is a non-admin signed-in person. No Admin nav, no Update badge, `GET /admin` is `403 forbidden_admin`.

## How to get to it (user POV)

- Operator, hub: open `/`. Admin shows **Update** only when a newer release is available and that tag is not dismissed. The link is `/admin#admin-update`.
- Operator, Admin: open `/admin`. Current: version in the kicker. Update: quiet card above Health with the newer version. Failed or unknown: one muted line. Dismiss is on the card.
- Non-admin: no Admin item.

## Driving it with energon-verify

Preconditions:

- This feature needs its own launch. The fixture tag must be a newer semver than the repo `version.txt`.
- Launch with `ENERGON_VERIFY_EMAIL` set (or the default local identity) and `ENERGON_VERIFY_VARS="ADMIN_EMAILS:$EMAIL UPSTREAM_RELEASE_JSON:{\"tag_name\":\"v1.1.0\",\"html_url\":\"https://example.test/r/v1.1.0\",\"published_at\":\"2026-09-14T00:00:00.000Z\"}"` so the doctor identity is an operator and Admin does not call the network. `$EMAIL` must be the address `GET /account/data` reports (`.dev.vars` `DEV_ACCESS_EMAIL` if set, else `dev@example.com`).
- `bin/up` passed. Persist is `$PERSIST` from `state.env`.

- **Default — Operator hub HTML.** `GET $ORIGIN/` as the doctor. HTML contains `href="/admin#admin-update"` and the word `Update` next to Admin. Bootstrap JSON `upstream.status` is `update`, `upstream.latest_tag` is `v1.1.0`. Bootstrap `upstream` has no release body or note list.
- **Default — Operator Admin HTML.** `GET $ORIGIN/admin` as the doctor is `200`. The page h1 is `Admin`. Contains `id="admin-update"`, `1.1.0 is available`, `1.1.0 was released`, `id="admin-update-dismiss"`, `Read the release`, `How to update`, and `This Energon ·` plus this build's `version.txt`. `#admin-update` appears before `#admin-health`. No `id="admin-update-operator"`. Bootstrap `upstream.status` is `update`. The update card class is `en-card en-admin-card` without `en-card--charged`. The date is the newer tag's `published_at`, not this build.
- **Extra (admin-upstream-dismiss) — Dismiss in the hub.** Open `$ORIGIN/`. `#who` shows the doctor email. Admin shows Update. Open `/admin`. `#admin-update` is above Health. Click `#admin-update-dismiss`. Card and nav badge hide. Reload `/admin` and `/`: still hidden. Drive when dismiss or localStorage key changes.
- **Extra (admin-upstream-current) — Current fixture.** Second wrangler: same operator email, `UPSTREAM_RELEASE_JSON` tag equal to `version.txt` (for example `v1.0.0` when the file is `1.0.0`). `GET /admin` has the version kicker and no `#admin-update`. Drive when current/empty chrome changes.
- **Proof.** Default: hub and Admin HTML plus bootstrap `upstream`. Screenshots only for Extra hub dismiss (`#who` visible).

## Gotchas

- Launch must pass `ADMIN_EMAILS` matching the doctor email or Admin is `403`.
- `UPSTREAM_RELEASE_JSON` is a GitHub `releases/latest`-shaped object: `tag_name`, `html_url`, `published_at`. A `body` field is ignored. Without the fixture the Worker calls GitHub; do not do that in verify.
- Dismiss is `localStorage` only (`energon:dismissed-release:{tag}`). A new tag lights the mark again. There is no D1 row.
- The card does not deploy or overwrite this Energon. How to update is the public docs upgrade page. Release notes stay on the GitHub release page.
- Worker tests pin a current fixture. This feature's launch pins an update fixture. Do not reuse a current-pinned process for Default.
- Non-admins never receive `upstream` in page chrome.
