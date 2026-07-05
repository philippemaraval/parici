const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "https://camino2.onrender.com";
const STORAGE_KEY = "camino_editor_user";

const state = { token: "", currentUserId: null, users: [] };
const refs = {
  status: document.getElementById("users-status"),
  section: document.getElementById("users-section"),
  search: document.getElementById("users-search"),
  refresh: document.getElementById("users-refresh"),
  count: document.getElementById("users-count"),
  body: document.getElementById("users-table-body"),
};

function setStatus(message, type = "info") {
  refs.status.textContent = message;
  refs.status.className = `status status--${type}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${state.token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Erreur HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function renderUsers() {
  const query = refs.search.value.trim().toLocaleLowerCase("fr");
  const users = state.users.filter((user) =>
    String(user.username || "").toLocaleLowerCase("fr").includes(query),
  );
  refs.count.textContent = `${users.length} compte${users.length > 1 ? "s" : ""} affiché${users.length > 1 ? "s" : ""}.`;
  refs.body.innerHTML = users.length
    ? users.map((user) => `
      <tr>
        <td>
          <span class="user-identity"><span class="user-avatar">${escapeHtml(user.avatar)}</span>
          <span><strong>${escapeHtml(user.username)}</strong><small>${escapeHtml(user.role)}</small></span></span>
        </td>
        <td><strong>${user.referralCount || 0}</strong> personne${user.referralCount === 1 ? "" : "s"}</td>
        <td>${escapeHtml(user.rank)}</td>
        <td>${user.dailyDaysPlayed} joué${user.dailyDaysPlayed > 1 ? "s" : ""}<br><small>${user.dailySuccesses} réussi${user.dailySuccesses > 1 ? "s" : ""}</small></td>
        <td><strong>${user.dailyFrequency}%</strong></td>
        <td><span class="boolean-badge boolean-badge--${user.reminderEnabled ? "yes" : "no"}">${user.reminderEnabled ? "Activé" : "Non"}</span></td>
        <td>${formatDate(user.lastDailyAt || user.lastGameAt)}</td>
        <td>${formatDate(user.createdAt)}</td>
        <td class="user-actions">
          <button type="button" class="btn" data-reset-id="${user.id}">Lien mot de passe</button>
          <button type="button" class="btn btn-danger-outline" data-delete-id="${user.id}" ${user.id === state.currentUserId ? "disabled" : ""}>Supprimer</button>
        </td>
      </tr>
    `).join("")
    : '<tr><td colspan="9">Aucun utilisateur trouvé.</td></tr>';
}

async function loadUsers() {
  refs.refresh.disabled = true;
  setStatus("Chargement des utilisateurs...", "info");
  try {
    const payload = await apiRequest("/api/editor/users");
    state.users = Array.isArray(payload.users) ? payload.users : [];
    refs.section.classList.remove("hidden");
    renderUsers();
    setStatus("Liste à jour.", "success");
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      refs.section.classList.add("hidden");
      setStatus("Accès refusé. Connectez-vous avec un compte admin depuis le back-office.", "error");
    } else {
      setStatus(`Chargement impossible : ${error.message}`, "error");
    }
  } finally {
    refs.refresh.disabled = false;
  }
}

async function generateResetLink(userId, button) {
  button.disabled = true;
  try {
    const payload = await apiRequest(`/api/editor/users/${userId}/password-reset-link`, { method: "POST" });
    await navigator.clipboard.writeText(payload.resetUrl).catch(() => {});
    window.prompt(`Lien de réinitialisation pour ${payload.username} (valable jusqu'au ${formatDate(payload.expiresAt)}) :`, payload.resetUrl);
    setStatus(`Lien généré pour ${payload.username}.`, "success");
  } catch (error) {
    setStatus(`Génération impossible : ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

async function deleteUser(userId, button) {
  const user = state.users.find((entry) => entry.id === userId);
  if (!user) return;
  if (!window.confirm(`Supprimer définitivement le compte « ${user.username} » et toutes ses données ?`)) return;
  const typedName = window.prompt(`Deuxième confirmation : saisissez exactement ${user.username}`);
  if (typedName !== user.username) {
    setStatus("Suppression annulée : le pseudo saisi ne correspond pas.", "info");
    return;
  }
  button.disabled = true;
  try {
    await apiRequest(`/api/editor/users/${userId}`, { method: "DELETE" });
    state.users = state.users.filter((entry) => entry.id !== userId);
    renderUsers();
    setStatus(`Compte ${user.username} supprimé.`, "success");
  } catch (error) {
    button.disabled = false;
    setStatus(`Suppression impossible : ${error.message}`, "error");
  }
}

refs.search.addEventListener("input", renderUsers);
refs.refresh.addEventListener("click", loadUsers);
refs.body.addEventListener("click", (event) => {
  const resetButton = event.target.closest("[data-reset-id]");
  if (resetButton) {
    generateResetLink(Number(resetButton.dataset.resetId), resetButton);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-id]");
  if (deleteButton) deleteUser(Number(deleteButton.dataset.deleteId), deleteButton);
});

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  state.token = String(saved.token || "");
} catch {
  state.token = "";
}

if (!state.token) {
  setStatus("Connectez-vous d’abord depuis le back-office.", "error");
} else {
  apiRequest("/api/editor/me")
    .then((me) => {
      if (!me.canManageUsers) throw Object.assign(new Error("Admin access required"), { status: 403 });
      state.currentUserId = Number(me.id);
      return loadUsers();
    })
    .catch(() => setStatus("Accès réservé aux administrateurs.", "error"));
}
