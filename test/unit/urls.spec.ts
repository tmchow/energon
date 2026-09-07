import { describe, expect, it } from "vitest";
import { filePublicPath, isFileId, sitePublicPath, urlFilename } from "../../src/urls";

describe("public URL shape", () => {
  it("spaces become underscores in the path only", () => {
    expect(urlFilename("My Notes.md")).toBe("My_Notes.md");
    expect(filePublicPath("ada", "Ab12Cd", "My Notes.md")).toBe("/ada/f/Ab12Cd/My_Notes.md");
  });

  it("site paths keep a trailing slash on the homepage", () => {
    expect(sitePublicPath("ada", "Ab12Cd", "demo")).toBe("/ada/s/Ab12Cd/demo/");
    expect(sitePublicPath("ada", "Ab12Cd", "demo", "notes.md")).toBe("/ada/s/Ab12Cd/demo/notes.md");
  });

  it("file ids are short and url-safe", () => {
    expect(isFileId("Ab12Cd")).toBe(true);
    expect(isFileId("short")).toBe(false);
    expect(isFileId("../x")).toBe(false);
  });
});
