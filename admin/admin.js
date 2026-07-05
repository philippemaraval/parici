const API_BASE_CANDIDATES =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.protocol === "file:"
    ? ["http://localhost:3000"]
    : ["https://camino-paris.onrender.com"];

const API_REQUEST_TIMEOUT_MS = 45000;
const LOGIN_API_REQUEST_TIMEOUT_MS = 75000;
const OSM_SYNC_POLL_INTERVAL_MS = 8000;
const OSM_SYNC_POLL_TIMEOUT_MS = 12 * 60 * 1000;

const STORAGE_KEY = "camino_paris_editor_user";

const state = {
  token: "",
  username: "",
  role: "",
  content: null,
  selectedStreetName: "",
  osmSyncPollTimer: 0,
  osmSyncPollStartedAtMs: 0,
};

const refs = {
  globalStatus: document.getElementById("global-status"),
  loginSection: document.getElementById("login-section"),
  editorSection: document.getElementById("editor-section"),
  loginForm: document.getElementById("login-form"),
  loginUsername: document.getElementById("login-username"),
  loginPassword: document.getElementById("login-password"),
  loginBtn: document.getElementById("login-btn"),
  sessionUser: document.getElementById("session-user"),
  sessionRole: document.getElementById("session-role"),
  manageUsersLink: document.getElementById("manage-users-link"),
  usersAdminCard: document.getElementById("users-admin-card"),
  refreshContentBtn: document.getElementById("refresh-content-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  runOsmSyncBtn: document.getElementById("run-osm-sync-btn"),
  osmSyncOutput: document.getElementById("osm-sync-output"),
  statsGrid: document.getElementById("stats-grid"),
  openVisitStatsBtn: document.getElementById("open-visit-stats-btn"),
  visitStatsModal: document.getElementById("visit-stats-modal"),
  visitStatsPanel: document.querySelector("#visit-stats-modal .modal-panel"),
  closeVisitStatsBtn: document.getElementById("close-visit-stats-btn"),
  visitStatsSummary: document.getElementById("visit-stats-summary"),
  visitStatsNote: document.getElementById("visit-stats-note"),
  visitStatsChart: document.getElementById("visit-stats-chart"),
  visitStatsTableBody: document.getElementById("visit-stats-table-body"),
  infoModeSelect: document.getElementById("info-mode-select"),
  streetSearchInput: document.getElementById("street-search-input"),
  streetSelect: document.getElementById("street-select"),
  streetNameInput: document.getElementById("street-name-input"),
  streetInfoText: document.getElementById("street-info-text"),
  saveStreetInfoBtn: document.getElementById("save-street-info-btn"),
  addStreetToListBtn: document.getElementById("add-street-to-list-btn"),
  removeStreetFromListBtn: document.getElementById("remove-street-from-list-btn"),
  deleteStreetInfoBtn: document.getElementById("delete-street-info-btn"),
  famousListText: document.getElementById("famous-list-text"),
  mainListText: document.getElementById("main-list-text"),
  saveListsBtn: document.getElementById("save-lists-btn"),
  monumentsTableBody: document.getElementById("monuments-table-body"),
  addMonumentRowBtn: document.getElementById("add-monument-row-btn"),
  saveMonumentsBtn: document.getElementById("save-monuments-btn"),
};

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeMonumentKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`´]/g, "'")
    .replace(/[-‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ");
}

function setGlobalStatus(message, type = "info") {
  if (!refs.globalStatus) {
    return;
  }
  refs.globalStatus.textContent = message;
  refs.globalStatus.classList.remove("status--info", "status--success", "status--error");
  if (type === "success") {
    refs.globalStatus.classList.add("status--success");
  } else if (type === "error") {
    refs.globalStatus.classList.add("status--error");
  } else {
    refs.globalStatus.classList.add("status--info");
  }
}

function setOsmSyncOutput(message) {
  if (!refs.osmSyncOutput) {
    return;
  }
  refs.osmSyncOutput.textContent = String(message || "").trim() || "Aucun log disponible.";
}

function formatOsmSyncActiveState(active) {
  if (!active || typeof active !== "object") {
    return "";
  }
  const startedAt = active.startedAt ? new Date(active.startedAt) : null;
  const startedLabel =
    startedAt && !Number.isNaN(startedAt.getTime())
      ? startedAt.toLocaleString("fr-FR")
      : active.startedAt || "?";
  const ageSeconds = Number.isFinite(active.ageMs)
    ? Math.max(0, Math.round(active.ageMs / 1000))
    : null;
  const ageLabel = ageSeconds !== null ? `, depuis ${ageSeconds}s` : "";
  return `Sync locale active: ${active.requestedBy || "admin"}, demarree ${startedLabel}${ageLabel}.`;
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return new Intl.NumberFormat("fr-FR").format(number);
}

function formatDay(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatShortDay(value) {
  if (!value) {
    return "";
  }
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatGithubRunStatus(run) {
  if (!run) {
    return "Workflow GitHub en attente d'apparition...";
  }

  const statusLabels = {
    queued: "en file d'attente",
    in_progress: "en cours",
    completed: "termine",
  };
  const conclusionLabels = {
    success: "succes",
    failure: "echec",
    cancelled: "annule",
    skipped: "ignore",
    timed_out: "timeout",
    action_required: "action requise",
  };
  const status = statusLabels[run.status] || run.status || "statut inconnu";
  const conclusion = run.conclusion
    ? ` (${conclusionLabels[run.conclusion] || run.conclusion})`
    : "";
  const started = formatDateTime(run.startedAt || run.createdAt);
  const updated = formatDateTime(run.updatedAt);
  const lines = [
    `Workflow GitHub #${run.number || run.id || "?"}: ${status}${conclusion}`,
  ];
  if (started) {
    lines.push(`Demarre: ${started}`);
  }
  if (updated) {
    lines.push(`Derniere mise a jour: ${updated}`);
  }
  if (run.url) {
    lines.push(`Voir le run: ${run.url}`);
  }
  return lines.join("\n");
}

