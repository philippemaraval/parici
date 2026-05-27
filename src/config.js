export const API_URL =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.protocol === "file:"
    ? "http://localhost:3000"
    : "https://parici.onrender.com";

export const SESSION_SIZE = 20;
export const MAX_ERRORS_MARATHON = 3;
export const MAX_TIME_SECONDS = 500;
export const CHRONO_DURATION = 60;
export const HIGHLIGHT_DURATION_MS = 5000;
export const MAX_POINTS_PER_ITEM = 10;
export const LEADERBOARD_VISIBLE_ROWS = 3;
export const MAX_LECTURE_SEARCH_RESULTS = 8;

export const DAILY_GUESSES_STORAGE_PREFIX = "parici_daily_guesses_";
export const DAILY_META_STORAGE_PREFIX = "parici_daily_meta_";

export const UI_THEME = {
  mapStreet: "#f2a900",
  mapStreetHover: "#f8c870",
  mapCorrect: "#1f9d66",
  mapWrong: "#d2463c",
  mapArrondissement: "#12297a",
  mapMonumentStroke: "#dfe6ff",
  mapMonumentFill: "#4057b2",
  timerSafe: "#1f9d66",
  timerWarn: "#a85a00",
  timerDanger: "#d2463c",
};
