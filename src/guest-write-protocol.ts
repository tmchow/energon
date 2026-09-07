import { WRITE_PASSWORD_HEADER } from "./config";

export { WRITE_PASSWORD_HEADER };

export const GUEST_WRITE_401_MESSAGE =
  `This link requires header ${WRITE_PASSWORD_HEADER} to write. GET /llms.txt on this host.`;

export const CONTENT_ONLY_404_MESSAGE =
  "This hostname serves published content only. GET /llms.txt on this host.";

export function guestWriteLlmsBody(): string {
  return `# Guest write

This hostname serves published files and sites.

A write password is a shared secret for one published object. It is not an account.

Send header \`${WRITE_PASSWORD_HEADER}\` on PUT, and on DELETE of a site path. The body is raw bytes only. An empty body is allowed.

A file write password only replaces that file. You cannot delete the file. The public file address stays.

A site write password can PUT or DELETE a path under that site. You cannot delete the site. The site address still opens after every path is gone.

GET with that same write header reads the object even if a share password is set. HTML forms only accept the share password. A cookie never authorizes PUT or DELETE.

Wrong or missing write password on PUT or DELETE: 401 naming \`${WRITE_PASSWORD_HEADER}\`. Unset write password: 405. Directory URLs accept GET only.

If the object is gone: 404. If expired: 410. If another write is in progress: 409. Retry 409.

Do not send the share-password header to write. That header does not authorize PUT or DELETE.
`;
}

export function hubGuestWriteSection(contentOrigin: string): string {
  return `## Guest write password

A second shared secret lets someone outside this host replace bytes at a public URL without a token. The creator sets \`write_password\` on create or PATCH (empty string clears). Duplicate does not copy it. Only the creator can set or clear it.

The outside agent GETs \`${contentOrigin}/llms.txt\` and PUTs the public URL with \`${WRITE_PASSWORD_HEADER}\`. Site paths also accept DELETE. Do not mint them a token. Do not send them to /connect.

A file write password only replaces that file (including empty). A site write password can add, replace, or delete paths under that slug, including \`index.html\`. It cannot delete the site or the loose file.

\`${WRITE_PASSWORD_HEADER}\` is not the share-password header. Identical phrases still bind to the header that carried them. The write header unlocks GET. The HTML gate and cookie never authorize PUT or DELETE.
`;
}

export function helpGuestWriteSop(): string[] {
  return [
    `Guest write password: a per-object shared secret, not an account. Creator-only to set or clear (JSON write_password on create/PATCH, X-Energon-Set-Write-Password or multipart write_password on file create). Empty string clears. Duplicate does not copy it.`,
    `An outside agent given the public URL and write password GETs the content-origin /llms.txt and PUTs that URL with header ${WRITE_PASSWORD_HEADER} and a raw body. Site paths also accept DELETE. Do not mint them a token.`,
    `A file write password only replaces that file. A site write password can PUT or DELETE paths under that slug, including index.html, and cannot delete the site. ${WRITE_PASSWORD_HEADER} never authorizes via the share-password header, cookie, or gate form.`,
  ];
}
