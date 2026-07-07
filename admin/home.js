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
  canManageUsers: false,
  osmSyncPollTimer: 0,
  osmSyncPollStartedAtMs: 0,
};

const refs = {
  globalStatus: document.getElementById("global-status"),
  loginSection: document.getElementById("login-section"),
  dashboardSection: document.getElementById("dashboard-section"),
  loginForm: document.getElementById("login-form"),
  loginUsername: document.getElementById("login-username"),
  loginPassword: document.getElementById("login-password"),
  loginBtn: document.getElementById("login-btn"),
  sessionUser: document.getElementById("session-user"),
  sessionRole: document.getElementById("session-role"),
  manageUsersLink: document.getElementById("manage-users-link"),
  usersAdminCard: document.getElementById("users-admin-card"),
  refreshSessionBtn: document.getElementById("refresh-session-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  runOsmSyncBtn: document.getElementById("run-osm-sync-btn"),
  osmSyncOutput: document.getElementById("osm-sync-output"),
};

function setGlobalStatus(message, type = "info") {
  refs.globalStatus.textContent = message;
  refs.globalStatus.classList.remove("status--info", "status--success", "status--error");
  refs.globalStatus.classList.add(`status--${type}`);
}

function setUiAuthenticated(isAuthenticated) {
  refs.loginSection.classList.toggle("hidden", isAuthenticated);
  refs.dashboardSection.classList.toggle("hidden", !isAuthenticated);
}

function setOsmSyncOutput(message) {
  if (!refs.osmSyncOutput) {
    return;
  }
  refs.osmSyncOutput.textContent = String(message || "").trim() || "Aucun journal disponible.";
}

function formatRole(role) {
  const labels = {
    admin: "Administrateur",
    editor: "Éditeur",
    player: "Joueur",
  };
  return labels[role] || role || "Joueur";
}

function setOsmSyncButtonRunning(isRunning) {
  if (!refs.runOsmSyncBtn) {
    return;
  }
  refs.runOsmSyncBtn.disabled = isRunning;
  refs.runOsmSyncBtn.textContent = isRunning
    ? "Synchronisation en cours…"
    : "Synchroniser les données OSM";
}

function renderSession() {
  refs.sessionUser.textContent = state.username || "-";
  refs.sessionRole.textContent = formatRole(state.role);
  refs.manageUsersLink?.classList.toggle("hidden", !state.canManageUsers);
  refs.usersAdminCard?.classList.toggle("hidden", !state.canManageUsers);
}

function saveSession() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      token: state.token,
      username: state.username,
      role: state.role,
    }),
  );
}

function clearSession() {
  state.token = "";
  state.username = "";
  state.role = "";
  state.canManageUsers = false;
  localStorage.removeItem(STORAGE_KEY);
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    state.token = String(saved?.token || "");
    state.username = String(saved?.username || "");
    state.role = String(saved?.role || "");
    return Boolean(state.token);
  } catch (error) {
    clearSession();
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  return `Synchronisation locale active : ${active.requestedBy || "administrateur"}, démarrée ${startedLabel}${ageLabel}.`;
}

function formatGithubRunStatus(run) {
  if (!run) {
    return "Le traitement GitHub n’est pas encore visible…";
  }

  const statusLabels = {
    queued: "en file d'attente",
    in_progress: "en cours",
    completed: "terminé",
  };
  const conclusionLabels = {
    success: "succès",
    failure: "échec",
    cancelled: "annulé",
    skipped: "ignoré",
    timed_out: "délai dépassé",
    action_required: "action requise",
  };
  const status = statusLabels[run.status] || run.status || "statut inconnu";
  const conclusion = run.conclusion
    ? ` (${conclusionLabels[run.conclusion] || run.conclusion})`
    : "";
  const started = formatDateTime(run.startedAt || run.createdAt);
  const updated = formatDateTime(run.updatedAt);
  const lines = [`Workflow GitHub #${run.number || run.id || "?"}: ${status}${conclusion}`];
  if (started) {
    lines.push(`Démarré : ${started}`);
  }
  if (updated) {
    lines.push(`Dernière mise à jour : ${updated}`);
  }
  if (run.url) {
    lines.push(`Consulter le traitement : ${run.url}`);
  }
  return lines.join("\n");
}

