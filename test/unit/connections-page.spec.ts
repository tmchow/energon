import { describe, expect, it } from "vitest";
import { connectPageKind, connectPageStatus, connectVerificationUri, parseUserCode } from "../../src/connections";

const now = "2026-09-08T12:00:00.000Z";
const later = "2026-09-08T12:10:00.000Z";
const earlier = "2026-09-08T11:00:00.000Z";

describe("connect page kind", () => {
  it("treats missing, expired, and consumed requests as ended HTML", () => {
    expect(connectPageKind(null, now)).toBe("expired");
    expect(connectPageKind({ status: "pending", expires_at: earlier }, now)).toBe("expired");
    expect(connectPageKind({ status: "consumed", expires_at: later }, now)).toBe("expired");
    expect(connectPageStatus("expired")).toBe(410);
  });

  it("keeps live pending requests on the approval form", () => {
    expect(connectPageKind({ status: "pending", expires_at: later }, now)).toBe("pending");
    expect(connectPageStatus("pending")).toBe(200);
  });

  it("maps decided requests without turning them into JSON errors", () => {
    expect(connectPageKind({ status: "approved", expires_at: later }, now)).toBe("approved");
    expect(connectPageKind({ status: "denied", expires_at: later }, now)).toBe("denied");
    expect(connectPageStatus("approved")).toBe(409);
    expect(connectPageStatus("denied")).toBe(403);
  });
});

describe("user code parsing", () => {
  it("accepts only an eight-digit code", () => {
    expect(parseUserCode("12345678")).toBe("12345678");
    expect(parseUserCode(" 12345678 ")).toBe("12345678");
    expect(parseUserCode(null)).toBeNull();
    expect(parseUserCode(undefined)).toBeNull();
    expect(parseUserCode("")).toBeNull();
    expect(parseUserCode("1234567")).toBeNull();
    expect(parseUserCode("123456789")).toBeNull();
    expect(parseUserCode("abcdefgh")).toBeNull();
    expect(parseUserCode("1234 5678")).toBeNull();
  });

  it("puts the code on the verification URL", () => {
    expect(connectVerificationUri("https://hub.example.com", "reqid000000000000000001", "12345678"))
      .toBe("https://hub.example.com/connect?request=reqid000000000000000001&user_code=12345678");
  });
});
