const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "https://camino-paris.onrender.com";
const STORAGE_KEY = "camino_paris_editor_user";

const state = {
  token: "",
  currentUserId: null,
  users: [],
  sort: { key: null, direction: null },
};
const refs = {
  status: document.getElementById("users-status"),
  section: document.getElementById("users-section"),
  search: document.getElementById("users-search"),
  refresh: document.getElementById("users-refresh"),
  count: document.getElementById("users-count"),
  total: document.getElementById("users-total"),
  daily: document.getElementById("users-daily"),
  reminders: document.getElementById("users-reminders"),
  body: document.getElementById("users-table-body"),
  sortHeaders: Array.from(document.querySelectorAll("[data-sort-key]")),
};

const textCollator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
const rankOrder = new Map([
  ["Touriste", 0],
  ["Titi Parisien", 1],
  ["Habitué des Quais", 2],
  ["Vrai Parigot", 3],
  ["Préfet de Paris", 4],
]);

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

function formatRole(role) {
  return {
    admin: "Administrateur",
    editor: "Éditeur",
    player: "Joueur",
  }[role] || role || "Joueur";
}

function getSortValue(user, key) {
  if (key === "reminderEnabled") return user.reminderEnabled ? "Activé" : "Non";
  if (key === "rank") return rankOrder.get(user.rank) ?? -1;
  if (key === "lastActivityAt") {
    const value = user.lastDailyAt || user.lastGameAt;
    return value ? Date.parse(value) : null;
  }
  if (key === "createdAt") return user.createdAt ? Date.parse(user.createdAt) : null;
  if (["referralCount", "dailyDaysPlayed", "dailyFrequency"].includes(key)) {
    return Number(user[key] || 0);
  }
  return String(user[key] || "");
}

function compareSortValues(left, right) {
  if (typeof left === "number") {
    return Number(left) - Number(right);
  }
  return textCollator.compare(String(left), String(right));
}

function getSortedUsers(users) {
  const { key, direction } = state.sort;
  if (!key || !direction) return users;
  const multiplier = direction === "asc" ? 1 : -1;
  return users
    .map((user, index) => ({ user, index }))
    .sort((left, right) => {
      const leftValue = getSortValue(left.user, key);
      const rightValue = getSortValue(right.user, key);
      const leftMissing = leftValue === null || Number.isNaN(leftValue);
      const rightMissing = rightValue === null || Number.isNaN(rightValue);
      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) return left.index - right.index;
        return leftMissing ? 1 : -1;
      }
      const result = compareSortValues(leftValue, rightValue);
      return result === 0 ? left.index - right.index : result * multiplier;
    })
    .map(({ user }) => user);
}

function updateSortHeaders() {
  refs.sortHeaders.forEach((header) => {
    const direction = header.dataset.sortKey === state.sort.key ? state.sort.direction : null;
    header.setAttribute("aria-sort", direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none");
    const indicator = header.querySelector(".table-sort span");
    if (indicator) indicator.textContent = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "↕";
    const button = header.querySelector(".table-sort");
    const label = button?.textContent.replace(/[▲▼↕]/g, "").trim() || "cette colonne";
    if (button) {
      button.setAttribute(
        "aria-label",
        direction === "asc"
          ? `${label}, tri croissant. Cliquer pour trier par ordre décroissant.`
          : direction === "desc"
            ? `${label}, tri décroissant. Cliquer pour annuler le tri.`
            : `Trier par ${label}.`,
      );
    }
  });
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
  const users = getSortedUsers(state.users.filter((user) =>
    String(user.username || "").toLocaleLowerCase("fr").includes(query),
  ));
  updateSortHeaders();
  const totalCount = state.users.length;
  refs.count.textContent = query
    ? `${users.length} résultat${users.length > 1 ? "s" : ""} sur ${totalCount} compte${totalCount > 1 ? "s" : ""}.`
    : `${totalCount} compte${totalCount > 1 ? "s" : ""} affiché${totalCount > 1 ? "s" : ""}.`;
  refs.total.textContent = String(totalCount);
  refs.daily.textContent = String(
    state.users.filter((user) => Number(user.dailyDaysPlayed || 0) > 0).length,
  );
  refs.reminders.textContent = String(
    state.users.filter((user) => Boolean(user.reminderEnabled)).length,
  );
  refs.body.innerHTML = users.length
    ? users.map((user) => `
      <tr>
        <td>
          <span class="user-identity"><span class="user-avatar">${escapeHtml(user.avatar)}</span>
          <span><strong>${escapeHtml(user.username)}</strong><small>${escapeHtml(formatRole(user.role))}</small></span></span>
        </td>
        <td><strong>${user.referralCount || 0}</strong> filleul${user.referralCount === 1 ? "" : "s"}</td>
        <td>${escapeHtml(user.rank)}</td>
        <td><strong>${user.dailyDaysPlayed}</strong> jour${user.dailyDaysPlayed === 1 ? "" : "s"} joué${user.dailyDaysPlayed === 1 ? "" : "s"}<br><small>${user.dailySuccesses} réussite${user.dailySuccesses === 1 ? "" : "s"}</small></td>
        <td><strong>${user.dailyFrequency}%</strong></td>
        <td><span class="boolean-badge boolean-badge--${user.reminderEnabled ? "yes" : "no"}">${user.reminderEnabled ? "Activé" : "Non"}</span></td>
        <td>${formatDate(user.lastDailyAt || user.lastGameAt)}</td>
        <td>${formatDate(user.createdAt)}</td>
        <td class="user-actions">
          <button type="button" class="btn" data-reset-id="${user.id}">Générer un lien</button>
          <button type="button" class="btn btn-danger-outline" data-delete-id="${user.id}" ${user.id === state.currentUserId ? "disabled" : ""}>Supprimer</button>
        </td>
      </tr>
    `).join("")
    : '<tr><td colspan="9">Aucun utilisateur trouvé.</td></tr>';
}

async function loadUsers() {
  refs.refresh.disabled = true;
  setStatus("Chargement des utilisateurs…", "info");
  try {
    const payload = await apiRequest("/api/editor/users");
    state.users = Array.isArray(payload.users) ? payload.users : [];
    refs.section.classList.remove("hidden");
    renderUsers();
    setStatus("La liste des utilisateurs est à jour.", "success");
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      refs.section.classList.add("hidden");
      setStatus("Accès refusé. Connectez-vous avec un compte administrateur depuis le tableau de bord.", "error");
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
    setStatus(`Lien de réinitialisation généré et copié pour ${payload.username}.`, "success");
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
refs.sortHeaders.forEach((header) => {
  header.querySelector(".table-sort")?.addEventListener("click", () => {
    const key = header.dataset.sortKey;
    if (state.sort.key !== key) {
      state.sort = { key, direction: "asc" };
    } else if (state.sort.direction === "asc") {
      state.sort.direction = "desc";
    } else {
      state.sort = { key: null, direction: null };
    }
    renderUsers();
  });
});
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
  setStatus("Connectez-vous d’abord depuis le tableau de bord.", "error");
} else {
  apiRequest("/api/editor/me")
    .then((me) => {
      if (!me.canManageUsers) throw Object.assign(new Error("Accès administrateur requis"), { status: 403 });
      state.currentUserId = Number(me.id);
      return loadUsers();
    })
    .catch(() => setStatus("Accès réservé aux administrateurs.", "error"));
}