function stopOsmSyncPolling() {
  if (state.osmSyncPollTimer) {
    window.clearTimeout(state.osmSyncPollTimer);
    state.osmSyncPollTimer = 0;
  }
}

async function pollOsmSyncStatus({ since, label }) {
  stopOsmSyncPolling();
  state.osmSyncPollStartedAtMs = Date.now();

  const pollOnce = async () => {
    try {
      const query = since ? `?since=${encodeURIComponent(since)}` : "";
      const payload = await apiRequest(`/api/editor/osm-sync/status${query}`);
      const run = payload?.github?.run || null;
      const githubError = payload?.github?.error || "";
      const activeState = formatOsmSyncActiveState(payload?.active);
      const runStatus = formatGithubRunStatus(run);
      const parts = [
        label || "Workflow GitHub lance.",
        runStatus,
      ];
      if (activeState) {
        parts.push(activeState);
      }
      if (githubError) {
        parts.push(`Statut GitHub indisponible: ${githubError}`);
      }
      setOsmSyncOutput(parts.filter(Boolean).join("\n\n"));

      if (run?.status === "completed") {
        stopOsmSyncPolling();
        refs.runOsmSyncBtn.disabled = false;
        if (run.conclusion === "success") {
          setGlobalStatus("Synchronisation OSM terminee avec succes. Deploiement Render declenche si des donnees ont change.", "success");
        } else {
          setGlobalStatus(`Echec synchronisation OSM: ${run.conclusion || "statut inconnu"}.`, "error");
        }
        return;
      }
    } catch (error) {
      setOsmSyncOutput(`Suivi de synchronisation indisponible: ${error.message}`);
    }

    if (Date.now() - state.osmSyncPollStartedAtMs > OSM_SYNC_POLL_TIMEOUT_MS) {
      stopOsmSyncPolling();
      refs.runOsmSyncBtn.disabled = false;
      setGlobalStatus("Suivi OSM arrete: timeout cote admin. Verifiez GitHub Actions.", "error");
      return;
    }

    state.osmSyncPollTimer = window.setTimeout(pollOnce, OSM_SYNC_POLL_INTERVAL_MS);
  };

  await pollOnce();
}

function setUiAuthenticated(isAuthenticated) {
  refs.loginSection.classList.toggle("hidden", isAuthenticated);
  refs.editorSection.classList.toggle("hidden", !isAuthenticated);
}

function saveSession() {
  const payload = {
    token: state.token,
    username: state.username,
    role: state.role,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function clearSession() {
  state.token = "";
  state.username = "";
  state.role = "";
  state.content = null;
  localStorage.removeItem(STORAGE_KEY);
}

function restoreSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return false;
  }
  try {
    const payload = JSON.parse(raw);
    state.token = String(payload.token || "");
    state.username = String(payload.username || "");
    state.role = String(payload.role || "");
    return Boolean(state.token);
  } catch (error) {
    clearSession();
    return false;
  }
}

async function apiRequest(path, { method = "GET", body, auth = true, timeoutMs = API_REQUEST_TIMEOUT_MS } = {}) {
  const headers = {};
  if (auth) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response = null;
  let responsePayload = null;
  let responseText = "";
  let lastNetworkError = null;
  for (let index = 0; index < API_BASE_CANDIDATES.length; index += 1) {
    const base = API_BASE_CANDIDATES[index];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const candidateResponse = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const candidateText = await candidateResponse.text();
      let candidatePayload = null;
      if (candidateText) {
        try {
          candidatePayload = JSON.parse(candidateText);
        } catch (error) {
          candidatePayload = null;
        }
      }

      const contentType = String(candidateResponse.headers.get("content-type") || "").toLowerCase();
      const isJsonResponse =
        contentType.includes("application/json") || contentType.includes("+json");
      const looksLikeHtml = /^\s*</.test(candidateText || "");
      const canFallback = index < API_BASE_CANDIDATES.length - 1;

      if (candidateResponse.status === 404 || candidateResponse.status === 405) {
        if (index < API_BASE_CANDIDATES.length - 1) {
          continue;
        }
      }

      if (candidateResponse.ok && !isJsonResponse && (looksLikeHtml || candidatePayload === null) && canFallback) {
        continue;
      }

      response = candidateResponse;
      responsePayload = candidatePayload;
      responseText = candidateText;
      break;
    } catch (error) {
      clearTimeout(timeoutId);
      lastNetworkError = error;
      if (index < API_BASE_CANDIDATES.length - 1) {
        continue;
      }
      if (error?.name === "AbortError") {
        throw new Error(`API timeout apres ${Math.round(timeoutMs / 1000)}s (${path})`);
      }
      throw error;
    }
  }

  if (!response) {
    throw lastNetworkError || new Error("No API response");
  }

  if (!response.ok) {
    const error = new Error(responsePayload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = responsePayload;
    throw error;
  }

  if (responsePayload === null && responseText) {
    throw new Error("API response is not valid JSON");
  }
  return responsePayload;
}

