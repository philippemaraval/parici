import {
  API_URL,
  CHRONO_DURATION,
  HIGHLIGHT_DURATION_MS,
  MAX_ERRORS_MARATHON,
  MAX_LECTURE_SEARCH_RESULTS,
  MAX_TIME_SECONDS,
  SESSION_SIZE,
  UI_THEME,
} from "./config.js";
import {
  AVATAR_UNLOCKS,
  GAME_LABELS,
  TITLE_NAMES,
  ZONE_LABELS,
  getGlobalRankLevelForTitleIndex,
  getGlobalRankMeta,
  hasReachedGlobalRank,
  hasReachedVilleRank,
  getPlayerTitle,
  getTitleThresholds,
  loadAllLeaderboards,
  loadLeaderboard,
} from "./leaderboard.js";
import {
  initAvatarSelectorRuntime,
  loadProfileRuntime,
  renderAvatarGridRuntime,
  renderUserStickerRuntime,
  sendScoreToServerRuntime,
  updateUserUIRuntime,
} from "./profile-runtime.js";
import {
  calculateStreetLengthFromFeatures,
  computeFeatureCentroid,
  getDistanceMeters,
  getDistanceToFeature,
} from "./map.js";
import {
  buildUniqueStreetList as buildUniqueStreetListCore,
  createArrondissementByArrondissementMap,
  getBaseStreetStyle as getBaseStreetStyleCore,
  getBaseStreetStyleFromName as getBaseStreetStyleFromNameCore,
  getCurrentZoneStreets as getCurrentZoneStreetsCore,
  highlightArrondissementOnMap,
  isStreetVisibleInCurrentMode as isStreetVisibleInCurrentModeCore,
  normalizeArrondissementKey,
  populateArrondissementsUI,
  clearArrondissementOverlayLayer,
} from "./map-session-core.js";
import {
  addTouchBufferForLayerRuntime,
  loadMonumentsRuntime,
  loadArrondissementsRuntime,
  loadStreetsRuntime,
  setLectureTooltipsEnabledRuntime,
} from "./map-runtime.js";
import {
  playBuzz,
  playDing,
  playTick,
  playVictory,
  syncSoundToggleUI,
  toggleSound,
} from "./audio.js";
import { initOnboardingBanner, loadUniqueVisitorCounter } from "./onboarding.js";
import { initInstallPrompt } from "./install-prompt.js";
import { toggleHaptics, triggerHaptic, updateHapticsUI } from "./haptics.js";
import {
  formatDailyDistanceForShare,
  getDailyGuessesStorageKey,
  getDailyMetaStorageKey,
  getDailyShareDateLabelFromDate as getDailyShareDateLabel,
  getDirectionArrow,
  getTodayDailyStorageDate,
} from "./daily.js";
import {
  buildSessionShareText,
  copySessionShareText,
  shareSessionShareText,
} from "./session-share.js";
import {
  cleanOldDailyGuessStorageRuntime,
  fitTargetStreetTextRuntime,
  handleDailyShareImageRuntime,
  handleDailyShareTextRuntime,
  highlightDailyTargetRuntime,
  removeDailyHighlightRuntime,
  renderDailyGuessHistoryRuntime,
  restoreDailyGuessesFromStorageRuntime,
  restoreDailyMetaFromStorageRuntime,
  saveDailyGuessesToStorageRuntime,
  saveDailyMetaToStorageRuntime,
  updateDailyResultPanelRuntime,
  updateDailyUIRuntime,
} from "./daily-runtime.js";
import { clearCurrentUserFromStorage, loadCurrentUserFromStorage, saveCurrentUserToStorage } from "./auth.js";
import { computeItemPoints, sampleWithoutReplacement, shuffle } from "./session.js";

let FAMOUS_STREET_INFOS = {};
let MAIN_STREET_INFOS = {};
let FAMOUS_STREET_NAMES_RUNTIME = new Set(
  typeof FAMOUS_STREET_NAMES !== "undefined" ? Array.from(FAMOUS_STREET_NAMES) : [],
);
let MAIN_STREET_NAMES_RUNTIME = new Set(
  typeof MAIN_STREET_NAMES !== "undefined" ? Array.from(MAIN_STREET_NAMES) : [],
);
let MONUMENT_NAMES_RUNTIME = new Set();
let MONUMENT_FEATURES_RUNTIME = null;
const DEFAULT_REMINDER_CONFIG = {
  hour: 10,
  minute: 0,
  timezone: "Europe/Paris",
};
const MAP_REGION_MAX_BOUNDS = [
  [48.805, 2.215], // SW: Paris et petite marge intra-muros
  [48.91, 2.47], // NE: Paris et bois limitrophes
];
let swRegistrationPromise = null;
let notificationConfigCache = null;
let backendWarmupPromise = null;
let runtimeContentLoadPromise = null;

function scheduleAfterStartup(callback, delayMs = 0) {
  const run = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(callback, { timeout: 2500 });
      return;
    }
    setTimeout(callback, 0);
  };

  requestAnimationFrame(() => {
    setTimeout(run, delayMs);
  });
}

function normalizeStreetInfoMapPayload(entries) {
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return null;
  }
  const normalized = {};
  Object.entries(entries).forEach(([rawName, rawInfo]) => {
    const streetName = normalizeName(rawName);
    if (!streetName || typeof rawInfo !== "string") {
      return;
    }
    const infoText = rawInfo.trim();
    if (!infoText) {
      return;
    }
    normalized[streetName] = infoText;
  });
  return normalized;
}

function normalizeNameListPayload(entries) {
  if (!Array.isArray(entries)) {
    return null;
  }
  const normalized = [];
  const seen = new Set();
  entries.forEach((value) => {
    const normalizedValue = normalizeName(value);
    if (!normalizedValue || seen.has(normalizedValue)) {
      return;
    }
    seen.add(normalizedValue);
    normalized.push(normalizedValue);
  });
  return normalized;
}

function normalizeMonumentsPayload(entries) {
  if (!Array.isArray(entries)) {
    return null;
  }

  const normalized = [];
  const seen = new Set();
  entries.forEach((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }

    const name = String(entry.name || "").trim();
    const normalizedName = normalizeName(name);
    if (!normalizedName || seen.has(normalizedName)) {
      return;
    }

    const longitude = Number(
      entry.longitude ??
      entry.lng ??
      (Array.isArray(entry.coordinates) ? entry.coordinates[0] : Number.NaN),
    );
    const latitude = Number(
      entry.latitude ??
      entry.lat ??
      (Array.isArray(entry.coordinates) ? entry.coordinates[1] : Number.NaN),
    );
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return;
    }
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      return;
    }

    seen.add(normalizedName);
    normalized.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      properties: {
        name,
      },
    });
  });

  return normalized;
}

function applyPublicContentPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  const famousInfos = normalizeStreetInfoMapPayload(payload?.streetInfos?.famous);
  if (famousInfos) {
    FAMOUS_STREET_INFOS = famousInfos;
  }

  const mainInfos = normalizeStreetInfoMapPayload(payload?.streetInfos?.main);
  if (mainInfos) {
    MAIN_STREET_INFOS = mainInfos;
  }

  const famousList = normalizeNameListPayload(payload?.lists?.famousStreets);
  if (famousList) {
    FAMOUS_STREET_NAMES_RUNTIME = new Set(famousList);
  }

  const mainList = normalizeNameListPayload(payload?.lists?.mainStreets);
  if (mainList) {
    MAIN_STREET_NAMES_RUNTIME = new Set(mainList);
  }

  const monumentsList = normalizeNameListPayload(payload?.lists?.monuments);
  if (monumentsList) {
    MONUMENT_NAMES_RUNTIME = new Set(monumentsList);
  }

  const monuments = normalizeMonumentsPayload(payload?.monuments);
  if (monuments) {
    MONUMENT_FEATURES_RUNTIME = monuments;
  }
}

async function loadStreetInfosFromStaticFile() {
  try {
    const response = await fetch("data/street_infos.json");
    const data = await response.json();
    const normalizedFamousInfos = normalizeStreetInfoMapPayload(data?.famous);
    const normalizedMainInfos = normalizeStreetInfoMapPayload(data?.main);
    FAMOUS_STREET_INFOS = normalizedFamousInfos || {};
    MAIN_STREET_INFOS = normalizedMainInfos || {};
    console.log("Street infos loaded from static file");
  } catch (error) {
    console.error("Failed to load local street infos", error);
  }
}

async function loadPublicContentFromApi() {
  const response = await fetch(`${API_URL}/api/content/public`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  applyPublicContentPayload(payload);
  return payload;
}

function applyRuntimeContentRefresh() {
  const modeSelect = document.getElementById("mode-select");
  if (!modeSelect) {
    return;
  }
  modeSelect.dispatchEvent(new Event("change"));
  refreshLectureStreetSearchForCurrentMode({ preserveQuery: !0 });
  refreshLectureTooltipsIfNeeded();
}

function warmBackendConnection() {
  if (backendWarmupPromise) {
    return backendWarmupPromise;
  }

  backendWarmupPromise = fetch(`${API_URL}/api/health?prewarm=1`, {
    cache: "no-store",
  })
    .then((response) => response.ok)
    .catch(() => !1)
    .finally(() => {
      backendWarmupPromise = null;
    });

  return backendWarmupPromise;
}

function checkBackendAvailability() {
  return fetch(`${API_URL}/api/health`, {
    method: "HEAD",
    cache: "no-store",
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response;
  });
}

function loadStreetInfos() {
  if (runtimeContentLoadPromise) {
    return runtimeContentLoadPromise;
  }

  runtimeContentLoadPromise = loadStreetInfosFromStaticFile()
    .then(async () => {
      try {
        await loadPublicContentFromApi();
        applyRuntimeContentRefresh();
        console.log("Runtime content loaded from API");
      } catch (error) {
        console.warn("Runtime content API unavailable, fallback to static content.", error);
      }
    })
    .finally(() => {
      runtimeContentLoadPromise = null;
    });

  return runtimeContentLoadPromise;
}
function normalizeName(e) {
  return String(e || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`´]/g, "'")
    .replace(/[-‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ");
}
function normalizeSearchText(e) {
  return normalizeName(e).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function normalizeChallengeNameKey(e) {
  return normalizeSearchText(e)
    .replace(/[’`´]/g, "'")
    .replace(/[-‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function formatFriendChallengeSerial(serialNumber) {
  const parsed = Number.parseInt(serialNumber, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return "";
  }
  return `#${String(parsed).padStart(5, "0")}`;
}

function normalizeFriendChallengeCreator(rawCreator) {
  if (!rawCreator || typeof rawCreator !== "object") {
    return null;
  }
  const rawUserId = Number.parseInt(rawCreator.userId, 10);
  const userId = Number.isInteger(rawUserId) && rawUserId > 0 ? rawUserId : null;
  const username = typeof rawCreator.username === "string" ? rawCreator.username.trim() : "";
  if (!userId && !username) {
    return null;
  }
  return { userId, username };
}

function getFriendChallengeCreatorLabel(challenge) {
  const username = String(challenge?.createdBy?.username || "").trim();
  return username ? `@${username}` : "";
}

function toPushServerKeyUint8Array(base64String) {
  const normalized = String(base64String || "").trim();
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const base64 = (normalized + padding).replace(/-/g, "+").replace(/_/g, "/");
  const decoded = window.atob(base64);
  const output = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) {
    output[i] = decoded.charCodeAt(i);
  }
  return output;
}

function isPushReminderSupported() {
  return (
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function isIOSMobileDevice() {
  const ua = window.navigator.userAgent || "";
  const platform = window.navigator.platform || "";
  const iPhoneOrIPad = /iPad|iPhone|iPod/i.test(ua);
  const ipadOnDesktop = platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  return iPhoneOrIPad || ipadOnDesktop;
}

function requiresInstalledAppForMobilePush() {
  return isIOSMobileDevice() && !isStandaloneDisplayMode();
}

function formatReminderTimeLabel(reminder = DEFAULT_REMINDER_CONFIG) {
  const hour = Number.isInteger(reminder?.hour) ? reminder.hour : DEFAULT_REMINDER_CONFIG.hour;
  const minute = Number.isInteger(reminder?.minute) ? reminder.minute : DEFAULT_REMINDER_CONFIG.minute;
  const timezone = reminder?.timezone || DEFAULT_REMINDER_CONFIG.timezone;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (${timezone})`;
}

function getDailyReminderElements() {
  return {
    statusEl: document.getElementById("daily-reminder-status"),
    enableBtn: document.getElementById("daily-reminder-enable-btn"),
    disableBtn: document.getElementById("daily-reminder-disable-btn"),
  };
}

function setDailyReminderStatus(message, type = "neutral") {
  const { statusEl } = getDailyReminderElements();
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.classList.remove("is-error", "is-success");
  if (type === "error") {
    statusEl.classList.add("is-error");
  } else if (type === "success") {
    statusEl.classList.add("is-success");
  }
}

function setDailyReminderButtons({
  canEnable = false,
  canDisable = false,
  loading = false,
} = {}) {
  const { enableBtn, disableBtn } = getDailyReminderElements();
  if (!enableBtn || !disableBtn) {
    return;
  }
  enableBtn.classList.toggle("hidden", !canEnable);
  disableBtn.classList.toggle("hidden", !canDisable);
  enableBtn.disabled = loading;
  disableBtn.disabled = loading;
}

function isAuthStatus(status) {
  return status === 401 || status === 403;
}

async function buildApiError(response, fallbackMessage) {
  let message = fallbackMessage;
  try {
    const payload = await response.json();
    if (payload && typeof payload.error === "string" && payload.error.trim()) {
      message = payload.error.trim();
    }
  } catch (error) {
    // Keep fallback message when body is not JSON.
  }
  const err = new Error(message);
  err.status = response.status;
  return err;
}

function getReminderErrorMessage(error, fallback) {
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

function handleReminderAuthError() {
  setDailyReminderStatus("Session expirée. Reconnectez-vous pour gérer les rappels.", "error");
  setDailyReminderButtons({
    canEnable: false,
    canDisable: false,
    loading: false,
  });
}

async function ensureServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        console.log("SW registered:", registration.scope);
        registration.update().catch(() => { });
        return registration;
      })
      .catch((error) => {
        swRegistrationPromise = null;
        console.warn("SW registration failed:", error);
        return null;
      });
  }

  return swRegistrationPromise;
}

async function getNotificationConfig(forceReload = false) {
  if (!forceReload && notificationConfigCache) {
    return notificationConfigCache;
  }

  const response = await fetch(`${API_URL}/api/notifications/public-key`);
  if (!response.ok) {
    throw await buildApiError(response, `HTTP ${response.status}`);
  }

  const payload = await response.json();
  notificationConfigCache = payload;
  return payload;
}

async function fetchNotificationStatus() {
  if (!(currentUser && currentUser.token)) {
    return null;
  }

  const response = await fetch(`${API_URL}/api/notifications/status`, {
    headers: {
      Authorization: `Bearer ${currentUser.token}`,
    },
  });

  if (!response.ok) {
    throw await buildApiError(response, `HTTP ${response.status}`);
  }

  return response.json();
}

async function refreshDailyReminderControls() {
  const { statusEl, enableBtn, disableBtn } = getDailyReminderElements();
  if (!statusEl || !enableBtn || !disableBtn) {
    return;
  }

  setDailyReminderStatus("Chargement…");
  setDailyReminderButtons({ loading: true });

  if (!(currentUser && currentUser.token)) {
    setDailyReminderStatus("Connectez-vous pour gérer le rappel Daily.", "error");
    setDailyReminderButtons({ canEnable: false, canDisable: false, loading: false });
    return;
  }

  if (requiresInstalledAppForMobilePush()) {
    setDailyReminderStatus(
      "Sur iPhone/iPad, installe Parici via “Ajouter à l’écran d’accueil” pour activer les notifications.",
      "error",
    );
    setDailyReminderButtons({ canEnable: false, canDisable: false, loading: false });
    return;
  }

  if (!isPushReminderSupported()) {
    setDailyReminderStatus("Notifications push non disponibles sur ce navigateur.", "error");
    setDailyReminderButtons({ canEnable: false, canDisable: false, loading: false });
    return;
  }

  let config;
  try {
    config = await getNotificationConfig();
  } catch (error) {
    setDailyReminderStatus(
      `Impossible de charger la config des notifications: ${getReminderErrorMessage(error, "erreur serveur")}.`,
      "error",
    );
    setDailyReminderButtons({ canEnable: false, canDisable: false, loading: false });
    return;
  }

  if (!config?.enabled || !config?.publicKey) {
    setDailyReminderStatus("Rappels indisponibles: configuration serveur manquante.", "error");
    setDailyReminderButtons({ canEnable: false, canDisable: false, loading: false });
    return;
  }

  let registration;
  try {
    registration = await ensureServiceWorkerRegistration();
  } catch (error) {
    registration = null;
  }

  if (!registration) {
    setDailyReminderStatus("Service worker indisponible. Rechargez la page.", "error");
    setDailyReminderButtons({ canEnable: false, canDisable: false, loading: false });
    return;
  }

  try {
    const [serverStatus, browserSubscription] = await Promise.all([
      fetchNotificationStatus(),
      registration.pushManager.getSubscription(),
    ]);

    const serverSubscribed = Boolean(serverStatus?.subscribed);
    const serverEndpoint = typeof serverStatus?.endpoint === "string" ? serverStatus.endpoint : "";
    const browserEndpoint = typeof browserSubscription?.endpoint === "string" ? browserSubscription.endpoint : "";
    const isSubscribed = Boolean(serverSubscribed && browserEndpoint && browserEndpoint === serverEndpoint);
    if (isSubscribed) {
      setDailyReminderStatus("Rappel quotidien actif.", "success");
      setDailyReminderButtons({ canEnable: false, canDisable: true, loading: false });
    } else if (serverSubscribed) {
      setDailyReminderStatus(
        "Rappel actif sur un autre appareil/navigateur. Active-le ici.",
      );
      setDailyReminderButtons({ canEnable: true, canDisable: false, loading: false });
    } else {
      setDailyReminderStatus("Rappel inactif. Active-le.");
      setDailyReminderButtons({ canEnable: true, canDisable: false, loading: false });
    }
  } catch (error) {
    if (isAuthStatus(error?.status)) {
      handleReminderAuthError();
      return;
    }
    setDailyReminderStatus(
      `Impossible de lire le statut du rappel: ${getReminderErrorMessage(error, "erreur serveur")}.`,
      "error",
    );
    setDailyReminderButtons({ canEnable: true, canDisable: false, loading: false });
  }
}

async function enableDailyReminder() {
  if (!(currentUser && currentUser.token)) {
    showMessage("Connectez-vous pour activer le rappel Daily.", "warning");
    return;
  }

  if (!isPushReminderSupported()) {
    showMessage("Notifications push non disponibles sur ce navigateur.", "error");
    return;
  }

  if (requiresInstalledAppForMobilePush()) {
    setDailyReminderStatus(
      "Installe Parici sur l’écran d’accueil pour activer les notifications sur iPhone/iPad.",
      "error",
    );
    setDailyReminderButtons({ canEnable: false, canDisable: false, loading: false });
    showMessage(
      "Sur iPhone/iPad, les notifications push nécessitent la version installée (Ajouter à l’écran d’accueil).",
      "warning",
    );
    return;
  }

  setDailyReminderButtons({ loading: true });

  try {
    const config = await getNotificationConfig();
    if (!config?.enabled || !config?.publicKey) {
      throw new Error("Push disabled on server");
    }

    const permission =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();

    if (permission !== "granted") {
      setDailyReminderStatus("Autorisation de notification refusée.", "error");
      setDailyReminderButtons({ canEnable: true, canDisable: false, loading: false });
      return;
    }

    const registration = await ensureServiceWorkerRegistration();
    if (!registration) {
      throw new Error("Missing service worker registration");
    }

    let subscription = await registration.pushManager.getSubscription();

    // Recycle stale subscription when VAPID keys have changed (e.g. after server redeploy).
    if (subscription) {
      try {
        const existingKeyBuffer = subscription.options?.applicationServerKey;
        const expectedKey = toPushServerKeyUint8Array(config.publicKey);
        let keyMismatch = false;

        if (existingKeyBuffer) {
          const existingKey = new Uint8Array(existingKeyBuffer);
          if (existingKey.length !== expectedKey.length) {
            keyMismatch = true;
          } else {
            for (let i = 0; i < existingKey.length; i += 1) {
              if (existingKey[i] !== expectedKey[i]) {
                keyMismatch = true;
                break;
              }
            }
          }
        } else {
          // Cannot verify key — treat as stale to be safe.
          keyMismatch = true;
        }

        if (keyMismatch) {
          console.warn("Push subscription VAPID key mismatch — recycling subscription.");
          await subscription.unsubscribe().catch(() => { });
          subscription = null;
        }
      } catch (keyCheckError) {
        console.warn("Push subscription key check failed — recycling subscription.", keyCheckError);
        await subscription.unsubscribe().catch(() => { });
        subscription = null;
      }
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: toPushServerKeyUint8Array(config.publicKey),
      });
    }

    const response = await fetch(`${API_URL}/api/notifications/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentUser.token}`,
      },
      body: JSON.stringify({ subscription }),
    });

    if (!response.ok) {
      throw await buildApiError(response, `HTTP ${response.status}`);
    }

    const scheduleLabel = formatReminderTimeLabel(config.reminder || DEFAULT_REMINDER_CONFIG);
    showMessage(`Rappel Daily activé pour ${scheduleLabel}.`, "success");
  } catch (error) {
    console.warn("Enable daily reminder failed:", error);
    if (isAuthStatus(error?.status)) {
      handleReminderAuthError();
      showMessage("Session expirée. Reconnectez-vous puis réessayez.", "warning");
    } else {
      showMessage(`Impossible d'activer le rappel Daily: ${getReminderErrorMessage(error, "erreur serveur")}.`, "error");
    }
  }

  await refreshDailyReminderControls();
}

async function disableDailyReminder() {
  if (!(currentUser && currentUser.token)) {
    return;
  }

  setDailyReminderButtons({ loading: true });

  try {
    const registration = await ensureServiceWorkerRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;

    await fetch(`${API_URL}/api/notifications/unsubscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentUser.token}`,
      },
      body: JSON.stringify({
        endpoint: subscription?.endpoint || "",
      }),
    }).then(async (response) => {
      if (!response.ok) {
        throw await buildApiError(response, `HTTP ${response.status}`);
      }
    });

    if (subscription) {
      await subscription.unsubscribe().catch(() => { });
    }

    showMessage("Rappel Daily désactivé.", "info");
  } catch (error) {
    console.warn("Disable daily reminder failed:", error);
    if (isAuthStatus(error?.status)) {
      handleReminderAuthError();
      showMessage("Session expirée. Reconnectez-vous puis réessayez.", "warning");
    } else {
      showMessage(`Impossible de désactiver le rappel Daily: ${getReminderErrorMessage(error, "erreur serveur")}.`, "error");
    }
  }

  await refreshDailyReminderControls();
}

