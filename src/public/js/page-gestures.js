(() => {
  "use strict";
  const onMap = target => target instanceof Element && Boolean(target.closest(".leaflet-container, .maplibregl-map, .mapboxgl-map"));
  // Leaflet handles map pinches; prevent the browser from scaling the page.
  for (const type of ["gesturestart", "gesturechange"]) {
    document.addEventListener(type, event => event.preventDefault(), { passive: false });
  }
  for (const type of ["touchstart", "touchmove"]) {
    document.addEventListener(type, event => {
      if (event.touches.length > 1 && !onMap(event.target)) event.preventDefault();
    }, { passive: false });
  }
  document.addEventListener("wheel", event => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  }, { passive: false });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && ["+", "=", "-", "0"].includes(event.key)) event.preventDefault();
  });
  const style = document.createElement("style");
  style.textContent = "html,body{touch-action:pan-x pan-y}.leaflet-container{touch-action:none}.map-review-button{font:inherit;color:inherit;background:transparent;border:0;padding:8px 2px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}.map-review-button:focus-visible{outline:2px solid currentColor;outline-offset:2px}";
  document.head.append(style);
})();

// Pinch clue photos in place, keeping the surrounding game at its normal size.
(() => {
  const selector = ".daily-image-hint-body img";
  const prepared = new WeakSet();
  const style = document.createElement("style");
  style.textContent = ".clue-photo-viewport{overflow:hidden;touch-action:pan-y}.clue-photo-viewport img{transform-origin:center;user-select:none;-webkit-user-select:none;-webkit-user-drag:none}";
  document.head.append(style);
  function prepare() {
    document.querySelectorAll(selector).forEach(image => {
      if (prepared.has(image)) return;
      prepared.add(image);
      const viewport = document.createElement("div");
      viewport.className = "clue-photo-viewport";
      image.before(viewport);
      viewport.append(image);
      let scale = 1, x = 0, y = 0, previous = null;
      const render = () => {
        const maxX = image.offsetWidth * (scale - 1) / 2;
        const maxY = image.offsetHeight * (scale - 1) / 2;
        x = Math.max(-maxX, Math.min(maxX, x));
        y = Math.max(-maxY, Math.min(maxY, y));
        image.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
        viewport.style.touchAction = scale > 1 ? "none" : "pan-y";
      };
      const position = touches => {
        const first = touches[0], second = touches[1] || first;
        return {
          x: (first.clientX + second.clientX) / 2,
          y: (first.clientY + second.clientY) / 2,
          distance: touches.length > 1 ? Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY) : 0,
          count: touches.length,
        };
      };
      viewport.addEventListener("touchstart", event => {
        previous = position(event.touches);
        if (event.touches.length > 1 || scale > 1) event.preventDefault();
      }, { passive: false });
      viewport.addEventListener("touchmove", event => {
        const current = position(event.touches);
        if (event.touches.length > 1 || scale > 1) {
          event.preventDefault();
          if (previous && previous.count === current.count) {
            const nextScale = current.distance && previous.distance
              ? Math.max(1, Math.min(6, scale * current.distance / previous.distance)) : scale;
            const bounds = viewport.getBoundingClientRect();
            const anchorX = previous.x - bounds.left - bounds.width / 2;
            const anchorY = previous.y - bounds.top - bounds.height / 2;
            x = anchorX - (anchorX - x) * nextScale / scale + current.x - previous.x;
            y = anchorY - (anchorY - y) * nextScale / scale + current.y - previous.y;
            scale = nextScale;
            render();
          }
        }
        previous = current;
      }, { passive: false });
      const end = event => { previous = event.touches.length ? position(event.touches) : null; };
      viewport.addEventListener("touchend", end);
      viewport.addEventListener("touchcancel", end);
      image.addEventListener("load", () => { scale = 1; x = y = 0; render(); });
    });
  }
  new MutationObserver(prepare).observe(document.body, { childList: true, subtree: true });
  prepare();
})();
