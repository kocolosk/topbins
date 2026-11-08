import type { AlbumDTO, MediaDTO } from "./catalog";

export interface Team {
  id: string;
  title: string;
}

export interface Season {
  id: string;
  teamId: string;
  title: string;
}

export type Photo = MediaDTO;
export type Album = AlbumDTO;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    return (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        character
      ] ?? character
    );
  });
}

const segment = (value: string) => encodeURIComponent(value);
const teamPath = (team: string) => `/teams/${segment(team)}`;
const seasonPath = (team: string, season: string) =>
  `${teamPath(team)}/seasons/${segment(season)}`;

function document(title: string, body: string, preview = false): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)} — topbins</title>
  <link rel="stylesheet" href="/style.css">
  <script src="/gallery.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to galleries</a>
  <header class="site-header"><a class="wordmark" href="/">topbins<span class="wordmark-dot" aria-hidden="true">.</span></a><span class="site-description">A season at a time.</span></header>
  ${preview ? '<aside class="preview-notice">Draft preview · Only available with publisher credentials. Nothing on this page is a public share link.</aside>' : ""}
  <main id="main">${body}</main>
  <footer class="site-footer"><a href="/">Match galleries</a><p>Photos from the touchline.</p></footer>
</body>
</html>`;
}

function breadcrumbs(items: { title: string; href: string }[]): string {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol><li><a href="/">Teams</a></li>${items.map((item) => `<li><a href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a></li>`).join("")}</ol></nav>`;
}

export function homePage(teams: Team[]): string {
  return document(
    "Match galleries",
    `<div class="page-heading"><h1>Match galleries</h1><p>The moments between the first whistle and the last.</p></div>${
      teams.length
        ? `<ul class="directory">${teams.map((team) => `<li><a href="${teamPath(team.id)}"><span>${escapeHtml(team.title)}</span><span class="directory-action">View seasons</span></a></li>`).join("")}</ul>`
        : '<div class="empty-state"><h2>Between matches</h2><p>Published galleries will appear here when they are ready.</p></div>'
    }`,
  );
}

export function teamPage(team: Team, seasons: Season[]): string {
  return document(
    team.title,
    `${breadcrumbs([])}<div class="page-heading"><h1>${escapeHtml(team.title)}</h1><p>Choose a season.</p></div><ul class="directory">${seasons.map((season) => `<li><a href="${seasonPath(team.id, season.id)}"><span>${escapeHtml(season.title)}</span><span class="directory-action">View matches</span></a></li>`).join("")}</ul>`,
  );
}

export function seasonPage(
  team: Team,
  season: Season,
  albums: Album[],
): string {
  return document(
    `${team.title} / ${season.title}`,
    `${breadcrumbs([{ title: team.title, href: teamPath(team.id) }])}<div class="page-heading"><p class="context">${escapeHtml(team.title)}</p><h1>${escapeHtml(season.title)}</h1><p>${albums.length} match ${albums.length === 1 ? "gallery" : "galleries"}</p></div><div class="match-grid">${albums
      .map((album) => {
        const cover =
          album.media.find((photo) => photo.id === album.coverMediaId) ??
          album.media[0];
        return `<a class="match" href="/albums/${segment(album.id)}">${cover ? `<img src="${escapeHtml(cover.gridUrl)}" width="${cover.width}" height="${cover.height}" alt="" loading="lazy">` : '<div class="cover-placeholder" aria-hidden="true"></div>'}<div class="match-description"><time datetime="${escapeHtml(album.date)}">${escapeHtml(album.date)}</time><h2>${escapeHtml(album.title)}</h2><span>${album.media.length} photos</span></div></a>`;
      })
      .join("")}</div>`,
  );
}

function photoTime(photo: Photo): string {
  const value = photo.captureTime;
  if (!value) return "";
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    );
  if (!match) return "";
  const zone =
    match[3] === "Z" ? "UTC" : match[3] ? `UTC${match[3]}` : "timezone unknown";
  return `<p class="capture-time"><time datetime="${escapeHtml(value)}">${escapeHtml(`${match[1]} ${match[2]} (${zone})`)}</time></p>`;
}

