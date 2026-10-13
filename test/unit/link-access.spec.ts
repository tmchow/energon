import { describe, expect, it } from "vitest";
import { hiddenFrom, patchLinkAccess, requestedLinkAccess, resolveCreateAccess, storedLinkAccess } from "../../src/link-access";

const none = { password: false, writePassword: false, writePolicy: "org" as const };
const noChange = { password: undefined, writePassword: undefined, writePolicy: undefined };
const orgEnv = { WRITE_POLICY: "org" };

describe("link access", () => {
  it("treats only a stored private value as private", () => {
    expect(storedLinkAccess("private")).toBe("private");
    expect(storedLinkAccess("public")).toBe("public");
    expect(storedLinkAccess(null)).toBe("public");
  });

  it("reads public or private and rejects anything else", () => {
    expect(requestedLinkAccess(undefined)).toBeUndefined();
    expect(requestedLinkAccess("")).toBeUndefined();
    expect(requestedLinkAccess(" Private ")).toBe("private");
    expect(() => requestedLinkAccess("org")).toThrow(expect.objectContaining({ status: 400, code: "bad_link_access" }));
    expect(() => requestedLinkAccess(true)).toThrow(expect.objectContaining({ code: "bad_link_access" }));
  });

  it("hides a private object from every account but its creator", () => {
    const row = { link_access: "private", created_by: "ada@example.com", owner_id: "u-ada" };
    expect(hiddenFrom({ email: "ada@example.com", userId: "u-ada", via: "token" }, row)).toBe(false);
    expect(hiddenFrom({ email: "bob@example.com", userId: "u-bob", via: "token" }, row)).toBe(true);
    expect(hiddenFrom({ email: "bob@example.com", userId: "u-bob", via: "token" }, { ...row, link_access: "public" })).toBe(false);
  });

  it("creates public with the requested write policy by default", () => {
    expect(resolveCreateAccess(orgEnv, undefined, undefined, "hash", null)).toEqual({ access: "public", writePolicy: "org" });
  });

  it("creates a private object owner-only for writes and refuses passwords or org writes", () => {
    expect(resolveCreateAccess(orgEnv, "private", undefined, null, null)).toEqual({ access: "private", writePolicy: "owner" });
    expect(() => resolveCreateAccess(orgEnv, "private", undefined, "hash", null)).toThrow(expect.objectContaining({ status: 400, code: "link_access_conflict" }));
    expect(() => resolveCreateAccess(orgEnv, "private", undefined, null, "hash")).toThrow(expect.objectContaining({ status: 400, code: "link_access_conflict" }));
    expect(() => resolveCreateAccess(orgEnv, "private", "org", null, null)).toThrow(expect.objectContaining({ status: 400, code: "link_access_conflict" }));
  });

  it("refuses to go private while a password stays set", () => {
    expect(() => patchLinkAccess("public", "private", { ...none, password: true }, noChange))
      .toThrow(expect.objectContaining({ status: 409, code: "link_access_conflict" }));
    expect(() => patchLinkAccess("public", "private", { ...none, password: true, writePassword: true }, { ...noChange, password: null }))
      .toThrow(expect.objectContaining({ status: 409, code: "link_access_conflict" }));
  });

  it("goes private when the same request clears both passwords, and makes writes owner-only", () => {
    const patch = patchLinkAccess("public", "private", { ...none, password: true, writePassword: true }, { ...noChange, password: null, writePassword: null });
    expect(patch).toEqual({ next: "private", changed: true, writePolicy: "owner", forcedOwner: true, purge: true, guardSql: "1 = 1" });
  });

  it("writes owner policy when going private even if the stored policy already reads owner", () => {
    expect(patchLinkAccess("public", "private", { ...none, writePolicy: "owner" }, noChange))
      .toMatchObject({ next: "private", changed: true, writePolicy: "owner", forcedOwner: true });
  });

  it("refuses org writes on a private object", () => {
    expect(() => patchLinkAccess("public", "private", none, { ...noChange, writePolicy: "org" }))
      .toThrow(expect.objectContaining({ status: 400, code: "link_access_conflict" }));
    expect(() => patchLinkAccess("private", undefined, none, { ...noChange, writePolicy: "org" }))
      .toThrow(expect.objectContaining({ status: 400, code: "link_access_conflict" }));
  });

  it("guards untouched password columns while the object is or becomes private", () => {
    expect(patchLinkAccess("public", "private", none, noChange).guardSql).toBe("password_hash IS NULL AND write_password_hash IS NULL");
    expect(patchLinkAccess("private", undefined, { ...none, writePolicy: "owner" }, noChange))
      .toMatchObject({ next: "private", changed: false, writePolicy: "owner", forcedOwner: false, purge: true });
  });

  it("refuses a new password on a private object unless the request makes it public", () => {
    expect(() => patchLinkAccess("private", undefined, none, { ...noChange, password: "hash" }))
      .toThrow(expect.objectContaining({ status: 400, code: "link_access_conflict" }));
    expect(patchLinkAccess("private", "public", none, { ...noChange, password: "hash" }))
      .toEqual({ next: "public", changed: true, writePolicy: "org", forcedOwner: false, purge: true, guardSql: "1 = 1" });
  });

  it("guards a password or org writes on a public object against a concurrent switch to private", () => {
    const guard = "ifnull(link_access, 'public') = 'public'";
    expect(patchLinkAccess("public", undefined, none, { ...noChange, password: "hash" }).guardSql).toBe(guard);
    expect(patchLinkAccess("public", undefined, none, { ...noChange, writePolicy: "org" }).guardSql).toBe(guard);
    expect(patchLinkAccess("public", undefined, none, { ...noChange, writePolicy: "owner" }).guardSql).toBe("1 = 1");
  });
});