function initDailyReminderControls() {
  const { enableBtn, disableBtn } = getDailyReminderElements();
  if (!enableBtn || !disableBtn) {
    return;
  }

  enableBtn.onclick = () => {
    enableDailyReminder().catch((error) => {
      console.warn("Enable reminder handler failed:", error);
    });
  };

  disableBtn.onclick = () => {
    disableDailyReminder().catch((error) => {
      console.warn("Disable reminder handler failed:", error);
    });
  };

  refreshDailyReminderControls().catch((error) => {
    console.warn("Refresh reminder controls failed:", error);
  });
}
let tooltipPopupEl = null,
  tooltipPopupTarget = null,
  tooltipHideTimeoutId = null;
function prefersTouchTooltips() {
  return !!(
    window.matchMedia &&
    window.matchMedia("(hover: none), (pointer: coarse)").matches
  );
}
function getTooltipTextFromTarget(e) {
  if (!e || "function" != typeof e.getAttribute) return "";
  const t = e.getAttribute("data-tooltip");
  return "string" == typeof t ? t.trim() : "";
}
function clearTooltipAutoHide() {
  tooltipHideTimeoutId &&
    (clearTimeout(tooltipHideTimeoutId), (tooltipHideTimeoutId = null));
}
function positionTooltipPopup(e) {
  if (!tooltipPopupEl || !e) return;
  const t = 8;
  tooltipPopupEl.style.maxWidth = `${Math.max(180, Math.min(280, window.innerWidth - 2 * t))}px`;
  const r = e.getBoundingClientRect();
  tooltipPopupEl.style.left = `${t}px`;
  tooltipPopupEl.style.top = `${t}px`;
  const a = tooltipPopupEl.getBoundingClientRect();
  let n = r.left + r.width / 2 - a.width / 2;
  n = Math.max(t, Math.min(n, window.innerWidth - a.width - t));
  let s = r.top - a.height - t;
  s < t && (s = r.bottom + t);
  const i = window.innerHeight - a.height - t;
  i < t ? (s = t) : s > i && (s = i);
  ((tooltipPopupEl.style.left = `${Math.round(n)}px`),
    (tooltipPopupEl.style.top = `${Math.round(s)}px`));
}
function showTooltipPopup(e) {
  if (!tooltipPopupEl || !e) return;
  const t = getTooltipTextFromTarget(e);
  if (!t) return;
  clearTooltipAutoHide(),
    (tooltipPopupTarget = e),
    (tooltipPopupEl.textContent = t),
    tooltipPopupEl.classList.add("visible"),
    positionTooltipPopup(e);
}
function hideTooltipPopup() {
  clearTooltipAutoHide(),
    tooltipPopupEl && tooltipPopupEl.classList.remove("visible"),
    (tooltipPopupTarget = null);
}
function scheduleTooltipAutoHide() {
  clearTooltipAutoHide(),
    (tooltipHideTimeoutId = setTimeout(() => {
      hideTooltipPopup();
    }, 2600));
}
function shouldShowTapTooltip(e) {
  return !!(
    e &&
    (e.classList.contains("tooltip-icon") ||
      e.classList.contains("profile-badge") ||
      (e.classList.contains("avatar-item") && e.classList.contains("locked")))
  );
}
function initTooltipPopup() {
  if (tooltipPopupEl) return;
  ((tooltipPopupEl = document.createElement("div")),
    (tooltipPopupEl.className = "tooltip-popup"),
    document.body.appendChild(tooltipPopupEl),
    document.addEventListener("mouseover", (e) => {
      if (prefersTouchTooltips()) return;
      const t = e.target.closest("[data-tooltip]");
      t && showTooltipPopup(t);
    }),
    document.addEventListener("mouseout", (e) => {
      if (prefersTouchTooltips()) return;
      const t = e.target.closest("[data-tooltip]");
      if (!t || t !== tooltipPopupTarget) return;
      const r = e.relatedTarget;
      (!r || !t.contains(r)) && hideTooltipPopup();
    }),
    document.addEventListener("focusin", (e) => {
      const t = e.target.closest("[data-tooltip]");
      t && showTooltipPopup(t);
    }),
    document.addEventListener("focusout", (e) => {
      const t = e.target.closest("[data-tooltip]");
      t && t === tooltipPopupTarget && hideTooltipPopup();
    }),
    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-tooltip]");
      if (!t) return void (tooltipPopupTarget && hideTooltipPopup());
      if (!prefersTouchTooltips() || !shouldShowTapTooltip(t)) return;
      tooltipPopupTarget === t && tooltipPopupEl.classList.contains("visible")
        ? hideTooltipPopup()
        : (showTooltipPopup(t), scheduleTooltipAutoHide());
    }),
    window.addEventListener("scroll", () => {
      tooltipPopupTarget && positionTooltipPopup(tooltipPopupTarget);
    }, !0),
    window.addEventListener("resize", () => {
      tooltipPopupTarget && positionTooltipPopup(tooltipPopupTarget);
    }));
}
let map = null,
  currentZoneMode = "ville",
  streetsLayer = null,
  allStreetFeatures = [],
  streetLayersById = new Map(),
  streetLayersByName = new Map(),
  arrondissementsLayer = null,
  allArrondissementFeatures = [],
  arrondissementLayersByKey = new Map(),
  monumentsLayer = null,
  allMonuments = [],
  sessionMonuments = [],
  currentMonumentIndex = 0,
  currentMonumentTarget = null,
  isMonumentsMode = !1,
  arrondissementPolygonsByName = new Map(),
  arrondissementOverlay = null;
let arrondissementByArrondissement = createArrondissementByArrondissementMap(ARRONDISSEMENT_PAR_QUARTIER);
let sessionStreets = [],
  currentIndex = 0,
  currentTarget = null,
  sessionArrondissements = [],
  currentArrondissementIndex = 0,
  currentArrondissementTarget = null,
  isSessionRunning = !1,
  activeSessionId = null,
  sessionStartTime = null,
  streetStartTime = null,
  isPaused = !1,
  pauseStartTime = null,
  remainingChronoMs = null,
  isChronoMode = !1,
  chronoEndTime = null,
  correctCount = 0,
  totalAnswered = 0,
  summaryData = [],
  weightedScore = 0,
  errorsCount = 0,
  highlightTimeoutId = null,
  highlightedLayers = [],
  dailyLastGuessHighlightLayers = [],
  messageTimeoutId = null,
  currentUser = null,
  isLectureMode = !1,
  hasAnsweredCurrentItem = !1,
  lectureStreetSearchIndex = [],
  lectureStreetSearchMatches = [],
  isApplyingFriendChallengeConfig = !1,
  activeFriendChallenge = null,
  friendChallengeInitPromise = null,
  pendingFriendChallengeArrondissementName = null;
let streetsLoadingPromise = null;
let areStreetsReady = false;
let mapInvalidateTimeoutIds = [];
let arrondissementsLoadingPromise = null;
let monumentsLoadingPromise = null;
let monumentsContentSyncPromise = null;
let monumentsSessionRefreshPending = !1;

const FRIEND_CHALLENGE_QUERY_PARAM = "defi";
const PENDING_FRIEND_CHALLENGE_STORAGE_KEY = "parici_pending_friend_challenge";
const PENDING_FRIEND_CHALLENGE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const FRIEND_CHALLENGE_ALLOWED_GAME_MODES = new Set(["classique", "marathon", "chrono"]);
const FRIEND_CHALLENGE_ALLOWED_ZONE_MODES = new Set([
  "ville",
  "arrondissement",
  "arrondissements-ville",
  "rues-principales",
  "rues-celebres",
  "monuments",
]);
function getSessionScoreValue(e = getGameMode()) {
  return "classique" === e ? weightedScore : correctCount;
}
function getCurrentSessionPoolSize() {
  return "monuments" === getZoneMode()
    ? sessionMonuments.length
    : "arrondissements-ville" === getZoneMode()
      ? sessionArrondissements.length
      : sessionStreets.length;
}
function getScoreMetricUIConfig(e = getGameMode()) {
  const zoneMode = getZoneMode();
  const itemLabel =
    "monuments" === zoneMode
      ? "Monuments"
      : "arrondissements-ville" === zoneMode
        ? "Arrondissements"
        : "Rues";
  const foundWord =
    "monuments" === zoneMode || "arrondissements-ville" === zoneMode
      ? "trouvés"
      : "trouvées";

  if ("marathon" === e)
    return {
      label: `${itemLabel} ${foundWord}`,
      legend: `Score = nombre de ${itemLabel.toLowerCase()} ${foundWord} (objectif: aller le plus loin possible).`,
      help:
        `<strong>${itemLabel} ${foundWord} (Marathon)</strong><br>Le score correspond au nombre de ${itemLabel.toLowerCase()} ${foundWord} avant la limite d'erreurs.<br><br>Le maximum dépend de la zone sélectionnée.`,
      decimals: 0,
    };
  if ("chrono" === e)
    return {
      label: `${itemLabel} ${foundWord}`,
      legend: `Score = nombre de ${itemLabel.toLowerCase()} ${foundWord} en ${CHRONO_DURATION} secondes.`,
      help:
        `<strong>${itemLabel} ${foundWord} (Chrono)</strong><br>Le score correspond au nombre de ${itemLabel.toLowerCase()} ${foundWord} dans le temps imparti (${CHRONO_DURATION} s).`,
      decimals: 0,
    };
  return {
    label: "Score pondéré",
    legend: "Chaque bonne réponse: jusqu'à 10 points selon la rapidité.",
    help:
      "<strong>Score pondéré</strong><br>Chaque bonne réponse rapporte jusqu'à 10 points selon la rapidité: 1 point en moins toutes les 2 secondes.<br>Au-delà de 20 secondes, aucun point.<br><br>Le score affiché est la somme des points de la session.",
    decimals: 1,
  };
}
function updateScoreMetricUI() {
  const e = getScoreMetricUIConfig(),
    t = document.getElementById("weighted-score-label"),
    r = document.getElementById("weighted-score-legend"),
    a = document.getElementById("weighted-score-help"),
    n = document.getElementById("weighted-score-help-btn");
  t && (t.textContent = e.label);
  r && (r.textContent = e.legend);
  a && (a.innerHTML = e.help);
  n &&
    n.setAttribute(
      "aria-label",
      "classique" === getGameMode()
        ? "Information sur le score pondéré"
        : "Information sur le score",
    );
}
function setMapStatus(e, t) {
  const r = document.getElementById("map-status");
  r &&
    ((r.textContent = e),
      (r.className = "map-status-pill"),
      "loading" === t
        ? r.classList.add("map-status--loading")
        : "ready" === t
          ? r.classList.add("map-status--ready")
          : "error" === t && r.classList.add("map-status--error"));
}
const IS_TOUCH_DEVICE =
  "ontouchstart" in window || navigator.maxTouchPoints > 0;
const PULL_TO_REFRESH_THRESHOLD_PX = 92;
const PULL_TO_REFRESH_TOP_ZONE_PX = 96;
const PULL_TO_REFRESH_TOP_ZONE_STANDALONE_PX = 220;
const DISCRETE_ZOOM_STEP = 1;
const DESKTOP_WHEEL_IDLE_MS = 170;
const DESKTOP_WHEEL_THRESHOLD_PX = 90;
const DESKTOP_LINE_DELTA_PX = 40;
const MOBILE_TWO_FINGER_TAP_MAX_DURATION_MS = 260;
const MOBILE_TWO_FINGER_TAP_MAX_MOVE_PX = 24;
const MOBILE_TWO_FINGER_DOUBLE_TAP_DELAY_MS = 340;
const MOBILE_TWO_FINGER_DOUBLE_TAP_MAX_DISTANCE_PX = 56;
const MOBILE_TWO_FINGER_SUPPRESS_DBLCLICK_MS = 380;
let isPullToRefreshBound = !1;

function isStandaloneDisplayMode() {
  if (window.navigator.standalone === !0) return !0;
  if ("function" != typeof window.matchMedia) return !1;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

function getPullToRefreshTopZonePx() {
  return isStandaloneDisplayMode()
    ? PULL_TO_REFRESH_TOP_ZONE_STANDALONE_PX
    : PULL_TO_REFRESH_TOP_ZONE_PX;
}

function getScrollableAncestor(e) {
  let t = e instanceof Element ? e : null;
  for (; t && t !== document.body;) {
    const e = window.getComputedStyle(t),
      r = /(auto|scroll)/.test(e.overflowY),
      a = t.scrollHeight - t.clientHeight > 2;
    if (r && a) return t;
    t = t.parentElement;
  }
  return null;
}

function canStartPullToRefresh(e, t) {
  if (t > getPullToRefreshTopZonePx()) return !1;
  const r =
    window.scrollY ||
    window.pageYOffset ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0;
  if (r > 2) return !1;
  const a = getScrollableAncestor(e);
  return !(a && a.scrollTop > 0);
}

function initMobilePullToRefresh() {
  if (!IS_TOUCH_DEVICE || isPullToRefreshBound) return;
  isPullToRefreshBound = !0;
  let e = {
    active: !1,
    eligible: !1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    maxPull: 0,
    reloaded: !1,
  };
  const t = () => {
    e = {
      active: !1,
      eligible: !1,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      maxPull: 0,
      reloaded: !1,
    };
  };
  document.addEventListener(
    "touchstart",
    (r) => {
      if (1 !== r.touches.length) return void t();
      const a = r.touches[0],
        n = canStartPullToRefresh(r.target, a.clientY);
      e = {
        active: !0,
        eligible: n,
        startX: a.clientX,
        startY: a.clientY,
        lastX: a.clientX,
        lastY: a.clientY,
        maxPull: 0,
        reloaded: !1,
      };
    },
    { passive: !0, capture: !0 },
  );
  document.addEventListener(
    "touchmove",
    (t) => {
      if (!e.active || !e.eligible || e.reloaded || 1 !== t.touches.length) return;
      const r = t.touches[0],
        a = r.clientY - e.startY,
        n = r.clientX - e.startX;
      ((e.lastX = r.clientX), (e.lastY = r.clientY));
      if (a < -12) return void (e.eligible = !1);
      if (Math.abs(n) > Math.max(24, 1.25 * Math.abs(a)))
        return void (e.eligible = !1);
      a > e.maxPull && (e.maxPull = a);
    },
    { passive: !0, capture: !0 },
  );
  const r = (n) => {
    if (n.changedTouches && 1 === n.changedTouches.length) {
      const t = n.changedTouches[0];
      ((e.lastX = t.clientX), (e.lastY = t.clientY));
    }
    if (!e.active || !e.eligible || e.reloaded) return void t();
    const a = Math.max(e.maxPull, e.lastY - e.startY),
      s = Math.abs(e.lastX - e.startX);
    if (a >= PULL_TO_REFRESH_THRESHOLD_PX && a > 1.35 * s) {
      ((e.reloaded = !0),
        showMessage("Rafraîchissement...", "info"),
        triggerHaptic('click'),
        setTimeout(() => window.location.reload(), 40));
      return;
    }
    t();
  };
  (document.addEventListener("touchend", r, { passive: !0, capture: !0 }),
    document.addEventListener("touchcancel", t, { passive: !0, capture: !0 }));
}

function getSelectedArrondissement() {
  const e = document.getElementById("arrondissement-select");
  if (!e) return null;
  const t = e.value;
  return t && "" !== t.trim() ? t.trim() : null;
}

function generateSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeFriendChallengePayload(payload) {
  const code = String(payload?.code || "").trim().toUpperCase();
  const mode = String(payload?.mode || "").trim();
  const gameType = String(payload?.gameType || "").trim();
  const targetType = String(payload?.targetType || "").trim() || "street";
  const rawSerialNumber = Number.parseInt(payload?.serialNumber, 10);
  const serialNumber = Number.isInteger(rawSerialNumber) && rawSerialNumber > 0 ? rawSerialNumber : null;
  const rawSerialCode = typeof payload?.serialCode === "string" ? payload.serialCode.trim() : "";
  const serialCode = serialNumber ? formatFriendChallengeSerial(serialNumber) : rawSerialCode;
  const targetNames = Array.isArray(payload?.targetNames)
    ? payload.targetNames
      .map((value) => String(value || "").trim())
      .filter(Boolean)
    : [];
  const rawTargets = Array.isArray(payload?.targets) ? payload.targets : targetNames;
  const targets = rawTargets
    .map((value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const name = String(value.name || "").trim();
        if (!name) return null;
        const longitude = Array.isArray(value.centroid) ? Number(value.centroid[0]) : Number.NaN;
        const latitude = Array.isArray(value.centroid) ? Number(value.centroid[1]) : Number.NaN;
        return {
          name,
          featureId: String(value.featureId || value.id || value.osmId || value.osm_id || "").trim(),
          centroid: Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null,
          arrondissementName: typeof value.arrondissementName === "string" ? value.arrondissementName.trim() : null,
        };
      }
      const name = String(value || "").trim();
      return name ? { name, featureId: "", centroid: null, arrondissementName: null } : null;
    })
    .filter(Boolean);
  const resolvedTargetNames = targets.map((target) => target.name);
  if (
    !/^[A-Z0-9]{10}$/.test(code) ||
    !FRIEND_CHALLENGE_ALLOWED_ZONE_MODES.has(mode) ||
    !FRIEND_CHALLENGE_ALLOWED_GAME_MODES.has(gameType) ||
    targets.length < 1
  ) {
    return null;
  }
  return {
    code,
    serialNumber,
    serialCode,
    mode,
    gameType,
    arrondissementName: typeof payload?.arrondissementName === "string" ? payload.arrondissementName.trim() : null,
    targetType,
    targetNames: resolvedTargetNames,
    targets,
    itemCount: Number.parseInt(payload?.itemCount, 10) || targets.length,
    sharePath: typeof payload?.sharePath === "string" ? payload.sharePath : "",
    createdBy: normalizeFriendChallengeCreator(payload?.createdBy),
  };
}

function getFriendChallengeCodeFromUrl() {
  try {
    const url = new URL(window.location.href);
    return String(url.searchParams.get(FRIEND_CHALLENGE_QUERY_PARAM) || "").trim().toUpperCase();
  } catch (error) {
    return "";
  }
}

function normalizeFriendChallengeCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(code) ? code : "";
}

function rememberPendingFriendChallengeCode(code) {
  const normalizedCode = normalizeFriendChallengeCode(code);
  if (!normalizedCode) {
    return;
  }
  try {
    localStorage.setItem(
      PENDING_FRIEND_CHALLENGE_STORAGE_KEY,
      JSON.stringify({
        code: normalizedCode,
        savedAt: Date.now(),
      }),
    );
  } catch (error) {
    console.warn("Pending friend challenge save failed:", error);
  }
}

function clearPendingFriendChallengeCode(code = "") {
  try {
    if (!code) {
      localStorage.removeItem(PENDING_FRIEND_CHALLENGE_STORAGE_KEY);
      return;
    }
    const pending = getPendingFriendChallengeCode();
    if (pending && pending === normalizeFriendChallengeCode(code)) {
      localStorage.removeItem(PENDING_FRIEND_CHALLENGE_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("Pending friend challenge clear failed:", error);
  }
}

function getPendingFriendChallengeCode() {
  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem(PENDING_FRIEND_CHALLENGE_STORAGE_KEY) || "null");
  } catch (error) {
    clearPendingFriendChallengeCode();
    return "";
  }

  const code = normalizeFriendChallengeCode(payload?.code);
  const savedAt = Number(payload?.savedAt);
  if (!code || !Number.isFinite(savedAt) || Date.now() - savedAt > PENDING_FRIEND_CHALLENGE_MAX_AGE_MS) {
    clearPendingFriendChallengeCode();
    return "";
  }
  return code;
}

function updateFriendChallengeCodeInUrl(code) {
  try {
    const url = new URL(window.location.href);
    if (code) {
      url.searchParams.set(FRIEND_CHALLENGE_QUERY_PARAM, code);
    } else {
      url.searchParams.delete(FRIEND_CHALLENGE_QUERY_PARAM);
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, "", next);
  } catch (error) {
    console.warn("Friend challenge URL sync failed:", error);
  }
}

function getFriendChallengeShareOrigin() {
  const fallbackOrigin = "https://parici.netlify.app";
  try {
    const { origin, hostname, protocol } = window.location;
    if (
      protocol !== "file:" &&
      hostname &&
      hostname !== "localhost" &&
      hostname !== "127.0.0.1"
    ) {
      return origin;
    }
  } catch (error) {
    // Fallback below.
  }
  return fallbackOrigin;
}

function buildFriendChallengeShareUrl(challenge) {
  if (!challenge) {
    return "";
  }
  const shareOrigin = getFriendChallengeShareOrigin();
  if (challenge.sharePath) {
    try {
      return new URL(challenge.sharePath, shareOrigin).toString();
    } catch (error) {
      // Fallback below.
    }
  }
  const url = new URL("/", shareOrigin);
  url.searchParams.set(FRIEND_CHALLENGE_QUERY_PARAM, challenge.code);
  return url.toString();
}

async function copyTextToClipboard(text) {
  const value = String(text || "").trim();
  if (!value) {
    return !1;
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(value);
      return !0;
    } catch (error) {
      // Fallback below.
    }
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "readonly");
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.appendChild(input);
  input.select();
  let copied = !1;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    copied = !1;
  }
  document.body.removeChild(input);
  return copied;
}

function findCustomSelectItemByValue(listEl, value) {
  if (!listEl) return null;
  const target = String(value || "");
  return Array.from(listEl.querySelectorAll("li")).find((item) => item.dataset.value === target) || null;
}

function syncModeSelectButton() {
  const select = document.getElementById("mode-select");
  const button = document.getElementById("mode-select-button");
  const list = document.getElementById("mode-select-list");
  if (!select || !button || !list) return;
  const item = findCustomSelectItemByValue(list, select.value);
  const label = button.querySelector(".custom-select-label");
  if (label && item) {
    label.textContent = item.childNodes[0].textContent.trim();
  }
  const sourcePill = item?.querySelector(".difficulty-pill");
  const targetPill = button.querySelector(".difficulty-pill");
  if (sourcePill) {
    const clone = sourcePill.cloneNode(!0);
    targetPill ? targetPill.replaceWith(clone) : button.appendChild(clone);
  } else if (targetPill) {
    targetPill.remove();
  }
}

function syncGameModeSelectButton() {
  const select = document.getElementById("game-mode-select");
  const button = document.getElementById("game-mode-select-button");
  const list = document.getElementById("game-mode-select-list");
  if (!select || !button || !list) return;
  const item = findCustomSelectItemByValue(list, select.value);
  const label = button.querySelector(".custom-select-label");
  if (label && item) {
    label.textContent = item.childNodes[0].textContent.trim();
  }
  const sourcePill = item?.querySelector(".difficulty-pill");
  const targetPill = button.querySelector(".difficulty-pill");
  if (sourcePill) {
    const clone = sourcePill.cloneNode(!0);
    targetPill ? targetPill.replaceWith(clone) : button.appendChild(clone);
  } else if (targetPill) {
    targetPill.remove();
  }
}

function setZoneModeSelection(mode) {
  const select = document.getElementById("mode-select");
  if (!select || !mode) return;
  if (!Array.from(select.options).some((option) => option.value === mode)) return;
  select.value = mode;
  syncModeSelectButton();
  select.dispatchEvent(new Event("change"));
}

