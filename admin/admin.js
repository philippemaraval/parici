const API_BASE_CANDIDATES = [
  window.CaminoRuntimeConfig?.apiUrl || "http://localhost:3000",
];

const API_REQUEST_TIMEOUT_MS = 45000;
const LOGIN_API_REQUEST_TIMEOUT_MS = 75000;
const STORAGE_KEY = "camino_paris_editor_user";
const SESSION_TOKEN_STORAGE_KEY = "camino_paris_editor_token";

const dirtyFields = new Set();
const state = {
  token: "",
  username: "",
  role: "",
  content: null,
  selectedStreetName: "",
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
  statsGrid: document.getElementById("stats-grid"),
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
  streetSelectCount: document.getElementById("street-select-count"),
  famousListCount: document.getElementById("famous-list-count"),
  mainListCount: document.getElementById("main-list-count"),
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

function setUiAuthenticated(isAuthenticated) {
  refs.loginSection.classList.toggle("hidden", isAuthenticated);
  refs.editorSection.classList.toggle("hidden", !isAuthenticated);
}

function saveSession() {
  const payload = {
    username: state.username,
    role: state.role,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, state.token);
}

function clearSession() {
  state.token = "";
  state.username = "";
  state.role = "";
  state.content = null;
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
}

function restoreSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return false;
  }
  try {
    const payload = JSON.parse(raw);
    const legacyToken = String(payload.token || "");
    state.token = String(sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || legacyToken);
    if (legacyToken) {
      delete payload.token;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, legacyToken);
    }
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
      const candidateResponse = await window.PariciAdminFetch(`${base}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(path.startsWith("/api/editor/") && method !== "GET" ? { ...body, expectedRevision: state.content?.revision } : body) : undefined,
        signal: controller.signal,
        credentials: "include",
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
        throw new Error(`Délai API dépassé après ${Math.round(timeoutMs / 1000)} s (${path})`);
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
  if (method !== "GET" && Number.isInteger(responsePayload?.revision) && state.content) state.content.revision = responsePayload.revision;
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
  nameCell.className = "monument-name-cell";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "monument-name-input";
  nameInput.placeholder = "Nom du monument";
  nameInput.value = String(entry.name || "");
  nameCell.appendChild(nameInput);

  const longitudeCell = document.createElement("td");
  longitudeCell.className = "monument-coordinate-cell";
  const longitudeInput = document.createElement("input");
  longitudeInput.type = "text";
  longitudeInput.inputMode = "decimal";
  longitudeInput.className = "monument-longitude-input";
  longitudeInput.placeholder = "Ex. : 2,352200";
  longitudeInput.setAttribute("aria-label", `Longitude de ${entry.name || "ce monument"}`);
  longitudeInput.value = formatCoordinateValue(entry.longitude);
  longitudeCell.appendChild(longitudeInput);

  const latitudeCell = document.createElement("td");
  latitudeCell.className = "monument-coordinate-cell";
  const latitudeInput = document.createElement("input");
  latitudeInput.type = "text";
  latitudeInput.inputMode = "decimal";
  latitudeInput.className = "monument-latitude-input";
  latitudeInput.placeholder = "Ex. : 48,856600";
  latitudeInput.setAttribute("aria-label", `Latitude de ${entry.name || "ce monument"}`);
  latitudeInput.value = formatCoordinateValue(entry.latitude);
  latitudeCell.appendChild(latitudeInput);

  const actionCell = document.createElement("td");
  actionCell.className = "monument-action-cell";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn btn-danger-outline monument-remove-btn";
  removeBtn.textContent = "Supprimer";
  removeBtn.setAttribute("aria-label", `Supprimer ${entry.name || "cette ligne"}`);
  removeBtn.addEventListener("click", () => {
    dirtyFields.add(refs.monumentsTableBody);
    row.remove();
    if (!refs.monumentsTableBody.querySelector("tr")) {
      appendMonumentRow();
    }
  });
  actionCell.appendChild(removeBtn);

  row.appendChild(nameCell);
  row.appendChild(longitudeCell);
  row.appendChild(latitudeCell);
  row.appendChild(actionCell);
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
      throw new Error(`Ligne ${rowNumber} : le nom du monument est obligatoire.`);
    }

    const longitude = parseCoordinateValue(rawLongitude);
    const latitude = parseCoordinateValue(rawLatitude);
    if (longitude === null || latitude === null) {
      throw new Error(
        `Ligne ${rowNumber} : la longitude et la latitude doivent être des nombres valides.`,
      );
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error(`Ligne ${rowNumber} : la longitude doit être comprise entre -180 et 180.`);
    }
    if (latitude < -90 || latitude > 90) {
      throw new Error(`Ligne ${rowNumber} : la latitude doit être comprise entre -90 et 90.`);
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

function formatRole(role) {
  const labels = {
    admin: "Administrateur",
    editor: "Éditeur",
    player: "Joueur",
  };
  return labels[role] || role || "Joueur";
}

function getModeLabel(mode) {
  return mode === "main" ? "rues principales" : "rues célèbres";
}

function formatStreetCount(count) {
  return `${count} rue${count > 1 ? "s" : ""}`;
}

function updateListCounts() {
  if (refs.famousListCount && refs.famousListText) {
    refs.famousListCount.textContent = formatStreetCount(
      parseListTextarea(refs.famousListText.value).length,
    );
  }
  if (refs.mainListCount && refs.mainListText) {
    refs.mainListCount.textContent = formatStreetCount(
      parseListTextarea(refs.mainListText.value).length,
    );
  }
}

function updateStreetActionLabels() {
  if (!refs.infoModeSelect) {
    return;
  }
  const modeLabel = getModeLabel(getCurrentMode());
  if (refs.addStreetToListBtn) {
    refs.addStreetToListBtn.textContent = `Ajouter aux ${modeLabel}`;
  }
  if (refs.removeStreetFromListBtn) {
    refs.removeStreetFromListBtn.textContent = `Retirer des ${modeLabel}`;
  }
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
    ["Fiches rues célèbres", stats.famousStreetInfoCount ?? 0],
    ["Fiches rues principales", stats.mainStreetInfoCount ?? 0],
    ["Rues célèbres", stats.famousStreetCount ?? 0],
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

function updateEditorFieldsForStreet(streetName) {
  if ((dirtyFields.has(refs.streetNameInput) || dirtyFields.has(refs.streetInfoText))
      && !window.confirm("Changer de fiche et abandonner la saisie non enregistrée ?")) return;
  dirtyFields.delete(refs.streetNameInput); dirtyFields.delete(refs.streetInfoText);
  if (!refs.streetNameInput || !refs.streetInfoText) {
    return;
  }
  const mode = getCurrentMode();
  const infoMap = state.content?.streetInfos?.[mode] || {};
  const normalizedName = normalizeName(streetName);
  state.selectedStreetName = normalizedName;
  refs.streetNameInput.value = normalizedName;
  refs.streetInfoText.value = normalizedName ? infoMap[normalizedName] || "" : "";
}

function renderStreetSelect(preferredStreetName = "") {
  if (!refs.infoModeSelect || !refs.streetSearchInput || !refs.streetSelect) {
    return;
  }
  const mode = getCurrentMode();
  const filterQuery = normalizeName(refs.streetSearchInput.value);
  const names = getStreetNamesForMode(mode).filter((name) =>
    filterQuery ? name.includes(filterQuery) : true,
  );
  if (refs.streetSelectCount) {
    refs.streetSelectCount.textContent = formatStreetCount(names.length);
  }
  updateStreetActionLabels();

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
  if (!state.content || !refs.famousListText || !refs.mainListText) {
    return;
  }
  refs.famousListText.value = listToTextarea(state.content.lists?.famousStreets);
  refs.mainListText.value = listToTextarea(state.content.lists?.mainStreets);
  updateListCounts();
}

function renderAllEditors(preferredStreetName = "") {
  if (refs.sessionUser) {
    refs.sessionUser.textContent = state.username || "-";
  }
  if (refs.sessionRole) {
    refs.sessionRole.textContent = formatRole(state.role);
  }
  renderStats();
  renderListsEditors();
  if (![...dirtyFields].some(field => (field === refs.monumentsTableBody || refs.monumentsTableBody?.contains(field)))) renderMonumentsEditor();
  if (!dirtyFields.has(refs.streetNameInput) && !dirtyFields.has(refs.streetInfoText)) renderStreetSelect(preferredStreetName);
}

async function ensureEditorAccess() {
  const me = await apiRequest("/api/editor/me");
  if (!me?.canEdit) {
    const error = new Error("Ce compte ne dispose pas des droits d’édition.");
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
  setGlobalStatus("Chargement du contenu…", "info");
  const previousRevision = state.content?.revision;
  const content = await apiRequest("/api/editor/content");
  state.content = content;
  if (dirtyFields.size && previousRevision !== undefined) state.content.revision = previousRevision;
  const drafts = [...dirtyFields].filter(element => element.isConnected && "value" in element).map(element => ({ element, value: element.value }));
  renderAllEditors(preferredStreetName);
  for (const draft of drafts) if (draft.element.isConnected) draft.element.value = draft.value;
  setGlobalStatus("Le contenu est à jour.", "success");
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
    refs.loginBtn.textContent = "Connexion…";
    setGlobalStatus("Démarrage du service…", "info");
    await warmApiForLogin();
    setGlobalStatus("Connexion en cours…", "info");
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
    setGlobalStatus(`Connexion impossible : ${error.message}`, "error");
  } finally {
    refs.loginBtn.disabled = false;
    refs.loginBtn.textContent = "Se connecter";
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
    setGlobalStatus(`Session invalide : ${error.message}`, "error");
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
        "Confirmer : renommer la fiche existante.\n" +
        "Annuler : créer ou mettre à jour la nouvelle fiche sans modifier l’ancienne.",
    );
    if (shouldRename) {
      previousStreetName = selectedStreetName;
    }
  }

  try {
    setGlobalStatus("Enregistrement de la fiche…", "info");
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
    for (const field of [refs.streetNameInput, refs.streetInfoText]) dirtyFields.delete(field);
    await loadContent(streetName);
    if (previousStreetName) {
      setGlobalStatus(`Rue renommée : « ${previousStreetName} » devient « ${streetName} ».`, "success");
    } else if (infoText) {
      setGlobalStatus(`Fiche enregistrée : ${streetName}.`, "success");
    } else {
      setGlobalStatus(
        `Le nom « ${streetName} » est enregistré sans texte de fiche.`,
        "success",
      );
    }
  } catch (error) {
    setGlobalStatus(`Échec de l’enregistrement de la fiche : ${error.message}`, "error");
  }
}

async function onDeleteStreetInfo() {
  const mode = getCurrentMode();
  const streetName = normalizeName(
    refs.streetNameInput.value || state.selectedStreetName || refs.streetSelect.value,
  );
  if (!streetName) {
    setGlobalStatus("Sélectionnez la rue dont vous souhaitez supprimer la fiche.", "error");
    return;
  }

  if (!window.confirm(`Supprimer définitivement la fiche de « ${streetName} » ?`)) {
    return;
  }

  try {
    setGlobalStatus("Suppression de la fiche…", "info");
    await apiRequest("/api/editor/street-info", {
      method: "DELETE",
      body: {
        mode,
        streetName,
      },
    });
    refs.streetNameInput.value = "";
    refs.streetInfoText.value = "";
    dirtyFields.delete(refs.streetNameInput); dirtyFields.delete(refs.streetInfoText);
    await loadContent();
    setGlobalStatus(`Fiche supprimée : ${streetName}.`, "success");
  } catch (error) {
    setGlobalStatus(`Échec de la suppression de la fiche : ${error.message}`, "error");
  }
}

async function onAddStreetToModeList() {
  if (!state.content) {
    setGlobalStatus("Le contenu n’est pas encore chargé.", "error");
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
    setGlobalStatus(`« ${streetName} » figure déjà parmi les ${getModeLabel(mode)}.`, "info");
    return;
  }

  const updatedList = [...currentList, streetName];
  const payload =
    listKey === "mainStreets"
      ? buildListsPayloadWithUpdates({ mainStreets: updatedList })
      : buildListsPayloadWithUpdates({ famousStreets: updatedList });

  try {
    setGlobalStatus(`Ajout aux ${getModeLabel(mode)}…`, "info");
    await apiRequest("/api/editor/lists", {
      method: "PUT",
      body: payload,
    });
    await loadContent(streetName);
    setGlobalStatus(`« ${streetName} » a été ajoutée aux ${getModeLabel(mode)}.`, "success");
  } catch (error) {
    setGlobalStatus(`Échec de l’ajout à la liste : ${error.message}`, "error");
  }
}

async function onRemoveStreetFromModeList() {
  if (!state.content) {
    setGlobalStatus("Le contenu n’est pas encore chargé.", "error");
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
    setGlobalStatus(`« ${streetName} » ne figure pas parmi les ${getModeLabel(mode)}.`, "info");
    return;
  }

  if (!window.confirm(`Retirer « ${streetName} » des ${getModeLabel(mode)} ?`)) {
    return;
  }

  const updatedList = currentList.filter((name) => name !== streetName);
  const payload =
    listKey === "mainStreets"
      ? buildListsPayloadWithUpdates({ mainStreets: updatedList })
      : buildListsPayloadWithUpdates({ famousStreets: updatedList });

  try {
    setGlobalStatus(`Retrait des ${getModeLabel(mode)}…`, "info");
    await apiRequest("/api/editor/lists", {
      method: "PUT",
      body: payload,
    });
    await loadContent(streetName);
    setGlobalStatus(`« ${streetName} » a été retirée des ${getModeLabel(mode)}.`, "success");
  } catch (error) {
    setGlobalStatus(`Échec du retrait de la liste : ${error.message}`, "error");
  }
}

async function onSaveLists() {
  if (!state.content) {
    setGlobalStatus("Le contenu n’est pas encore chargé.", "error");
    return;
  }

  const payload = {
    famousStreets: parseListTextarea(refs.famousListText.value),
    mainStreets: parseListTextarea(refs.mainListText.value),
    monuments: normalizeNameArray(state.content?.lists?.monuments),
  };

  try {
    setGlobalStatus("Enregistrement des listes…", "info");
    await apiRequest("/api/editor/lists", {
      method: "PUT",
      body: payload,
    });
    dirtyFields.delete(refs.famousListText); dirtyFields.delete(refs.mainListText);
    await loadContent();
    setGlobalStatus("Les deux listes ont été enregistrées.", "success");
  } catch (error) {
    setGlobalStatus(`Échec de l’enregistrement des listes : ${error.message}`, "error");
  }
}

async function onSaveMonuments() {
  if (!state.content) {
    setGlobalStatus("Le contenu n’est pas encore chargé.", "error");
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
    setGlobalStatus("Enregistrement des monuments…", "info");
    await apiRequest("/api/editor/monuments", {
      method: "PUT",
      body: { entries },
    });
    for (const field of [...dirtyFields]) if ((field === refs.monumentsTableBody || refs.monumentsTableBody?.contains(field))) dirtyFields.delete(field);
    await loadContent();
    const isSingular = entries.length === 1;
    setGlobalStatus(
      `${entries.length} monument${isSingular ? " a" : "s ont"} été enregistré${isSingular ? "" : "s"}.`,
      "success",
    );
  } catch (error) {
    setGlobalStatus(`Échec de l’enregistrement des monuments : ${error.message}`, "error");
  }
}

function bindEvents() {
  refs.loginForm.addEventListener("submit", onLoginSubmit);
  refs.logoutBtn.addEventListener("click", async () => {
    try {
      await apiRequest("/api/logout", { method: "POST" });
    } catch (error) {
      // Local logout remains available if the server cannot be reached.
    }
    clearSession();
    setUiAuthenticated(false);
    setGlobalStatus("Vous êtes déconnecté.", "info");
  });
  refs.refreshContentBtn.addEventListener("click", async () => {
    if (dirtyFields.size && !window.confirm("Actualiser et abandonner les saisies non enregistrées ?")) return;
    dirtyFields.clear();
    try {
      refs.refreshContentBtn.disabled = true;
      refs.refreshContentBtn.textContent = "Actualisation…";
      await loadContent(refs.streetNameInput?.value || "");
    } catch (error) {
      setGlobalStatus(`Échec de l’actualisation : ${error.message}`, "error");
    } finally {
      refs.refreshContentBtn.disabled = false;
      refs.refreshContentBtn.textContent = "Actualiser";
    }
  });

  refs.infoModeSelect?.addEventListener("change", () => {
    refs.streetSearchInput.value = "";
    renderStreetSelect();
  });

  refs.streetSearchInput?.addEventListener("input", () => {
    renderStreetSelect();
  });
  refs.famousListText?.addEventListener("input", updateListCounts);
  refs.mainListText?.addEventListener("input", updateListCounts);

  refs.streetSelect?.addEventListener("change", () => {
    updateEditorFieldsForStreet(refs.streetSelect.value);
  });

  refs.saveStreetInfoBtn?.addEventListener("click", onSaveStreetInfo);
  refs.addStreetToListBtn?.addEventListener("click", onAddStreetToModeList);
  refs.removeStreetFromListBtn?.addEventListener("click", onRemoveStreetFromModeList);
  refs.deleteStreetInfoBtn?.addEventListener("click", onDeleteStreetInfo);
  refs.saveListsBtn?.addEventListener("click", onSaveLists);
  refs.addMonumentRowBtn?.addEventListener("click", () => {
    appendMonumentRow();
    dirtyFields.add(refs.monumentsTableBody);
  });
  refs.saveMonumentsBtn?.addEventListener("click", onSaveMonuments);

}

bindEvents();
bootstrapSession();

// Keep edited values when another module refreshes; warn before leaving the page.
document.getElementById("editor-section")?.addEventListener("input", event => {
  if (event.target.matches("textarea, #street-name-input, .monuments-table input")) dirtyFields.add(event.target);
});
window.addEventListener("beforeunload", event => {
  if (!dirtyFields.size) return;
  event.preventDefault(); event.returnValue = "";
});
