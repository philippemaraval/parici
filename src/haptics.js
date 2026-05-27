const HAPTICS_ENABLED_KEY = "parici_haptics_enabled";

export function isHapticsEnabled() {
  // Enabled by default unless explicitly disabled in storage.
  return localStorage.getItem(HAPTICS_ENABLED_KEY) !== "false";
}

export function updateHapticsUI() {
  const button = document.getElementById("haptics-toggle");
  if (!button) {
    return;
  }

  button.textContent = isHapticsEnabled() ? "📳" : "📴";
}

export function triggerHaptic(type = "click") {
  if (!isHapticsEnabled() || !navigator.vibrate) {
    return;
  }

  try {
    switch (type) {
      case "click":
        navigator.vibrate(15);
        break;
      case "success":
        navigator.vibrate([40, 30, 80]);
        break;
      case "error":
        navigator.vibrate([50, 60, 50]);
        break;
      case "warm":
        navigator.vibrate(10);
        break;
    }
  } catch (error) {
    console.warn("Haptics failed or blocked:", error);
  }
}

export function toggleHaptics() {
  const currentValue = isHapticsEnabled();
  localStorage.setItem(HAPTICS_ENABLED_KEY, String(!currentValue));
  updateHapticsUI();
  if (!currentValue) {
    triggerHaptic("success");
  }
}
