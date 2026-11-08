(() => {
  const dialog = document.querySelector("#viewer");
  if (!(dialog instanceof HTMLDialogElement)) return;
  const photos = [...document.querySelectorAll(".photo-link")];
  if (!photos.length) return;

  const image = document.querySelector("#viewer-image");
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

  function show(index, updateHistory = true) {
    current = Math.max(0, Math.min(photos.length - 1, index));
    const photo = photos[current];
    image.src = photo.dataset.viewer;
    image.alt = `Match photo ${current + 1} of ${photos.length}`;
    download.href = photo.dataset.download;
    position.textContent = `${current + 1} / ${photos.length}`;
    credit.replaceChildren(
      ...[...photo.parentElement.querySelector(".photo-rights").childNodes].map(
        (node) => node.cloneNode(true),
      ),
    );
    previous.disabled = current === 0;
    next.disabled = current === photos.length - 1;
    share.textContent = "Copy photo link";
    status.textContent = "";
    if (updateHistory) {
      history.replaceState(null, "", photo.getAttribute("href"));
    }
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
    const url = new URL(location.href);
    url.searchParams.delete("photo");
    history.replaceState(null, "", `${url.pathname}${url.search}`);
    opener?.focus();
  });
  dialog.addEventListener("keydown", (event) => {
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
      status.textContent = "Photo link copied.";
    } catch {
      status.textContent =
        "Could not copy automatically. Copy the photo link from your address bar.";
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
