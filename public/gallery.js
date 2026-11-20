(() => {
  // Justified rows. The CSS (see style.css) wraps greedily using ratios rounded
  // to tenths; that is the no-script fallback. Here, choose where rows break so
  // every row stays close to the target height, and size figures from each
  // image's exact ratio. CSSOM styles are CSP-safe.
  const grid = document.querySelector(".photo-grid");
  if (!grid) return;
  const figures = [...grid.children].filter((el) => el.tagName === "FIGURE");
  const ratios = figures.map((figure) => {
    const img = figure.querySelector("img");
    const ratio =
      Number(img?.getAttribute("width")) / Number(img?.getAttribute("height"));
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1.5;
  });
  const maxPerRow = 8;

  // Height at which figures start..end-1 exactly fill the width.
  function fillHeight(start, end, width, gap) {
    let sum = 0;
    for (let i = start; i < end; i++) sum += ratios[i];
    return (width - gap * (end - start - 1)) / sum;
  }

  // Minimum total squared log deviation from the target height. The last row
  // is not stretched, so it only costs anything if it would be squeezed.
  function rowBreaks(width, gap, target) {
    const n = ratios.length;
    const cost = [0];
    const from = [0];
    for (let end = 1; end <= n; end++) {
      cost[end] = Infinity;
      for (let start = Math.max(0, end - maxPerRow); start < end; start++) {
        const height = fillHeight(start, end, width, gap);
        if (!(height > 0)) continue;
        const error = Math.log(height / target);
        const total =
          cost[start] + (end === n ? Math.min(0, error) : error) ** 2;
        if (total < cost[end]) {
          cost[end] = total;
          from[end] = start;
        }
      }
    }
    const rows = [];
    for (let end = n; end > 0; end = from[end]) rows.unshift([from[end], end]);
    return rows;
  }

  function layout() {
    for (const figure of figures) {
      figure.style.removeProperty("flex");
      figure.style.removeProperty("width");
    }
    // One column on narrow screens: every figure is its own row.
    if (!figures.length || matchMedia("(max-width: 42rem)").matches) return;
    const style = getComputedStyle(grid);
    const gap = parseFloat(style.columnGap) || 0;
    // --row is registered as a length, so it computes to pixels.
    const target = parseFloat(style.getPropertyValue("--row")) || 240;
    // A pixel of slack so rounding never wraps the last figure of a full row.
    const width = grid.clientWidth - 1;
    const rows = rowBreaks(width, gap, target);
    let previous = target;
    rows.forEach(([start, end], index) => {
      let height = fillHeight(start, end, width, gap);
      // The last row matches the row above rather than filling the width.
      if (index === rows.length - 1) height = Math.min(height, previous);
      previous = height;
      for (let i = start; i < end; i++) {
        figures[i].style.flex = "none";
        figures[i].style.width = `${ratios[i] * height}px`;
      }
    });
  }

  // Lay out before first paint, then again only when the grid width changes
  // (window resizes, scrollbars appearing, crossing the mobile breakpoint).
  let laidOut = grid.clientWidth;
  layout();
  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (grid.clientWidth === laidOut) return;
      laidOut = grid.clientWidth;
      layout();
    });
  }).observe(grid);
})();

(() => {
  const dialog = document.querySelector("#viewer");
  if (!(dialog instanceof HTMLDialogElement)) return;
  const photos = [...document.querySelectorAll(".photo-link")];
  if (!photos.length) return;

  const image = document.querySelector("#viewer-image");
  const video = document.querySelector("#viewer-video");
  const previous = document.querySelector("#viewer-previous");
  const next = document.querySelector("#viewer-next");
  const close = document.querySelector("#viewer-close");
  const download = document.querySelector("#viewer-download");
  const position = document.querySelector("#viewer-position");
  const credit = document.querySelector("#viewer-rights");
  const share = document.querySelector("#viewer-share");
  const status = document.querySelector("#viewer-status");
  let current = 0;
  let touchStart = null;
  let opener = null;

  // Warm the browser cache for the neighbours so stepping through is instant.
  const prefetched = new Set();
  function prefetch(index) {
    const photo = photos[index];
    if (!photo || photo.dataset.kind === "video") return;
    const url = photo.dataset.viewer;
    if (prefetched.has(url)) return;
    prefetched.add(url);
    new Image().src = url;
  }

  function show(index, updateHistory = true) {
    current = Math.max(0, Math.min(photos.length - 1, index));
    const photo = photos[current];
    video.pause();
    video.removeAttribute("src");
    video.load();
    const isVideo = photo.dataset.kind === "video";
    image.hidden = isVideo;
    video.hidden = !isVideo;
    image.removeAttribute("src");
    if (isVideo) {
      video.poster = photo.dataset.poster;
      video.src = photo.dataset.viewer;
    } else image.src = photo.dataset.viewer;
    image.alt = `Match photo ${current + 1} of ${photos.length}`;
    download.href = photo.dataset.download;
    download.textContent = isVideo ? "Download video" : "Download photo";
    position.textContent = `${current + 1} / ${photos.length}`;
    // Keep the camera details expanded while stepping through photos.
    const detailsOpen = credit.querySelector("details")?.open === true;
    credit.replaceChildren(
      ...[...photo.parentElement.querySelector(".photo-rights").childNodes].map(
        (node) => node.cloneNode(true),
      ),
    );
    const details = credit.querySelector("details");
    if (details && detailsOpen) details.open = true;
    previous.disabled = current === 0;
    next.disabled = current === photos.length - 1;
    share.textContent = "Copy link";
    status.textContent = "";
    if (updateHistory) {
      history.replaceState(null, "", photo.getAttribute("href"));
    }
    prefetch(current + 1);
    prefetch(current - 1);
    if (!dialog.open) {
      dialog.showModal();
      document.documentElement.classList.add("viewer-open");
      close.focus();
    }
  }

  photos.forEach((photo, index) => {
    photo.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      opener = photo;
      show(index);
    });
  });
  previous.addEventListener("click", () => show(current - 1));
  next.addEventListener("click", () => show(current + 1));
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("viewer-open");
    image.removeAttribute("src");
    video.pause();
    video.removeAttribute("src");
    video.load();
    const url = new URL(location.href);
    url.searchParams.delete("photo");
    history.replaceState(null, "", `${url.pathname}${url.search}`);
    opener?.focus();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.target === video) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      show(current + (event.key === "ArrowLeft" ? -1 : 1));
    }
  });
  image.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 1) {
        touchStart = [event.touches[0].clientX, event.touches[0].clientY];
      }
    },
    { passive: true },
  );
  image.addEventListener(
    "touchend",
    (event) => {
      if (touchStart && event.changedTouches.length === 1) {
        const dx = event.changedTouches[0].clientX - touchStart[0];
        const dy = event.changedTouches[0].clientY - touchStart[1];
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          show(current + (dx < 0 ? 1 : -1));
        }
      }
      touchStart = null;
    },
    { passive: true },
  );
  share.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      share.textContent = "Link copied";
      status.textContent = "Media link copied.";
    } catch {
      status.textContent =
        "Could not copy automatically. Copy the link from your address bar.";
      share.textContent = "Copy from address bar";
    }
  });
  image.addEventListener("error", () => {
    status.textContent =
      "This photo could not load. Try again or download the original.";
  });
  const selected = new URL(location.href).searchParams.get("photo");
  const index = photos.findIndex((photo) => photo.dataset.photoId === selected);
  if (index !== -1) show(index, false);
})();
