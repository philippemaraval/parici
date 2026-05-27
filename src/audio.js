import { triggerHaptic } from "./haptics.js";

const SOUND_STORAGE_KEY = "parici-sound";

let soundEnabled = localStorage.getItem(SOUND_STORAGE_KEY) !== "off";
let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

function playTone(
  frequency,
  durationSec,
  type = "sine",
  gain = 0.15,
  delaySec = 0,
) {
  if (!soundEnabled) {
    return;
  }

  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;

    envelope.gain.setValueAtTime(gain, ctx.currentTime + delaySec);
    envelope.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + delaySec + durationSec,
    );

    oscillator.connect(envelope);
    envelope.connect(ctx.destination);
    oscillator.start(ctx.currentTime + delaySec);
    oscillator.stop(ctx.currentTime + delaySec + durationSec);
  } catch (error) {}
}

export function playDing() {
  playTone(880, 0.15, "sine", 0.12, 0);
  playTone(1320, 0.2, "sine", 0.1, 0.1);
}

export function playBuzz() {
  playTone(150, 0.25, "sawtooth", 0.08, 0);
  playTone(120, 0.3, "square", 0.05, 0.05);
}

export function playVictory() {
  playTone(523, 0.15, "sine", 0.12, 0);
  playTone(659, 0.15, "sine", 0.12, 0.15);
  playTone(784, 0.15, "sine", 0.12, 0.3);
  playTone(1047, 0.3, "triangle", 0.1, 0.45);
}

export function playTick() {
  playTone(1000, 0.03, "square", 0.04, 0);
}

export function syncSoundToggleUI() {
  const button = document.getElementById("sound-toggle");
  if (!button) {
    return;
  }

  button.textContent = soundEnabled ? "🔊" : "🔇";
}

export function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_STORAGE_KEY, soundEnabled ? "on" : "off");
  syncSoundToggleUI();
  if (soundEnabled) {
    playDing();
  }
  triggerHaptic("click");
}
