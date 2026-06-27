(function () {
  "use strict";

  const soundButton = document.querySelector(".site-header__control--sound");
  const hapticsButton = document.querySelector(".site-header__control--haptics");
  const visitorCounter = document.querySelector(".site-footer__visitors");
  const syncMeta = document.querySelector(".site-footer__sync");
  const soundKey = "camino-sound";
  const hapticsKey = "camino_haptics_enabled";
  const visitorIdKey = "camino_visitor_id";
  const visitSessionKey = "camino_visit_session";
  const visitorCountKey = "camino_visits_cache";
  const visitSessionTimeoutMs = 30 * 60 * 1000;
  const visitSessionHeartbeatMs = 60 * 1000;
  const apiOrigin =
    location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.protocol === "file:"
      ? "http://localhost:3000"
      : "https://parici.onrender.com";

  function render() {
    if (soundButton) soundButton.textContent = localStorage.getItem(soundKey) === "off" ? "🔇" : "🔊";
    if (hapticsButton) hapticsButton.textContent = localStorage.getItem(hapticsKey) === "false" ? "📴" : "📳";
  }

  soundButton?.addEventListener("click", () => {
    const enabled = localStorage.getItem(soundKey) !== "off";
    localStorage.setItem(soundKey, enabled ? "off" : "on");
    render();
  });

  hapticsButton?.addEventListener("click", () => {
    const enabled = localStorage.getItem(hapticsKey) !== "false";
    localStorage.setItem(hapticsKey, String(!enabled));
    if (!enabled && navigator.vibrate) navigator.vibrate(20);
    render();
  });

  function renderVisits(visits) {
    if (!visitorCounter || !Number.isFinite(visits) || visits < 0) return;
    visitorCounter.textContent = `Visites : ${new Intl.NumberFormat("fr-FR").format(Math.trunc(visits))}`;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function generateId() {
    return window.crypto?.randomUUID
      ? window.crypto.randomUUID().replaceAll("-", "")
      : `${Date.now()}${Math.random()}`.replace(".", "");
  }

  function isValidId(value) {
    return typeof value === "string" && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
  }

  function getOrCreateVisitId() {
    const now = Date.now();
    try {
      const stored = JSON.parse(localStorage.getItem(visitSessionKey) || "null");
      if (
        isValidId(stored?.id) &&
        Number.isFinite(stored.lastSeenAt) &&
        now - stored.lastSeenAt < visitSessionTimeoutMs
      ) {
        localStorage.setItem(visitSessionKey, JSON.stringify({ id: stored.id, lastSeenAt: now }));
        return stored.id;
      }
    } catch (error) {}

    const visitId = generateId();
    localStorage.setItem(visitSessionKey, JSON.stringify({ id: visitId, lastSeenAt: now }));
    return visitId;
  }

  function startVisitSessionHeartbeat(visitId) {
    const heartbeatId = window.setInterval(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(visitSessionKey) || "null");
        if (stored?.id !== visitId) {
          window.clearInterval(heartbeatId);
          return;
        }
        localStorage.setItem(visitSessionKey, JSON.stringify({ id: visitId, lastSeenAt: Date.now() }));
      } catch (error) {}
    }, visitSessionHeartbeatMs);
  }

  async function loadVisits() {
    if (!visitorCounter) return;
    const cached = Number(localStorage.getItem(visitorCountKey));
    if (Number.isFinite(cached) && cached >= 0) renderVisits(cached);

    let visitorId = localStorage.getItem(visitorIdKey);
    if (!isValidId(visitorId)) {
      visitorId = generateId();
      localStorage.setItem(visitorIdKey, visitorId);
    }
    const visitId = getOrCreateVisitId();
    startVisitSessionHeartbeat(visitId);

    try {
      const payload = await fetchJson(`${apiOrigin}/api/visitors/hit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, visitId }),
      });
      const visits = Number(payload.visits ?? payload.uniqueVisitors);
      if (Number.isFinite(visits)) {
        localStorage.setItem(visitorCountKey, String(Math.trunc(visits)));
        renderVisits(visits);
      }
    } catch (error) {
      // The cached count remains visible while offline.
    }
  }

  async function loadMapSync() {
    if (!syncMeta) return;
    try {
      const payload = await fetchJson(`${apiOrigin}/api/map-sync-meta`, { cache: "no-store" })
        .catch(() => fetchJson("/data/map_sync_meta.json", { cache: "no-store" }));
      const parsed = new Date(payload.lastSyncedAt);
      if (Number.isNaN(parsed.getTime())) throw new Error("Invalid sync date");
      const formatted = new Intl.DateTimeFormat("fr-FR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Europe/Paris",
      }).format(parsed);
      syncMeta.textContent = `Sync carte : ${formatted}`;
    } catch (error) {
      syncMeta.textContent = "Sync carte : inconnue";
    }
  }

  render();
  loadVisits();
  loadMapSync();
})();
