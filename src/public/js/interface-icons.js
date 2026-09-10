import { AVATAR_ART } from "/src/public/js/camino-art.js";

// Render legacy presentation strings without changing saved avatar IDs or player text.
const symbols = {
  "🗺️": ["map", "Carte"], "📍": ["pin", "Lieu"], "💡": ["bulb", "Indice"],
  "🖼️": ["photo", "Photo"], "🏘️": ["neighborhood", "Quartier"], "📏": ["ruler", "Longueur"],
  "🎉": ["celebrate", "Réussite"], "✅": ["check", "Réussi"], "❌": ["error", "Échec"],
  "⚠️": ["warning", "Attention"], "📋": ["copy", "Copier"], "📸": ["camera", "Photo"],
  "📤": ["share", "Partager"], "📊": ["chart", "Statistiques"], "🧳": ["suitcase", "Touriste"],
  "🔒": ["lock", "Verrouillé"], "✕": ["close", "Fermer"], "☝️": ["first", "Premier"],
  "🥇": ["medal-gold", "Première place"], "🥈": ["medal-silver", "Deuxième place"],
  "🥉": ["medal-bronze", "Troisième place"], "🧩": ["puzzle", "Mode de jeu"],
  "★": ["star", "Score"], "⬆️": ["arrow-north", "Nord"], "↗️": ["arrow-north-east", "Nord-est"],
  "➡️": ["arrow-east", "Est"], "↘️": ["arrow-south-east", "Sud-est"],
  "⬇️": ["arrow-south", "Sud"], "↙️": ["arrow-south-west", "Sud-ouest"],
  "⬅️": ["arrow-west", "Ouest"], "↖️": ["arrow-north-west", "Nord-ouest"],
};
for (const [emoji, name] of Object.entries(AVATAR_ART)) {
  symbols[emoji] ||= [name, "Récompense"];
}
for (const [emoji, definition] of Object.entries(symbols)) {
  symbols[emoji.replace(/\uFE0F/g, "")] = definition;
}
const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = new RegExp(Object.keys(symbols).sort((a, b) => b.length - a.length).map(escapePattern).join("|"), "gu");

// Deliberately limited to interface labels: usernames, form values and shared text stay literal.
const scope = [
  "button", "summary", "h1", "h2", "h3", "h4", ".panel-title", ".message", "#offline-banner",
  ".onboarding-emoji", ".daily-streak-flame", ".daily-hints", ".daily-result", ".daily-arrow",
  "#daily-tries-counter", ".user-avatar", ".users-table td:nth-child(4)", "#target-panel-title", "#target-panel-title-text", ".stats-subtitle",
  ".profile-stat-label", ".profile-mode-details", ".profile-mode-title", ".profile-rank-link",
  ".profile-daily-summary", ".profile-badge", ".avatar-item", ".leaderboard-zone-title",
  ".leaderboard-player-meta", ".leaderboard-table td:first-child", ".leaderboard-table td:nth-child(3)",
  ".leaderboard-table td:nth-child(2) > span[title]", ".explorer-leaderboard td:first-child",
  "#explorer-leaderboard tbody td:first-child", ".rank-node", ".overview-label", "#global-progress-line",
  "[data-camino-icons]",
].join(",");
const excluded = "script, style, textarea, input, select, option, pre, code, svg, .profile-name, .user-sticker-name, [contenteditable], [data-camino-user-content]";

export function decorateInterface(root = document.body) {
  if (!root) return;
  const replaceText = node => {
    const parent = node.parentElement;
    if (!parent || parent.closest(excluded) || !parent.closest(scope)) return;
    const text = node.nodeValue;
    const matches = [...text.matchAll(pattern)];
    if (!matches.length) return;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      fragment.append(document.createTextNode(text.slice(offset, match.index)));
      const [name, label] = symbols[match[0]];
      const icon = document.createElement("img");
      icon.className = "camino-inline-icon";
      icon.src = `/src/public/icons/${name}.svg`;
      icon.width = 20;
      icon.height = 20;
      icon.alt = label;
      icon.draggable = false;
      fragment.append(icon);
      offset = match.index + match[0].length;
      // Some persisted direction strings contain an extra emoji presentation selector.
      if (text[offset] === "\uFE0F") offset++;
    }
    fragment.append(document.createTextNode(text.slice(offset)));
    node.replaceWith(fragment);
  };
  if (root.nodeType === Node.TEXT_NODE) { replaceText(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE || root.matches(excluded)) return;
  if (!root.closest(scope) && !root.querySelector(scope)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  texts.forEach(replaceText);
  const labels = [root, ...root.querySelectorAll("[title], [aria-label]")];
  for (const element of labels) {
    if (!element.closest(scope) || element.closest(excluded)) continue;
    for (const attr of ["title", "aria-label"]) {
      const value = element.getAttribute(attr);
      if (value) {
        const plain = value.replace(pattern, symbol => symbols[symbol][1]).replace(/\uFE0F/g, "");
        if (plain !== value) element.setAttribute(attr, plain);
      }
    }
  }
}

if (typeof document !== "undefined") {
  decorateInterface();
  const observer = new MutationObserver(records => {
    const changed = new Set();
    for (const record of records) {
      if (record.type === "childList") record.addedNodes.forEach(node => changed.add(node));
      else changed.add(record.target);
    }
    for (const node of changed) if (node.isConnected) decorateInterface(node);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ["title", "aria-label"] });
}