function stopOsmSyncPolling() {
  if (state.osmSyncPollTimer) {
    window.clearTimeout(state.osmSyncPollTimer);
    state.osmSyncPollTimer = 0;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = API_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function apiRequest(path, { method = "GET", body, auth = true, timeoutMs = API_REQUEST_TIMEOUT_MS } = {}) {
  let lastError = null;

  for (const baseUrl of API_BASE_CANDIDATES) {
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(auth && state.token ? { Authorization: `Bearer ${state.token}` } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        },
        timeoutMs,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `Erreur HTTP ${response.status}`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("API indisponible.");
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
      const parts = [label || "Traitement GitHub lancé.", runStatus];
      if (activeState) {
        parts.push(activeState);
      }
      if (githubError) {
        parts.push(`Statut GitHub indisponible : ${githubError}`);
      }
      setOsmSyncOutput(parts.filter(Boolean).join("\n\n"));

      if (run?.status === "completed") {
        setOsmSyncButtonRunning(false);
        state.osmSyncPollTimer = 0;
        if (run.conclusion === "success") {
          setGlobalStatus("Synchronisation OSM terminée avec succès.", "success");
        } else {
          setGlobalStatus(`Synchronisation OSM terminée avec le statut « ${run.conclusion || "inconnu"} ».`, "error");
        }
        return;
      }

      if (Date.now() - state.osmSyncPollStartedAtMs >= OSM_SYNC_POLL_TIMEOUT_MS) {
        state.osmSyncPollTimer = 0;
        setOsmSyncButtonRunning(false);
        setGlobalStatus("Synchronisation OSM lancée. Le suivi automatique s’est arrêté après douze minutes.", "info");
        return;
      }

      state.osmSyncPollTimer = window.setTimeout(pollOnce, OSM_SYNC_POLL_INTERVAL_MS);
    } catch (error) {
      const elapsedMs = Date.now() - state.osmSyncPollStartedAtMs;
      if (elapsedMs < OSM_SYNC_POLL_TIMEOUT_MS) {
        setOsmSyncOutput(
          `Suivi momentanément indisponible : ${error.message}\n\nNouvelle tentative dans ${Math.round(OSM_SYNC_POLL_INTERVAL_MS / 1000)} secondes…`,
        );
        setGlobalStatus("Synchronisation OSM lancée. Reconnexion au suivi en cours…", "info");
        state.osmSyncPollTimer = window.setTimeout(pollOnce, OSM_SYNC_POLL_INTERVAL_MS);
        return;
      }
      state.osmSyncPollTimer = 0;
      setOsmSyncButtonRunning(false);
      setGlobalStatus("Synchronisation OSM lancée. Le suivi a expiré après douze minutes.", "info");
    }
  };

  await pollOnce();
}

async function warmApiForLogin() {
  try {
    await apiRequest("/api/health", { auth: false, timeoutMs: 15000 });
  } catch (error) {
    await delay(1200);
  }
}

async function ensureEditorAccess() {
  const me = await apiRequest("/api/editor/me");
  if (!me?.canEdit) {
    const error = new Error("Ce compte ne dispose pas des droits d’édition.");
    error.status = 403;
    throw error;
  }

  state.username = me.username || state.username;
  state.role = me.role || state.role;
  state.canManageUsers = Boolean(me.canManageUsers);
  saveSession();
  renderSession();
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
    await ensureEditorAccess();
    setUiAuthenticated(true);
    setGlobalStatus("Connexion réussie. Votre session d’édition est active.", "success");
  } catch (error) {
    clearSession();
    setUiAuthenticated(false);
    setGlobalStatus(`Connexion impossible : ${error.message}`, "error");
  } finally {
    refs.loginBtn.disabled = false;
    refs.loginBtn.textContent = "Se connecter";
  }
}

