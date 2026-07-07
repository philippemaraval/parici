import { DAILY_GUESSES_STORAGE_PREFIX, DAILY_META_STORAGE_PREFIX } from "./config.js";

export const DAILY_STORAGE_TIMEZONE = "Europe/Paris";
export const DAILY_STORAGE_ROLLOVER_HOUR = 3;

function getDatePartsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const byType = {};
  parts.forEach((part) => {
    byType[part.type] = part.value;
  });
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function getDailyStorageDate(date = new Date()) {
  const sourceDate = date instanceof Date ? date : new Date(date);
  const validDate = Number.isNaN(sourceDate.getTime()) ? new Date() : sourceDate;
  return getDatePartsInTimeZone(
    new Date(validDate.getTime() - DAILY_STORAGE_ROLLOVER_HOUR * 60 * 60 * 1000),
    DAILY_STORAGE_TIMEZONE,
  );
}

export function getTodayDailyStorageDate(date = new Date()) {
  return getDailyStorageDate(date);
}

export function getDailyGuessesStorageKey(date) {
  return `${DAILY_GUESSES_STORAGE_PREFIX}${date}`;
}

export function getDailyMetaStorageKey(date) {
  return `${DAILY_META_STORAGE_PREFIX}${date}`;
}

export function formatDailyDistanceForShare(distanceMeters) {
  return distanceMeters >= 1000
    ? `${(distanceMeters / 1000).toFixed(1)} km`
    : `${Math.round(distanceMeters)} m`;
}

export function getDailyShareDateLabelFromDate(dailyDate) {
  let date = null;
  if (typeof dailyDate === "string") {
    const parsed = new Date(`${dailyDate}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed;
    }
  }

  if (!date) {
    date = new Date();
  }

  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function getDirectionArrow(fromCoords, targetCoords) {
  const dLon = targetCoords[0] - fromCoords[0];
  const dLat = targetCoords[1] - fromCoords[1];
  const angle = ((((180 * Math.atan2(dLon, dLat)) / Math.PI) % 360) + 360) % 360;
  return ["⬆️", "↗️", "➡️", "↘️", "⬇️", "↙️", "⬅️", "↖️"][Math.round(angle / 45) % 8];
}