async function warmApiForLogin() {
  await apiRequest("/api/health", {
    auth: false,
    timeoutMs: LOGIN_API_REQUEST_TIMEOUT_MS,
  });
}

function parseListTextarea(value) {
  const dedup = new Set();
  const normalized = [];
  String(value || "")
    .split("\n")
    .forEach((line) => {
      const name = normalizeName(line);
      if (!name || dedup.has(name)) {
        return;
      }
      dedup.add(name);
      normalized.push(name);
    });
  return normalized;
}

function normalizeNameArray(values) {
  const dedup = new Set();
  const normalized = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const name = normalizeName(value);
    if (!name || dedup.has(name)) {
      return;
    }
    dedup.add(name);
    normalized.push(name);
  });
  return normalized;
}

function listToTextarea(values) {
  return (Array.isArray(values) ? values : []).join("\n");
}

function parseCoordinateValue(rawValue) {
  const normalized = String(rawValue ?? "")
    .trim()
    .replace(",", ".");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCoordinateValue(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  return String(value);
}

function parseMonumentsPayload(values) {
  const normalized = [];
  const dedup = new Set();
  (Array.isArray(values) ? values : []).forEach((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return;
    }
    const name = String(entry.name || "").trim();
    const normalizedName = normalizeMonumentKey(name);
    if (!normalizedName || dedup.has(normalizedName)) {
      return;
    }

    const longitude = parseCoordinateValue(
      entry.longitude ??
        entry.lng ??
        (Array.isArray(entry.coordinates) ? entry.coordinates[0] : null),
    );
    const latitude = parseCoordinateValue(
      entry.latitude ??
        entry.lat ??
        (Array.isArray(entry.coordinates) ? entry.coordinates[1] : null),
    );
    if (longitude === null || latitude === null) {
      return;
    }
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      return;
    }

    dedup.add(normalizedName);
    normalized.push({
      name,
      longitude,
      latitude,
    });
  });
  return normalized;
}

function getMonumentsForEditor() {
  const monumentsFromApi = parseMonumentsPayload(state.content?.monuments);
  const monumentsByName = new Map();
  monumentsFromApi.forEach((entry) => {
    monumentsByName.set(normalizeMonumentKey(entry.name), entry);
  });

  const orderedRows = [];
  const listNames = Array.isArray(state.content?.lists?.monuments)
    ? state.content.lists.monuments
    : [];
  listNames.forEach((rawName) => {
    const normalizedName = normalizeMonumentKey(rawName);
    if (!normalizedName) {
      return;
    }

    const existing = monumentsByName.get(normalizedName);
    if (existing) {
      orderedRows.push(existing);
      monumentsByName.delete(normalizedName);
      return;
    }

    orderedRows.push({
      name: String(rawName || "").trim(),
      longitude: null,
      latitude: null,
    });
  });

  monumentsByName.forEach((entry) => {
    orderedRows.push(entry);
  });

  return orderedRows;
}

function appendMonumentRow(entry = {}) {
  if (!refs.monumentsTableBody) {
    return;
  }

  const row = document.createElement("tr");

  const nameCell = document.createElement("td");
  const nameWrap = document.createElement("div");
  nameWrap.className = "monument-name-cell";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "monument-name-input";
  nameInput.placeholder = "Nom du monument";
  nameInput.value = String(entry.name || "");
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn btn-danger-outline monument-remove-btn";
  removeBtn.textContent = "Retirer";
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!refs.monumentsTableBody.querySelector("tr")) {
      appendMonumentRow();
    }
  });
  nameWrap.appendChild(nameInput);
  nameWrap.appendChild(removeBtn);
  nameCell.appendChild(nameWrap);

  const locationCell = document.createElement("td");
  const coordsWrap = document.createElement("div");
  coordsWrap.className = "monument-coords";
  const longitudeInput = document.createElement("input");
  longitudeInput.type = "text";
  longitudeInput.className = "monument-longitude-input";
  longitudeInput.placeholder = "Longitude (ex: 5.371242)";
  longitudeInput.value = formatCoordinateValue(entry.longitude);
  const latitudeInput = document.createElement("input");
  latitudeInput.type = "text";
  latitudeInput.className = "monument-latitude-input";
  latitudeInput.placeholder = "Latitude (ex: 43.2839455)";
  latitudeInput.value = formatCoordinateValue(entry.latitude);
  coordsWrap.appendChild(longitudeInput);
  coordsWrap.appendChild(latitudeInput);
  locationCell.appendChild(coordsWrap);

  row.appendChild(nameCell);
  row.appendChild(locationCell);
  refs.monumentsTableBody.appendChild(row);
}

function renderMonumentsEditor() {
  if (!refs.monumentsTableBody) {
    return;
  }
  refs.monumentsTableBody.innerHTML = "";

  const rows = getMonumentsForEditor();
  if (!rows.length) {
    appendMonumentRow();
    return;
  }
  rows.forEach((entry) => appendMonumentRow(entry));
}