async function refreshSession() {
  try {
    refs.refreshSessionBtn.disabled = true;
    refs.refreshSessionBtn.textContent = "Vérification…";
    setGlobalStatus("Vérification de votre accès…", "info");
    await ensureEditorAccess();
    setUiAuthenticated(true);
    setGlobalStatus("Votre accès est valide et la session est à jour.", "success");
  } catch (error) {
    clearSession();
    setUiAuthenticated(false);
    setGlobalStatus(`Session invalide : ${error.message}`, "error");
  } finally {
    refs.refreshSessionBtn.disabled = false;
    refs.refreshSessionBtn.textContent = "Vérifier l’accès";
  }
}

async function onRunOsmSync() {
  if (!refs.runOsmSyncBtn) {
    return;
  }

  const confirmed = window.confirm(
    "Lancer la synchronisation OpenStreetMap maintenant ?\n\nLes données cartographiques seront reconstruites, puis un nouveau déploiement sera lancé.",
  );
  if (!confirmed) {
    return;
  }

  setOsmSyncButtonRunning(true);
  setGlobalStatus("Démarrage de la synchronisation OSM…", "info");
  setOsmSyncOutput("Déclenchement du traitement GitHub…");
  stopOsmSyncPolling();
  const pollSince = new Date(Date.now() - 15_000).toISOString();

  try {
    const payload = await apiRequest("/api/editor/osm-sync", {
      method: "POST",
      body: { target: "github" },
    });

    if (payload?.dispatched) {
      const dispatch = payload.dispatch || {};
      const label = `${dispatch.repository || "dépôt GitHub"} / ${dispatch.workflow || "sync-osm.yml"}`;
      setGlobalStatus(`Synchronisation OSM lancée (${label}). Suivi en cours…`, "info");
      setOsmSyncOutput(`${payload?.output || "Traitement GitHub lancé."}\n\nRecherche du traitement GitHub…`);
      await pollOsmSyncStatus({
        since: pollSince,
        label: payload?.output || `Traitement GitHub lancé (${label}).`,
      });
      return;
    }

    const durationSeconds = Number.isFinite(payload?.durationMs)
      ? (payload.durationMs / 1000).toFixed(1)
      : "?";
    const changedFiles = Array.isArray(payload?.changedFiles) ? payload.changedFiles : [];
    const changedLabel = changedFiles.length
      ? `Fichiers modifiés : ${changedFiles.join(", ")}`
      : "Aucun fichier cible n’a été modifié.";

    setGlobalStatus(`Synchronisation OSM terminée en ${durationSeconds} s. ${changedLabel}`, "success");
    setOsmSyncOutput(payload?.output || "Synchronisation terminée.");
  } catch (error) {
    stopOsmSyncPolling();
    const output = error?.payload?.output || "";
    setGlobalStatus(`Échec de la synchronisation OSM : ${error.message}`, "error");
    const activeState = formatOsmSyncActiveState(error?.payload?.active);
    setOsmSyncOutput(output || activeState || `Erreur : ${error.message}`);
    setOsmSyncButtonRunning(false);
  } finally {
    if (!state.osmSyncPollTimer) {
      setOsmSyncButtonRunning(false);
    }
  }
}

async function bootstrapSession() {
  if (!restoreSession()) {
    setUiAuthenticated(false);
    return;
  }
  await refreshSession();
}

function bindEvents() {
  refs.loginForm.addEventListener("submit", onLoginSubmit);
  refs.refreshSessionBtn.addEventListener("click", refreshSession);
  refs.runOsmSyncBtn?.addEventListener("click", onRunOsmSync);
  refs.logoutBtn.addEventListener("click", () => {
    stopOsmSyncPolling();
    clearSession();
    setUiAuthenticated(false);
    setGlobalStatus("Vous êtes déconnecté.", "info");
  });
}

bindEvents();
bootstrapSession();
