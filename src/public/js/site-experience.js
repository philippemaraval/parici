const numericSelector = [
  "#score",
  "#weighted-score",
  "[data-daily-streak-count]",
  "#daily-tries-counter",
  "#explorer-score",
  "#explorer-final-score",
  "#explorer-solved",
  "#explorer-total",
  ".profile-stat-value",
  ".profile-kpi-value",
  "#collect-progress",
  "#collect-quota",
  "[data-result-count]",
].join(",");
const surfaceSelector = [
  ".mobile-home__modes",
  ".site-mode-intro",
  ".profile-daily-summary",
  "#profile-panel",
  "#daily-result-panel",
  "#collect-result-progress",
  "#explorer-start",
  "#explorer-riddle",
  "#explorer-explanation",
  "#explorer-complete",
].join(",");
const cardSelector =
  ".mobile-mode-card, .profile-badge, #explorer-album > img, .collect-card-dialog .collect-card, #collect-revealed-card .collect-card, .daily-card-reward .collect-card";
let numbers;
let motion;
let pending = false;
const numericRoots = new Set();
const surfaces = new Set();
const cards = new Set();

function collect(root, selector, set) {
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  if (root.matches(selector)) set.add(root);
  root.querySelectorAll(selector).forEach((element) => set.add(element));
}

function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(flush);
}

async function flush() {
  pending = false;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const visibleNumbers = [...numericRoots].filter(
    (element) => element.isConnected && element.getClientRects().length,
  );
  const visibleSurfaces = [...surfaces].filter(
    (element) => element.isConnected && element.getClientRects().length,
  );
  const visibleCards = [...cards].filter(
    (element) => element.isConnected && element.getClientRects().length,
  );
  // Native content and controls work before (and without) these optional chunks.
  if (!reduce && visibleNumbers.length) {
    numbers ||= import("./experience-numbers.js").catch(() => null);
    const library = await numbers;
    visibleNumbers.forEach((element) => {
      numericRoots.delete(element);
      if (element.isConnected) library?.enhanceNumber(element);
    });
  }
  if (!reduce && (visibleSurfaces.length || visibleCards.length)) {
    motion ||= import("./experience-motion.js").catch(() => null);
    const library = await motion;
    visibleSurfaces.forEach((element) => {
      surfaces.delete(element);
      if (element.isConnected) library?.revealSurface(element);
    });
    visibleCards.forEach((element) => {
      cards.delete(element);
      if (element.isConnected) library?.attachCardLight(element);
    });
  }
  for (const set of [numericRoots, surfaces, cards]) {
    for (const element of set) if (!element.isConnected) set.delete(element);
  }
}

function discover(root) {
  collect(root, numericSelector, numericRoots);
  collect(root, surfaceSelector, surfaces);
  collect(root, cardSelector, cards);
}

function updateNavigation() {
  const view = document.documentElement.dataset.mobileView;
  const current =
    location.pathname === "/" || location.pathname.endsWith("/index.html")
      ? view || "home"
      : location.pathname.split("/").pop()?.replace(".html", "");
  document.documentElement.dataset.experienceMode = current;
  document.querySelectorAll(".site-nav > a").forEach((link) => {
    const url = new URL(link.href);
    const destination =
      url.pathname === "/"
        ? url.searchParams.get("view") || "home"
        : url.pathname.split("/").pop()?.replace(".html", "");
    if (destination === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

discover(document.body);
updateNavigation();
new MutationObserver((records) => {
  let changed = false;
  for (const record of records) {
    const element =
      record.target.nodeType === Node.ELEMENT_NODE
        ? record.target
        : record.target.parentElement;
    if (!element || element.closest(".experience-number, .leaflet-container"))
      continue;
    if (record.type === "attributes") {
      // Visibility changes can reveal descendants collected while hidden.
      if (
        element.matches(
          `${surfaceSelector}, .panel, .collect-panel, #user-panel-details`,
        ) ||
        element === document.body
      )
        changed = true;
      continue;
    }
    const numeric = element.closest(numericSelector);
    if (numeric) {
      numericRoots.add(numeric);
      changed = true;
    }
    for (const node of record.addedNodes) {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        !node.matches(".experience-number")
      ) {
        discover(node);
        changed = true;
      }
    }
  }
  if (changed) schedule();
}).observe(document.body, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["class", "hidden"],
});
new MutationObserver(() => {
  updateNavigation();
  discover(document.body);
  schedule();
}).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-mobile-view"],
});
matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
  "change",
  schedule,
);
document.addEventListener("toggle", schedule, true);
document.documentElement.dataset.experienceReady = "true";
schedule();