function collectMonumentsFromTable() {
  const rows = Array.from(refs.monumentsTableBody?.querySelectorAll("tr") || []);
  const dedup = new Set();
  const entries = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 1;
    const nameInput = row.querySelector(".monument-name-input");
    const longitudeInput = row.querySelector(".monument-longitude-input");
    const latitudeInput = row.querySelector(".monument-latitude-input");

    const name = String(nameInput?.value || "").trim();
    const normalizedName = normalizeMonumentKey(name);
    const rawLongitude = String(longitudeInput?.value || "").trim();
    const rawLatitude = String(latitudeInput?.value || "").trim();

    const hasSomeValue = Boolean(name || rawLongitude || rawLatitude);
    if (!hasSomeValue) {
      continue;
    }

    if (!name) {
      throw new Error(`Ligne ${rowNumber}: le nom du monument est obligatoire.`);
    }

    const longitude = parseCoordinateValue(rawLongitude);
    const latitude = parseCoordinateValue(rawLatitude);
    if (longitude === null || latitude === null) {
      throw new Error(
        `Ligne ${rowNumber}: longitude et latitude doivent etre des nombres valides.`,
      );
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error(`Ligne ${rowNumber}: longitude hors plage (-180 a 180).`);
    }
    if (latitude < -90 || latitude > 90) {
      throw new Error(`Ligne ${rowNumber}: latitude hors plage (-90 a 90).`);
    }
    if (dedup.has(normalizedName)) {
      continue;
    }

    dedup.add(normalizedName);
    entries.push({
      name,
      longitude,
      latitude,
    });
  }

  return entries;
}

function getCurrentMode() {
  return refs.infoModeSelect.value === "main" ? "main" : "famous";
}

function getModeListKey(mode) {
  return mode === "main" ? "mainStreets" : "famousStreets";
}

function getStreetNamesForMode(mode) {
  if (!state.content) {
    return [];
  }
  const listNames = state.content.lists?.[getModeListKey(mode)] || [];
  const infoNames = Object.keys(state.content.streetInfos?.[mode] || {});
  const allNames = new Set([...listNames, ...infoNames]);
  return Array.from(allNames).sort((a, b) => a.localeCompare(b, "fr"));
}

function renderStats() {
  if (!state.content || !refs.statsGrid) {
    return;
  }

  const stats = state.content.stats || {};
  const cards = [
    ["Fiches rues celebres", stats.famousStreetInfoCount ?? 0],
    ["Fiches rues principales", stats.mainStreetInfoCount ?? 0],
    ["Rues celebres", stats.famousStreetCount ?? 0],
    ["Rues principales", stats.mainStreetCount ?? 0],
    ["Monuments", stats.monumentCount ?? 0],
  ];

  refs.statsGrid.innerHTML = cards
    .map(
      ([label, value]) =>
        `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`,
    )
    .join("");
}

function setVisitStatsLoading(message) {
  if (refs.visitStatsSummary) {
    refs.visitStatsSummary.textContent = message;
  }
  if (refs.visitStatsNote) {
    refs.visitStatsNote.textContent = "";
  }
  if (refs.visitStatsTableBody) {
    refs.visitStatsTableBody.innerHTML = "";
  }
  if (refs.visitStatsChart) {
    refs.visitStatsChart.textContent = "";
  }
}

