const INSTALL_BANNER_SEEN_KEY = "parici_install_banner_seen";
const INSTALL_BANNER_REMIND_AT_KEY = "parici_install_banner_remind_at";

const LATER_REMIND_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const IOS_SHEET_REMIND_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
const INSTALLED_REMIND_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

const MOBILE_WIDTH_QUERY = "(max-width: 900px)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";

let deferredInstallPromptEvent = null;
let installPromptInitialized = false;

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {}
}

function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {}
}

function readReminderTimestamp() {
  const raw = readStorage(INSTALL_BANNER_REMIND_AT_KEY);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.trunc(value);
}

function scheduleReminder(delayMs) {
  writeStorage(INSTALL_BANNER_REMIND_AT_KEY, String(Date.now() + delayMs));
}

function clearReminder() {
  removeStorage(INSTALL_BANNER_REMIND_AT_KEY);
}

function setHidden(element, shouldHide) {
  if (!element) {
    return;
  }
  element.classList.toggle("hidden", shouldHide);
}

function setIosSheetVisibility(show) {
  const sheet = document.getElementById("install-ios-sheet");
  if (!sheet) {
    return;
  }
  setHidden(sheet, !show);
  sheet.setAttribute("aria-hidden", show ? "false" : "true");
}

function isStandaloneDisplayMode(isStandaloneDisplayModeFn) {
  if (typeof isStandaloneDisplayModeFn !== "function") {
    return false;
  }
  try {
    return !!isStandaloneDisplayModeFn();
  } catch (error) {
    return false;
  }
}

function isIOSDevice() {
  const ua = window.navigator.userAgent || "";
  const platform = window.navigator.platform || "";
  const iPhoneOrIPad = /iPad|iPhone|iPod/i.test(ua);
  const ipadOnDesktop = platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  return iPhoneOrIPad || ipadOnDesktop;
}

function isIOSSafari() {
  if (!isIOSDevice()) {
    return false;
  }
  const ua = window.navigator.userAgent || "";
  const isSafari = /Safari/i.test(ua);
  const isOtherIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/i.test(ua);
  return isSafari && !isOtherIOSBrowser;
}

function isAndroidDevice() {
  return /Android/i.test(window.navigator.userAgent || "");
}

function isMobileWebContext() {
  const widthMatches =
    typeof window.matchMedia === "function"
      ? window.matchMedia(MOBILE_WIDTH_QUERY).matches
      : window.innerWidth <= 900;
  const coarsePointer =
    typeof window.matchMedia === "function"
      ? window.matchMedia(COARSE_POINTER_QUERY).matches
      : "ontouchstart" in window || window.navigator.maxTouchPoints > 0;
  return widthMatches && coarsePointer;
}

function isInstallSupportedForCurrentDevice() {
  return Boolean(deferredInstallPromptEvent) || isIOSSafari() || isAndroidDevice();
}

function isInstalled(isStandaloneDisplayModeFn) {
  return isStandaloneDisplayMode(isStandaloneDisplayModeFn);
}

function showBannerIfEligible(isStandaloneDisplayModeFn) {
  const banner = document.getElementById("install-banner");
  const sticky = document.getElementById("install-sticky-btn");
  if (!banner || !sticky) {
    return;
  }

  const installed = isInstalled(isStandaloneDisplayModeFn);
  const eligibleContext = isMobileWebContext() && !installed;
  const canInstall = eligibleContext && isInstallSupportedForCurrentDevice();

  setHidden(sticky, !canInstall);

  if (!canInstall) {
    setHidden(banner, true);
    setIosSheetVisibility(false);
    return;
  }

  const hasSeenBanner = readStorage(INSTALL_BANNER_SEEN_KEY) === "1";
  const reminderAt = readReminderTimestamp();
  const reminderDue = reminderAt > 0 && Date.now() >= reminderAt;

  let showBanner = false;
  if (!hasSeenBanner) {
    showBanner = true;
    writeStorage(INSTALL_BANNER_SEEN_KEY, "1");
  } else if (reminderDue) {
    showBanner = true;
    clearReminder();
  }

  setHidden(banner, !showBanner);
}

function hideInstallBanner() {
  const banner = document.getElementById("install-banner");
  setHidden(banner, true);
}

async function handleInstallAction({ isStandaloneDisplayModeFn, showMessage }) {
  if (isInstalled(isStandaloneDisplayModeFn)) {
    showBannerIfEligible(isStandaloneDisplayModeFn);
    return;
  }

  if (deferredInstallPromptEvent) {
    const promptEvent = deferredInstallPromptEvent;
    deferredInstallPromptEvent = null;

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === "dismissed") {
        scheduleReminder(LATER_REMIND_DELAY_MS);
      } else if (choice?.outcome === "accepted") {
        scheduleReminder(INSTALLED_REMIND_DELAY_MS);
      }
      hideInstallBanner();
    } catch (error) {}

    showBannerIfEligible(isStandaloneDisplayModeFn);
    return;
  }

  if (isIOSSafari()) {
    setIosSheetVisibility(true);
    return;
  }

  if (isAndroidDevice()) {
    if (typeof showMessage === "function") {
      showMessage(
        "Sur Android: menu du navigateur (⋮) puis “Installer l’application” ou “Ajouter à l’écran d’accueil”.",
        "info",
      );
    }
    return;
  }

  if (typeof showMessage === "function") {
    showMessage(
      "Pour installer, ouvrez le menu du navigateur puis choisissez “Installer l’application”.",
      "info",
    );
  }
}

export function initInstallPrompt({ isStandaloneDisplayModeFn, showMessage } = {}) {
  if (!installPromptInitialized) {
    installPromptInitialized = true;

    const installBannerActionButton = document.getElementById("install-banner-action");
    const installBannerLaterButton = document.getElementById("install-banner-later");
    const installStickyButton = document.getElementById("install-sticky-btn");
    const installIosCloseButton = document.getElementById("install-ios-close");
    const installIosBackdrop = document.getElementById("install-ios-backdrop");

    const refreshUI = () => showBannerIfEligible(isStandaloneDisplayModeFn);

    const onInstallClick = () =>
      handleInstallAction({ isStandaloneDisplayModeFn, showMessage });

    installBannerActionButton && installBannerActionButton.addEventListener("click", onInstallClick);
    installStickyButton && installStickyButton.addEventListener("click", onInstallClick);

    installBannerLaterButton &&
      installBannerLaterButton.addEventListener("click", () => {
        scheduleReminder(LATER_REMIND_DELAY_MS);
        hideInstallBanner();
      });

    const closeIosSheetWithCooldown = () => {
      scheduleReminder(IOS_SHEET_REMIND_DELAY_MS);
      hideInstallBanner();
      setIosSheetVisibility(false);
    };

    installIosCloseButton && installIosCloseButton.addEventListener("click", closeIosSheetWithCooldown);
    installIosBackdrop && installIosBackdrop.addEventListener("click", closeIosSheetWithCooldown);

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPromptEvent = event;
      refreshUI();
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPromptEvent = null;
      scheduleReminder(INSTALLED_REMIND_DELAY_MS);
      hideInstallBanner();
      setIosSheetVisibility(false);
      refreshUI();
    });

    window.addEventListener("resize", refreshUI, { passive: true });
    window.addEventListener("orientationchange", refreshUI);
  }

  showBannerIfEligible(isStandaloneDisplayModeFn);
}
