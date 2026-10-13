import { confirmSensitiveAction } from "/admin/sensitive-actions.js";
const API = window.CaminoRuntimeConfig?.apiUrl || "http://localhost:3000";
const token = sessionStorage.getItem("camino_paris_editor_token") || "";
const status = document.getElementById("operations-status");
const body = document.getElementById("operations-body");
let admin = false;
let requestId = 0;
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const date = value => value ? new Date(value).toLocaleString("fr-FR") : "—";

async function api(path, options = {}) {
  if (options.method === "POST" && path.endsWith("/restore")) {
    options.body = JSON.stringify({ ...JSON.parse(options.body), confirmationToken: await confirmSensitiveAction(API, token, path, options.method) });
  }
  const response = await window.PariciAdminFetch(API + path, { ...options, signal: AbortSignal.timeout(45000), credentials: "include",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Erreur ${response.status}`);
  return result;
}
function message(text, error = false) { status.textContent = text; status.className = `status status--${error ? "error" : "success"}`; }
function table(headings, rows, compact = false) {
  return `<div class="users-table-wrap"><table class="users-table operations-table ${compact ? "operations-table--compact" : ""}"><thead><tr>${headings.map(h => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headings.length}">Aucun résultat sur cette période.</td></tr>`}</tbody></table></div>`;
}

async function load() {
  const id = ++requestId;
  const section = document.getElementById("operations-section").value;
  message("Chargement…");
  document.getElementById("daily-controls").hidden = section !== "daily";
  try {
    const root = "/api/editor/operations-tools";
    let html = "";
    if (section === "overview") {
      const data = await api(root + "/operations");
      const stats = data.players ? [["Comptes", data.players.total], ["Actifs sur 7 jours", data.players.active_7d], ["Actifs sur 30 jours", data.players.active_30d], ["Inscrits sur 7 jours", data.players.new_7d]] : [];
      stats.push(["Énigmes actives", data.explorer.active], ["Énigmes sans coordonnées", data.explorer.missing_coordinates]);
      html = `<p class="muted">Actualisé le ${escape(date(data.generatedAt))}. Activité observée : scores Parici, tentatives Daily, parties Collect et étapes Explorer enregistrées. Les visites sans partie ne sont pas comptées.</p><div class="stats-grid">${stats.map(([label,value]) => `<div class="stat-card"><span class="stat-label">${escape(label)}</span><strong class="stat-value">${escape(value)}</strong></div>`).join("")}</div><h2>Catalogue Collect</h2>${table(["Famille", "Statut", "Cartes"], data.catalog.map(row => [escape(({street:"Rues",district:"Quartiers",monument:"Monuments",bus:"Bus"})[row.family] || row.family), escape(row.status === "active" ? "Actives" : "Archivées"), escape(row.count)]), true)}<p><a class="btn" href="/admin/collect/">Ouvrir le catalogue et les signalements</a> <a class="btn" href="/admin/explorer/">Vérifier les énigmes Explorer</a></p>`;
    } else if (section === "history") {
      const data = await api(root + "/revisions");
      html = `<p class="muted">Les ${data.limit} dernières modifications des fiches, listes et monuments. Une restauration remet l’ensemble de ces contenus dans l’état précédant la modification sélectionnée. Consultez l’aperçu avant d’agir.</p>${table(["Date", "Auteur", "Modification", "Détail"], data.revisions.map(row => [escape(date(row.created_at)), escape(row.actor_username), escape(row.action), `<button class="btn" data-revision="${row.id}">Comparer</button>`]))}`;
    } else if (section === "daily") {
      const month = document.getElementById("daily-month").value;
      const data = await api(root + `/daily-calendar?month=${encodeURIComponent(month)}`);
      html = `<p class="muted">${escape(data.coverage)}</p>${table(["Date", "Cible", "Quartier", "Photo", "Joueurs", "Réussites", "Tentatives"], data.targets.map(row => [escape(row.date), escape(row.street_name), escape(row.quartier), row.imageUrl ? `<a href="${escape(new URL(row.imageUrl,API).href)}" target="_blank" rel="noopener">Voir la photo</a>` : "À vérifier", escape(row.players), `${escape(row.successes)} / ${escape(row.players)}`, `<button class="btn" data-daily="${escape(row.date)}">Consulter</button>`]))}`;
    } else {
      const [health, audit] = await Promise.all([api("/api/ready"), api(root + "/audit-log")]);
      html = `<p>Base : ${escape(health.database)}. Vérification : ${escape(date(new Date()))}.</p><p class="muted">Les ${audit.limit} dernières opérations techniques. Les valeurs sensibles ne sont pas affichées.</p>${table(["Date", "Auteur", "Action", "HTTP"], audit.entries.map(row => [escape(date(row.created_at)), escape(row.actor_username), escape(row.action), escape(row.status_code)]))}`;
    }
    if (id !== requestId) return;
    body.innerHTML = html;
    message("Données à jour.");
  } catch (error) { if (id === requestId) { body.replaceChildren(); message(error.message, true); } }
}

const dialog = document.getElementById("operations-dialog");
const detail = document.getElementById("operations-detail");
document.getElementById("operations-close").addEventListener("click", () => dialog.close());
body.addEventListener("click", async event => {
  const revision = event.target.closest("[data-revision]");
  const daily = event.target.closest("[data-daily]");
  if (!revision && !daily) return;
  try {
    if (revision) {
      const [data, current] = await Promise.all([api(`/api/editor/operations-tools/revisions/${revision.dataset.revision}`), api("/api/editor/content")]);
      detail.replaceChildren();
      const text = document.createElement("p"); text.textContent = `${date(data.created_at)} · ${data.actor_username} · ${data.action}`; detail.append(text);
      for (const [title, settings] of [["Avant la modification (état restaurable)", data.before_settings], ["Après la modification", data.after_settings]]) {
        const heading = document.createElement("h3"); heading.textContent = title;
        const pre = document.createElement("pre"); pre.className = "command-output";
        pre.textContent = JSON.stringify(Object.fromEntries(Object.entries(settings).map(([key,value]) => { try { return [key,JSON.parse(value)]; } catch { return [key,value]; } })), null, 2);
        detail.append(heading, pre);
      }
      if (admin) {
        const button = document.createElement("button"); button.className = "btn btn-danger-outline"; button.textContent = "Restaurer l’état précédent";
        button.addEventListener("click", async () => {
          if (!window.confirm("Restaurer toutes les fiches, listes et monuments à cet état ? Les changements plus récents seront remplacés et conservés dans l’historique.")) return;
          button.disabled = true;
          try { await api(`/api/editor/operations-tools/revisions/${data.id}/restore`, { method: "POST", body: JSON.stringify({ expectedRevision: current.revision }) }); dialog.close(); await load(); }
          catch (error) { button.disabled = false; message(error.message, true); dialog.close(); }
        });
        detail.append(button);
      }
    } else {
      const data = await api(`/api/editor/daily-history?date=${daily.dataset.daily}&limit=2000`);
      detail.innerHTML = `<h3>Tentatives du ${escape(data.date)}</h3><p class="muted">Maximum 2 000 joueurs affichés. Distances en mètres ; « — » signifie indisponible.</p>${table(["Joueur", "Résultat", "Essais", "Distances par essai"], data.players.map(row => [escape(row.username), row.success ? "Réussi" : "Non résolu", escape(row.attempts_count), escape(row.attempts.map(attempt => `${attempt.attemptNumber} : ${attempt.distanceMeters == null ? "—" : Math.round(attempt.distanceMeters)} m`).join(" · "))]))}`;
    }
    dialog.showModal();
  } catch (error) { message(error.message, true); }
});
document.getElementById("operations-section").addEventListener("change", load);
document.getElementById("operations-refresh").addEventListener("click", load);
document.getElementById("daily-month").addEventListener("change", load);
document.getElementById("daily-month").value = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit" }).format(new Date());
try {
  const me = await api("/api/editor/me");
  if (!me.canEdit) throw new Error("Connectez-vous avec un compte éditeur depuis le tableau de bord.");
  admin = me.canManageUsers;
  document.getElementById("manage-users-link")?.classList.toggle("hidden", !admin);
  for (const option of document.querySelectorAll("[data-admin-option]")) option.disabled = !admin;
  await load();
} catch (error) { message(`${error.message} Connexion : tableau de bord.`, true); }