function setGameModeSelection(gameMode) {
  const select = document.getElementById("game-mode-select");
  const list = document.getElementById("game-mode-select-list");
  if (!select || !gameMode) return;
  if (!Array.from(select.options).some((option) => option.value === gameMode)) return;

  select.value = gameMode;
  syncGameModeSelectButton();
  isSessionRunning && endSession();
  "lecture" !== gameMode &&
    isLectureMode &&
    ((isLectureMode = !1),
      setLectureTooltipsEnabled(!1),
      refreshLectureStreetSearchForCurrentMode(),
      updateTargetPanelTitle(),
      updateLayoutSessionState());
  updateGameModeControls();
  list && ((list.scrollTop = 0), list.classList.remove("visible"));
  "lecture" === gameMode && requestAnimationFrame(() => prepareAndStartNewSession());
}

function setArrondissementSelectionByName(arrondissementName) {
  const select = document.getElementById("arrondissement-select");
  const button = document.getElementById("arrondissement-select-button");
  if (!select || !arrondissementName) return !1;
  const targetKey = normalizeArrondissementKey(arrondissementName);
  const option = Array.from(select.options).find(
    (entry) => normalizeArrondissementKey(entry.value) === targetKey || normalizeArrondissementKey(entry.textContent) === targetKey,
  );
  if (!option) return !1;
  select.value = option.value;
  if (button) {
    const label = button.querySelector(".custom-select-label");
    label && (label.textContent = option.value);
  }
  select.dispatchEvent(new Event("change"));
  return !0;
}

function setGameConfigurationControlsLocked(locked) {
  const elements = [
    document.getElementById("mode-select"),
    document.getElementById("mode-select-button"),
    document.getElementById("arrondissement-select"),
    document.getElementById("arrondissement-select-button"),
    document.getElementById("game-mode-select"),
    document.getElementById("game-mode-select-button"),
  ];
  elements.forEach((element) => {
    if (!element) return;
    element.disabled = !!locked;
    element.setAttribute("aria-disabled", locked ? "true" : "false");
  });
  const lists = [
    document.getElementById("mode-select-list"),
    document.getElementById("arrondissement-select-list"),
    document.getElementById("game-mode-select-list"),
  ];
  lists.forEach((list) => {
    list && list.classList.remove("visible");
  });
}

function updateFriendChallengeToggleUI() {
  const button = document.getElementById("friends-challenge-toggle");
  const serialLabel = document.getElementById("friends-challenge-serial");
  if (!button) return;
  const isOn = !!activeFriendChallenge;
  const serialCode = formatFriendChallengeSerial(activeFriendChallenge?.serialNumber) || activeFriendChallenge?.serialCode || "";
  const creatorLabel = getFriendChallengeCreatorLabel(activeFriendChallenge);
  button.classList.toggle("is-on", isOn);
  button.textContent = isOn ? "Défi amis ON" : "Défi amis OFF";
  button.setAttribute("aria-pressed", isOn ? "true" : "false");
  if (!serialLabel) return;
  if (isOn && (serialCode || creatorLabel)) {
    serialLabel.innerHTML = "";
    if (serialCode) {
      const serialText = document.createElement("span");
      serialText.className = "friends-challenge-serial-id";
      serialText.textContent = `Numéro du défi : ${serialCode}`;
      serialLabel.appendChild(serialText);
    }
    if (creatorLabel) {
      const creatorText = document.createElement("span");
      creatorText.className = "friends-challenge-serial-creator";
      creatorText.textContent = `Créateur : ${creatorLabel}`;
      serialLabel.appendChild(creatorText);
    }
    serialLabel.classList.remove("hidden");
    return;
  }
  serialLabel.innerHTML = "";
  serialLabel.classList.add("hidden");
}

function getZoneMode() {
  return currentZoneMode;
}

function clearFriendChallengeMiniBoard() {
  const slot = document.getElementById("friend-challenge-board-slot");
  if (!slot) return;
  slot.innerHTML = "";
  slot.classList.add("hidden");
}

function renderPendingFriendChallengePrompt(code) {
  const normalizedCode = normalizeFriendChallengeCode(code);
  const slot = document.getElementById("friend-challenge-board-slot");
  if (!slot || !normalizedCode || activeFriendChallenge) return;

  slot.innerHTML = "";
  slot.classList.remove("hidden");

  const title = document.createElement("p");
  title.className = "friend-challenge-board-title";
  title.textContent = "Défi amis reçu";
  slot.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "friend-challenge-board-meta";
  meta.textContent = `Code ${normalizedCode}`;
  slot.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "friend-challenge-board-actions";

  const ignoreBtn = document.createElement("button");
  ignoreBtn.type = "button";
  ignoreBtn.className = "btn-secondary friend-challenge-copy-btn";
  ignoreBtn.textContent = "Ignorer";
  ignoreBtn.addEventListener("click", () => {
    clearPendingFriendChallengeCode(normalizedCode);
    clearFriendChallengeMiniBoard();
    showMessage("Défi amis ignoré.", "info");
  });
  actions.appendChild(ignoreBtn);

  const resumeBtn = document.createElement("button");
  resumeBtn.type = "button";
  resumeBtn.className = "btn-primary friend-challenge-copy-btn";
  resumeBtn.textContent = "Reprendre";
  resumeBtn.addEventListener("click", async () => {
    resumeBtn.disabled = !0;
    ignoreBtn.disabled = !0;
    const challenge = await fetchAndActivateFriendChallengeByCode(normalizedCode, { showSuccessMessage: !0 });
    if (challenge) {
      clearPendingFriendChallengeCode(normalizedCode);
    } else {
      resumeBtn.disabled = !1;
      ignoreBtn.disabled = !1;
    }
  });
  actions.appendChild(resumeBtn);
  slot.appendChild(actions);
}

function renderFriendChallengeMiniBoard({ rows = [], infoMessage = "" } = {}) {
  const slot = document.getElementById("friend-challenge-board-slot");
  if (!slot) return;
  if (!activeFriendChallenge) {
    clearFriendChallengeMiniBoard();
    return;
  }

  slot.innerHTML = "";
  slot.classList.remove("hidden");

  const title = document.createElement("p");
  title.className = "friend-challenge-board-title";
  const serialCode = formatFriendChallengeSerial(activeFriendChallenge?.serialNumber) || activeFriendChallenge?.serialCode || "";
  const creatorLabel = getFriendChallengeCreatorLabel(activeFriendChallenge);
  if (serialCode && creatorLabel) {
    title.textContent = `Mini leaderboard — Défi amis ${serialCode} · ${creatorLabel}`;
  } else if (serialCode) {
    title.textContent = `Mini leaderboard — Défi amis ${serialCode}`;
  } else if (creatorLabel) {
    title.textContent = `Mini leaderboard — Défi amis · ${creatorLabel}`;
  } else {
    title.textContent = "Mini leaderboard — Défi amis";
  }
  slot.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "friend-challenge-board-meta";
  meta.textContent =
    `${ZONE_LABELS[activeFriendChallenge.mode] || activeFriendChallenge.mode} · ` +
    `${GAME_LABELS[activeFriendChallenge.gameType] || activeFriendChallenge.gameType}`;
  slot.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "friend-challenge-board-actions";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn-secondary friend-challenge-copy-btn";
  copyBtn.textContent = "Copier le lien";
  copyBtn.addEventListener("click", async () => {
    const copied = await copyTextToClipboard(buildFriendChallengeShareUrl(activeFriendChallenge));
    showMessage(copied ? "Lien du défi copié." : "Impossible de copier le lien du défi.", copied ? "success" : "error");
  });
  actions.appendChild(copyBtn);
  slot.appendChild(actions);

  if (infoMessage) {
    const note = document.createElement("p");
    note.className = "friend-challenge-board-empty";
    note.textContent = infoMessage;
    slot.appendChild(note);
    return;
  }

  if (!Array.isArray(rows) || rows.length < 1) {
    const note = document.createElement("p");
    note.className = "friend-challenge-board-empty";
    note.textContent = "Aucun score enregistré pour ce défi pour l'instant.";
    slot.appendChild(note);
    return;
  }

  const table = document.createElement("table");
  table.className = "leaderboard-table";
  table.innerHTML = "<thead><tr><th>#</th><th>Joueur</th><th>Score</th><th>Temps</th></tr></thead>";
  const tbody = document.createElement("tbody");
  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const rank = document.createElement("td");
    rank.textContent = String(index + 1);
    const player = document.createElement("td");
    const avatar = row?.avatar || "👤";
    const username = row?.username || "Anonyme";
    const titleValue = getPlayerTitle(
      row?.score || 0,
      activeFriendChallenge.mode,
      activeFriendChallenge.gameType,
      row?.items_total || activeFriendChallenge.itemCount || 0,
      row?.items_correct,
    );
    player.innerHTML = `<span class="leaderboard-avatar">${avatar}</span>${username}<br><small class="leaderboard-player-meta">${titleValue}</small>`;
    const scoreCell = document.createElement("td");
    if (activeFriendChallenge.gameType === "classique") {
      const parsedScore = Number(row?.score);
      scoreCell.textContent = Number.isFinite(parsedScore) ? parsedScore.toFixed(1) : "0.0";
    } else {
      const parsedCorrect = Number.parseInt(row?.items_correct, 10);
      scoreCell.textContent = Number.isFinite(parsedCorrect) ? String(parsedCorrect) : "0";
    }
    const timeCell = document.createElement("td");
    const parsedTime = Number(row?.time_sec);
    timeCell.textContent = Number.isFinite(parsedTime) ? `${parsedTime.toFixed(1)} s` : "—";
    tr.appendChild(rank);
    tr.appendChild(player);
    tr.appendChild(scoreCell);
    tr.appendChild(timeCell);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  slot.appendChild(table);
}