function renderVisitStatsChart(payload) {
  if (!refs.visitStatsChart) {
    return;
  }
  const chartRows = Array.isArray(payload?.chartRows) ? payload.chartRows.slice(-30) : [];
  if (!chartRows.length) {
    refs.visitStatsChart.textContent = "";
    return;
  }

  const width = 860;
  const height = 320;
  const margin = { top: 28, right: 78, bottom: 46, left: 54 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxDailyValue = Math.max(
    1,
    ...chartRows.map((row) => Math.max(Number(row.totalVisits || 0), Number(row.uniqueVisitors || 0))),
  );
  const cumulativeValues = chartRows.map((row) => Number(row.cumulativeTotal || 0));
  const cumulativeMin = Math.min(...cumulativeValues);
  const cumulativeMax = Math.max(...cumulativeValues);
  const cumulativeRange = Math.max(1, cumulativeMax - cumulativeMin);
  const bandWidth = plotWidth / chartRows.length;
  const barWidth = Math.max(3, Math.min(10, bandWidth * 0.28));
  const xForIndex = (index) => margin.left + bandWidth * index + bandWidth / 2;
  const yForDaily = (value) => margin.top + plotHeight - (Number(value || 0) / maxDailyValue) * plotHeight;
  const yForCumulative = (value) =>
    margin.top + plotHeight - ((Number(value || 0) - cumulativeMin) / cumulativeRange) * plotHeight;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = margin.top + plotHeight - ratio * plotHeight;
    return `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="visit-chart-grid" />
      <text x="${margin.left - 8}" y="${y + 4}" class="visit-chart-axis-label" text-anchor="end">${formatNumber(Math.round(maxDailyValue * ratio))}</text>`;
  }).join("");
  const cumulativeLabels = [cumulativeMin, cumulativeMax].map((value) => {
    const y = yForCumulative(value);
    return `<text x="${width - margin.right + 8}" y="${y + 4}" class="visit-chart-axis-label visit-chart-axis-label--right">${formatNumber(value)}</text>`;
  }).join("");
  const bars = chartRows.map((row, index) => {
    const centerX = xForIndex(index);
    const totalHeight = Math.max(0, margin.top + plotHeight - yForDaily(row.totalVisits));
    const uniqueHeight = Math.max(0, margin.top + plotHeight - yForDaily(row.uniqueVisitors));
    return `<rect x="${centerX - barWidth - 1}" y="${yForDaily(row.totalVisits)}" width="${barWidth}" height="${totalHeight}" class="visit-chart-bar visit-chart-bar--total"><title>${formatDay(row.day)} - visites: ${formatNumber(row.totalVisits)}</title></rect>
      <rect x="${centerX + 1}" y="${yForDaily(row.uniqueVisitors)}" width="${barWidth}" height="${uniqueHeight}" class="visit-chart-bar visit-chart-bar--unique"><title>${formatDay(row.day)} - visiteurs uniques: ${formatNumber(row.uniqueVisitors)}</title></rect>`;
  }).join("");
  const linePoints = chartRows.map((row, index) =>
    `${xForIndex(index)},${yForCumulative(row.cumulativeTotal)}`,
  ).join(" ");
  const lineDots = chartRows.map((row, index) =>
    `<circle cx="${xForIndex(index)}" cy="${yForCumulative(row.cumulativeTotal)}" r="2.5" class="visit-chart-dot"><title>${formatDay(row.day)} - cumul total: ${formatNumber(row.cumulativeTotal)}</title></circle>`,
  ).join("");
  const xLabels = chartRows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => index === 0 || index === chartRows.length - 1 || (index + 1) % 7 === 0)
    .map(({ row, index }, selectedIndex, selectedRows) => {
      const anchor = selectedIndex === 0 ? "start" : selectedIndex === selectedRows.length - 1 ? "end" : "middle";
      return `<text x="${xForIndex(index)}" y="${height - 16}" class="visit-chart-axis-label" text-anchor="${anchor}">${formatShortDay(row.day)}</text>`;
    }).join("");

  refs.visitStatsChart.innerHTML = `
    <div class="visit-chart-legend">
      <span><i class="visit-chart-swatch visit-chart-swatch--total"></i>Visites quotidiennes</span>
      <span><i class="visit-chart-swatch visit-chart-swatch--unique"></i>Visiteurs uniques quotidiens</span>
      <span><i class="visit-chart-swatch visit-chart-swatch--line"></i>Cumul des visites</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Visites quotidiennes, visiteurs uniques et cumul des visites sur les 30 derniers jours">
      <text x="${margin.left}" y="18" class="visit-chart-title">30 derniers jours</text>
      <text x="${margin.left}" y="${height - 2}" class="visit-chart-axis-caption">Visites quotidiennes</text>
      <text x="${width - margin.right}" y="${height - 2}" class="visit-chart-axis-caption visit-chart-axis-caption--right" text-anchor="end">Cumul des visites</text>
      ${gridLines}${cumulativeLabels}
      <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" class="visit-chart-axis" />
      ${bars}<polyline points="${linePoints}" class="visit-chart-line" />${lineDots}${xLabels}
    </svg>`;
}

function renderVisitStats(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (refs.visitStatsSummary) {
    const totalVisits = formatNumber(payload?.totalVisits);
    const dayCount = formatNumber(payload?.chartRows?.length || rows.length);
    refs.visitStatsSummary.textContent = `${totalVisits} visites au total, ${dayCount} jours affiches.`;
  }
  renderVisitStatsChart(payload);
  if (refs.visitStatsNote) {
    refs.visitStatsNote.textContent =
      payload?.note ||
      "Les visites suivies par jour ne sont disponibles qu'a partir de l'activation du suivi quotidien.";
  }
  if (!refs.visitStatsTableBody) {
    return;
  }
  if (!rows.length) {
    refs.visitStatsTableBody.innerHTML =
      '<tr><td colspan="3">Aucune donnee de visite disponible.</td></tr>';
    return;
  }
  refs.visitStatsTableBody.innerHTML = rows
    .map((row) => {
      const visits =
        row.totalVisits === null || row.totalVisits === undefined
          ? "Non suivi"
          : formatNumber(row.totalVisits);
      return `
        <tr>
          <td>${formatDay(row.day)}</td>
          <td>${visits}</td>
          <td>${formatNumber(row.uniqueVisitors)}</td>
        </tr>
      `;
    })
    .join("");
}

function closeVisitStatsModal() {
  if (!refs.visitStatsModal) {
    return;
  }
  refs.visitStatsModal.classList.add("hidden");
}

async function openVisitStatsModal() {
  if (!refs.visitStatsModal) {
    return;
  }
  refs.visitStatsModal.classList.remove("hidden");
  refs.visitStatsPanel?.focus();
  setVisitStatsLoading("Chargement des statistiques de visites...");

  try {
    const payload = await apiRequest("/api/editor/visits/daily");
    renderVisitStats(payload);
  } catch (error) {
    setVisitStatsLoading(`Chargement impossible: ${error.message}`);
  }
}

function updateEditorFieldsForStreet(streetName) {
  const mode = getCurrentMode();
  const infoMap = state.content?.streetInfos?.[mode] || {};
  const normalizedName = normalizeName(streetName);
  state.selectedStreetName = normalizedName;
  refs.streetNameInput.value = normalizedName;
  refs.streetInfoText.value = normalizedName ? infoMap[normalizedName] || "" : "";
}