function rights(photo: Photo): string {
  return [
    photoTime(photo),
    photo.credit ? `<p>Photo by ${escapeHtml(photo.credit)}</p>` : "",
    photo.copyright ? `<p>${escapeHtml(photo.copyright)}</p>` : "",
    photo.usageTerms ? `<p>${escapeHtml(photo.usageTerms)}</p>` : "",
    photo.rightsUrl && /^https?:\/\//i.test(photo.rightsUrl)
      ? `<p><a href="${escapeHtml(photo.rightsUrl)}" rel="noreferrer">Usage information</a></p>`
      : "",
  ].join("");
}

export function albumPage(album: Album, url: URL, preview = false): string {
  const chosen = album.media.find(
    (photo) => photo.id === url.searchParams.get("photo"),
  );
  const photoHref = (photo: Photo) =>
    `${url.pathname}?photo=${segment(photo.id)}`;
  return document(
    album.title,
    `${
      preview || album.visibility === "unlisted"
        ? ""
        : breadcrumbs([
            { title: album.teamTitle, href: teamPath(album.teamId) },
            {
              title: album.seasonTitle,
              href: seasonPath(album.teamId, album.seasonId),
            },
          ])
    }
<div class="page-heading album-heading"><div><p class="context">${escapeHtml(album.teamTitle)} / ${escapeHtml(album.seasonTitle)}</p><h1>${escapeHtml(album.title)}</h1><p><time datetime="${escapeHtml(album.date)}">${escapeHtml(album.date)}</time><span class="count">${album.media.length} photos</span></p></div>${album.visibility === "unlisted" ? '<span class="visibility-note">Unlisted album · Anyone with this link can view and share it.</span>' : ""}</div>
${chosen ? `<noscript><section class="selected-photo"><img src="${escapeHtml(chosen.viewerUrl)}" width="${chosen.width}" height="${chosen.height}" alt="Selected match photo"><div class="rights">${rights(chosen)}</div><a class="button" href="${escapeHtml(chosen.downloadUrl)}" download>Download photo</a><p><a href="${escapeHtml(url.pathname)}">Back to all photos</a></p></section></noscript>` : ""}
<div class="photo-grid" aria-label="Match photos">${album.media
      .map(
        (photo, index) =>
          `<figure><a class="photo-link" href="${escapeHtml(photoHref(photo))}" data-photo-id="${escapeHtml(photo.id)}" data-viewer="${escapeHtml(photo.viewerUrl)}" data-download="${escapeHtml(photo.downloadUrl)}" aria-label="Open photo ${index + 1} of ${album.media.length}"><img src="${escapeHtml(photo.gridUrl)}" width="${photo.width}" height="${photo.height}" alt="Match photo ${index + 1}" loading="lazy" decoding="async"></a>${photoTime(photo)}<figcaption class="photo-rights" hidden>${rights(photo)}</figcaption></figure>`,
      )
      .join("")}</div>
<dialog id="viewer" aria-label="Photo viewer"><div class="viewer-shell"><div class="viewer-toolbar"><span id="viewer-position" aria-live="polite"></span><button id="viewer-close" type="button" aria-label="Close photo viewer">Close <span aria-hidden="true">×</span></button></div><div class="viewer-stage"><button id="viewer-previous" class="viewer-step" type="button" aria-label="Previous photo">‹</button><img id="viewer-image" alt=""><button id="viewer-next" class="viewer-step" type="button" aria-label="Next photo">›</button></div><div class="viewer-details"><div id="viewer-rights" class="rights"></div><div class="viewer-actions"><button id="viewer-share" type="button">Copy photo link</button><a id="viewer-download" class="button" download>Download photo</a></div></div><p id="viewer-status" class="visually-hidden" role="status"></p></div></dialog>`,
    preview,
  );
}
