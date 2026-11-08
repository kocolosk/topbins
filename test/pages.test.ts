import { describe, expect, it } from "vitest";
import { type Album, albumPage, homePage, seasonPage } from "../src/pages";

const album: Album = {
  id: "match",
  teamId: "team",
  seasonId: "season",
  teamTitle: "Team",
  seasonTitle: "Season",
  title: 'Match <script>alert("unsafe")</script>',
  date: "2026-10-10",
  visibility: "public",
  coverMediaId: "photo",
  media: [
    {
      id: "photo",
      width: 3072,
      height: 2048,
      captureTime: "2026-10-10T15:04:19-04:00",
      credit: "Example Photographer",
      copyright: "© Example",
      usageTerms: null,
      rightsUrl: "javascript:alert(1)",
      gridUrl: "/media/photo/version/grid",
      viewerUrl: "/media/photo/version/viewer",
      downloadUrl: "/media/photo/version/download",
    },
  ],
};

describe("gallery rendering", () => {
  it("renders an honest empty state without fictitious matches", () => {
    const html = homePage([]);
    expect(html).toContain("Between matches");
    expect(html).not.toContain("development scaffold");
  });

  it("escapes catalog text and excludes unsafe rights links", () => {
    const html = albumPage(album, new URL("https://example.test/albums/match"));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("unsafe")');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Example Photographer");
    expect(html).not.toContain("noncommercial");
  });

  it("renders stable individual links and a no-script selected photo", () => {
    const html = albumPage(
      album,
      new URL("https://example.test/albums/match?photo=photo"),
    );
    expect(html).toContain('href="/albums/match?photo=photo"');
    expect(html).toContain("<noscript><section");
    expect(html).toContain('src="/media/photo/version/viewer"');
    expect(html).toContain('href="/media/photo/version/download"');
    expect(html).toContain('aria-label="Photo viewer"');
    expect(html).toContain('id="viewer-previous"');
  });

  it("does not create discoverability links from an unlisted album", () => {
    const html = albumPage(
      { ...album, visibility: "unlisted" },
      new URL("https://example.test/shared/opaque-token"),
    );
    expect(html).toContain('href="/shared/opaque-token?photo=photo"');
    expect(html).not.toContain('href="/teams/team"');
    expect(html).toContain("Anyone with this link");
  });

  it("marks preview pages and keeps their individual links in preview", () => {
    const html = albumPage(
      album,
      new URL("https://example.test/preview/match"),
      true,
    );
    expect(html).toContain("Draft preview");
    expect(html).toContain('href="/preview/match?photo=photo"');
    expect(html).not.toContain('href="/albums/match?photo=photo"');
  });

  it("preserves cover aspect ratio without requiring a crop", () => {
    const html = seasonPage(
      { id: "team", title: "Team" },
      { id: "season", teamId: "team", title: "Season" },
      [album],
    );
    expect(html).toContain('width="3072" height="2048"');
    expect(html).toContain('href="/albums/match"');
  });

  it("shows recorded capture time and offset without viewer timezone conversion", () => {
    const html = albumPage(album, new URL("https://example.test/albums/match"));
    expect(html).toContain('datetime="2026-10-10T15:04:19-04:00"');
    expect(html).toContain("2026-10-10 15:04:19 (UTC-04:00)");
    const unknown = albumPage(
      {
        ...album,
        media: album.media.map((photo) => ({
          ...photo,
          captureTime: "2026-10-10T15:04:19",
        })),
      },
      new URL("https://example.test/albums/match"),
    );
    expect(unknown).toContain("15:04:19 (timezone unknown)");
  });
});