function renderStreetSelect(preferredStreetName = "") {
  const mode = getCurrentMode();
  const filterQuery = normalizeName(refs.streetSearchInput.value);
  const names = getStreetNamesForMode(mode).filter((name) =>
    filterQuery ? name.includes(filterQuery) : true,
  );

  refs.streetSelect.innerHTML = "";
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    refs.streetSelect.appendChild(option);
  });

  const normalizedPreferred = normalizeName(preferredStreetName);
  let selected = "";
  if (normalizedPreferred && names.includes(normalizedPreferred)) {
    refs.streetSelect.value = normalizedPreferred;
    selected = normalizedPreferred;
  } else if (names.length > 0) {
    refs.streetSelect.selectedIndex = 0;
    selected = refs.streetSelect.value;
  }

  if (selected) {
    updateEditorFieldsForStreet(selected);
  } else {
    updateEditorFieldsForStreet("");
  }
}

function buildListsPayloadWithUpdates(updates = {}) {
  return {
    famousStreets: normalizeNameArray(
      Object.prototype.hasOwnProperty.call(updates, "famousStreets")
        ? updates.famousStreets
        : state.content?.lists?.famousStreets,
    ),
    mainStreets: normalizeNameArray(
      Object.prototype.hasOwnProperty.call(updates, "mainStreets")
        ? updates.mainStreets
        : state.content?.lists?.mainStreets,
    ),
    monuments: normalizeNameArray(
      Object.prototype.hasOwnProperty.call(updates, "monuments")
        ? updates.monuments
        : state.content?.lists?.monuments,
    ),
  };
}

function renderListsEditors() {
  if (!state.content) {
    return;
  }
  refs.famousListText.value = listToTextarea(state.content.lists?.famousStreets);
  refs.mainListText.value = listToTextarea(state.content.lists?.mainStreets);
}

function renderAllEditors(preferredStreetName = "") {
  refs.sessionUser.textContent = state.username || "-";
  refs.sessionRole.textContent = state.role || "player";
  renderStats();
  renderListsEditors();
  renderMonumentsEditor();
  renderStreetSelect(preferredStreetName);
}

async function ensureEditorAccess() {
  const me = await apiRequest("/api/editor/me");
  if (!me?.canEdit) {
    const error = new Error("Ce compte n'a pas les droits editeur.");
    error.status = 403;
    throw error;
  }
  state.username = me.username;
  state.role = me.role;
  refs.manageUsersLink?.classList.toggle("hidden", !me.canManageUsers);
  refs.usersAdminCard?.classList.toggle("hidden", !me.canManageUsers);
  saveSession();
}

async function loadContent(preferredStreetName = "") {
  setGlobalStatus("Chargement du contenu...", "info");
  const content = await apiRequest("/api/editor/content");
  state.content = content;
  renderAllEditors(preferredStreetName);
  setGlobalStatus("Contenu charge.", "success");
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const username = refs.loginUsername.value.trim();
  const password = refs.loginPassword.value;
  if (!username || !password) {
    setGlobalStatus("Pseudo et mot de passe requis.", "error");
    return;
  }

  try {
    refs.loginBtn.disabled = true;
    setGlobalStatus("Reveil de l'API...", "info");
    await warmApiForLogin();
    setGlobalStatus("Connexion en cours...", "info");
    const payload = await apiRequest("/api/login", {
      method: "POST",
      auth: false,
      body: { username, password },
      timeoutMs: LOGIN_API_REQUEST_TIMEOUT_MS,
    });

    state.token = String(payload?.token || "");
    state.username = String(payload?.username || username);
    state.role = String(payload?.role || "player");
    saveSession();

    await ensureEditorAccess();
    setUiAuthenticated(true);
    await loadContent();
  } catch (error) {
    clearSession();
    setUiAuthenticated(false);
    setGlobalStatus(`Connexion impossible: ${error.message}`, "error");
  } finally {
    refs.loginBtn.disabled = false;
  }
}

async function bootstrapSession() {
  if (!restoreSession()) {
    setUiAuthenticated(false);
    return;
  }

  try {
    await ensureEditorAccess();
    setUiAuthenticated(true);
    await loadContent();
  } catch (error) {
    clearSession();
    setUiAuthenticated(false);
    setGlobalStatus(`Session invalide: ${error.message}`, "error");
  }
}

async function onSaveStreetInfo() {
  const mode = getCurrentMode();
  const streetName = normalizeName(refs.streetNameInput.value);
  const infoText = String(refs.streetInfoText.value || "").trim();

  if (!streetName) {
    setGlobalStatus("Nom de rue obligatoire.", "error");
    return;
  }

  const selectedStreetName = normalizeName(state.selectedStreetName || refs.streetSelect.value);
  let previousStreetName = "";
  if (selectedStreetName && selectedStreetName !== streetName) {
    const shouldRename = window.confirm(
      `Renommer "${selectedStreetName}" en "${streetName}" ?\n\n` +
        "OK: met a jour l'entree existante.\n" +
        "Annuler: cree ou met a jour la nouvelle entree sans toucher l'ancienne.",
    );
    if (shouldRename) {
      previousStreetName = selectedStreetName;
    }
  }

  try {
    setGlobalStatus("Enregistrement de la fiche...", "info");
    const payload = {
      mode,
      streetName,
      infoText,
    };
    if (previousStreetName) {
      payload.previousStreetName = previousStreetName;
    }
    await apiRequest("/api/editor/street-info", {
      method: "PUT",
      body: payload,
    });
    await loadContent(streetName);
    if (previousStreetName) {
      setGlobalStatus(`Rue renommee: ${previousStreetName} -> ${streetName}`, "success");
    } else if (infoText) {
      setGlobalStatus(`Fiche enregistree: ${streetName}`, "success");
    } else {
      setGlobalStatus(
        `Nom enregistre sans texte pour "${streetName}" (texte de fiche vide autorise).`,
        "success",
      );
    }
  } catch (error) {
    setGlobalStatus(`Echec enregistrement fiche: ${error.message}`, "error");
  }
}