async function loadFriendChallengeLeaderboard() {
  if (!activeFriendChallenge) {
    clearFriendChallengeMiniBoard();
    return;
  }
  if (!currentUser || !currentUser.token) {
    renderFriendChallengeMiniBoard({
      infoMessage: "Connectez-vous puis terminez au moins une partie pour voir le mini leaderboard.",
    });
    return;
  }
  const challengeCode = activeFriendChallenge.code;
  try {
    const response = await fetch(`${API_URL}/api/friend-challenges/${encodeURIComponent(challengeCode)}/leaderboard`, {
      headers: { Authorization: `Bearer ${currentUser.token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!activeFriendChallenge || activeFriendChallenge.code !== challengeCode) {
      return;
    }
    if (!response.ok) {
      if (response.status === 403) {
        renderFriendChallengeMiniBoard({
          infoMessage: "Le mini leaderboard sera visible après ta première partie sur ce défi.",
        });
        return;
      }
      if (response.status === 401) {
        renderFriendChallengeMiniBoard({
          infoMessage: "Connectez-vous pour afficher le mini leaderboard du défi.",
        });
        return;
      }
      renderFriendChallengeMiniBoard({
        infoMessage: payload?.error || "Mini leaderboard indisponible pour le moment.",
      });
      return;
    }
    const payloadChallenge = normalizeFriendChallengePayload(payload?.challenge);
    if (
      payloadChallenge &&
      activeFriendChallenge &&
      payloadChallenge.code === challengeCode &&
      activeFriendChallenge.code === challengeCode
    ) {
      activeFriendChallenge = {
        ...activeFriendChallenge,
        serialNumber: payloadChallenge.serialNumber || activeFriendChallenge.serialNumber,
        serialCode: payloadChallenge.serialCode || activeFriendChallenge.serialCode,
        createdBy: payloadChallenge.createdBy || activeFriendChallenge.createdBy || null,
      };
      updateFriendChallengeToggleUI();
    }
    renderFriendChallengeMiniBoard({ rows: Array.isArray(payload?.rows) ? payload.rows : [] });
  } catch (error) {
    console.error("Friend challenge leaderboard error:", error);
    if (!activeFriendChallenge || activeFriendChallenge.code !== challengeCode) {
      return;
    }
    renderFriendChallengeMiniBoard({
      infoMessage: "Mini leaderboard indisponible (erreur réseau).",
    });
  }
}

function applyFriendChallengeConfigToUI(challenge) {
  if (!challenge) return;
  isApplyingFriendChallengeConfig = !0;
  try {
    setZoneModeSelection(challenge.mode);
    setGameModeSelection(challenge.gameType);
    pendingFriendChallengeArrondissementName = null;
    if (challenge.mode === "arrondissement" && challenge.arrondissementName) {
      if (!setArrondissementSelectionByName(challenge.arrondissementName)) {
        pendingFriendChallengeArrondissementName = challenge.arrondissementName;
      }
    }
  } finally {
    isApplyingFriendChallengeConfig = !1;
    setGameConfigurationControlsLocked(!!activeFriendChallenge);
  }
}

function deactivateFriendChallenge({ clearUrl = !0, silent = !1 } = {}) {
  activeFriendChallenge = null;
  pendingFriendChallengeArrondissementName = null;
  clearUrl && updateFriendChallengeCodeInUrl("");
  updateFriendChallengeToggleUI();
  setGameConfigurationControlsLocked(!1);
  clearFriendChallengeMiniBoard();
  !silent && showMessage("Défi amis désactivé.", "info");
}

async function activateFriendChallenge(challenge, { copyLink = !1, successMessage = "" } = {}) {
  const normalized = normalizeFriendChallengePayload(challenge);
  if (!normalized) {
    showMessage("Impossible de charger ce défi amis.", "error");
    return null;
  }

  activeFriendChallenge = normalized;
  updateFriendChallengeCodeInUrl(normalized.code);
  updateFriendChallengeToggleUI();
  applyFriendChallengeConfigToUI(normalized);
  await loadFriendChallengeLeaderboard();

  if (copyLink) {
    const copied = await copyTextToClipboard(buildFriendChallengeShareUrl(normalized));
    showMessage(copied ? "Lien du défi copié dans le presse-papiers." : "Impossible de copier le lien du défi.", copied ? "success" : "error");
  } else if (successMessage) {
    showMessage(successMessage, "info");
  }
  return normalized;
}

async function fetchAndActivateFriendChallengeByCode(code, { showSuccessMessage = !1 } = {}) {
  const challengeCode = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(challengeCode)) {
    showMessage("Code de défi invalide.", "error");
    return null;
  }
  try {
    const response = await fetch(`${API_URL}/api/friend-challenges/${encodeURIComponent(challengeCode)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showMessage(payload?.error || "Défi introuvable ou expiré.", "error");
      return null;
    }
    return await activateFriendChallenge(payload, {
      copyLink: !1,
      successMessage: showSuccessMessage ? "Défi amis chargé." : "",
    });
  } catch (error) {
    console.error("Friend challenge fetch error:", error);
    showMessage("Impossible de charger le défi (erreur réseau).", "error");
    return null;
  }
}

async function createFriendChallengeFromCurrentSettings() {
  if (isSessionRunning) {
    showMessage("Arrêtez la session en cours avant de créer un défi amis.", "warning");
    return null;
  }
  if (!currentUser || !currentUser.token) {
    showMessage("Connectez-vous pour créer un défi amis.", "warning");
    return null;
  }

  const zoneMode = getZoneMode();
  const gameMode = getGameMode();
  if (!FRIEND_CHALLENGE_ALLOWED_GAME_MODES.has(gameMode)) {
    showMessage("Le défi amis est disponible en Classique, Marathon ou Chrono.", "warning");
    return null;
  }
  if (!FRIEND_CHALLENGE_ALLOWED_ZONE_MODES.has(zoneMode)) {
    showMessage("Cette zone n'est pas compatible avec le défi amis.", "warning");
    return null;
  }
  const arrondissementName = zoneMode === "arrondissement" ? getSelectedArrondissement() : null;
  if (zoneMode === "arrondissement" && !arrondissementName) {
    showMessage("Choisissez un arrondissement avant de créer un défi amis.", "warning");
    return null;
  }

  try {
    const response = await fetch(`${API_URL}/api/friend-challenges`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentUser.token}`,
      },
      body: JSON.stringify({
        mode: zoneMode,
        gameType: gameMode,
        arrondissementName,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showMessage(payload?.error || "Impossible de créer le défi amis.", "error");
      return null;
    }
    return await activateFriendChallenge(payload, { copyLink: !0 });
  } catch (error) {
    console.error("Friend challenge create error:", error);
    showMessage("Impossible de créer le défi amis (erreur réseau).", "error");
    return null;
  }
}

async function handleFriendChallengeToggleClick() {
  const toggle = document.getElementById("friends-challenge-toggle");
  if (!toggle) return;
  if (isSessionRunning) {
    showMessage("Arrêtez la session avant de modifier le mode Défi amis.", "warning");
    return;
  }
  if (activeFriendChallenge) {
    deactivateFriendChallenge({ clearUrl: !0, silent: !1 });
    return;
  }
  toggle.disabled = !0;
  try {
    await createFriendChallengeFromCurrentSettings();
  } finally {
    toggle.disabled = !1;
    updateFriendChallengeToggleUI();
  }
}

async function initFriendChallengeModeFromUrl() {
  if (friendChallengeInitPromise) {
    return friendChallengeInitPromise;
  }
  const challengeCode = getFriendChallengeCodeFromUrl();
  if (!challengeCode) {
    deactivateFriendChallenge({ clearUrl: !1, silent: !0 });
    renderPendingFriendChallengePrompt(getPendingFriendChallengeCode());
    return null;
  }
  if (!isStandaloneDisplayMode()) {
    rememberPendingFriendChallengeCode(challengeCode);
  }
  friendChallengeInitPromise = fetchAndActivateFriendChallengeByCode(challengeCode, { showSuccessMessage: !0 })
    .then((challenge) => {
      if (!challenge) {
        updateFriendChallengeCodeInUrl("");
      }
      return challenge;
    })
    .finally(() => {
      friendChallengeInitPromise = null;
    });
  return friendChallengeInitPromise;
}

function getFeatureStableId(feature) {
  return String(
    feature?.properties?.id ||
    feature?.properties?.osm_id ||
    feature?.id ||
    "",
  ).trim();
}

function getFeatureCentroid(feature) {
  const centroid = feature?.properties?.centroid || feature?.centroid;
  if (!Array.isArray(centroid) || centroid.length < 2) return null;
  const longitude = Number(centroid[0]);
  const latitude = Number(centroid[1]);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null;
}

function areCentroidsClose(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return !1;
  const leftLng = Number(left[0]);
  const leftLat = Number(left[1]);
  const rightLng = Number(right[0]);
  const rightLat = Number(right[1]);
  if (![leftLng, leftLat, rightLng, rightLat].every(Number.isFinite)) return !1;
  return Math.abs(leftLng - rightLng) <= 0.00001 && Math.abs(leftLat - rightLat) <= 0.00001;
}

function getFriendChallengeStreetTargets() {
  if (!activeFriendChallenge || !Array.isArray(activeFriendChallenge.targets)) return [];
  const byId = new Map();
  const byName = new Map();
  allStreetFeatures.forEach((feature) => {
    const featureId = getFeatureStableId(feature);
    if (featureId && !byId.has(featureId)) {
      byId.set(featureId, feature);
    }
    const featureName = feature?.properties?.name;
    const key = normalizeChallengeNameKey(featureName);
    if (key && !byName.has(key)) {
      byName.set(key, feature);
    }
  });
  return activeFriendChallenge.targets
    .map((target) => {
      if (!target) return null;
      if (target.featureId && byId.has(target.featureId)) {
        return byId.get(target.featureId);
      }
      const nameKey = normalizeChallengeNameKey(target.name);
      if (nameKey && target.centroid) {
        const matchingFeature = allStreetFeatures.find((feature) => {
          const featureName = feature?.properties?.name;
          return normalizeChallengeNameKey(featureName) === nameKey && areCentroidsClose(getFeatureCentroid(feature), target.centroid);
        });
        if (matchingFeature) {
          return matchingFeature;
        }
      }
      return byName.get(nameKey) || null;
    })
    .filter(Boolean);
}

function getFriendChallengeMonumentTargets() {
  if (!activeFriendChallenge || !Array.isArray(activeFriendChallenge.targets)) return [];
  const byName = new Map();
  allMonuments.forEach((feature) => {
    const featureName = feature?.properties?.name;
    const key = normalizeChallengeNameKey(featureName);
    if (key && !byName.has(key)) {
      byName.set(key, feature);
    }
  });
  return activeFriendChallenge.targets
    .map((target) => byName.get(normalizeChallengeNameKey(target?.name)))
    .filter((feature) => !!feature);
}

function getFriendChallengeArrondissementTargets() {
  if (!activeFriendChallenge || !Array.isArray(activeFriendChallenge.targets)) return [];
  const byKey = new Map();
  allArrondissementFeatures.forEach((feature) => {
    const key = normalizeArrondissementKey(getArrondissementTargetName(feature));
    if (key && !byKey.has(key)) {
      byKey.set(key, feature);
    }
  });
  return activeFriendChallenge.targets
    .map((target) => byKey.get(normalizeArrondissementKey(target?.name)))
    .filter((feature) => !!feature);
}

function updateModeDifficultyPill() {
  const e = document.getElementById("mode-select"),
    t = document.getElementById("mode-difficulty-pill");
  if (!e || !t) return;
  const r = e.value;
  (t.classList.remove(
    "difficulty-pill--very-easy",
    "difficulty-pill--easy",
    "difficulty-pill--medium",
    "difficulty-pill--hard",
  ),
    "rues-principales" === r
      ? ((t.textContent = "Facile"), t.classList.add("difficulty-pill--easy"))
      : "arrondissements-ville" === r
        ? ((t.textContent = "Facile"),
          t.classList.add("difficulty-pill--very-easy"))
      : "arrondissement" === r || "monuments" === r
        ? ((t.textContent = "Faisable"),
          t.classList.add("difficulty-pill--medium"))
      : "rues-celebres" === r
        ? ((t.textContent = "Très Facile"),
          t.classList.add("difficulty-pill--very-easy"))
        : "ville" === r
          ? ((t.textContent = "Difficile"),
            t.classList.add("difficulty-pill--hard"))
          : (t.textContent = ""));
}
function setTargetPanelTitleText(e) {
  const t = document.getElementById("target-panel-title-text");
  if (t) return void (t.textContent = e);
  const r =
    document.getElementById("target-panel-title") ||
    document.querySelector(".target-panel .panel-title");
  r && (r.textContent = e);
}
function updateTargetItemCounter() {
  const e = document.getElementById("target-item-counter");
  if (!e) return;
  const t =
    isSessionRunning &&
    !isDailyMode &&
    !isLectureMode &&
    "classique" === getGameMode();
  if (!t)
    return (
      (e.textContent = ""),
      void e.classList.add("hidden")
    );
  const r = getZoneMode(),
    a =
      "monuments" === r
        ? sessionMonuments.length
        : "arrondissements-ville" === r
          ? sessionArrondissements.length
          : sessionStreets.length;
  if (!Number.isFinite(a) || a <= 0)
    return (
      (e.textContent = ""),
      void e.classList.add("hidden")
    );
  const n =
    "monuments" === r
      ? currentMonumentIndex
      : "arrondissements-ville" === r
        ? currentArrondissementIndex
        : currentIndex,
    s = Math.min(a, Math.max(1, n + 1));
  ((e.textContent = `${s}/${a}`), e.classList.remove("hidden"));
}
function updateTargetPanelTitle() {
  const e = getZoneMode();
  (isLectureMode
    ? setTargetPanelTitleText(
      "monuments" === e
        ? "Monument à explorer"
        : "arrondissements-ville" === e
          ? "Arrondissement à explorer"
          : "Recherche de rue",
    )
    : setTargetPanelTitleText(
      "monuments" === e
        ? "Monument à trouver"
        : "arrondissements-ville" === e
          ? "Arrondissement à trouver"
          : "Rue à trouver",
    ),
    updateTargetItemCounter());
}
function getGameMode() {
  const e = document.getElementById("game-mode-select");
  return e ? e.value : "classique";
}
function updateGameModeControls() {
  const e = document.getElementById("game-mode-select"),
    t = document.getElementById("restart-btn"),
    r = document.getElementById("pause-btn");
  e &&
    t &&
    r &&
    ("lecture" === e.value
      ? ((t.style.display = "none"), (r.style.display = "none"))
      : (t.style.display = ""),
      updateScoreMetricUI(),
      updateWeightedScoreUI(),
      updateSessionProgressBar(),
      refreshLectureStreetSearchForCurrentMode({ preserveQuery: !0 }));
}
function getLectureSearchElements() {
  return {
    container: document.getElementById("lecture-search"),
    input: document.getElementById("lecture-search-input"),
    results: document.getElementById("lecture-search-results"),
    target: document.getElementById("target-street"),
  };
}
function closeLectureStreetSearchResults() {
  const { results } = getLectureSearchElements();
  results && (results.innerHTML = "", results.classList.add("hidden"));
  lectureStreetSearchMatches = [];
}
function setLectureStreetSearchVisible(e, t = !1) {
  const { container, input, target } = getLectureSearchElements();
  if (!container || !target) return;
  if (e) {
    target.classList.add("hidden");
    container.classList.remove("hidden");
    return;
  }
  (container.classList.add("hidden"),
    target.classList.remove("hidden"),
    closeLectureStreetSearchResults(),
    input &&
    !0 !== t &&
    ((input.value = ""), input.blur()));
}
function getLectureSearchCopy(e = getZoneMode()) {
  if ("monuments" === e)
    return {
      placeholder: "Rechercher un monument (nom ou mot)",
      unavailable: "Aucun monument disponible pour cette zone.",
      notFound: "Monument introuvable dans la zone actuelle.",
      noResults: "Aucun monument trouvé.",
      srLabel: "Rechercher un monument",
    };
  if ("arrondissements-ville" === e)
    return {
      placeholder: "Rechercher un arrondissement (nom ou mot)",
      unavailable: "Aucun arrondissement disponible pour cette zone.",
      notFound: "Arrondissement introuvable dans la zone actuelle.",
      noResults: "Aucun arrondissement trouvé.",
      srLabel: "Rechercher un arrondissement",
    };
  return {
    placeholder: "Rechercher une rue (nom ou mot)",
    unavailable: "Aucune rue disponible pour cette zone.",
    notFound: "Rue introuvable dans la zone actuelle.",
    noResults: "Aucune rue trouvée.",
    srLabel: "Rechercher une rue",
  };
}
function focusMonumentByName(e) {
  const t = findMonumentLayerByName(e);
  if (!t) return null;
  if ("function" == typeof t.getLatLng && map) {
    const e = t.getLatLng();
    e && map.flyTo(e, Math.max(map.getZoom(), 15), { animate: !0, duration: 1.2 });
  }
  return highlightMonument(t, UI_THEME.mapStreetHover), t;
}
function focusLectureSearchResultByName(e) {
  if (!e) return null;
  if ("monuments" === getZoneMode()) return focusMonumentByName(e);
  if ("arrondissements-ville" === getZoneMode()) return focusArrondissementByName(e);
  const t = focusStreetByName(e);
  if (!t) return null;
  return t.feature && showStreetInfo(t.feature), t;
}
function buildLectureStreetSearchIndex() {
  let e = [];
  if ("monuments" === getZoneMode())
    e = allMonuments
      .map((e) =>
        "string" == typeof e?.properties?.name ? e.properties.name.trim() : "",
      )
      .filter((e) => !!e);
  else if ("arrondissements-ville" === getZoneMode())
    e = allArrondissementFeatures
      .map((e) => getArrondissementTargetName(e))
      .filter((e) => !!e);
  else {
    const t = buildUniqueStreetList(getCurrentZoneStreets());
    e = t
      .map((e) =>
        "string" == typeof e?.properties?.name ? e.properties.name.trim() : "",
      )
      .filter((e) => !!e);
  }
  const t = new Set();
  lectureStreetSearchIndex = e
    .filter((e) => {
      const r = normalizeSearchText(e);
      return !!r && (!t.has(r) && (t.add(r), !0));
    })
    .map((e) => {
      const t = normalizeSearchText(e);
      return {
        name: e,
        normalized: t,
        words: t.split(/[\s'’-]+/).filter(Boolean),
      };
    })
    .sort((e, t) => e.name.localeCompare(t.name, "fr", { sensitivity: "base" }));
}
function getLectureStreetMatchScore(e, t) {
  return e.normalized === t
    ? 0
    : e.normalized.startsWith(t)
      ? 1
      : e.words.some((e) => e.startsWith(t))
        ? 2
        : 3;
}
function findLectureStreetMatches(e) {
  const t = normalizeSearchText(e);
  if (!t) return [];
  return lectureStreetSearchIndex
    .filter((e) => e.normalized.includes(t))
    .sort((e, r) => {
      const a = getLectureStreetMatchScore(e, t),
        n = getLectureStreetMatchScore(r, t);
      return a - n || e.name.localeCompare(r.name, "fr", { sensitivity: "base" });
    })
    .slice(0, MAX_LECTURE_SEARCH_RESULTS);
}
function renderLectureStreetSearchResults(e) {
  const { results } = getLectureSearchElements();
  if (!results) return;
  if (!e || 0 === e.length) {
    const t = getLectureSearchCopy();
    const e = document.createElement("div");
    return (
      (e.className = "lecture-search-empty"),
      (e.textContent = t.noResults),
      (results.innerHTML = ""),
      results.appendChild(e),
      void results.classList.remove("hidden")
    );
  }
  (results.innerHTML = "",
    e.forEach((e) => {
      const t = document.createElement("button");
      ((t.type = "button"),
        (t.className = "lecture-search-result"),
        (t.textContent = e.name),
        t.addEventListener("click", () => {
          focusLectureStreetBySearchName(e.name);
        }),
        results.appendChild(t));
    }),
    results.classList.remove("hidden"));
}
function focusLectureStreetBySearchName(e) {
  const t = getLectureSearchCopy();
  if (!e) return;
  const r = focusLectureSearchResultByName(e);
  if (!r) return void showMessage(t.notFound, "error");
  const { input } = getLectureSearchElements();
  (input && (input.value = e), closeLectureStreetSearchResults());
}
function updateLectureStreetSearchResults() {
  const { input } = getLectureSearchElements();
  if (!input) return;
  const e = input.value.trim();
  return e
    ? (lectureStreetSearchMatches = findLectureStreetMatches(e),
      void renderLectureStreetSearchResults(lectureStreetSearchMatches))
    : void closeLectureStreetSearchResults();
}
function refreshLectureStreetSearchForCurrentMode(e = {}) {
  const t = !0 === e.preserveQuery,
    r = isLectureMode,
    a = getLectureSearchCopy(),
    { input } = getLectureSearchElements();
  if (!r)
    return void setLectureStreetSearchVisible(!1, t);
  const n = document.querySelector('label[for="lecture-search-input"]');
  n && (n.textContent = a.srLabel);
  (setLectureStreetSearchVisible(!0, t),
    buildLectureStreetSearchIndex(),
    input &&
    ((input.disabled = 0 === lectureStreetSearchIndex.length),
      input.setAttribute("aria-label", a.srLabel),
      (input.placeholder = 0 === lectureStreetSearchIndex.length ? a.unavailable : a.placeholder),
      t && input.value.trim() && lectureStreetSearchIndex.length > 0
        ? updateLectureStreetSearchResults()
        : closeLectureStreetSearchResults()));
}
function initLectureStreetSearch() {
  const { container, input } = getLectureSearchElements();
  if (!container || !input || input.__lectureSearchBound) return;
  ((input.__lectureSearchBound = !0),
    input.addEventListener("input", () => {
      updateLectureStreetSearchResults();
    }),
    input.addEventListener("focus", () => {
      input.value.trim() && updateLectureStreetSearchResults();
    }),
    input.addEventListener("keydown", (e) => {
      if ("Escape" === e.key) {
        closeLectureStreetSearchResults();
        return;
      }
      if ("Enter" === e.key) {
        e.preventDefault();
        const t = input.value.trim();
        const r = getLectureSearchCopy();
        if (!t) return;
        if (0 === lectureStreetSearchIndex.length)
          return void showMessage(r.unavailable, "warning");
        0 === lectureStreetSearchMatches.length &&
          (lectureStreetSearchMatches = findLectureStreetMatches(t));
        const a =
          lectureStreetSearchMatches[0] ||
          lectureStreetSearchIndex.find((e) => e.normalized === normalizeSearchText(t));
        a
          ? focusLectureStreetBySearchName(a.name)
          : showMessage(r.notFound, "error");
      }
    }),
    document.addEventListener("click", (e) => {
      container.contains(e.target) || closeLectureStreetSearchResults();
    }));
}
function updateStreetInfoPanelVisibility() {
  const e = document.getElementById("street-info-panel"),
    t = document.getElementById("street-info");
  if (!e || !t) return;
  const r = getZoneMode();
  updateStreetInfoPanelTitle(r);
  "rues-principales" === r || "main" === r
    ? (e.style.display = "block")
    : ((e.style.display = "none"),
      e.classList.remove("is-visible"),
      (t.textContent = ""),
      t.classList.remove("is-visible"));
}
function getStreetInfoPanelTitle(e = getZoneMode()) {
  return "rues-celebres" === e || "famous" === e
    ? "Infos rues célèbres"
    : "Infos rues principales";
}
function updateStreetInfoPanelTitle(e = getZoneMode()) {
  const t = document.getElementById("street-info-title");
  t && (t.textContent = getStreetInfoPanelTitle(e));
}
function enforceRegionalMapBounds() {
  if (!map) return;
  const e = L.latLngBounds(MAP_REGION_MAX_BOUNDS);
  map.setMaxBounds(e);
  const t = map.getBoundsZoom(e, !0);
  if (Number.isFinite(t)) {
    const r = Math.max(0, Math.min(19, Math.floor(4 * t) / 4));
    (map.setMinZoom(r),
      map.getZoom() < r && map.setZoom(r));
  }
  map.panInsideBounds(e, { animate: !1 });
}

function clientPointToContainerPoint(clientX, clientY) {
  if (!map || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const container = map.getContainer();
  if (!container) return null;
  const rect = container.getBoundingClientRect();
  return L.point(clientX - rect.left, clientY - rect.top);
}

function zoomMapBySingleStep(direction, aroundPoint = null) {
  if (!map || !Number.isFinite(direction) || 0 === direction) return !1;
  const step = direction > 0 ? DISCRETE_ZOOM_STEP : -DISCRETE_ZOOM_STEP;
  const minZoom = map.getMinZoom();
  const maxZoom = map.getMaxZoom();
  const currentZoom = map.getZoom();
  const targetZoom = Math.max(minZoom, Math.min(maxZoom, currentZoom + step));
  if (targetZoom === currentZoom) return !1;
  aroundPoint && "function" == typeof map.setZoomAround
    ? map.setZoomAround(aroundPoint, targetZoom, { animate: !0 })
    : map.setZoom(targetZoom, { animate: !0 });
  return !0;
}

function initDesktopDiscreteZoomControls() {
  if (!map || IS_TOUCH_DEVICE) return;
  const container = map.getContainer();
  if (!container || container.__pariciDesktopDiscreteZoomBound) return;
  container.__pariciDesktopDiscreteZoomBound = !0;

  let wheelAccumPx = 0;
  let wheelDirection = 0;
  let wheelResetTimeoutId = null;
  let pinchDirection = 0;
  let pinchResetTimeoutId = null;
  let gestureStartScale = null;
  let lastPinchZoomAt = 0;

  const resetWheelGesture = () => {
    wheelAccumPx = 0;
    wheelDirection = 0;
    wheelResetTimeoutId = null;
  };
  const resetPinchGesture = () => {
    pinchDirection = 0;
    pinchResetTimeoutId = null;
  };
  const scheduleWheelReset = () => {
    null !== wheelResetTimeoutId && clearTimeout(wheelResetTimeoutId);
    wheelResetTimeoutId = setTimeout(resetWheelGesture, DESKTOP_WHEEL_IDLE_MS);
  };
  const schedulePinchReset = () => {
    null !== pinchResetTimeoutId && clearTimeout(pinchResetTimeoutId);
    pinchResetTimeoutId = setTimeout(resetPinchGesture, DESKTOP_WHEEL_IDLE_MS);
  };
  const normalizeWheelDeltaPx = (event) => {
    if (1 === event.deltaMode) return event.deltaY * DESKTOP_LINE_DELTA_PX;
    if (2 === event.deltaMode) return event.deltaY * window.innerHeight;
    return event.deltaY;
  };

  container.addEventListener(
    "wheel",
    (event) => {
      if (!map || !map._loaded || !Number.isFinite(event.deltaY) || 0 === event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();

      const direction = event.deltaY < 0 ? 1 : -1;
      const aroundPoint = map.mouseEventToContainerPoint(event);

      if (event.ctrlKey) {
        if (pinchDirection !== direction) {
          pinchDirection = direction;
          zoomMapBySingleStep(direction, aroundPoint) && (lastPinchZoomAt = performance.now());
        }
        schedulePinchReset();
        return;
      }

      const deltaPx = normalizeWheelDeltaPx(event);
      if (!Number.isFinite(deltaPx) || 0 === deltaPx) return;

      if (wheelDirection !== direction) {
        wheelDirection = direction;
        wheelAccumPx = 0;
      }

      wheelAccumPx += Math.abs(deltaPx);
      if (wheelAccumPx >= DESKTOP_WHEEL_THRESHOLD_PX) {
        (zoomMapBySingleStep(direction, aroundPoint), (wheelAccumPx = 0));
      }
      scheduleWheelReset();
    },
    { passive: !1 },
  );

  container.addEventListener(
    "gesturestart",
    (event) => {
      if (!map || !map._loaded || "number" != typeof event.scale) return;
      event.preventDefault();
      gestureStartScale = event.scale || 1;
    },
    { passive: !1 },
  );

  container.addEventListener(
    "gestureend",
    (event) => {
      if (!map || !map._loaded || "number" != typeof event.scale || null === gestureStartScale) {
        gestureStartScale = null;
        return;
      }
      event.preventDefault();
      const now = performance.now();
      if (now - lastPinchZoomAt < DESKTOP_WHEEL_IDLE_MS) {
        gestureStartScale = null;
        return;
      }
      const ratio = event.scale / gestureStartScale;
      const direction = ratio > 1.04 ? 1 : ratio < 0.96 ? -1 : 0;
      if (0 !== direction) {
        const aroundPoint = clientPointToContainerPoint(event.clientX, event.clientY) ||
          map.getSize().divideBy(2);
        zoomMapBySingleStep(direction, aroundPoint);
      }
      gestureStartScale = null;
    },
    { passive: !1 },
  );
}

function initMobileTwoFingerDoubleTapZoomOut() {
  if (!map || !IS_TOUCH_DEVICE) return;
  const container = map.getContainer();
  if (!container || container.__pariciMobileTwoFingerDoubleTapBound) return;
  container.__pariciMobileTwoFingerDoubleTapBound = !0;

  let activeTwoFingerTap = null;
  let lastTwoFingerTap = null;

  container.addEventListener(
    "touchstart",
    (event) => {
      if (2 !== event.touches.length) {
        activeTwoFingerTap = null;
        return;
      }
      const starts = Array.from(event.touches).map((touch) => ({
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
      }));
      activeTwoFingerTap = {
        startedAt: performance.now(),
        starts,
        moved: !1,
      };
    },
    { passive: !0 },
  );

  container.addEventListener(
    "touchmove",
    (event) => {
      if (!activeTwoFingerTap || 2 !== event.touches.length) return;
      const startsById = new Map(activeTwoFingerTap.starts.map((entry) => [entry.id, entry]));
      Array.from(event.touches).forEach((touch) => {
        const start = startsById.get(touch.identifier);
        if (!start) {
          activeTwoFingerTap.moved = !0;
          return;
        }
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        Math.hypot(dx, dy) > MOBILE_TWO_FINGER_TAP_MAX_MOVE_PX && (activeTwoFingerTap.moved = !0);
      });
    },
    { passive: !0 },
  );

  container.addEventListener(
    "touchend",
    (event) => {
      if (!activeTwoFingerTap) return;
      if (event.touches.length > 0) return;

      const elapsedMs = performance.now() - activeTwoFingerTap.startedAt;
      const isTap = !activeTwoFingerTap.moved && elapsedMs <= MOBILE_TWO_FINGER_TAP_MAX_DURATION_MS;
      const center = L.point(
        (activeTwoFingerTap.starts[0].x + activeTwoFingerTap.starts[1].x) / 2,
        (activeTwoFingerTap.starts[0].y + activeTwoFingerTap.starts[1].y) / 2,
      );
      activeTwoFingerTap = null;
      if (!isTap) {
        lastTwoFingerTap = null;
        return;
      }
      const now = performance.now();

      if (
        lastTwoFingerTap &&
        now - lastTwoFingerTap.time <= MOBILE_TWO_FINGER_DOUBLE_TAP_DELAY_MS &&
        center.distanceTo(lastTwoFingerTap.center) <= MOBILE_TWO_FINGER_DOUBLE_TAP_MAX_DISTANCE_PX
      ) {
        event.preventDefault();
        event.stopPropagation();
        const aroundPoint = clientPointToContainerPoint(center.x, center.y);
        map.__pariciSuppressDblClickZoomUntil = now + MOBILE_TWO_FINGER_SUPPRESS_DBLCLICK_MS;
        zoomMapBySingleStep(-1, aroundPoint);
        lastTwoFingerTap = null;
        return;
      }

      lastTwoFingerTap = {
        time: now,
        center,
      };
    },
    { passive: !1 },
  );

  container.addEventListener(
    "touchcancel",
    () => {
      activeTwoFingerTap = null;
    },
    { passive: !0 },
  );
}

function initDiscreteDoubleTapZoomControls() {
  if (!map || map.__pariciDiscreteDblClickBound) return;
  map.__pariciDiscreteDblClickBound = !0;
  map.on("dblclick", (event) => {
    const now = performance.now();
    if (now < (map.__pariciSuppressDblClickZoomUntil || 0)) return;
    const originalEvent = event?.originalEvent || null;
    const direction = originalEvent?.shiftKey ? -1 : 1;
    const aroundPoint = originalEvent
      ? map.mouseEventToContainerPoint(originalEvent)
      : event?.latlng
        ? map.latLngToContainerPoint(event.latlng)
        : null;
    zoomMapBySingleStep(direction, aroundPoint);
  });
}
function initMap() {
  if (
    ((map = L.map("map", {
      tap: !0,
      tapTolerance: IS_TOUCH_DEVICE ? 25 : 15,
      doubleClickZoom: !1,
      scrollWheelZoom: !1,
      zoomSnap: 1,
      zoomDelta: 1,
      maxBounds: MAP_REGION_MAX_BOUNDS,
      maxBoundsViscosity: 1,
      renderer: L.canvas({ padding: 0.5 }),
    }).setView([48.8566, 2.3522], 12)),
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "Tiles © Esri" },
      ).addTo(map),
      void 0 !== L.Control.MiniMap)
  ) {
    const e = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      { maxZoom: 19, attribution: "© CartoDB" },
    );
    new L.Control.MiniMap(e, {
      position: "bottomright",
      toggleDisplay: !0,
      minimized: IS_TOUCH_DEVICE,
      width: IS_TOUCH_DEVICE ? 100 : 150,
      height: IS_TOUCH_DEVICE ? 100 : 150,
      zoomLevelOffset: -5,
      zoomLevelFixed: !1,
      collapsedWidth: 24,
      collapsedHeight: 24,
    }).addTo(map);
  }
  (initDiscreteDoubleTapZoomControls(),
    initDesktopDiscreteZoomControls(),
    initMobileTwoFingerDoubleTapZoomOut(),
    map.whenReady(enforceRegionalMapBounds),
    map.on("zoomend", refreshStreetLayerStylesForZoom),
    map.on("resize", enforceRegionalMapBounds));
}
function initUI() {
  (IS_TOUCH_DEVICE && document.body.classList.add("touch-mode"),
    initMobilePullToRefresh());
  const e = document.getElementById("restart-btn"),
    t = document.getElementById("mode-select"),
    r = document.getElementById("arrondissement-block"),
    a = document.getElementById("arrondissement-select"),
    n = document.getElementById("skip-btn"),
    s = document.getElementById("pause-btn"),
    i = document.getElementById("arrondissement-select-button"),
    l = document.getElementById("arrondissement-select-list"),
    o =
      (i && i.querySelector(".custom-select-label"),
        document.getElementById("login-btn")),
    u = document.getElementById("register-btn"),
    d = document.getElementById("logout-btn"),
    c = document.getElementById("auth-username"),
    m = document.getElementById("auth-password"),
    friendChallengeToggleBtn = document.getElementById("friends-challenge-toggle");
  (t && (currentZoneMode = t.value), updateModeDifficultyPill());
  const p = document.getElementById("mode-select-button"),
    g = document.getElementById("mode-select-list"),
    h = p ? p.querySelector(".custom-select-label") : null;
  p &&
    g &&
    (p.addEventListener("click", (e) => {
      (e.stopPropagation(), g.classList.toggle("visible"));
    }),
      g.querySelectorAll("li").forEach((e) => {
        e.addEventListener("click", () => {
          const r = e.dataset.value;
          if (
            activeFriendChallenge &&
            !isApplyingFriendChallengeConfig &&
            r !== activeFriendChallenge.mode
          ) {
            showMessage("Les paramètres sont verrouillés pour ce défi amis.", "warning");
            g.classList.remove("visible");
            return;
          }
          h && (h.textContent = e.childNodes[0].textContent.trim());
          const a = e.querySelector(".difficulty-pill"),
            n = p.querySelector(".difficulty-pill");
          if (a) {
            const e = a.cloneNode(!0);
            n ? n.replaceWith(e) : p.appendChild(e);
          }
          (t && ((t.value = r), t.dispatchEvent(new Event("change"))),
            g.classList.remove("visible"));
        });
      }));
  const y = document.getElementById("game-mode-select-button"),
    v = document.getElementById("game-mode-select-list"),
    f = y ? y.querySelector(".custom-select-label") : null,
    b = document.getElementById("game-mode-select");
  (y &&
    v &&
    b &&
    (y.addEventListener("click", (e) => {
      (e.stopPropagation(), v.classList.toggle("visible"));
    }),
      v.querySelectorAll("li").forEach((e) => {
        e.addEventListener("click", () => {
          const t = e.dataset.value;
          if (
            activeFriendChallenge &&
            !isApplyingFriendChallengeConfig &&
            t !== activeFriendChallenge.gameType
          ) {
            showMessage("Les paramètres sont verrouillés pour ce défi amis.", "warning");
            v.classList.remove("visible");
            return;
          }
          f && (f.textContent = e.childNodes[0].textContent.trim());
          const r = e.querySelector(".difficulty-pill");
          if (r) {
            const e = r.cloneNode(!0),
              t = y.querySelector(".difficulty-pill");
            t ? t.replaceWith(e) : y.appendChild(e);
          }
          ((b.value = t),
            isSessionRunning && endSession(),
            "lecture" !== t &&
            isLectureMode &&
            ((isLectureMode = !1),
              setLectureTooltipsEnabled(!1),
              refreshLectureStreetSearchForCurrentMode(),
              updateTargetPanelTitle(),
              updateLayoutSessionState()),
            updateGameModeControls(),
            (v.scrollTop = 0),
            v.classList.remove("visible"),
            "lecture" === t && requestAnimationFrame(() => prepareAndStartNewSession()));
        });
      })),
    i &&
    l &&
    i.addEventListener("click", (e) => {
      (e.stopPropagation(), l.classList.toggle("visible"));
    }),
    document.addEventListener("click", (e) => {
      (p &&
        g &&
        !p.contains(e.target) &&
        !g.contains(e.target) &&
        g.classList.remove("visible"),
        y &&
        v &&
        !y.contains(e.target) &&
        !v.contains(e.target) &&
        v.classList.remove("visible"),
        i &&
        l &&
        !i.contains(e.target) &&
        !l.contains(e.target) &&
        l.classList.remove("visible"));
    }),
    (currentUser = loadCurrentUserFromStorage()),
    updateUserUI(),
    initLectureStreetSearch());
  const S = document.getElementById("sound-toggle"),
    N = document.getElementById("haptics-toggle");
  (S &&
    (syncSoundToggleUI(),
      S.addEventListener("click", () => {
        toggleSound();
      })),
    N &&
    (updateHapticsUI(),
      N.addEventListener("click", () => {
        toggleHaptics();
      })),
    initOnboardingBanner(),
    initInstallPrompt({
      isStandaloneDisplayModeFn: isStandaloneDisplayMode,
      showMessage,
    }));
  function L(e) {
    const t = document.getElementById("offline-banner");
    t && (t.style.display = e ? "block" : "none");
  }
  (initTooltipPopup(),
    window.addEventListener("offline", () => L(!0)),
    window.addEventListener("online", () => {
      warmBackendConnection();
      checkBackendAvailability()
        .then(() => L(!1))
        .catch(() => L(!0));
    }),
    navigator.onLine
      ? scheduleAfterStartup(() => {
        checkBackendAvailability().catch(() => L(!0));
        loadUniqueVisitorCounter();
      }, 1800)
      : L(!0),
    e &&
    e.addEventListener("click", () => {
      isDailyMode && window._dailyGameOver
        ? stopSessionManually()
        : isSessionRunning
          ? stopSessionManually()
          : prepareAndStartNewSession();
    }),
    updateTargetPanelTitle(),
    s &&
    s.addEventListener("click", () => {
      isSessionRunning && togglePause();
    }));
  const M = document.getElementById("daily-mode-btn");
  (friendChallengeToggleBtn &&
    (updateFriendChallengeToggleUI(),
      friendChallengeToggleBtn.addEventListener("click", () => {
        handleFriendChallengeToggleClick();
      })),
    setGameConfigurationControlsLocked(!!activeFriendChallenge),
    loadFriendChallengeLeaderboard(),
    M && M.addEventListener("click", handleDailyModeClick),
    n &&
    n.addEventListener("click", () => {
      const applyMarathonSkipPenalty = () => {
        if ("marathon" !== getGameMode()) {
          return !1;
        }
        errorsCount += 1;
        updateSessionProgressBar();
        if (errorsCount >= MAX_ERRORS_MARATHON) {
          showMessage(`Passé (limite de ${MAX_ERRORS_MARATHON} erreurs atteinte)`, "error");
          return !0;
        }
        showMessage(`Passé (${errorsCount}/${MAX_ERRORS_MARATHON} erreurs)`, "warning");
        return !1;
      };

      if (isSessionRunning && !isPaused) {
        if ("monuments" === getZoneMode()) {
          if (!currentMonumentTarget) return;
          summaryData.push({
            name: currentMonumentTarget.properties.name,
            correct: !1,
            time: 0,
          });
          totalAnswered += 1;
          updateScoreUI();
          updateWeightedScoreUI();
          if (applyMarathonSkipPenalty()) {
            endSession();
            return;
          }
          currentMonumentIndex += 1;
          setNewTarget();
          return;
        }
        if ("arrondissements-ville" === getZoneMode()) {
          if (!currentArrondissementTarget) return;
          summaryData.push({
            name: getArrondissementTargetName(currentArrondissementTarget),
            correct: !1,
            time: 0,
          });
          totalAnswered += 1;
          updateScoreUI();
          updateWeightedScoreUI();
          if (applyMarathonSkipPenalty()) {
            endSession();
            return;
          }
          currentArrondissementIndex += 1;
          setNewTarget();
          return;
        }
        if (currentTarget) {
          summaryData.push({
            name: currentTarget.properties.name,
            correct: !1,
            time: 0,
          });
          totalAnswered += 1;
          updateScoreUI();
          updateWeightedScoreUI();
          if (applyMarathonSkipPenalty()) {
            endSession();
            return;
          }
          currentIndex += 1;
          setNewTarget();
        }
      }
    }),
    t &&
    t.addEventListener("change", () => {
      if (
        activeFriendChallenge &&
        !isApplyingFriendChallengeConfig &&
        t.value !== activeFriendChallenge.mode
      ) {
        t.value = activeFriendChallenge.mode;
        syncModeSelectButton();
        showMessage("Les paramètres sont verrouillés pour ce défi amis.", "warning");
        return;
      }
      currentZoneMode = t.value;
      const e = currentZoneMode;
      (updateTargetPanelTitle(),
        updateModeDifficultyPill(),
        updateScoreMetricUI(),
        streetsLayer &&
        streetLayersById.size &&
        streetLayersById.forEach((e) => {
          const t = getBaseStreetStyle(e),
            r = t.weight > 0;
          if (IS_TOUCH_DEVICE && r && !e.touchBuffer) {
            addTouchBufferForLayer(e);
          }
          (e.setStyle({ color: t.color, weight: t.weight }),
            (e.options.interactive = r),
            e.touchBuffer && (e.touchBuffer.options.interactive = r && !!e.touchBuffer));
        }),
        "arrondissement" === e
          ? ((r.style.display = "block"),
            loadArrondissements(),
            a && a.value && highlightArrondissement(a.value))
          : ((r.style.display = "none"), clearArrondissementOverlay()),
        setZoneLayersVisibility(e),
        "arrondissements-ville" === e && loadArrondissements(),
        "monuments" === e &&
        refreshMonumentsContentAndLayer().catch((error) => {
          console.warn("Actualisation des monuments impossible après changement de mode.", error);
        }),
        updateStreetInfoPanelVisibility(),
        refreshLectureTooltipsIfNeeded(),
        isLectureMode &&
        refreshLectureStreetSearchForCurrentMode({ preserveQuery: !0 }));
      const n = document.getElementById("street-info");
      n &&
        ("rues-principales" === e ||
          "main" === e ||
          ((n.textContent = ""), (n.style.display = "none")));
    }),
    a &&
    a.addEventListener("change", () => {
      if (
        activeFriendChallenge &&
        activeFriendChallenge.mode === "arrondissement" &&
        !isApplyingFriendChallengeConfig &&
        normalizeArrondissementKey(a.value) !== normalizeArrondissementKey(activeFriendChallenge.arrondissementName)
      ) {
        setArrondissementSelectionByName(activeFriendChallenge.arrondissementName);
        showMessage("Les paramètres sont verrouillés pour ce défi amis.", "warning");
        return;
      }
      ("arrondissement" === getZoneMode() && a.value
        ? highlightArrondissement(a.value)
        : clearArrondissementOverlay(),
        streetsLayer &&
        streetLayersById.size &&
        streetLayersById.forEach((e) => {
          const t = getBaseStreetStyle(e),
            r = t.weight > 0;
          if (IS_TOUCH_DEVICE && r && !e.touchBuffer) {
            addTouchBufferForLayer(e);
          }
          (e.setStyle({ color: t.color, weight: t.weight }),
            (e.options.interactive = r),
            e.touchBuffer && (e.touchBuffer.options.interactive = r && !!e.touchBuffer));
        }),
        refreshLectureTooltipsIfNeeded(),
        isLectureMode &&
        refreshLectureStreetSearchForCurrentMode({ preserveQuery: !0 }));
    }));
  const T = document.getElementById("auth-feedback");
  function E(e, t) {
    T && ((T.textContent = e), (T.className = "auth-feedback " + (t || "")));
  }
  const C = document.getElementById("toggle-password");
  (C &&
    m &&
    C.addEventListener("click", () => {
      const e = "password" === m.type;
      ((m.type = e ? "text" : "password"), (C.textContent = e ? "🙈" : "👁"));
    }),
    o &&
    o.addEventListener("click", async () => {
      E("", "");
      const e = (c?.value || "").trim(),
        t = m?.value || "";
      if (e && t)
        try {
          const r = await fetch(API_URL + "/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: e, password: t }),
          }),
            a = await r.json();
          if (!r.ok)
            return void (401 === r.status
              ? E("Identifiants incorrects.", "error")
              : E(a.error || "Erreur de connexion.", "error"));
          ((currentUser = { id: a.id, username: a.username, token: a.token }),
            saveCurrentUserToStorage(currentUser),
            updateUserUI(),
            E("Connexion réussie !", "success"));
        } catch (e) {
          (console.error("Erreur login :", e),
            E("Serveur injoignable.", "error"));
        }
      else E("Pseudo et mot de passe requis.", "error");
    }),
    u &&
    u.addEventListener("click", async () => {
      E("", "");
      const e = (c?.value || "").trim(),
        t = m?.value || "";
      if (e && t)
        if (t.length < 4)
          E("Mot de passe trop court (min. 4 caractères).", "error");
        else
          try {
            const r = await fetch(API_URL + "/api/register", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username: e, password: t }),
            }),
              a = await r.json();
            if (!r.ok)
              return void (a.error && a.error.includes("already taken")
                ? E("Ce pseudo est déjà pris.", "error")
                : E(a.error || "Erreur lors de l'inscription.", "error"));
            ((currentUser = {
              id: a.id,
              username: a.username,
              token: a.token,
            }),
              saveCurrentUserToStorage(currentUser),
              updateUserUI(),
              E("Compte créé !", "success"));
          } catch (e) {
            (console.error("Erreur register :", e),
              E("Serveur injoignable.", "error"));
          }
      else E("Pseudo et mot de passe requis.", "error");
    }),
    d &&
    d.addEventListener("click", () => {
      ((currentUser = null),
        clearCurrentUserFromStorage(),
        updateUserUI(),
        E("", ""));
    }));
  const q = document.getElementById("target-street");
  (q && (q.textContent = "—"),
    updateScoreUI(),
    updateTimeUI(0, 0),
    updateScoreMetricUI(),
    updateWeightedScoreUI(),
    updateSessionProgressBar(),
    updateStartStopButton(),
    updatePauseButton(),
    updateStreetInfoPanelVisibility(),
    updateLayoutSessionState(),
    updateGameModeControls(),
    ensureLectureBackButton(),
    "lecture" === getGameMode()
      ? startNewSession()
      : showMessage(
        'Cliquez sur "Commencer la session" une fois que la carte est chargée.',
        "info",
      ));
  const I = document.getElementById("summary");
  (I && ((I.classList.add("hidden"), (I.innerHTML = ""))), clearSessionShareSlot());
}

async function prepareAndStartNewSession() {
  const zoneMode = getZoneMode();
  if (
    zoneMode !== "monuments" &&
    zoneMode !== "arrondissements-ville" &&
    !areStreetsReady
  ) {
    showMessage("Chargement des rues...", "info");
    const loaded = await loadStreets({ force: true });
    if (!loaded) {
      showMessage("Impossible de lancer la session: rues indisponibles.", "error");
      return;
    }
  }
  if ("monuments" === zoneMode && !allMonuments.length) {
    showMessage("Chargement des monuments...", "info");
    await loadMonuments();
  }
  if ("arrondissements-ville" === zoneMode && !allArrondissementFeatures.length) {
    showMessage("Chargement des arrondissements...", "info");
    await loadArrondissements();
  }
  startNewSession();
}

document.addEventListener("DOMContentLoaded", async () => {
  (setMapStatus("Chargement", "loading"),
    initMap(),
    initUI(),
    startTimersLoop(),
    document.body.classList.add("app-ready"));

  scheduleAfterStartup(() => {
    warmBackendConnection();
    loadStreetInfos();
    initFriendChallengeModeFromUrl();
  }, 150);

  scheduleAfterStartup(() => {
    loadStreets();
  }, 650);

  scheduleAfterStartup(() => {
    loadArrondissements();
    loadMonuments();
    loadAllLeaderboards();
  }, 1200);
});
const infoEl = document.getElementById("street-info");
function startTimersLoop() {
  requestAnimationFrame(function e() {
    if (
      null !== sessionStartTime &&
      null !== streetStartTime &&
      isSessionRunning &&
      !isPaused &&
      (currentTarget || currentMonumentTarget || currentArrondissementTarget)
    ) {
      const t = performance.now(),
        r = (t - sessionStartTime) / 1e3,
        a = (t - streetStartTime) / 1e3;
      if ("classique" !== getGameMode() && MAX_TIME_SECONDS > 0 && (r >= MAX_TIME_SECONDS || a >= MAX_TIME_SECONDS))
        return (endSession(), void requestAnimationFrame(e));
      if (isChronoMode && null !== chronoEndTime && t >= chronoEndTime)
        return (endSession(), void requestAnimationFrame(e));
      (updateTimeUI(
        r,
        a,
        isChronoMode && null !== chronoEndTime
          ? Math.max(0, (chronoEndTime - t) / 1e3)
          : null,
      ),
        "classique" === getGameMode() &&
          (hasAnsweredCurrentItem || updateWeightedBar(computeItemPoints(a) / 10)));
    }
    requestAnimationFrame(e);
  });
}
function showMessage(e, t) {
  const r = document.getElementById("message");
  r &&
    ((r.className = "message"),
      "success" === t
        ? r.classList.add("message--success")
        : "error" === t
          ? r.classList.add("message--error")
          : r.classList.add("message--info"),
      (r.textContent = e),
      r.classList.add("message--visible"),
      null !== messageTimeoutId && clearTimeout(messageTimeoutId),
      (messageTimeoutId = setTimeout(() => {
        (r.classList.remove("message--visible"), (messageTimeoutId = null));
      }, 3e3)));
}
function clearSessionShareSlot() {
  const e = document.getElementById("session-share-slot");
  e && ((e.innerHTML = ""), e.classList.add("hidden"));
}
function getBaseStreetStyleFromName(e) {
  return getBaseStreetStyleFromNameCore({
    zoneMode: getZoneMode(),
    streetName: e,
    normalizeName,
    uiTheme: UI_THEME,
    mainStreetNames: MAIN_STREET_NAMES_RUNTIME,
    famousStreetNames: FAMOUS_STREET_NAMES_RUNTIME,
  });
}
function getBaseStreetStyle(e) {
  const t = getBaseStreetStyleCore({
    layerOrFeature: e,
    zoneMode: getZoneMode(),
    selectedArrondissement: getSelectedArrondissement(),
    normalizeName,
    uiTheme: UI_THEME,
    mainStreetNames: MAIN_STREET_NAMES_RUNTIME,
    famousStreetNames: FAMOUS_STREET_NAMES_RUNTIME,
  });
  return { ...t, weight: getAdaptiveStreetWeight(t.weight) };
}
function getStreetWeightScale() {
  if (!map || "function" != typeof map.getZoom) return 1;
  const e = map.getZoom();
  if (!Number.isFinite(e)) return 1;
  return e >= 13 ? Math.min(1.12, 1 + 0.03 * (e - 13)) : Math.max(0.38, 1 - 0.16 * (13 - e));
}
function getAdaptiveStreetWeight(e) {
  const t = Number(e) || 0;
  if (t <= 0) return 0;
  return Math.max(1.25, Math.round(t * getStreetWeightScale() * 10) / 10);
}
function getStreetHighlightStyle(e, t = 7) {
  return { color: e, weight: getAdaptiveStreetWeight(t), opacity: 1 };
}
function refreshStreetLayerStylesForZoom() {
  if (!streetsLayer || !streetLayersById || !streetLayersById.size) return;
  streetLayersById.forEach((e) => {
    if (!e || "function" != typeof e.setStyle) return;
    if (e.__pariciLockedStyle) {
      const t = e.__pariciLockedStyleBaseWeight || e.__pariciLockedStyle.weight || 7;
      e.__pariciLockedStyle = { ...e.__pariciLockedStyle, weight: getAdaptiveStreetWeight(t) };
      e.setStyle(e.__pariciLockedStyle);
      return;
    }
    if (isLayerHighlighted(e)) return;
    const t = getBaseStreetStyle(e);
    e.setStyle({ color: t.color, weight: t.weight, opacity: t.opacity });
  });
}
function isStreetVisibleInCurrentMode(e, t) {
  return isStreetVisibleInCurrentModeCore({
    zoneMode: getZoneMode(),
    normalizedStreetName: e,
    arrondissementName: t,
    selectedArrondissement: getSelectedArrondissement(),
    famousStreetNames: FAMOUS_STREET_NAMES_RUNTIME,
    mainStreetNames: MAIN_STREET_NAMES_RUNTIME,
  });
}
function getArrondissementTargetName(e) {
  return "string" == typeof e?.properties?.nom_qua ? e.properties.nom_qua.trim() : "";
}
function getArrondissementBaseStyle() {
  return {
    color: UI_THEME.mapArrondissement,
    weight: 2,
    opacity: 0.9,
    fillColor: UI_THEME.mapArrondissement,
    fillOpacity: 0.16,
  };
}
function setZoneLayersVisibility(e = getZoneMode()) {
  if (!map) return;
  if ("monuments" === e) {
    (arrondissementsLayer && map.hasLayer(arrondissementsLayer) && map.removeLayer(arrondissementsLayer),
      streetsLayer && map.hasLayer(streetsLayer) && map.removeLayer(streetsLayer),
      monumentsLayer && !map.hasLayer(monumentsLayer) && monumentsLayer.addTo(map));
    return;
  }
  if ("arrondissements-ville" === e) {
    (monumentsLayer && map.hasLayer(monumentsLayer) && map.removeLayer(monumentsLayer),
      streetsLayer && map.hasLayer(streetsLayer) && map.removeLayer(streetsLayer),
      arrondissementsLayer && !map.hasLayer(arrondissementsLayer) && arrondissementsLayer.addTo(map));
    return;
  }
  (monumentsLayer && map.hasLayer(monumentsLayer) && map.removeLayer(monumentsLayer),
    arrondissementsLayer && map.hasLayer(arrondissementsLayer) && map.removeLayer(arrondissementsLayer),
    streetsLayer && !map.hasLayer(streetsLayer) && streetsLayer.addTo(map));
}
function addTouchBufferForLayer(e) {
  addTouchBufferForLayerRuntime(e, { isTouchDevice: IS_TOUCH_DEVICE, map, L });
}
function syncDailyModeButtonLoadingState() {
  const dailyModeBtn = document.getElementById("daily-mode-btn");
  if (!dailyModeBtn) {
    return;
  }

  const isLoading = !areStreetsReady && !!streetsLoadingPromise;
  dailyModeBtn.disabled = isLoading;
  dailyModeBtn.setAttribute("aria-busy", isLoading ? "true" : "false");
  dailyModeBtn.title = isLoading ? "Chargement des rues..." : "";
}

function requestMapInvalidateSize() {
  if (!map) {
    return;
  }

  mapInvalidateTimeoutIds.forEach((timeoutId) => {
    clearTimeout(timeoutId);
  });
  mapInvalidateTimeoutIds = [];

  [0, 160, 420].forEach((delayMs) => {
    const timeoutId = setTimeout(() => {
      if (!map) {
        return;
      }

      try {
        map.invalidateSize({ pan: false, animate: false });
      } catch (error) {
        map.invalidateSize();
      }
    }, delayMs);
    mapInvalidateTimeoutIds.push(timeoutId);
  });
}

function loadStreets({ force = false } = {}) {
  if (streetsLoadingPromise) {
    return streetsLoadingPromise;
  }

  if (areStreetsReady && !force) {
    return Promise.resolve(true);
  }

  streetsLoadingPromise = loadStreetsRuntime({
    map,
    L,
    uiTheme: UI_THEME,
    apiUrl: API_URL,
    isTouchDevice: IS_TOUCH_DEVICE,
    normalizeName,
    getBaseStreetStyle,
    getStreetHighlightStyle,
    isStreetVisibleInCurrentMode,
    isLayerHighlighted: (layer) =>
      (highlightedLayers && highlightedLayers.includes(layer)) ||
      (dailyLastGuessHighlightLayers && dailyLastGuessHighlightLayers.includes(layer)),
    handleStreetClick,
    addTouchBufferForLayer,
  })
    .then((result) => {
      areStreetsReady = true;
      allStreetFeatures = result.allStreetFeatures;
      streetsLayer = result.streetsLayer;
      streetLayersById = result.streetLayersById;
      streetLayersByName = result.streetLayersByName;

      console.log(
        `Rues chargées : ${allStreetFeatures.length} en ${result.loadedMs}ms (source: ${result.loadedFrom})`,
      );
      refreshLectureTooltipsIfNeeded();
      refreshLectureStreetSearchForCurrentMode({ preserveQuery: !0 });
      populateArrondissements();
      refreshLectureTooltipsIfNeeded();

      const modeSelect = document.getElementById("mode-select");
      if (modeSelect) {
        modeSelect.dispatchEvent(new Event("change"));
      }

      if (window.innerWidth > 900) {
        showMessage(
          'Carte chargée. Choisissez la zone, le type de partie, puis cliquez sur "Commencer la session".',
          "info",
        );
      }

      setMapStatus("Carte OK", "ready");
      document.body.classList.add("app-ready");
      requestMapInvalidateSize();
      return true;
    })
    .catch((e) => {
      areStreetsReady = false;
      console.error("Erreur lors du chargement des rues :", e);
      showMessage("Erreur de chargement des rues (voir console).", "error");
      setMapStatus("Erreur", "error");
      return false;
    })
    .finally(() => {
      streetsLoadingPromise = null;
      syncDailyModeButtonLoadingState();
    });

  syncDailyModeButtonLoadingState();
  return streetsLoadingPromise;
}
function loadMonuments() {
  if (monumentsLoadingPromise) {
    return monumentsLoadingPromise;
  }

  monumentsLoadingPromise = loadMonumentsRuntime({
    map,
    L,
    uiTheme: UI_THEME,
    isTouchDevice: IS_TOUCH_DEVICE,
    handleMonumentClick,
    allowedMonumentNames: MONUMENT_NAMES_RUNTIME,
    runtimeMonuments: MONUMENT_FEATURES_RUNTIME,
  })
    .then((result) => {
      allMonuments = result.allMonuments;
      console.log("Nombre de monuments chargés :", allMonuments.length);
      if (allMonuments.length === 0) {
        console.warn("Aucun monument trouvé après filtrage.");
      }

      if (monumentsLayer) {
        map.removeLayer(monumentsLayer);
        monumentsLayer = null;
      }
      monumentsLayer = result.monumentsLayer;

      refreshLectureTooltipsIfNeeded();
      setZoneLayersVisibility(getZoneMode());
    })
    .catch((e) => {
      console.error("Erreur lors du chargement des monuments :", e);
    })
    .finally(() => {
      monumentsLoadingPromise = null;
    });

  return monumentsLoadingPromise;
}

function refreshMonumentsContentAndLayer() {
  if (monumentsContentSyncPromise) {
    return monumentsContentSyncPromise;
  }

  monumentsContentSyncPromise = (async () => {
    try {
      await loadPublicContentFromApi();
    } catch (error) {
      console.warn("Impossible d'actualiser les monuments via API, conservation du cache runtime.", error);
    }
    await loadMonuments();
  })().finally(() => {
    monumentsContentSyncPromise = null;
  });

  return monumentsContentSyncPromise;
}
function setLectureTooltipsEnabled(e) {
  setLectureTooltipsEnabledRuntime(e, {
    streetsLayer,
    monumentsLayer,
    arrondissementsLayer,
    getBaseStreetStyle,
    isStreetVisibleInCurrentMode,
    normalizeName,
    isTouchDevice: IS_TOUCH_DEVICE,
  });
}
function refreshLectureTooltipsIfNeeded() {
  ("lecture" !== getGameMode() && !0 !== isLectureMode) ||
    setLectureTooltipsEnabled(!0);
}
function loadArrondissements() {
  if (arrondissementsLoadingPromise) {
    return arrondissementsLoadingPromise;
  }

  if (allArrondissementFeatures.length && arrondissementsLayer) {
    return Promise.resolve(true);
  }

  arrondissementsLoadingPromise = loadArrondissementsRuntime({
    map,
    L,
    uiTheme: UI_THEME,
    normalizeArrondissementKey,
    handleArrondissementClick,
  })
    .then((result) => {
      allArrondissementFeatures = result.allArrondissementFeatures;
      arrondissementsLayer = result.arrondissementsLayer;
      arrondissementPolygonsByName = result.arrondissementPolygonsByName;
      arrondissementLayersByKey = result.arrondissementLayersByKey;

      console.log("Arrondissements chargés :", arrondissementPolygonsByName.size);
      console.log("Noms de arrondissements (polygones):");
      console.log(Array.from(arrondissementPolygonsByName.keys()).sort());

      setZoneLayersVisibility(getZoneMode());
      refreshLectureTooltipsIfNeeded();
    })
    .catch((e) => {
      console.error("Erreur lors du chargement des arrondissements :", e);
    })
    .finally(() => {
      arrondissementsLoadingPromise = null;
    });

  return arrondissementsLoadingPromise;
}
function highlightArrondissement(e) {
  arrondissementOverlay = highlightArrondissementOnMap({
    map,
    L,
    arrondissementName: e,
    arrondissementPolygonsByName,
    uiTheme: UI_THEME,
    existingOverlay: arrondissementOverlay,
  });
}
function clearArrondissementOverlay() {
  arrondissementOverlay = clearArrondissementOverlayLayer(map, arrondissementOverlay);
}
function populateArrondissements() {
  populateArrondissementsUI({
    allStreetFeatures,
    arrondissementByArrondissement,
    onArrondissementChange: () => {
      const nativeSelect = document.getElementById("arrondissement-select");
      nativeSelect && nativeSelect.dispatchEvent(new Event("change"));
    },
  });
  if (pendingFriendChallengeArrondissementName) {
    setArrondissementSelectionByName(pendingFriendChallengeArrondissementName) &&
      (pendingFriendChallengeArrondissementName = null);
  }
}
function scrollSidebarToTargetPanel() {
  if (window.innerWidth >= 900) return;
  const e = document.getElementById("sidebar"),
    t = document.querySelector(".target-panel");
  e &&
    t &&
    setTimeout(() => {
      const r = t.offsetTop,
        a = t.offsetHeight,
        n = r - e.clientHeight / 2 + a / 2;
      e.scrollTo({ top: n, behavior: "smooth" });
    }, 350);
}
function ensureLectureBackButton() {
  if (document.getElementById("lecture-back-btn")) return;
  const e = document.querySelector(".target-panel");
  if (!e) return;
  const t = document.createElement("button");
  ((t.id = "lecture-back-btn"),
    (t.type = "button"),
    (t.className = "btn btn-secondary lecture-back-btn"),
    (t.textContent = "Retour au menu"),
    e.insertAdjacentElement("afterend", t),
    t.addEventListener("click", exitLectureModeToMenu),
    (t.style.display = "none"));
}
function exitLectureModeToMenu() {
  ((isLectureMode = !1),
    setLectureTooltipsEnabled(!1),
    (isSessionRunning = !1),
    (activeSessionId = null),
    (isChronoMode = !1),
    (chronoEndTime = null),
    (sessionStartTime = null),
    (streetStartTime = null),
    (isPaused = !1),
    (pauseStartTime = null),
    (remainingChronoMs = null));
  const e = document.getElementById("game-mode-select");
  e && (e.value = "classique");
  const t = document.getElementById("game-mode-select-button"),
    r = document.getElementById("game-mode-select-list");
  if (t && r) {
    const e = t.querySelector(".custom-select-label"),
      a = r.querySelector('li[data-value="classique"]');
    if (e && a) {
      e.textContent = a.childNodes[0].textContent.trim();
      const r = a.querySelector(".difficulty-pill");
      if (r) {
        const e = r.cloneNode(!0),
          a = t.querySelector(".difficulty-pill");
        a ? a.replaceWith(e) : t.appendChild(e);
      }
    }
  }
  const a = document.getElementById("target-street");
  (a && (a.textContent = "—"),
    updateTargetPanelTitle(),
    updateTimeUI(0, 0),
    updateStartStopButton(),
    updatePauseButton(),
    updateGameModeControls(),
    refreshLectureStreetSearchForCurrentMode(),
    updateLayoutSessionState(),
    showMessage("Retour au menu.", "info"));
}
function startNewSession(options = {}) {
  document.body.classList.remove("session-ended");
  clearDailyTransientUiState();
  const e = document.getElementById("arrondissement-select"),
    a = document.getElementById("street-info");
  let t = getZoneMode(),
    r = getGameMode();
  const skipMonumentsRefresh = !0 === options.skipMonumentsRefresh;
  if (activeFriendChallenge) {
    if (
      t !== activeFriendChallenge.mode ||
      r !== activeFriendChallenge.gameType ||
      ("arrondissement" === activeFriendChallenge.mode &&
        normalizeArrondissementKey(getSelectedArrondissement()) !== normalizeArrondissementKey(activeFriendChallenge.arrondissementName))
    ) {
      applyFriendChallengeConfigToUI(activeFriendChallenge);
      t = getZoneMode();
      r = getGameMode();
    }
    if ("arrondissement" === activeFriendChallenge.mode && activeFriendChallenge.arrondissementName) {
      setArrondissementSelectionByName(activeFriendChallenge.arrondissementName) ||
        (pendingFriendChallengeArrondissementName = activeFriendChallenge.arrondissementName);
    }
  }
  if ("monuments" === t && !skipMonumentsRefresh) {
    if (monumentsSessionRefreshPending) {
      return;
    }
    monumentsSessionRefreshPending = !0;
    showMessage("Actualisation des monuments...", "info");
    refreshMonumentsContentAndLayer()
      .catch((error) => {
        console.warn("Actualisation des monuments avant session impossible.", error);
      })
      .finally(() => {
        monumentsSessionRefreshPending = !1;
        startNewSession({ skipMonumentsRefresh: !0 });
      });
    return;
  }
  (a && ((a.textContent = ""), (a.style.display = "none")),
    clearDailyLastGuessHighlight(),
    clearHighlight(),
    (activeSessionId = generateSessionId()),
    (correctCount = 0),
    (totalAnswered = 0),
    (summaryData = []),
    (weightedScore = 0),
    (errorsCount = 0),
    (isPaused = !1),
    (pauseStartTime = null),
    (remainingChronoMs = null),
    updateScoreUI(),
    updateTimeUI(0, 0),
    updateScoreMetricUI(),
    updateWeightedScoreUI(),
    updateSessionProgressBar());
  const n = document.getElementById("summary");
  if (
    (n && ((n.classList.add("hidden"), (n.innerHTML = ""))),
      clearSessionShareSlot(),
      (isChronoMode = "chrono" === r),
      (chronoEndTime = isChronoMode ? performance.now() + CHRONO_DURATION * 1e3 : null),
      setLectureTooltipsEnabled(!1),
      "lecture" === r)
  ) {
    ((isLectureMode = !0),
      (isSessionRunning = !1),
      (isChronoMode = !1),
      (chronoEndTime = null),
      (sessionStartTime = null),
      (streetStartTime = null),
      (currentTarget = null),
      (currentMonumentTarget = null),
      (currentArrondissementTarget = null),
      (isPaused = !1),
      (pauseStartTime = null),
      (remainingChronoMs = null),
      updateTargetPanelTitle(),
      updateLayoutSessionState(),
      setZoneLayersVisibility(t),
      "arrondissement" === t && e && e.value
        ? highlightArrondissement(e.value)
        : clearArrondissementOverlay(),
      (() => {
        const r = document.getElementById("target-street");
        r &&
          ("monuments" === t || "arrondissements-ville" === t
            ? ((r.textContent = "Mode lecture : survolez la carte"),
              requestAnimationFrame(fitTargetStreetText))
            : (r.textContent = "—"));
      })(),
      refreshLectureStreetSearchForCurrentMode());
    const r = document.getElementById("pause-btn");
    r && ((r.disabled = !0), (r.textContent = "Pause"));
    const a = document.getElementById("skip-btn");
    return (
      a && (a.style.display = "none"),
      updateStartStopButton(),
      updatePauseButton(),
      updateTimeUI(0, 0),
      setLectureTooltipsEnabled(!0),
      void showMessage(
        "arrondissements-ville" === t
          ? "Mode lecture : survolez les arrondissements pour voir leur nom."
          : "Mode lecture : utilisez la recherche ou survolez la carte pour voir les noms.",
        "info",
      )
    );
  }
  if (
    ((isLectureMode = !1),
      updateTargetPanelTitle(),
      refreshLectureStreetSearchForCurrentMode(),
      "monuments" === t)
  ) {
    if (!allMonuments.length)
      return void showMessage(
        "Aucun monument disponible (vérifiez data/paris_monuments.geojson).",
        "error",
      );
    if (
      (setZoneLayersVisibility(t),
        clearArrondissementOverlay(),
        activeFriendChallenge)
    ) {
      sessionMonuments = getFriendChallengeMonumentTargets();
    } else if ("marathon" === r || "chrono" === r) {
      sessionMonuments = sampleWithoutReplacement(
        allMonuments,
        allMonuments.length,
      );
    } else {
      const e = Math.min(SESSION_SIZE, allMonuments.length);
      sessionMonuments = sampleWithoutReplacement(allMonuments, e);
    }
    if (!sessionMonuments.length)
      return void showMessage(
        activeFriendChallenge
          ? "Impossible de démarrer ce défi amis (monuments introuvables)."
          : "Aucun monument disponible pour cette session.",
        "error",
      );
    ((currentMonumentIndex = 0),
      (currentMonumentTarget = null),
      (currentTarget = null),
      (currentArrondissementTarget = null),
      (isMonumentsMode = !0),
      (sessionStartTime = performance.now()),
      (streetStartTime = null),
      (isSessionRunning = !0),
      updateStartStopButton(),
      updatePauseButton(),
      updateLayoutSessionState(),
      scrollSidebarToTargetPanel());
    const e = document.getElementById("skip-btn");
    return (
      e && (e.style.display = "inline-block"),
      setNewTarget(),
      showMessage("Session monuments démarrée.", "info"),
      void updateLayoutSessionState()
    );
  }
  if (
    ((isLectureMode = !1),
      (isMonumentsMode = !1),
      "arrondissements-ville" === t)
  ) {
    if (!allArrondissementFeatures.length)
      return void showMessage(
        "Aucun arrondissement disponible (vérifiez data/paris_arrondissements.geojson).",
        "error",
      );

    if (activeFriendChallenge) {
      sessionArrondissements = getFriendChallengeArrondissementTargets();
    } else if ("marathon" === r || "chrono" === r) {
      sessionArrondissements = sampleWithoutReplacement(allArrondissementFeatures, allArrondissementFeatures.length);
    } else {
      const e = Math.min(SESSION_SIZE, allArrondissementFeatures.length);
      sessionArrondissements = sampleWithoutReplacement(allArrondissementFeatures, e);
    }
    if (!sessionArrondissements.length)
      return void showMessage(
        activeFriendChallenge
          ? "Impossible de démarrer ce défi amis (arrondissements introuvables)."
          : "Aucun arrondissement disponible pour cette session.",
        "error",
      );

    ((currentArrondissementIndex = 0),
      (currentArrondissementTarget = null),
      (currentTarget = null),
      (currentMonumentTarget = null),
      setZoneLayersVisibility(t),
      clearArrondissementOverlay(),
      (sessionStartTime = performance.now()),
      (streetStartTime = null),
      (isSessionRunning = !0),
      updateStartStopButton(),
      updatePauseButton(),
      updateLayoutSessionState(),
      scrollSidebarToTargetPanel());
    const e = document.getElementById("skip-btn");
    return (
      e && (e.style.display = "inline-block"),
      setNewTarget(),
      showMessage("Session arrondissements démarrée.", "info"),
      void updateLayoutSessionState()
    );
  }
  if (
    ((isLectureMode = !1),
      (isMonumentsMode = !1),
      0 === allStreetFeatures.length)
  )
    return void showMessage(
      "Impossible de démarrer : données rues non chargées.",
      "error",
    );
  const s = getCurrentZoneStreets();
  if (0 === s.length)
    return void showMessage("Aucune rue disponible pour cette zone.", "error");
  const i = buildUniqueStreetList(s);
  if (0 === i.length)
    return void showMessage(
      "Aucune rue nommée disponible pour cette zone.",
      "error",
    );
  if (activeFriendChallenge) {
    sessionStreets = getFriendChallengeStreetTargets();
  } else if ("marathon" === r || "chrono" === r) {
    sessionStreets = sampleWithoutReplacement(i, i.length);
  } else {
    const e = Math.min(SESSION_SIZE, i.length);
    sessionStreets = sampleWithoutReplacement(i, e);
  }
  if (!sessionStreets.length)
    return void showMessage(
      activeFriendChallenge
        ? "Impossible de démarrer ce défi amis (rues introuvables)."
        : "Aucune rue disponible pour cette session.",
      "error",
    );
  ((currentIndex = 0),
    "arrondissement" === t && e && e.value
      ? highlightArrondissement(e.value)
      : clearArrondissementOverlay(),
    setZoneLayersVisibility(t),
    (sessionStartTime = performance.now()),
    (currentTarget = null),
    (currentMonumentTarget = null),
    (currentArrondissementTarget = null),
    (streetStartTime = null),
    (isSessionRunning = !0),
    updateStartStopButton(),
    updatePauseButton(),
    updateLayoutSessionState(),
    scrollSidebarToTargetPanel());
  const l = document.getElementById("skip-btn");
  (l && !isLectureMode && (l.style.display = "inline-block"),
    setNewTarget(),
    showMessage("Session démarrée.", "info"));
}
function getCurrentZoneStreets() {
  return getCurrentZoneStreetsCore({
    allStreetFeatures,
    zoneMode: getZoneMode(),
    selectedArrondissement: getSelectedArrondissement(),
    normalizeName,
    mainStreetNames: MAIN_STREET_NAMES_RUNTIME,
    famousStreetNames: FAMOUS_STREET_NAMES_RUNTIME,
  });
}
function buildUniqueStreetList(e) {
  return buildUniqueStreetListCore(e, normalizeName);
}
function setNewTarget() {
  const e = getGameMode();
  if ("monuments" === getZoneMode()) {
    if (currentMonumentIndex >= sessionMonuments.length) {
      if ("chrono" !== e) return void endSession();
      activeFriendChallenge
        ? (currentMonumentIndex = 0)
        : (shuffle(sessionMonuments), (currentMonumentIndex = 0));
    }
    ((currentTarget = null),
      (currentMonumentTarget = sessionMonuments[currentMonumentIndex]),
      (streetStartTime = performance.now()),
      (hasAnsweredCurrentItem = !1),
      resetWeightedBar());
    const t = currentMonumentTarget.properties.name,
      r = document.getElementById("target-street");
    return (
      r &&
      ((r.textContent = t || "—"),
        requestAnimationFrame(fitTargetStreetText)),
      updateTargetItemCounter(),
      void triggerTargetPulse()
    );
  }
  if ("arrondissements-ville" === getZoneMode()) {
    if (currentArrondissementIndex >= sessionArrondissements.length) {
      if ("chrono" !== e) return void endSession();
      activeFriendChallenge
        ? (currentArrondissementIndex = 0)
        : (shuffle(sessionArrondissements), (currentArrondissementIndex = 0));
    }
    ((currentTarget = null),
      (currentMonumentTarget = null),
      (currentArrondissementTarget = sessionArrondissements[currentArrondissementIndex]),
      (streetStartTime = performance.now()),
      (hasAnsweredCurrentItem = !1),
      resetWeightedBar());
    const t = getArrondissementTargetName(currentArrondissementTarget),
      r = document.getElementById("target-street");
    return (
      r &&
      ((r.textContent = t || "—"),
        requestAnimationFrame(fitTargetStreetText)),
      updateTargetItemCounter(),
      void triggerTargetPulse()
    );
  }
  if (currentIndex >= sessionStreets.length) {
    if ("chrono" !== e) return void endSession();
    activeFriendChallenge
      ? (currentIndex = 0)
      : (shuffle(sessionStreets), (currentIndex = 0));
  }
  ((currentMonumentTarget = null),
    (currentArrondissementTarget = null),
    (currentTarget = sessionStreets[currentIndex]),
    (streetStartTime = performance.now()),
    (hasAnsweredCurrentItem = !1),
    resetWeightedBar());
  const t = currentTarget.properties.name,
    r = document.getElementById("target-street");
  (r &&
    ((r.textContent = t || "—"), requestAnimationFrame(fitTargetStreetText)),
    updateTargetItemCounter(),
    triggerTargetPulse());
}
function triggerTargetPulse() {
  const e = document.querySelector(".target-panel");
  e && (e.classList.remove("pulse"), e.offsetWidth, e.classList.add("pulse"));
}
function updateStartStopButton() {
  const e = document.getElementById("restart-btn"),
    t = document.getElementById("skip-btn");
  if (e)
    return "lecture" === getGameMode()
      ? ((e.style.display = "none"), void (t && (t.style.display = "none")))
      : isDailyMode
        ? ((e.style.display = ""),
          void (window._dailyGameOver
            ? ((e.textContent = "Retour au menu"),
              e.classList.remove("btn-stop"),
              e.classList.remove("btn-primary"),
              e.classList.add("btn-secondary"),
              t && (t.style.display = "none"))
            : ((e.textContent = "Quitter le défi"),
              e.classList.remove("btn-primary"),
              e.classList.remove("btn-secondary"),
              e.classList.add("btn-stop"),
              t && (t.style.display = "none"))))
      : ((e.style.display = ""),
        void (isSessionRunning
          ? ((e.textContent = "Arrêter la session"),
            e.classList.remove("btn-primary"),
            e.classList.remove("btn-secondary"),
            e.classList.add("btn-stop"),
            t && (t.style.display = "block"))
          : ((e.textContent = "Commencer la session"),
            e.classList.remove("btn-stop"),
            e.classList.remove("btn-secondary"),
            e.classList.add("btn-primary"),
            t && (t.style.display = "none"))));
}
function stopSessionManually() {
  (isSessionRunning || isDailyMode) &&
    (("function" == typeof handleDailyStop && handleDailyStop()) ||
      endSession());
}
function togglePause() {
  if (isSessionRunning) {
    if (isPaused) {
      const e = performance.now(),
        t = e - pauseStartTime;
      (null !== sessionStartTime && (sessionStartTime += t),
        null !== streetStartTime && (streetStartTime += t),
        isChronoMode &&
        null !== remainingChronoMs &&
        ((chronoEndTime = e + remainingChronoMs), (remainingChronoMs = null)),
        (isPaused = !1),
        (pauseStartTime = null));
    } else
      ((isPaused = !0),
        (pauseStartTime = performance.now()),
        isChronoMode &&
        null !== chronoEndTime &&
        (remainingChronoMs = chronoEndTime - pauseStartTime));
    updatePauseButton();
  }
}
function updatePauseButton() {
  const e = document.getElementById("pause-btn");
  if (e)
    if ("lecture" !== getGameMode()) {
      if (!isSessionRunning)
        return (
          (e.style.display = "none"),
          (e.textContent = "Pause"),
          void (e.disabled = !0)
        );
      ((e.style.display = "block"),
        (e.disabled = !1),
        (e.textContent = isPaused ? "Reprendre" : "Pause"));
    } else e.style.display = "none";
}
function updateLayoutSessionState() {
  const e = document.body;
  if (!e) return;
  const t = isSessionRunning || isLectureMode || (isDailyMode && !!window._dailyGameOver);
  if (
    (t
      ? e.classList.add("session-running")
      : e.classList.remove("session-running"),
      isLectureMode
        ? e.classList.add("lecture-mode")
        : e.classList.remove("lecture-mode"),
      requestMapInvalidateSize(),
      isLectureMode)
  ) {
    const e = document.getElementById("sidebar"),
      t = document.querySelector(".target-panel");
    e &&
      t &&
      setTimeout(() => {
        e.scrollTo({ top: t.offsetTop - 8, behavior: "smooth" });
      }, 120);
  }
  const r = document.getElementById("lecture-back-btn");
  if (r) {
    const e = window.innerWidth <= 900;
    isLectureMode && e
      ? ((r.style.display = "block"),
        r.__didAutoFocus ||
        ((r.__didAutoFocus = !0),
          setTimeout(() => {
            try {
              r.focus({ preventScroll: !0 });
            } catch (e) {
              r.focus();
            }
          }, 200)))
      : ((r.style.display = "none"), (r.__didAutoFocus = !1));
  }
  updateDailyResultPanel();
}
function handleStreetClick(e, t, r) {
  const a = getZoneMode();
  if ("monuments" === a || "arrondissements-ville" === a) return;
  if ("rues-principales" === a || "main" === a) {
    const t = normalizeName(e.properties.name);
    if (!MAIN_STREET_NAMES_RUNTIME.has(t)) return;
  }
  if ("rues-celebres" === a) {
    const t = normalizeName(e.properties.name);
    if (!FAMOUS_STREET_NAMES_RUNTIME.has(t)) return;
  }
  if ("arrondissement" === a) {
    const t = getSelectedArrondissement(),
      r =
        e.properties && "string" == typeof e.properties.arrondissement
          ? e.properties.arrondissement.trim()
          : null;
    if (
      t &&
      normalizeArrondissementKey(r) !== normalizeArrondissementKey(t)
    )
      return;
  }
  if (isPaused) return;
  if (isDailyMode) {
    if (!dailyTargetData || !dailyTargetGeoJson) return;
    const a = dailyTargetData.userStatus || {};
    if (a.success || (a.attempts_count || 0) >= 7 || window._dailyGameOver)
      return;
    if (window._dailyGuessInFlight) return;
    window._dailyGuessInFlight = !0;
    const n =
      normalizeName(e.properties.name) ===
      normalizeName(dailyTargetData.streetName);
    let s = 0,
      i = "";
    const l = computeFeatureCentroid(e),
      o = dailyTargetGeoJson;
    let m = l[0],
      p = l[1];
    r && r.latlng && ((m = r.latlng.lng), (p = r.latlng.lat));
    if (!n) {
      const a = normalizeName(dailyTargetData.streetName),
        n = allStreetFeatures.find(
          (e) => e.properties && normalizeName(e.properties.name) === a,
        );
      ((s =
        n && n.geometry
          ? getDistanceToFeature(p, m, n.geometry)
          : getDistanceMeters(p, m, o[1], o[0])),
        (i = getDirectionArrow([m, p], o)));
    }
    lockDailyLastGuessHighlight(
      e.properties.name,
      n ? UI_THEME.mapCorrect : UI_THEME.timerWarn,
    );
    (dailyGuessHistory.push({
      streetName: e.properties.name,
      distance: Math.round(s),
      arrow: i,
    }),
      saveDailyGuessesToStorage());
    const u = dailyGuessHistory.length,
      d = 7 - u;
    if (n) {
      ((window._dailyGameOver = !0),
        document.body.classList.add("daily-game-over"),
        typeof confetti === "function" && confetti({ particleCount: 150, zIndex: 10000, spread: 80, origin: { y: 0.6 } }),
        showMessage(
          `🎉 BRAVO ! Trouvé en ${u} essai${u > 1 ? "s" : ""} !`,
          "success",
        ),
        triggerHaptic('success'),
        renderDailyGuessHistory({ success: !0, attempts: u }));
      (setTargetPanelTitleText("🎉 Défi réussi !"),
        updateTargetItemCounter(),
        clearDailyLastGuessHighlight(),
        revealDailyTargetStreet(!0));
    } else if (d <= 0) {
      ((window._dailyGameOver = !0),
        document.body.classList.add("daily-game-over"),
        showMessage(
          `❌ Dommage ! C'était « ${dailyTargetData.streetName} ». Fin du défi.`,
          "error",
        ),
        triggerHaptic('error'),
        renderDailyGuessHistory({ success: !1 }));
      (setTargetPanelTitleText("❌ Défi échoué"),
        updateTargetItemCounter(),
        clearDailyLastGuessHighlight(),
        revealDailyTargetStreet(!1));
    } else
      (renderDailyGuessHistory(),
        triggerHaptic('error'),
        showMessage(
          `❌ Raté ! Distance : ${s >= 1e3 ? `${(s / 1e3).toFixed(1)} km` : `${Math.round(s)} m`}. Plus que ${d} essai${d > 1 ? "s" : ""}.`,
          "warning",
        ));
    return (
      updateDailyUI(),
      updateStartStopButton(),
      updateLayoutSessionState(),
      void fetch(API_URL + "/api/daily/guess", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentUser.token}`,
        },
        body: JSON.stringify({
          date: dailyTargetData.date,
          distanceMeters: Math.round(s),
          isSuccess: n,
        }),
      })
        .then((e) => e.json())
        .then((e) => {
          ((dailyTargetData.userStatus = e),
            (dailyTargetData.targetGeometry = e.targetGeometry || dailyTargetData.targetGeometry),
            e.targetGeometry &&
            (e.success || e.attempts_count >= 7) &&
            revealDailyTargetStreet(!!e.success));
          if (e.success || e.attempts_count >= 7) {
            loadAllLeaderboards();
          }
        })
        .catch((e) => {
          console.warn("Daily sync error (non-bloquant):", e);
        })
        .finally(() => {
          window._dailyGuessInFlight = !1;
        })
    );
  }
  if (!currentTarget || null === sessionStartTime || null === streetStartTime)
    return;
  const n = getGameMode(),
    s = (performance.now() - streetStartTime) / 1e3,
    i =
      normalizeName(e.properties.name) ===
      normalizeName(currentTarget.properties.name),
    l = currentTarget;
  if (i) {
    correctCount += 1;
    (hasAnsweredCurrentItem = !0);
    if ("classique" === n) {
      const e = computeItemPoints(s);
      ((weightedScore += e),
        updateWeightedBar(e / 10),
        showMessage(
          `Correct (${s.toFixed(1)} s, +${e.toFixed(1)} pts)`,
          "success",
        ));
    } else if ("marathon" === n) {
      const e = getCurrentSessionPoolSize();
      showMessage(
        `Correct (${correctCount}/${e > 0 ? e : "?"})`,
        "success",
      );
    } else showMessage(`Correct (${correctCount} trouvées)`, "success");
    (updateSessionProgressBar(),
      highlightStreet(UI_THEME.mapCorrect),
      triggerHaptic('success'),
      feedbackCorrect());
  } else
    ((errorsCount += 1),
      showMessage(
        "marathon" === n && errorsCount >= MAX_ERRORS_MARATHON
          ? `Incorrect (limite de ${MAX_ERRORS_MARATHON} erreurs atteinte)`
          : "Incorrect",
        "error",
      ),
      highlightStreet(UI_THEME.mapWrong),
      "classique" === n ? updateWeightedBar(0) : updateSessionProgressBar(),
      triggerHaptic('error'),
      feedbackError());
  ((totalAnswered += 1),
    summaryData.push({
      name: currentTarget.properties.name,
      correct: i,
      time: s.toFixed(1),
    }),
    trackAnswer(currentTarget.properties.name, getZoneMode(), i, s),
    updateWeightedScoreUI(),
    updateScoreUI(),
    showStreetInfo(l),
    !i && "marathon" === n && errorsCount >= MAX_ERRORS_MARATHON
      ? endSession()
      : ((currentIndex += 1), setNewTarget()));
}
function handleMonumentClick(e, t) {
  if ("monuments" !== getZoneMode()) return;
  if (isPaused) return;
  if (
    !currentMonumentTarget ||
    null === sessionStartTime ||
    null === streetStartTime
  )
    return;
  const r = getGameMode(),
    a = (performance.now() - streetStartTime) / 1e3,
    n =
      normalizeName(e.properties.name) ===
      normalizeName(currentMonumentTarget.properties.name),
    s = currentMonumentTarget.properties.name,
    i = findMonumentLayerByName(currentMonumentTarget.properties.name);
  if (n) {
    correctCount += 1;
    (hasAnsweredCurrentItem = !0);
    if ("classique" === r) {
      const e = computeItemPoints(a);
      ((weightedScore += e),
        updateWeightedBar(e / 10),
        showMessage(
          `Correct (${a.toFixed(1)} s, +${e.toFixed(1)} pts)`,
          "success",
        ));
    } else if ("marathon" === r) {
      const e = getCurrentSessionPoolSize();
      showMessage(
        `Correct (${correctCount}/${e > 0 ? e : "?"})`,
        "success",
      );
    } else showMessage(`Correct (${correctCount} trouvés)`, "success");
    (updateSessionProgressBar(),
      highlightMonument(i, UI_THEME.mapCorrect),
      triggerHaptic('success'),
      feedbackCorrect());
  } else
    ((errorsCount += 1),
      showMessage(
        "marathon" === r && errorsCount >= MAX_ERRORS_MARATHON
          ? `Incorrect (limite de ${MAX_ERRORS_MARATHON} erreurs atteinte)`
          : "Incorrect",
        "error",
      ),
      highlightMonument(i, UI_THEME.mapWrong),
      "classique" === r ? updateWeightedBar(0) : updateSessionProgressBar(),
      triggerHaptic('error'),
      feedbackError());
  ((totalAnswered += 1),
    summaryData.push({ name: s, correct: n, time: a.toFixed(1) }),
    trackAnswer(s, "monuments", n, a),
    updateWeightedScoreUI(),
    updateScoreUI(),
    !n && "marathon" === r && errorsCount >= MAX_ERRORS_MARATHON
      ? endSession()
      : ((currentMonumentIndex += 1), setNewTarget()));
}
function handleArrondissementClick(e, t) {
  if ("arrondissements-ville" !== getZoneMode()) return;
  if (isPaused) return;
  if (
    !currentArrondissementTarget ||
    null === sessionStartTime ||
    null === streetStartTime
  )
    return;
  const r = getGameMode(),
    a = (performance.now() - streetStartTime) / 1e3,
    n = getArrondissementTargetName(e),
    s = getArrondissementTargetName(currentArrondissementTarget),
    i = normalizeArrondissementKey(n) === normalizeArrondissementKey(s),
    l = findArrondissementLayersByName(s);
  if (i) {
    correctCount += 1;
    (hasAnsweredCurrentItem = !0);
    if ("classique" === r) {
      const e = computeItemPoints(a);
      ((weightedScore += e),
        updateWeightedBar(e / 10),
        showMessage(
          `Correct (${a.toFixed(1)} s, +${e.toFixed(1)} pts)`,
          "success",
        ));
    } else if ("marathon" === r) {
      const e = getCurrentSessionPoolSize();
      showMessage(
        `Correct (${correctCount}/${e > 0 ? e : "?"})`,
        "success",
      );
    } else showMessage(`Correct (${correctCount} trouvés)`, "success");
    (updateSessionProgressBar(),
      highlightArrondissementGuess(t, UI_THEME.mapCorrect),
      triggerHaptic('success'),
      feedbackCorrect());
  } else
    ((errorsCount += 1),
      showMessage(
        "marathon" === r && errorsCount >= MAX_ERRORS_MARATHON
          ? `Incorrect (limite de ${MAX_ERRORS_MARATHON} erreurs atteinte)`
          : "Incorrect",
        "error",
      ),
      l && l.length > 0
        ? (focusArrondissementByName(s),
          l.forEach((e) => {
            highlightArrondissementGuess(e, UI_THEME.mapWrong);
          }))
        : highlightArrondissementGuess(t, UI_THEME.mapWrong),
      "classique" === r ? updateWeightedBar(0) : updateSessionProgressBar(),
      triggerHaptic('error'),
      feedbackError());
  ((totalAnswered += 1),
    summaryData.push({ name: s, correct: i, time: a.toFixed(1) }),
    trackAnswer(s, "arrondissements-ville", i, a),
    updateWeightedScoreUI(),
    updateScoreUI(),
    !i && "marathon" === r && errorsCount >= MAX_ERRORS_MARATHON
      ? endSession()
      : ((currentArrondissementIndex += 1), setNewTarget()));
}
function highlightMonument(e, t) {
  e &&
    (e.setStyle({ color: t, fillColor: t }),
      setTimeout(() => {
        e.setStyle &&
          e.setStyle({
            color: UI_THEME.mapMonumentStroke,
            fillColor: UI_THEME.mapMonumentFill,
          });
      }, 5e3));
}
function highlightArrondissementGuess(e, t) {
  e &&
    (e.__pariciLockedStyle = !0,
      e.setStyle({ color: t, fillColor: t, fillOpacity: 0.28, weight: 3, opacity: 1 }),
      setTimeout(() => {
        e.__pariciLockedStyle = !1;
        e.setStyle &&
          e.setStyle(getArrondissementBaseStyle());
      }, 5e3));
}
function showStreetInfo(e) {
  const t = document.getElementById("street-info-panel"),
    r = document.getElementById("street-info");
  if (!t || !r || !e) return;
  const a = getZoneMode();
  updateStreetInfoPanelTitle(a);
  
  const isMain = "rues-principales" === a || "main" === a;
  const isFamous = "rues-celebres" === a || "famous" === a;
  
  if (!isMain && !isFamous)
    return (
      (t.style.display = "none"),
      t.classList.remove("is-visible"),
      (r.textContent = ""),
      void r.classList.remove("is-visible")
    );
    
  const n = e.properties.name || "",
    s = normalizeName(n);
    
  let i;
  if (isMain) {
    i = MAIN_STREET_INFOS[s];
    if (!i && MAIN_STREET_NAMES_RUNTIME.has(s)) {
      i = "Rue principale : informations historiques à compléter.";
    }
  } else if (isFamous) {
    i = FAMOUS_STREET_INFOS[s];
    if (!i && FAMOUS_STREET_NAMES_RUNTIME.has(s)) {
      i = "Rue célèbre : informations historiques à compléter.";
    }
  }
  
  if (!i)
    return (
      (t.style.display = "none"),
      t.classList.remove("is-visible"),
      (r.textContent = ""),
      void r.classList.remove("is-visible")
    );
  ((t.style.display = "block"),
    (r.style.display = "block"),
    r.classList.remove("is-visible"),
    r.offsetWidth,
    (r.innerHTML = `<strong>${n}</strong><br>${i}`),
    t.classList.add("is-visible"),
    r.classList.add("is-visible"));
}
function trackAnswer(e, t, r, a) {
  e &&
    fetch(API_URL + "/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streetName: e, mode: t, correct: r, timeSec: a }),
    }).catch(() => { });
}
function feedbackCorrect() {
  if (
    (playDing(),
      "function" == typeof confetti &&
      confetti({
        particleCount: 60,
        spread: 55,
        origin: { y: 0.7 },
        colors: [UI_THEME.mapCorrect, UI_THEME.mapMonumentFill, "#a9b8ec", UI_THEME.mapStreet],
        gravity: 1.2,
        scalar: 0.8,
        ticks: 120,
      }),
      highlightedLayers && highlightedLayers.length > 0)
  ) {
    let e = 0;
    const t = setInterval(() => {
      const r = e % 2 == 0 ? getAdaptiveStreetWeight(12) : getAdaptiveStreetWeight(6),
        a = e % 2 == 0 ? 1 : 0.5;
      (highlightedLayers.forEach((e) => {
        e.setStyle && e.setStyle({ weight: r, opacity: a });
      }),
        e++,
        e >= 6 &&
        (clearInterval(t),
          highlightedLayers.forEach((e) => {
            e.setStyle && e.setStyle({ weight: getAdaptiveStreetWeight(8), opacity: 1 });
          })));
    }, 200);
  }
}
function feedbackError() {
  playBuzz();
  const e = document.getElementById("map");
  e &&
    (e.classList.add("map-shake"),
      setTimeout(() => e.classList.remove("map-shake"), 500));
}
function highlightStreet(e) {
  currentTarget && highlightStreetByName(currentTarget.properties.name, e);
}
function highlightStreetByName(e, t) {
  clearHighlight();
  const r = normalizeName(e);
  if (!r) return [];
  const a = [];
  if (
    (streetLayersById.forEach((e) => {
      normalizeName(e.feature.properties.name) === r && a.push(e);
    }),
      0 === a.length)
  )
    return [];
  ((highlightedLayers = a),
    highlightedLayers.forEach((e) => {
      e.setStyle({ color: t, weight: getAdaptiveStreetWeight(8) });
    }));
  let n = null;
  return (
    a.forEach((e) => {
      if ("function" == typeof e.getBounds) {
        const t = e.getBounds();
        n = n ? n.extend(t) : t;
      }
    }),
    n &&
    n.isValid &&
    n.isValid() &&
    map.fitBounds(n, { padding: [60, 60], animate: !0, duration: 1.5 }),
    (highlightTimeoutId = setTimeout(() => {
      (highlightedLayers.forEach((e) => {
        const t = getBaseStreetStyle(e);
        e.setStyle({ color: t.color, weight: t.weight, opacity: t.opacity });
      }),
        (highlightedLayers = []),
        (highlightTimeoutId = null));
    }, 5e3)),
    a
  );
}
function findMonumentLayerByName(e) {
  if (!monumentsLayer || !e) return null;
  const t = normalizeName(e);
  let r = null;
  return (
    monumentsLayer.eachLayer((e) => {
      normalizeName(e.feature?.properties?.name) === t && (r = e);
    }),
    r
  );
}
function findArrondissementLayersByName(e) {
  if (!e) return [];
  const t = normalizeArrondissementKey(e);
  if (!t || !arrondissementLayersByKey.has(t)) return [];
  return arrondissementLayersByKey.get(t) || [];
}
function clearHighlight() {
  (null !== highlightTimeoutId &&
    (clearTimeout(highlightTimeoutId), (highlightTimeoutId = null)),
    highlightedLayers &&
    highlightedLayers.length > 0 &&
    (highlightedLayers.forEach((e) => {
      const t = getBaseStreetStyle(e);
      e.setStyle({ color: t.color, weight: t.weight, opacity: t.opacity });
    }),
      (highlightedLayers = [])));
}
function clearDailyLastGuessHighlight() {
  dailyLastGuessHighlightLayers &&
    dailyLastGuessHighlightLayers.length > 0 &&
    (dailyLastGuessHighlightLayers.forEach((e) => {
      if (!e || "function" != typeof e.setStyle) return;
      delete e.__pariciLockedStyle;
      delete e.__pariciLockedStyleBaseWeight;
      const t = getBaseStreetStyle(e);
      e.setStyle({ color: t.color, weight: t.weight, opacity: t.opacity });
    }),
      (dailyLastGuessHighlightLayers = []));
}
function lockDailyLastGuessHighlight(e, t = UI_THEME.timerWarn) {
  const r = normalizeName(e);
  if (!r || !streetLayersByName || !streetLayersByName.has(r)) return [];
  const a = getStreetHighlightStyle(t, 7);
  const n = (streetLayersByName.get(r) || []).filter(
    (e) => e && "function" == typeof e.setStyle,
  );
  return (
    n.forEach((e) => {
      ((e.__pariciLockedStyle = { ...a }), (e.__pariciLockedStyleBaseWeight = 7), e.setStyle(a));
      dailyLastGuessHighlightLayers.includes(e) || dailyLastGuessHighlightLayers.push(e);
    }),
    n
  );
}
function focusStreetByName(e) {
  const t = highlightStreetByName(e, UI_THEME.mapStreetHover);
  if (!t || 0 === t.length) return null;
  let r = null;
  (t.forEach((e) => {
    if ("function" == typeof e.getBounds) {
      const t = e.getBounds();
      r = r ? r.extend(t) : t;
    }
  }),
    r &&
    r.isValid &&
    r.isValid() &&
    map.fitBounds(r, { padding: [40, 40], animate: !0, duration: 1.5 }));
  return t[0] || null;
}
function focusArrondissementByName(e) {
  const t = findArrondissementLayersByName(e);
  if (!t || 0 === t.length) return null;
  let r = null;
  (t.forEach((e) => {
    if ("function" == typeof e.getBounds) {
      const t = e.getBounds();
      r = r ? r.extend(t) : t;
    }
  }),
    r &&
    r.isValid &&
    r.isValid() &&
    map.fitBounds(r, { padding: [40, 40], animate: !0, duration: 1.5 }));
  return t[0] || null;
}
function endSession() {
  document.body.classList.add("session-ended");
  playVictory();
  const e = performance.now(),
    t = sessionStartTime ? (e - sessionStartTime) / 1e3 : 0;
  ((sessionStartTime = null),
    (streetStartTime = null),
    (currentTarget = null),
    (currentMonumentTarget = null),
    (currentArrondissementTarget = null),
    (isSessionRunning = !1),
    (isChronoMode = !1),
    (chronoEndTime = null),
    isDailyMode && ((isDailyMode = !1), updateDailyUI()),
    (isLectureMode = !1),
    updateTargetPanelTitle(),
    updateLayoutSessionState(),
    (isPaused = !1),
    (pauseStartTime = null),
    (remainingChronoMs = null),
    updateStartStopButton(),
    updatePauseButton(),
    updateLayoutSessionState());
  const r = document.getElementById("skip-btn");
  r && (r.style.display = "none");
  const a = summaryData.length,
    n = summaryData.filter((e) => e.correct).length,
    s = 0 === a ? 0 : Math.round((n / a) * 100),
    i =
      0 === a ? 0 : summaryData.reduce((e, t) => e + parseFloat(t.time), 0) / a,
    l = getGameMode(),
    o = getZoneMode(),
    uScore = getSessionScoreValue(l),
    poolSize =
      "marathon" === l || "chrono" === l ? getCurrentSessionPoolSize() : a;
  let u = null;
  if ("arrondissement" === o) {
    const e = document.getElementById("arrondissement-select");
    e && e.value && (u = e.value);
  }
  const d = document.getElementById("summary");
  if (!d) return;
  if (100 === s && a > 0) {
    const e = 5e3,
      t = Date.now() + e,
      r = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 },
      a = (e, t) => Math.random() * (t - e) + e,
      n = setInterval(function () {
        const s = t - Date.now();
        if (s <= 0) return clearInterval(n);
        const i = (s / e) * 50;
        (confetti({
          ...r,
          particleCount: i,
          origin: { x: a(0.1, 0.3), y: Math.random() - 0.2 },
        }),
          confetti({
            ...r,
            particleCount: i,
            origin: { x: a(0.7, 0.9), y: Math.random() - 0.2 },
          }));
      }, 250);
  }
  d.innerHTML = "";
  const c = document.createElement("div");
  c.className = "summary-global";
  const m = document.createElement("h2");
  const zoneLabel = ZONE_LABELS[o] || o;
  const foundItemsLabel =
    "monuments" === o
      ? "Monuments trouvés"
      : "arrondissements-ville" === o
        ? "Arrondissements trouvés"
        : "Rues trouvées";
  let p;
  ((m.textContent = "Récapitulatif de la session"),
    c.appendChild(m),
    (p =
      "marathon" === l
        ? `Mode : Marathon (max. ${MAX_ERRORS_MARATHON} erreurs)`
        : "chrono" === l
          ? `Mode : Chrono (${CHRONO_DURATION} s)`
          : `Mode : Classique (${SESSION_SIZE} items max)`),
    (p += ` – Zone : ${zoneLabel}`),
    u && (p += ` – Arrondissement : ${u}`));
  const g = document.createElement("p");
  ((g.textContent = p), c.appendChild(g));
  const h = document.createElement("div");
  const yScoreLine =
    "classique" === l
      ? `<p>Score pondéré : <strong>${uScore.toFixed(1)} pts</strong></p>`
      : "marathon" === l
        ? `<p>${foundItemsLabel} : <strong>${Math.round(uScore)} / ${poolSize || 0}</strong></p>`
        : `<p>${foundItemsLabel} : <strong>${Math.round(uScore)}</strong> en 60 s</p>`;
  ((h.className = "summary-stats"),
    (h.innerHTML = `<p>Temps total : <strong>${t.toFixed(1)} s</strong></p>\n     <p>Temps moyen par item : <strong>${i.toFixed(1)} s</strong></p>\n     <p>Score : <strong>${s} %</strong> (${n} bonnes réponses / ${a})</p>\n     ${yScoreLine}`),
    c.appendChild(h));
  const shareHost =
    window.location &&
    window.location.hostname &&
    "localhost" !== window.location.hostname &&
    "127.0.0.1" !== window.location.hostname
      ? window.location.host
      : "parici.netlify.app";
  const sessionShareText = buildSessionShareText({
    summaryData,
    gameMode: l,
    zoneMode: o,
    arrondissementName: u,
    totalTimeSec: t,
    averageTimeSec: i,
    scorePercent: s,
    correctCount: n,
    answeredCount: a,
    sessionScoreValue: uScore,
    poolSize,
    gameLabels: GAME_LABELS,
    zoneLabels: ZONE_LABELS,
    host: shareHost,
  });
  d.appendChild(c);
  const y = document.createElement("div");
  y.className = "summary-detail";
  const v = document.createElement("div");
  v.className = "summary-detail-header";
  const f = document.createElement("h3");
  ((f.textContent = "Détail par item (cliquable pour zoomer)"),
    v.appendChild(f));
  const b = document.createElement("div");
  b.className = "summary-filters";
  let S = "all";
  ([
    { value: "all", label: "Tous" },
    { value: "correct", label: "Corrects" },
    { value: "incorrect", label: "Incorrects" },
  ].forEach((e) => {
    const t = document.createElement("button");
    ((t.type = "button"),
      (t.className = "summary-filter-btn"),
      (t.dataset.filter = e.value),
      (t.textContent = e.label),
      e.value === S && t.classList.add("is-active"),
      b.appendChild(t));
  }),
    v.appendChild(b),
    y.appendChild(v));
  const sessionSharePanel = document.createElement("div");
  sessionSharePanel.className = "session-share";
  const sessionShareButtons = document.createElement("div");
  sessionShareButtons.className = "daily-share-buttons session-share-buttons";
  const copyShareBtn = document.createElement("button");
  ((copyShareBtn.type = "button"),
    (copyShareBtn.className = "btn-secondary daily-share-btn"),
    (copyShareBtn.textContent = "📋 Copier le partage"),
    copyShareBtn.addEventListener("click", async () => {
      (copyShareBtn.disabled = !0);
      const e = await copySessionShareText(sessionShareText);
      ((copyShareBtn.disabled = !1),
        showMessage(e ? "Résultat copié !" : "Impossible de copier le résultat.", e ? "success" : "error"));
    }));
  const nativeShareBtn = document.createElement("button");
  ((nativeShareBtn.type = "button"),
    (nativeShareBtn.className = "btn-primary daily-share-btn"),
    (nativeShareBtn.textContent = "📤 Partager"));
  if (navigator.share)
    nativeShareBtn.addEventListener("click", async () => {
      (nativeShareBtn.disabled = !0);
      const e = await shareSessionShareText(sessionShareText);
      ((nativeShareBtn.disabled = !1),
        !0 === e
          ? showMessage("Partage envoyé !", "success")
          : !1 === e && showMessage("Impossible de partager ce résultat.", "error"));
    });
  else nativeShareBtn.style.display = "none";
  (sessionShareButtons.appendChild(copyShareBtn),
    sessionShareButtons.appendChild(nativeShareBtn),
    sessionSharePanel.appendChild(sessionShareButtons));
  const sessionShareHint = document.createElement("p");
  ((sessionShareHint.className = "daily-share-hint session-share-hint"),
    (sessionShareHint.textContent = "Résumé en grille emoji (format type Wordle)."),
    sessionSharePanel.appendChild(sessionShareHint));
  const sessionShareSlot = document.getElementById("session-share-slot");
  sessionShareSlot &&
    ((sessionShareSlot.innerHTML = ""),
      sessionShareSlot.appendChild(sessionSharePanel),
      sessionShareSlot.classList.remove("hidden"));
  const L = document.createElement("ul");
  function M(e) {
    L.querySelectorAll(".summary-item").forEach((t) => {
      const r = "true" === t.dataset.correct;
      let a = !1;
      ("all" === e
        ? (a = !0)
        : "correct" === e
          ? (a = r)
          : "incorrect" === e && (a = !r),
        (t.style.display = a ? "" : "none"));
    });
  }
  ((L.className = "summary-list"),
    summaryData.forEach((e) => {
      const t = document.createElement("li");
      (t.classList.add("summary-item"),
        (t.dataset.correct = e.correct ? "true" : "false"),
        e.correct
          ? t.classList.add("summary-item--correct")
          : t.classList.add("summary-item--incorrect"),
        (t.textContent = `${e.name} – ${e.correct ? "Correct" : "Incorrect"} – ${e.time} s`),
        (t.dataset.streetName = e.name),
        t.addEventListener("click", () => {
          if ("arrondissements-ville" === o) {
            focusArrondissementByName(e.name);
            return;
          }
          const t = focusStreetByName(e.name);
          t && t.feature && showStreetInfo(t.feature);
        }),
        L.appendChild(t));
    }),
    y.appendChild(L),
    d.appendChild(y),
    b.querySelectorAll(".summary-filter-btn").forEach((e) => {
      e.addEventListener("click", () => {
        const t = e.dataset.filter;
        t &&
          t !== S &&
          ((S = t),
            b.querySelectorAll(".summary-filter-btn").forEach((t) => {
              t.classList.toggle("is-active", t === e);
            }),
            M(S));
      });
    }),
    M(S),
    d.classList.remove("hidden"),
    showMessage("Session terminée.", "info"));
  const T = document.getElementById("target-street");
  (T && ((T.textContent = "—"), requestAnimationFrame(fitTargetStreetText)),
    refreshLectureStreetSearchForCurrentMode());
  const sessionScorePayload = {
    zoneMode: o,
    arrondissementName: u,
    gameMode: l,
    sessionId: activeSessionId || generateSessionId(),
    score: uScore,
    percentCorrect: s,
    totalTimeSec: t,
    itemsTotal: poolSize,
    itemsCorrect: n,
  };
  (currentUser &&
    currentUser.token &&
    (activeFriendChallenge
      ? sendFriendChallengeScoreToServer(sessionScorePayload)
      : sendScoreToServer(sessionScorePayload)),
    loadLeaderboard(o, u, l));
}
function updateScoreUI() {
  const e = document.getElementById("score"),
    t = document.getElementById("score-pill");
  if (!e) return;
  if (0 === totalAnswered)
    return (
      (e.textContent = "0 / 0 (0 %)"),
      void (t && (t.className = "score-pill score-pill--neutral"))
    );
  const r = Math.round((correctCount / totalAnswered) * 100);
  ((e.textContent = `${correctCount} / ${totalAnswered} (${r} %)`),
    t &&
    (t.className =
      r > 50
        ? "score-pill score-pill--good"
        : r > 0
          ? "score-pill score-pill--warn"
          : "score-pill score-pill--neutral"));
}
function updateTimeUI(e, t, r) {
  const a = document.getElementById("total-time"),
    n = document.getElementById("street-time");
  (a &&
    (null != r
      ? ((a.textContent = r.toFixed(1) + " s"),
        r > 30
          ? ((a.style.color = UI_THEME.timerSafe),
            a.classList.remove("chrono-blink"))
          : r > 10
            ? ((a.style.color = UI_THEME.timerWarn),
              a.classList.remove("chrono-blink"))
            : ((a.style.color = UI_THEME.timerDanger),
              r <= 5 && a.classList.add("chrono-blink")))
      : ((a.textContent = e.toFixed(1) + " s"),
        (a.style.color = ""),
        a.classList.remove("chrono-blink"))),
    n && (n.textContent = t.toFixed(1) + " s"));
}
function updateWeightedScoreUI() {
  const e = document.getElementById("weighted-score");
  if (!e) return;
  const t = getScoreMetricUIConfig(),
    r = getSessionScoreValue();
  e.textContent =
    t.decimals > 0 ? r.toFixed(t.decimals) : String(Math.round(r));
}
function updateWeightedBar(e) {
  const t = document.getElementById("weighted-score-bar");
  if (!t) return;
  const r = 100 * Math.max(0, Math.min(1, e));
  t.style.width = r + "%";
}
function updateSessionProgressBar() {
  const e = getGameMode();
  if ("classique" === e) return;
  if ("marathon" === e) {
    const e = getCurrentSessionPoolSize();
    return void updateWeightedBar(e > 0 ? correctCount / e : 0);
  }
  if ("chrono" === e) {
    const e = getTitleThresholds(
      getZoneMode(),
      "chrono",
      getCurrentSessionPoolSize(),
    ),
      t = Math.max(1, e.MV || 1);
    return void updateWeightedBar(correctCount / t);
  }
  updateWeightedBar(0);
}
function resetWeightedBar() {
  "classique" === getGameMode() ? updateWeightedBar(1) : updateSessionProgressBar();
}
function renderUserSticker() {
  renderUserStickerRuntime(currentUser);
}

function updateUserUI() {
  updateUserUIRuntime({
    currentUser,
    renderUserSticker,
    loadProfile,
  });
  if (!activeFriendChallenge && getFriendChallengeCodeFromUrl()) {
    initFriendChallengeModeFromUrl();
    return;
  }
  loadFriendChallengeLeaderboard();
}
(infoEl && (infoEl.textContent = ""),
  (function () {
    const e = document.getElementById("weighted-score-help-btn"),
      t = document.getElementById("weighted-score-help");
    if (!e || !t) return;
    (t.id || (t.id = "weighted-score-help"),
      e.setAttribute("aria-controls", t.id),
      e.setAttribute("aria-expanded", "false"));
    const r = () => {
      (t.classList.remove("hidden"),
        t.classList.add("is-open"),
        e.setAttribute("aria-expanded", "true"));
    },
      a = () => {
        (t.classList.remove("is-open"),
          e.setAttribute("aria-expanded", "false"));
      };
    (e.addEventListener("mouseenter", r),
      e.addEventListener("mouseleave", a),
      t.addEventListener("mouseenter", r),
      t.addEventListener("mouseleave", a),
      e.addEventListener("focus", r),
      e.addEventListener("blur", a),
      e.addEventListener("click", (e) => {
        (e.preventDefault(), t.classList.contains("is-open") ? a() : r());
      }),
      document.addEventListener(
        "click",
        (r) => {
          e.contains(r.target) || t.contains(r.target) || a();
        },
        !0,
      ),
      document.addEventListener("keydown", (e) => {
        "Escape" === e.key && a();
      }));
  })());
function loadProfile() {
  loadProfileRuntime({
    currentUser,
    apiUrl: API_URL,
    saveCurrentUserToStorage,
    renderUserSticker,
    getGlobalRankMeta,
    getPlayerTitle,
    zoneLabels: ZONE_LABELS,
    gameLabels: GAME_LABELS,
    hasReachedGlobalRank,
    hasReachedVilleRank,
    initAvatarSelector,
    onProfileRendered: initDailyReminderControls,
    onAuthFailure: () => {
      if (!currentUser) {
        return;
      }
      currentUser = null;
      clearCurrentUserFromStorage();
      updateUserUI();
      showMessage("Session expirée, reconnectez-vous.", "warning");
    },
  });
}

function initAvatarSelector(currentAvatar, globalRankLevel) {
  initAvatarSelectorRuntime({
    currentAvatar,
    globalRankLevel,
    renderAvatarGrid: (avatar, rankLevel) => {
      renderAvatarGrid(avatar, rankLevel);
    },
  });
}

function renderAvatarGrid(currentAvatar, globalRankLevel) {
  renderAvatarGridRuntime({
    currentAvatar,
    globalRankLevel,
    avatarUnlocks: AVATAR_UNLOCKS,
    titleNames: TITLE_NAMES,
    currentUser,
    getGlobalRankLevelForTitleIndex,
    apiUrl: API_URL,
    saveCurrentUserToStorage,
    updateUserUI,
    showMessage,
  });
}

function sendScoreToServer(e) {
  sendScoreToServerRuntime({
    isDailyMode,
    currentUser,
    apiUrl: API_URL,
    payload: e,
    loadAllLeaderboards,
  });
}

function sendFriendChallengeScoreToServer(e) {
  if (
    isDailyMode ||
    !activeFriendChallenge ||
    !currentUser ||
    !currentUser.token
  ) {
    return;
  }

  try {
    fetch(`${API_URL}/api/friend-challenges/${encodeURIComponent(activeFriendChallenge.code)}/score`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentUser.token}`,
      },
      body: JSON.stringify({
        score: e.score,
        itemsCorrect: e.itemsCorrect,
        itemsTotal: e.itemsTotal,
        timeSec: e.totalTimeSec,
      }),
    })
      .then((response) =>
        response
          .json()
          .catch(() => ({}))
          .then((payload) => ({ ok: response.ok, status: response.status, payload })),
      )
      .then(({ ok, status, payload }) => {
        if (!ok) {
          if (status === 401) {
            showMessage("Connectez-vous pour enregistrer votre score sur ce défi.", "warning");
          } else {
            console.warn("Friend challenge score rejected:", payload);
          }
          return;
        }
        loadFriendChallengeLeaderboard();
      })
      .catch((error) => {
        console.error("Erreur envoi score défi amis :", error);
      });
  } catch (error) {
    console.error("Erreur envoi score défi amis (synchrone) :", error);
  }
}

