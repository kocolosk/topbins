(() => {
  // Justified rows (see style.css) leave the last row at its base height, which
  // is shorter than the stretched rows above it. Size it to match the previous
  // row, shrinking only if it would not fit. CSSOM styles are CSP-safe.
  const grid = document.querySelector(".photo-grid");
  if (!grid) return;
  const figures = [...grid.children].filter((el) => el.tagName === "FIGURE");

  function balanceLastRow() {
    for (const figure of figures) {
      figure.style.removeProperty("flex");
      figure.style.removeProperty("width");
    }
    // One column on narrow screens: every figure is its own row.
    if (figures.length < 2 || matchMedia("(max-width: 42rem)").matches) return;
    const tops = figures.map((figure) => figure.offsetTop);
    const lastTop = Math.max(...tops);
    const last = figures.filter((_, i) => tops[i] === lastTop);
    const previous = figures.filter((_, i) => tops[i] < lastTop);
    const reference = previous.at(-1)?.querySelector("img");
    if (!reference || last.length === figures.length) return;
    const height = reference.getBoundingClientRect().height;
    const widths = last.map((figure) => {
      const img = figure.querySelector("img");
      return (
        (height * Number(img.getAttribute("width"))) /
        Number(img.getAttribute("height"))
      );
    });
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    const available = grid.clientWidth - gap * (last.length - 1);
    const scale = Math.min(1, available / widths.reduce((a, b) => a + b, 0));
    last.forEach((figure, i) => {
      figure.style.flex = "none";
      figure.style.width = `${widths[i] * scale}px`;
    });
  }

  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(balanceLastRow);
  };
  schedule();
  addEventListener("resize", schedule);
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
    credit.replaceChildren(
      ...[...photo.parentElement.querySelector(".photo-rights").childNodes].map(
        (node) => node.cloneNode(true),
      ),
    );
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