async function onDeleteStreetInfo() {
  const mode = getCurrentMode();
  const streetName = normalizeName(
    refs.streetNameInput.value || state.selectedStreetName || refs.streetSelect.value,
  );
  if (!streetName) {
    setGlobalStatus("Selectionnez une rue a supprimer.", "error");
    return;
  }

  if (!window.confirm(`Supprimer la fiche de "${streetName}" ?`)) {
    return;
  }

  try {
    setGlobalStatus("Suppression de la fiche...", "info");
    await apiRequest("/api/editor/street-info", {
      method: "DELETE",
      body: {
        mode,
        streetName,
      },
    });
    refs.streetNameInput.value = "";
    refs.streetInfoText.value = "";
    await loadContent();
    setGlobalStatus(`Fiche supprimee: ${streetName}`, "success");
  } catch (error) {
    setGlobalStatus(`Echec suppression fiche: ${error.message}`, "error");
  }
}

async function onAddStreetToModeList() {
  if (!state.content) {
    setGlobalStatus("Contenu non charge.", "error");
    return;
  }

  const mode = getCurrentMode();
  const listKey = getModeListKey(mode);
  const streetName = normalizeName(
    refs.streetNameInput.value || state.selectedStreetName || refs.streetSelect.value,
  );
  if (!streetName) {
    setGlobalStatus("Nom de rue obligatoire.", "error");
    return;
  }

  const currentList = normalizeNameArray(state.content?.lists?.[listKey]);
  if (currentList.includes(streetName)) {
    setGlobalStatus(`"${streetName}" est deja dans la liste active.`, "info");
    return;
  }

  const updatedList = [...currentList, streetName];
  const payload =
    listKey === "mainStreets"
      ? buildListsPayloadWithUpdates({ mainStreets: updatedList })
      : buildListsPayloadWithUpdates({ famousStreets: updatedList });

  try {
    setGlobalStatus("Ajout dans la liste active...", "info");
    await apiRequest("/api/editor/lists", {
      method: "PUT",
      body: payload,
    });
    await loadContent(streetName);
    setGlobalStatus(`Rue ajoutee a la liste active: ${streetName}`, "success");
  } catch (error) {
    setGlobalStatus(`Echec ajout liste: ${error.message}`, "error");
  }
}

async function onRemoveStreetFromModeList() {
  if (!state.content) {
    setGlobalStatus("Contenu non charge.", "error");
    return;
  }

  const mode = getCurrentMode();
  const listKey = getModeListKey(mode);
  const streetName = normalizeName(
    refs.streetNameInput.value || state.selectedStreetName || refs.streetSelect.value,
  );
  if (!streetName) {
    setGlobalStatus("Nom de rue obligatoire.", "error");
    return;
  }

  const currentList = normalizeNameArray(state.content?.lists?.[listKey]);
  if (!currentList.includes(streetName)) {
    setGlobalStatus(`"${streetName}" n'est pas present dans la liste active.`, "info");
    return;
  }

  if (!window.confirm(`Retirer "${streetName}" de la liste active ?`)) {
    return;
  }

  const updatedList = currentList.filter((name) => name !== streetName);
  const payload =
    listKey === "mainStreets"
      ? buildListsPayloadWithUpdates({ mainStreets: updatedList })
      : buildListsPayloadWithUpdates({ famousStreets: updatedList });

  try {
    setGlobalStatus("Suppression de la liste active...", "info");
    await apiRequest("/api/editor/lists", {
      method: "PUT",
      body: payload,
    });
    await loadContent(streetName);
    setGlobalStatus(`Rue retiree de la liste active: ${streetName}`, "success");
  } catch (error) {
    setGlobalStatus(`Echec suppression liste: ${error.message}`, "error");
  }
}

async function onSaveLists() {
  if (!state.content) {
    setGlobalStatus("Contenu non charge.", "error");
    return;
  }

  const payload = {
    famousStreets: parseListTextarea(refs.famousListText.value),
    mainStreets: parseListTextarea(refs.mainListText.value),
    monuments: normalizeNameArray(state.content?.lists?.monuments),
  };

  try {
    setGlobalStatus("Enregistrement des listes...", "info");
    await apiRequest("/api/editor/lists", {
      method: "PUT",
      body: payload,
    });
    await loadContent();
    setGlobalStatus("Listes enregistrees.", "success");
  } catch (error) {
    setGlobalStatus(`Echec enregistrement listes: ${error.message}`, "error");
  }
}