async function handleDailyModeClick() {
  if (activeFriendChallenge) {
    showMessage("Désactivez le défi amis avant de lancer un Daily.", "warning");
    return;
  }
  if (currentUser && currentUser.token)
    try {
      if (!areStreetsReady) {
        showMessage("Chargement des rues...", "info");
        const loaded = await loadStreets({ force: true });
        if (!loaded) {
          showMessage("Impossible de lancer le Daily: rues indisponibles.", "error");
          return;
        }
      }
      const e = await fetch(API_URL + "/api/daily", {
        headers: { Authorization: `Bearer ${currentUser.token}` },
      });
      if (!e.ok) throw new Error("Erreur chargement défi");
      startDailySession(await e.json());
    } catch (e) {
      (console.error(e),
        showMessage("Impossible de charger le défi quotidien.", "error"));
    }
  else showMessage("Connectez-vous pour accéder au défi quotidien.", "warning");
}
let dailyTargetData = null,
  dailyTargetGeoJson = null,
  isDailyMode = !1,
  dailyHighlightLayer = null,
  dailyGuessHistory = [];
function startDailySession(e) {
  document.body.classList.remove("session-ended", "daily-game-over");
  ((dailyTargetData = e), (dailyTargetGeoJson = JSON.parse(e.targetGeoJson)));
  saveDailyMetaToStorage();
  const t = e.userStatus || {};
  let r = !1,
    a = null;
  (t.success
    ? ((r = !0), (a = { success: !0, attempts: t.attempts_count }))
    : t.attempts_count >= 7 &&
    ((r = !0), (a = { success: !1, attempts: t.attempts_count })),
    (isDailyMode = !0),
    (isLectureMode = !1),
    setLectureTooltipsEnabled(!1),
    (dailyGuessHistory = []),
    (window._dailyGameOver = r),
    (window._dailyGuessInFlight = !1));
  const n = document.getElementById("daily-guesses-history");
  (n && ((n.style.display = "none"), (n.innerHTML = "")),
    r
      ? restoreDailyGuessesFromStorage(e.date)
      : (t.attempts_count || 0) > 0 &&
      !t.success &&
      (restoreDailyGuessesFromStorage(e.date),
        dailyGuessHistory.length > 0 && renderDailyGuessHistory()),
    cleanOldDailyGuessStorage(e.date),
    isSessionRunning && endSession(),
    clearSessionShareSlot(),
    clearDailyLastGuessHighlight(),
    removeDailyHighlight(),
    (currentZoneMode = "ville"));
  const s = document.getElementById("mode-select"),
    i = document.getElementById("mode-select-button");
  s &&
    ((s.value = "ville"),
      i &&
      (i.innerHTML =
        '<span class="custom-select-label">Ville entière</span><span class="difficulty-pill difficulty-pill--hard">Difficile</span>'));
  const l = document.getElementById("target-street");
  l &&
    ((l.textContent = e.streetName),
      requestAnimationFrame(fitTargetStreetText));
  const o = Math.max(0, 7 - (t.attempts_count || 0)),
    u = r
      ? t.success
        ? "🎉 Défi réussi !"
        : "❌ Défi échoué"
      : `🎯 Défi quotidien — ${o} essai${o > 1 ? "s" : ""} restant${o > 1 ? "s" : ""}`;
  (setTargetPanelTitleText(u),
    updateTargetItemCounter(),
    (isSessionRunning = !0),
    refreshLectureStreetSearchForCurrentMode(),
    updateLayoutSessionState());
  const d = document.getElementById("skip-btn"),
    c = document.getElementById("pause-btn");
  (d && (d.style.display = "none"), c && (c.style.display = "none"));
  (updateStartStopButton(),
    s && s.dispatchEvent(new Event("change")),
    r
      ? (dailyGuessHistory.length > 0 && renderDailyGuessHistory(a),
        e.targetGeometry &&
        (dailyTargetData.targetGeometry = e.targetGeometry),
        revealDailyTargetStreet(!!t.success),
        t.success
          ? showMessage(
            `🎉 Déjà réussi aujourd'hui en ${t.attempts_count} essai${t.attempts_count > 1 ? "s" : ""} !`,
            "success",
          )
          : showMessage(
            `❌ Plus d'essais pour aujourd'hui. La rue était « ${e.streetName} ».`,
            "error",
          ))
      : (renderDailyGuessHistory(),
        showMessage(`Trouvez : ${e.streetName} (${o} essais restants)`, "info")),
    updateDailyUI());
}
function endDailySession() {
  document.body.classList.remove("daily-game-over");
  clearDailyTransientUiState();
  ((isDailyMode = !1),
    (isSessionRunning = !1),
    (window._dailyGameOver = !1),
    (window._dailyGuessInFlight = !1));
  clearDailyLastGuessHighlight();
  (updateTargetPanelTitle(),
    refreshLectureStreetSearchForCurrentMode(),
    updateStartStopButton(),
    updatePauseButton(),
    updateLayoutSessionState(),
    updateDailyUI(),
    updateDailyResultPanel());
}
function renderDailyGuessHistory(e) {
  renderDailyGuessHistoryRuntime({
    dailyGuessHistory,
    finalStatus: e,
    dailyTargetData,
    onLayoutShift: requestMapInvalidateSize,
    normalizeArrondissementKey,
    arrondissementByArrondissement,
    calculateStreetLengthFromFeatures,
    allStreetFeatures,
    normalizeName,
  });
}
function clearDailyTransientUiState() {
  if (dailyTargetData && typeof dailyTargetData === "object") {
    delete dailyTargetData.dailyImageHintOpen;
  }

  const historyRoot = document.getElementById("daily-guesses-history");
  if (historyRoot) {
    historyRoot.style.display = "none";
    historyRoot.innerHTML = "";
  }

  const targetPanelEl = document.querySelector(".target-panel");
  if (targetPanelEl) {
    targetPanelEl.classList.remove("target-panel--daily-image-open");
  }

  clearDailyLastGuessHighlight();

  requestAnimationFrame(() => {
    requestMapInvalidateSize();
  });
}
function restoreDailyMetaFromStorage(e) {
  const t = restoreDailyMetaFromStorageRuntime(e, dailyTargetData, getDailyMetaStorageKey);
  if (!t) return !1;
  return ((dailyTargetData = t), !0);
}
async function ensureDailyShareContext(e, t) {
  Array.isArray(t) &&
    t.length > 0 &&
    (dailyGuessHistory = t.slice(0, 7).map((e) => ({ ...e })));
  if (
    dailyTargetData &&
    dailyTargetData.streetName &&
    (!e || !dailyTargetData.date || dailyTargetData.date === e)
  )
    return !0;
  if (restoreDailyMetaFromStorage(e)) return !0;
  if (!(currentUser && currentUser.token)) return !1;
  try {
    const t = await fetch(API_URL + "/api/daily", {
      headers: { Authorization: `Bearer ${currentUser.token}` },
    });
    if (!t.ok) return !1;
    const r = await t.json();
    if (!r || !r.streetName) return !1;
    if (e && r.date && r.date !== e) return !1;
    return (
      (dailyTargetData = { ...(dailyTargetData || {}), ...r }),
      saveDailyMetaToStorage(),
      !0
    );
  } catch (t) {
    return !1;
  }
}

