/** One authored description of the upload-grant protocol, shared by /llms.txt (both origins), /v1/help, and the skill. */
export const GRANT_UPLOAD_PREFIX = "/_grants/";
export const GRANT_AUTH_HEADER = "Authorization: Bearer";

export function grantLlmsSection(): string {
  return `# Upload grant

An upload grant lets you upload one file without an account. Whoever gave it to you sent an upload URL (\`/_grants/{id}\` on this host) and a secret that starts with \`grant_\`.

Send \`PUT\` to the upload URL with header \`${GRANT_AUTH_HEADER} <secret>\` and the file as the raw body. Set \`Content-Length\` for large files. Do not send a filename, password, TTL, or content type header; the grant already fixed the target, and other metadata headers are 400. Never put the secret in a URL.

Success is \`201\` (new file or path) or \`200\` (replaced) with the public \`url\`. The grant is then used up.

- \`404 grant_invalid\`: wrong id or secret.
- \`410 grant_used\`: already used; the body names the published \`url\`.
- \`410 grant_expired\` or \`410 grant_failed\`: stop and ask for a new grant.
- \`409 grant_busy\`, \`409 file_busy\`, or a \`5xx\`: retry the same upload.
- \`413 too_large\` or \`400 checksum_mismatch\`: fix the bytes and retry; nothing was published.
`;
}

export function hubGrantSection(contentOrigin: string): string {
  return `## Upload grant

Let a machine without a token upload one file. \`POST /v1/grants\` with \`{"target": {"type": "new_file", "filename": "…"}}\`, \`{"target": {"type": "file", "id": "…"}}\`, or \`{"target": {"type": "site_path", "site_id": "…", "path": "…"}}\`, plus optional \`expires_in\` (5m, 15m default, 30m, 1h), \`max_bytes\`, and \`sha256\`. You must be able to write the target. The response holds \`upload_url\` (\`${contentOrigin}${GRANT_UPLOAD_PREFIX}{id}\`) and a \`secret\`, shown once.

The other machine sends \`PUT\` to \`upload_url\` with \`${GRANT_AUTH_HEADER} <secret>\` and the raw bytes; it reads \`${contentOrigin}/llms.txt\`. Success publishes at once and uses the grant up. Read the result with \`GET /v1/grants/{id}\`. Revoking the minting token ends its grants. A grant is a single-use capability, not an account: do not mint the other machine a token.
`;
}

export function helpGrantSop(): string[] {
  return [
    `Upload grant: to let a machine without a token upload one file, POST /v1/grants with a target (new_file with filename, file with id, or site_path with site_id and path) and optional expires_in (5m, 15m default, 30m, 1h), max_bytes, and sha256. You must be able to write the target. The response returns upload_url on the content origin and a secret, once.`,
    `The other machine sends PUT upload_url with ${GRANT_AUTH_HEADER} <secret> and the raw body. Success publishes immediately and uses the grant up; retryable failures leave it usable until it expires. GET /v1/grants/{id} shows unused, uploading, consumed (with url), failed (with last_error), or expired. Revoking the minting token ends every grant it minted. Never put the secret in a URL or a published file.`,
  ];
}