async function onSaveMonuments() {
  if (!state.content) {
    setGlobalStatus("Contenu non charge.", "error");
    return;
  }

  let entries = [];
  try {
    entries = collectMonumentsFromTable();
  } catch (error) {
    setGlobalStatus(error.message, "error");
    return;
  }

  try {
    setGlobalStatus("Enregistrement des monuments...", "info");
    await apiRequest("/api/editor/monuments", {
      method: "PUT",
      body: { entries },
    });
    await loadContent();
    setGlobalStatus(`Monuments enregistres (${entries.length}).`, "success");
  } catch (error) {
    setGlobalStatus(`Echec enregistrement monuments: ${error.message}`, "error");
  }
}

async function onRunOsmSync() {
  if (!refs.runOsmSyncBtn) {
    return;
  }

  const confirmed = window.confirm(
    "Lancer la synchronisation OSM maintenant ?\n\nLe workflow GitHub mettra a jour les donnees de carte et declenchera le deploiement.",
  );
  if (!confirmed) {
    return;
  }

  refs.runOsmSyncBtn.disabled = true;
  setGlobalStatus("Declenchement de la synchronisation OSM...", "info");
  setOsmSyncOutput("Declenchement du workflow GitHub...");
  stopOsmSyncPolling();
  const pollSince = new Date(Date.now() - 15_000).toISOString();

  try {
    const payload = await apiRequest("/api/editor/osm-sync", {
      method: "POST",
      body: { target: "github" },
    });

    if (payload?.dispatched) {
      const dispatch = payload.dispatch || {};
      const label = `${dispatch.repository || "depot GitHub"} / ${dispatch.workflow || "sync-osm.yml"}`;
      setGlobalStatus(`Workflow OSM lance (${label}). Suivi en cours...`, "info");
      setOsmSyncOutput(`${payload?.output || "Workflow GitHub lance."}\n\nRecherche du run GitHub...`);
      await pollOsmSyncStatus({
        since: pollSince,
        label: payload?.output || `Workflow GitHub lance (${label}).`,
      });
      return;
    }

    const durationSeconds = Number.isFinite(payload?.durationMs)
      ? (payload.durationMs / 1000).toFixed(1)
      : "?";
    const changedFiles = Array.isArray(payload?.changedFiles) ? payload.changedFiles : [];
    const changedLabel = changedFiles.length
      ? `Fichiers modifies: ${changedFiles.join(", ")}`
      : "Aucun fichier cible n'a change.";

    setGlobalStatus(`Sync OSM terminee en ${durationSeconds}s. ${changedLabel}`, "success");
    setOsmSyncOutput(payload?.output || "Synchronisation terminee.");
  } catch (error) {
    stopOsmSyncPolling();
    const output = error?.payload?.output || "";
    setGlobalStatus(`Echec synchronisation OSM: ${error.message}`, "error");
    const activeState = formatOsmSyncActiveState(error?.payload?.active);
    setOsmSyncOutput(output || activeState || `Erreur: ${error.message}`);
    refs.runOsmSyncBtn.disabled = false;
  } finally {
    if (!state.osmSyncPollTimer) {
      refs.runOsmSyncBtn.disabled = false;
    }
  }
}

function bindEvents() {
  refs.loginForm.addEventListener("submit", onLoginSubmit);
  refs.logoutBtn.addEventListener("click", () => {
    clearSession();
    setUiAuthenticated(false);
    setGlobalStatus("Deconnecte.", "info");
  });
  refs.refreshContentBtn.addEventListener("click", async () => {
    try {
      await loadContent(refs.streetNameInput.value);
    } catch (error) {
      setGlobalStatus(`Echec actualisation: ${error.message}`, "error");
    }
  });

  refs.infoModeSelect.addEventListener("change", () => {
    refs.streetSearchInput.value = "";
    renderStreetSelect();
  });

  refs.streetSearchInput.addEventListener("input", () => {
    renderStreetSelect();
  });

  refs.streetSelect.addEventListener("change", () => {
    updateEditorFieldsForStreet(refs.streetSelect.value);
  });

  refs.saveStreetInfoBtn.addEventListener("click", onSaveStreetInfo);
  refs.addStreetToListBtn.addEventListener("click", onAddStreetToModeList);
  refs.removeStreetFromListBtn.addEventListener("click", onRemoveStreetFromModeList);
  refs.deleteStreetInfoBtn.addEventListener("click", onDeleteStreetInfo);
  refs.saveListsBtn.addEventListener("click", onSaveLists);
  refs.addMonumentRowBtn.addEventListener("click", () => {
    appendMonumentRow();
  });
  refs.saveMonumentsBtn.addEventListener("click", onSaveMonuments);
  if (refs.runOsmSyncBtn) {
    refs.runOsmSyncBtn.addEventListener("click", onRunOsmSync);
  }
  if (refs.openVisitStatsBtn) {
    refs.openVisitStatsBtn.addEventListener("click", openVisitStatsModal);
  }
  if (refs.closeVisitStatsBtn) {
    refs.closeVisitStatsBtn.addEventListener("click", closeVisitStatsModal);
  }
  refs.visitStatsModal?.addEventListener("click", (event) => {
    if (event.target?.hasAttribute("data-close-visit-stats")) {
      closeVisitStatsModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !refs.visitStatsModal?.classList.contains("hidden")) {
      closeVisitStatsModal();
    }
  });
}

bindEvents();
bootstrapSession();
