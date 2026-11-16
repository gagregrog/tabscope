// Injected into the active page on each hotkey press. Toggles a full-viewport
// iframe holding palette.html, so the picker UI is isolated from page CSS/JS.
(() => {
  const ID = "tabscope-overlay-frame";
  const existing = document.getElementById(ID);
  if (existing) {
    existing.dispatchEvent(new Event("tabscope-close"));
    return;
  }

  const prevFocus = document.activeElement;
  const frame = document.createElement("iframe");
  frame.id = ID;
  frame.src = chrome.runtime.getURL("palette.html?mode=overlay");
  frame.setAttribute("allowtransparency", "true");
  frame.style.cssText = [
    "position: fixed !important",
    "inset: 0 !important",
    "width: 100vw !important",
    "height: 100vh !important",
    "max-width: none !important",
    "max-height: none !important",
    "margin: 0 !important",
    "padding: 0 !important",
    "border: 0 !important",
    "background: transparent !important",
    // Must match palette.css, or Chrome paints an opaque iframe backdrop.
    "color-scheme: light !important",
    "z-index: 2147483647 !important",
    "display: block !important",
  ].join(";");

  const onMessage = (e) => {
    if (e.source === frame.contentWindow && e.data?.tabscope === "close") close();
  };
  const onKeydown = (e) => {
    // Only reached if focus somehow stayed in the page.
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  function close() {
    removeEventListener("message", onMessage, true);
    removeEventListener("keydown", onKeydown, true);
    frame.remove();
    try {
      prevFocus?.focus?.({ preventScroll: true });
    } catch {}
  }

  addEventListener("message", onMessage, true);
  addEventListener("keydown", onKeydown, true);
  frame.addEventListener("tabscope-close", close);
  frame.addEventListener("load", () => frame.focus());
  document.documentElement.appendChild(frame);
})();
