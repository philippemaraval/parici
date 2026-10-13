"use strict";

function toPositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toSafeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function cleanText(value, maxLength = 5000) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function toCoordinate(value) {
  if (value === null || value === undefined || String(value).trim() === "")
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRiddlePayload(body) {
  const wayId = toPositiveInteger(body?.way_id);
  const streetName = cleanText(body?.street_name_clean, 255);
  const riddleText = cleanText(body?.riddle_text);
  const hintText = cleanText(body?.hint_text);
  const explanationText = cleanText(body?.explanation_text, 12000);
  const imageUrl = cleanText(body?.image_url, 2000);
  const latitude = toCoordinate(body?.latitude);
  const longitude = toCoordinate(body?.longitude);

  if (!wayId) return { ok: false, error: "way_id is required" };
  if (!streetName) return { ok: false, error: "street_name_clean is required" };
  if (!riddleText) return { ok: false, error: "riddle_text is required" };
  if (!hintText) return { ok: false, error: "hint_text is required" };
  if (!imageUrl) return { ok: false, error: "image_url is required" };
  if (!/^(https?:\/\/|\/[^/])/.test(imageUrl))
    return { ok: false, error: "Adresse d’image invalide" };
  if (
    (latitude === null) !== (longitude === null) ||
    (latitude !== null && (latitude < -90 || latitude > 90)) ||
    (longitude !== null && (longitude < -180 || longitude > 180)) ||
    [body?.latitude, body?.longitude].some(
      (value) =>
        value != null &&
        String(value).trim() !== "" &&
        !Number.isFinite(Number(value)),
    )
  ) {
    return {
      ok: false,
      error:
        "Coordonnées invalides : renseignez latitude et longitude ensemble, ou laissez les deux vides.",
    };
  }

  return {
    ok: true,
    values: [
      wayId,
      streetName,
      riddleText,
      hintText,
      explanationText,
      imageUrl,
      latitude,
      longitude,
    ],
  };
}

function normalizeProgressPayload(body) {
  const riddleId = toPositiveInteger(body?.riddle_id);
  const startedAt = cleanText(body?.started_at, 80);
  const solvedAt = cleanText(body?.solved_at, 80) || new Date().toISOString();
  const hintsUsed = Math.max(0, Math.min(1, toSafeInteger(body?.hints_used)));
  const pointsEarned = Math.max(0, toSafeInteger(body?.points_earned));
  const walkingTimeSeconds = Math.max(
    0,
    toSafeInteger(body?.walking_time_seconds),
  );

  if (!riddleId || !startedAt) return { ok: false };

  return {
    ok: true,
    riddleId,
    startedAt,
    solvedAt,
    hintsUsed,
    pointsEarned,
    walkingTimeSeconds,
    clientPayload: {
      ocr_text: cleanText(body?.ocr_text, 2000),
      normalized_ocr_text: cleanText(body?.normalized_ocr_text, 2000),
      levenshtein_distance: toSafeInteger(body?.levenshtein_distance),
      client_validated: Boolean(body?.client_validated),
    },
  };
}

module.exports = {
  cleanText,
  normalizeProgressPayload,
  normalizeRiddlePayload,
  toPositiveInteger,
  toSafeInteger,
};