function updateDailyResultPanel() {
  updateDailyResultPanelRuntime({
    isSessionRunning,
    dailyGuessHistory,
    dailyTargetData,
    isDailyGameOver: !!window._dailyGameOver,
    setDailyGuessHistory: (e) => {
      dailyGuessHistory = e;
    },
    getTodayDailyStorageDate,
    getDailyGuessesStorageKey,
    restoreDailyMetaFromStorage,
    ensureDailyShareContext,
    handleDailyShareText,
    handleDailyShareImage,
    showMessage,
  });
}

function handleDailyShareText(e) {
  handleDailyShareTextRuntime({
    result: e,
    dailyTargetData,
    dailyGuessHistory,
    getDailyShareDateLabel,
    formatDailyDistanceForShare,
    showMessage,
  });
}
function handleDailyShareImage(e) {
  handleDailyShareImageRuntime({
    result: e,
    dailyTargetData,
    dailyGuessHistory,
    getDailyShareDateLabel,
    formatDailyDistanceForShare,
    showMessage,
  });
}
function saveDailyGuessesToStorage() {
  saveDailyGuessesToStorageRuntime({
    dailyTargetData,
    dailyGuessHistory,
    getDailyGuessesStorageKey,
    getDailyMetaStorageKey,
  });
}
function saveDailyMetaToStorage() {
  saveDailyMetaToStorageRuntime(dailyTargetData, getDailyMetaStorageKey);
}
function restoreDailyGuessesFromStorage(e) {
  dailyGuessHistory = restoreDailyGuessesFromStorageRuntime(e, getDailyGuessesStorageKey);
}
function cleanOldDailyGuessStorage(e) {
  cleanOldDailyGuessStorageRuntime(e, { getDailyGuessesStorageKey, getDailyMetaStorageKey });
}
function highlightDailyTarget(e, t) {
  dailyHighlightLayer = highlightDailyTargetRuntime({
    targetGeometry: e,
    isSuccess: t,
    map,
    L,
    uiTheme: UI_THEME,
    dailyHighlightLayer,
  });
}
function buildDailyTargetFeatureCollection(e) {
  const t = normalizeName(e);
  if (!t || !Array.isArray(allStreetFeatures) || 0 === allStreetFeatures.length) return null;
  const r = allStreetFeatures.filter(
    (e) => e && e.properties && normalizeName(e.properties.name) === t && e.geometry,
  );
  return r.length > 0 ? { type: "FeatureCollection", features: r } : null;
}
function revealDailyTargetStreet(e = !1) {
  if (!dailyTargetData) return;
  const t = buildDailyTargetFeatureCollection(dailyTargetData.streetName);
  if (t) return void highlightDailyTarget(t, e);
  dailyTargetData.targetGeometry && highlightDailyTarget(dailyTargetData.targetGeometry, e);
}
function removeDailyHighlight() {
  dailyHighlightLayer = removeDailyHighlightRuntime(map, dailyHighlightLayer);
}
function updateDailyUI() {
  updateDailyUIRuntime({
    isDailyMode,
    dailyTargetData,
    dailyGuessHistory,
  });
}
function handleDailyStop() {
  triggerHaptic('click');
  return !!isDailyMode && (endDailySession(), removeDailyHighlight(), !0);
}
function fitTargetStreetText() {
  fitTargetStreetTextRuntime("target-street");
}
(window.addEventListener("resize", () => {
  requestAnimationFrame(fitTargetStreetText);
}),
  window.addEventListener("orientationchange", () => {
    requestAnimationFrame(fitTargetStreetText);
  }),
  window.addEventListener("load", () => {
    if ("serviceWorker" in navigator) {
      ensureServiceWorkerRegistration().catch((e) =>
        console.warn("SW registration failed:", e),
      );
    }

    updateHapticsUI();

    const userPanelDetails = document.querySelector('.user-panel details');
    if (userPanelDetails) {
      userPanelDetails.addEventListener('toggle', () => {
        triggerHaptic('click');
      });
    }
  }));
