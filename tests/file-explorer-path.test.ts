import { describe, expect, it } from "vitest";
import {
  buildFileWikiLink,
  displayExplorerPath,
  isAudioVideoFileName,
  linkPathFromRoot,
  markdownReferencesPath,
  sortExplorerEntries,
} from "../src/domain/file-explorer-path";

describe("file-explorer-path", () => {
  it("detects audio and video by extension", () => {
    expect(isAudioVideoFileName("a.mp3")).toBe(true);
    expect(isAudioVideoFileName("b.MP4")).toBe(true);
    expect(isAudioVideoFileName("c.png")).toBe(false);
    expect(isAudioVideoFileName("folder")).toBe(false);
  });

  it("builds embed links for media and wiki links otherwise", () => {
    expect(buildFileWikiLink("files/clip.mp3", "clip.mp3")).toBe(
      "![[files/clip.mp3|clip.mp3]]",
    );
    expect(buildFileWikiLink("files/photo.png", "photo.png")).toBe(
      "[[files/photo.png|photo.png]]",
    );
    expect(buildFileWikiLink("files/images", "images")).toBe(
      "[[files/images|images]]",
    );
  });

  it("detects references in index markdown", () => {
    const md = "see [[files/a.png|a.png]] and ![[files/v.mp4|v.mp4]]";
    expect(markdownReferencesPath(md, "files/a.png")).toBe(true);
    expect(markdownReferencesPath(md, "files/missing.png")).toBe(false);
    expect(markdownReferencesPath(md, "files")).toBe(true); // 子孙引用也算目录关联
  });

  it("sorts folders before files then by name", () => {
    expect(
      sortExplorerEntries([
        { name: "z.txt", kind: "file" },
        { name: "b", kind: "folder" },
        { name: "a.png", kind: "file" },
        { name: "a", kind: "folder" },
      ]).map((e) => e.name),
    ).toEqual(["a", "b", "a.png", "z.txt"]);
  });

  it("builds display and link paths", () => {
    expect(displayExplorerPath("files", "")).toBe("files");
    expect(displayExplorerPath("files", "images")).toBe("files/images");
    expect(linkPathFromRoot("files", "", "photo.png")).toBe("files/photo.png");
    expect(linkPathFromRoot("files", "images", "photo.png")).toBe(
      "files/images/photo.png",
    );
  });
});
