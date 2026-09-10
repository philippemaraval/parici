// Only trusted, locally authored artwork is rendered. Stored avatar IDs remain unchanged.
export const AVATAR_ART = {"👤": "person", "🧑": "person", "👧": "girl", "🧒": "child", "⚓": "anchor", "🐟": "fish", "⛵": "boat", "🌊": "wave", "☀️": "sun", "👑": "crown", "⭐": "star", "⭐️": "star", "🌟": "spark", "🚀": "rocket", "🛸": "ufo", "👽": "alien", "🏛️": "monument", "🏙️": "city", "🗿": "moai", "🧭": "compass", "📅": "calendar", "🔥": "fire", "⚡": "bolt", "🏆": "cup", "🎯": "target", "💎": "diamond", "🎮": "game", "🛴": "scooter", "🍕": "pizza", "💪": "muscle", "🏖️": "beach", "😎": "glasses", "🦅": "bird", "⚽": "ball", "🫃": "recruit", "🧗‍♂️": "climber", "👴": "elder", "🥐": "croissant", "🔟": "25", "💯": "100"};
export function avatarMarkup(value) {
  const name = AVATAR_ART[String(value)] || "person";
  return `<img class="camino-avatar-art" src="/src/public/icons/${name}.svg" alt="" width="32" height="32">`;
}
const paths = {
 sound: '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
 soundOff: '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="m17 9 5 6m0-6-5 6"/>',
 haptics: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M11 17h2M4 7l-2 3 2 4-2 3m18-10 2 3-2 4 2 3"/>',
 hapticsOff: '<path d="M8 5V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v10m0 4v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9M3 3l18 18"/>',
 eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 eyeOff: '<path d="M3 3l18 18M9 5a12 12 0 0 1 13 7 18 18 0 0 1-3 4M6 6a18 18 0 0 0-4 6s4 7 10 7a13 13 0 0 0 5-1M10 10a3 3 0 0 0 4 4"/>',
 bell: '<path d="M5 16h14l-2-3V9a5 5 0 0 0-10 0v4ZM10 20h4M12 2v2"/>',
 bellCheck: '<path d="M5 16h9M10 20h4M5 16l2-3V9a5 5 0 0 1 10-4M12 2v2m3 8 3 3 4-5"/>',
 edit: '<path d="m5 16 11-11 3 3-11 11-4 1Zm9-9 3 3"/>',
 lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>'
};
export function iconMarkup(name) {
 return `<svg class="camino-ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.bell}</svg>`;
}
export function renderToggle(button, kind, enabled) {
 if (!button) return;
 button.innerHTML = iconMarkup(kind + (enabled ? "" : "Off"));
 button.setAttribute("aria-pressed", String(enabled));
 button.setAttribute("aria-label", kind === "sound" ? "Son" : "Vibrations");
 button.title = `${kind === "sound" ? "Son" : "Vibrations"} : ${enabled ? "activé" : "désactivé"}`;
}
export function renderPasswordToggle(button, visible) {
 button.innerHTML = iconMarkup(visible ? "eye" : "eyeOff");
 button.setAttribute("aria-label", visible ? "Masquer le mot de passe" : "Afficher le mot de passe");
 button.setAttribute("aria-pressed", String(visible));
}
