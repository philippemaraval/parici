import { confirmSensitiveAction } from "/admin/sensitive-actions.js";
const API = window.CaminoRuntimeConfig?.apiUrl || "http://localhost:3000";
const ROOT = "/api/editor/studio";
const token = sessionStorage.getItem("camino_paris_editor_token") || "";
const body = document.getElementById("studio-body"),
  status = document.getElementById("studio-status"),
  dialog = document.getElementById("studio-dialog"),
  detail = document.getElementById("studio-detail");
let me,
  requestId = 0,
  map,
  dirty = false;
const views = [
  ["tasks", "À traiter", "read"],
  ["daily", "Calendrier Daily", "read"],
  ["drafts", "Brouillons et publication", "edit"],
  ["reports", "Signalements", "quality"],
  ["quality", "Qualité des contenus", "quality"],
  ["players", "Assistance joueurs", "support"],
  ["analytics", "Activité et fidélisation", "support"],
  ["explorer", "Atelier Explorer", "read"],
  ["balance", "Équilibre Collect", "balance"],
  ["events", "Défis hebdomadaires", "events"],
  ["history", "Historique et restauration", "edit"],
  ["security", "Accès et sécurité", "read"],
  ["campaigns", "Notifications", "notify"],
  ["operations", "Exploitation", "operations"],
  ["backups", "Sauvegardes", "backups"],
];
const e = (v) =>
  String(v ?? "—").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const number = (v) =>
  v == null
    ? "Indisponible"
    : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v);
const date = (v) =>
  v ? new Date(v).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : "—";
const labels = {
  draft: "Brouillon",
  scheduled: "Programmé",
  published: "Publié",
  failed: "Échec",
  archived: "Archivé",
  open: "Ouvert",
  investigating: "En cours",
  resolved: "Résolu",
  dismissed: "Classé",
  daily: "Daily",
  card: "Carte Collect",
  street: "Fiche Parici",
  explorer: "Explorer",
  event: "Défi",
  all: "Tous",
  active30: "Actifs sur 30 jours",
  inactive30: "Inactifs sur 30 jours",
  sent: "Envoyée",
  success: "Réussi",
  failure: "Échec",
};
const label = (v) => labels[v] || v;
function message(v, error = false) {
  status.textContent = v;
  status.className = "status status--" + (error ? "error" : "success");
}
async function api(path, options = {}) {
  const full = path.startsWith("/api/") ? path : ROOT + path;
  const p = { ...options };
  if (p.sensitive) {
    const confirmationToken = await confirmSensitiveAction(
      API,
      token,
      full,
      p.method || "POST",
    );
    p.body = { ...(p.body || {}), confirmationToken };
    delete p.sensitive;
  }
  const r = await window.PariciAdminFetch(API + full, {
    ...p,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: p.body === undefined ? undefined : JSON.stringify(p.body),
    signal: AbortSignal.timeout(45000),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || `Erreur ${r.status}`);
  return data;
}
function table(headings, rows) {
  return `<div class="users-table-wrap"><table class="users-table studio-table"><thead><tr>${headings.map((h) => `<th>${e(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headings.length}">Aucun résultat enregistré.</td></tr>`}</tbody></table></div>`;
}
function stats(rows) {
  return `<div class="stats-grid">${rows.map(([k, v]) => `<div class="stat-card"><span class="stat-label">${e(k)}</span><strong class="stat-value">${e(number(v))}</strong></div>`).join("")}</div>`;
}
function button(text, action, id = "", extra = "") {
  return `<button type="button" class="btn" data-action="${action}" data-id="${e(id)}" ${extra}>${e(text)}</button>`;
}
function info(v) {
  return `<p class="muted">${e(v)}</p>`;
}
function show(html) {
  detail.innerHTML = html;
  dirty = false;
  if (!dialog.open) dialog.showModal();
}
function json(title, value) {
  return `<details><summary>${e(title)}</summary><pre class="command-output">${e(JSON.stringify(value, null, 2))}</pre></details>`;
}
function field(name, title, value = "", type = "text", options = []) {
  if (type === "select")
    return `<label>${e(title)}<select name="${name}">${options
      .map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, label(o)];
        return `<option value="${e(v)}" ${String(v) === String(value) ? "selected" : ""}>${e(l)}</option>`;
      })
      .join("")}</select></label>`;
  if (type === "textarea")
    return `<label>${e(title)}<textarea name="${name}" rows="4">${e(value ?? "")}</textarea></label>`;
  if (type === "checkbox")
    return `<label class="studio-check"><input name="${name}" type="checkbox" ${value ? "checked" : ""}>${e(title)}</label>`;
  return `<label>${e(title)}<input name="${name}" type="${type}" value="${e(value ?? "")}" ${type === "number" ? 'step="any"' : ""}></label>`;
}
function form(html, submit) {
  return `<form id="studio-form" class="studio-form">${html}<p id="studio-feedback" role="status"></p><button class="btn btn-primary" type="submit">${e(submit)}</button></form>`;
}
function bindForm(fn) {
  const f = detail.querySelector("#studio-form");
  f.addEventListener("input", () => (dirty = true));
  f.onsubmit = async (event) => {
    event.preventDefault();
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await fn(Object.fromEntries(new FormData(f)), f);
      dirty = false;
    } catch (error) {
      f.querySelector("#studio-feedback").textContent = error.message;
    } finally {
      btn.disabled = false;
    }
  };
}
function close() {
  if (dirty && !window.confirm("Fermer et abandonner cette saisie ?"))
    return false;
  dialog.close();
  dirty = false;
  return true;
}
document.getElementById("studio-close").onclick = close;
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  close();
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
function selected() {
  return location.hash.slice(1).split("?")[0] || "tasks";
}
async function load() {
  const id = ++requestId,
    view = views.find((v) => v[0] === selected()) || views[0];
  if (!me.permissions[view[2]]) {
    message("Cet outil nécessite la permission " + view[2], true);
    return;
  }
  document.getElementById("studio-title").textContent = view[1];
  for (const a of document.querySelectorAll("#studio-nav a"))
    a.setAttribute(
      "aria-current",
      a.dataset.view === view[0] ? "page" : "false",
    );
  message("Chargement…");
  if (map) {
    map.remove();
    map = null;
  }
  let html = "";
  try {
    if (view[0] === "tasks") {
      const d = await api("/tasks");
      html =
        stats([
          ["Alertes qualité affichées", d.tasks.length],
          ["Signalements à traiter", d.reports.length],
          [
            "Publications en échec",
            d.drafts.filter((r) => r.state === "failed").length,
          ],
        ]) +
        info(
          "Cet accueil affiche les 20 premiers contrôles qualité. Ouvrez Qualité des contenus pour consulter la liste complète. Les listes de signalements et publications sont bornées.",
        ) +
        `<div class="button-row"><a class="btn" href="#reports">Traiter les signalements</a><a class="btn" href="#quality">Vérifier les contenus</a><a class="btn" href="#drafts">Suivre les publications</a></div>` +
        table(
          ["Priorité", "Objet", "Problème", "Ouvrir"],
          [
            ...d.reports.map((r) => [
              e(r.severity),
              e(r.domain + " · " + r.entity_key),
              e(r.detail),
              '<a href="#reports">Signalements</a>',
            ]),
            ...d.drafts
              .filter((r) => r.state === "failed")
              .map((r) => [
                "Publication",
                e(r.title),
                e(r.error),
                '<a href="#drafts">Brouillons</a>',
              ]),
            ...d.tasks
              .slice(0, 20)
              .map((r) => [
                "Qualité",
                e(r.title),
                e(r.issue),
                `<a href="${e(r.url)}">Corriger</a>`,
              ]),
          ],
        );
    }
    if (view[0] === "daily") {
      const month =
        sessionStorage.getItem("admin_daily_month") ||
        new Intl.DateTimeFormat("fr-CA", {
          timeZone: "Europe/Paris",
          year: "numeric",
          month: "2-digit",
        }).format(new Date());
      const d = await api(
        "/api/editor/operations-tools/daily-calendar?month=" + month,
      );
      html =
        `<div class="users-toolbar"><label>Mois<input id="studio-month" type="month" value="${e(month)}"></label>${button("Préparer une journée", "new-draft", "daily")}</div>` +
        info(
          "Les cibles déjà enregistrées sont affichées. Préparez les journées futures avec une photo vérifiée ; aucune cible commencée ne sera remplacée.",
        ) +
        table(
          [
            "Date",
            "Rue",
            "Arrondissement",
            "Photo",
            "Joueurs",
            "Réussites",
            "Préparer",
          ],
          d.targets.map((r) => [
            e(r.date),
            e(r.street_name) +
              (r.source === "manifest"
                ? "<small>Prévu au manifeste, non enregistré en base</small>"
                : ""),
            e(r.quartier),
            r.imageUrl
              ? `<a href="${e(new URL(r.imageUrl, API).href)}" target="_blank" rel="noopener">Voir</a>`
              : "À vérifier",
            e(r.players),
            `${e(r.successes)} / ${e(r.players)}`,
            button("Préparer", "edit-entity", r.date, 'data-kind="daily"'),
          ]),
        );
    }
    if (view[0] === "drafts") {
      const d = await api("/drafts");
      html =
        button("Nouveau brouillon", "choose-draft") +
        info(
          "L’enregistrement prépare le contenu. Seule une publication immédiate ou programmée le rend visible dans le jeu. Les conflits conservent le brouillon.",
        ) +
        table(
          ["Objet", "Titre", "État", "Auteur", "Programmation", "Actions"],
          d.drafts.map((r) => [
            e(label(r.kind)),
            e(r.title),
            e(label(r.state)) +
              (r.error ? `<p class="status--error">${e(r.error)}</p>` : ""),
            e(r.author),
            e(date(r.publish_at)),
            button("Comparer / prévisualiser", "preview-draft", r.id) +
              (["draft", "scheduled", "failed"].includes(r.state)
                ? button("Modifier", "edit-draft", r.id) +
                  button(
                    "Archiver",
                    "archive-draft",
                    r.id,
                    'data-revision="' + r.revision + '"',
                  )
                : ""),
          ]),
        );
    }
    if (view[0] === "reports") {
      const filter = sessionStorage.getItem("admin_report_status") || "open",
        d = await api("/reports?status=" + filter);
      html =
        `<div class="users-toolbar"><label>État<select id="studio-report-status">${["open", "investigating", "resolved", "dismissed", "all"].map((v) => `<option value="${v}" ${v === filter ? "selected" : ""}>${e(label(v))}</option>`).join("")}</select></label>${button("Créer un signalement", "new-report")}</div>` +
        info(
          "Les signalements Collect existants sont réunis ici. Les états de résolution restent synchronisés avec Collect.",
        ) +
        table(
          [
            "Date",
            "Objet",
            "Catégorie",
            "Priorité",
            "Responsable",
            "Détail",
            "Suivi",
          ],
          d.reports.map((r) => [
            e(date(r.created_at)),
            e(r.domain + " · " + r.entity_key),
            e(r.category),
            e(r.severity),
            e(r.assignee || "Non attribué"),
            e(r.detail),
            button("Traiter", "edit-report", r.id),
          ]),
        );
    }
    if (view[0] === "quality") {
      const d = await api("/quality");
      html =
        info(d.coverage) +
        (d.editorial ? stats([["Photographies",d.editorial.photographs],["Illustrations cartographiques",d.editorial.cartographic],["Descriptions patrimoniales sourcées",d.editorial.heritageDescriptions],["Descriptions corrigées",d.editorial.correctedDescriptions]]) : "") +
        info("Dernière analyse : " + date(d.generatedAt)) +
        table(
          ["Jeu", "Contenu", "Contrôle", "Action"],
          d.tasks.map((r) => [
            e(r.domain),
            e(r.title),
            e(r.issue),
            `<a class="btn" href="${e(r.url)}">Ouvrir l’éditeur</a>` +
              (["collect", "explorer"].includes(r.domain) && /^\d+$/.test(r.key)
                ? button(
                    "Préparer une correction",
                    "edit-entity",
                    r.key,
                    'data-kind="' +
                      (r.domain === "collect" ? "card" : "explorer") +
                      '"',
                  )
                : ""),
          ]),
        );
    }
    if (view[0] === "players") {
      html =
        info(
          "Interventions ciblées, avec aperçu, motif et confirmation. Retrouvez l’identifiant du joueur depuis son profil dans Utilisateurs.",
        ) +
        `<div class="users-toolbar"><label>Identifiant joueur<input id="studio-player" type="number" min="1" value="${e(new URLSearchParams(location.hash.split("?")[1] || "").get("id") || "")}"></label>${button("Ouvrir le dossier", "player")}</div><div id="studio-player-detail"></div>`;
    }
    if (view[0] === "analytics") {
      const days = Number(sessionStorage.getItem("admin_analytics_days") || 30),
        d = await api("/analytics?days=" + days);
      html =
        period(days) +
        stats([
          ["Visites suivies", d.visits.visits],
          ["Jours avec collecte", d.visits.tracked_days],
          ["Collect démarrées", d.collect.started],
          ["Collect terminées", d.collect.finished],
          ["Collect abandons déclarés", d.collect.explicit_abandons],
          ["Collect en attente", d.collect.pending],
        ]) +
        table(
          [
            "Mode",
            "Joueurs sur la période",
            "Joueurs période précédente",
            "Événements",
          ],
          d.modes.map((r) => [
            e(r.mode),
            e(r.current_players),
            e(r.previous_players),
            e(r.current_events),
          ]),
        ) +
        `<h3>Cohortes arrivées à maturité</h3>` +
        stats([
          ["Inscriptions de la cohorte", d.cohort.registrations],
          ["Première activité sous 7 jours", d.cohort.first_play_7d],
          ["Retour en deuxième semaine", d.cohort.return_week2],
          ["Retour en cinquième semaine", d.cohort.return_week5],
        ]) +
        d.notes.map(info).join("");
    }
    if (view[0] === "explorer") {
      const d = await api("/explorer");
      html =
        info(d.rules) +
        `<div id="studio-map" class="studio-map" aria-label="Carte des énigmes Explorer"></div><div class="users-toolbar">${button("Préparer une énigme", "new-draft", "explorer")}${button("Simuler une partie", "simulate")}</div>` +
        info(
          "La simulation ne crée ni partie ni progression. Les énigmes archivées restent consultables ; les joueurs déjà engagés conservent leur étape.",
        ) +
        table(
          ["Rue", "État", "Départs enregistrés", "Étapes résolues", "Édition"],
          d.riddles.map((r) => [
            e(r.street_name_clean),
            r.archived_at ? "Archivée" : "Active",
            e(r.starts),
            e(r.solved),
            button("Préparer", "edit-entity", r.id, 'data-kind="explorer"'),
          ]),
        );
      if (id !== requestId) return;
      body.innerHTML = html;
      drawMap(d.riddles);
      message("Données à jour.");
      return;
    }
    if (view[0] === "balance") {
      const days = Number(sessionStorage.getItem("admin_analytics_days") || 30),
        d = await api("/balance?days=" + days);
      html =
        period(days) +
        stats([["Tirages observés", d.total]]) +
        info(d.note) +
        table(
          [
            "Famille",
            "Tirages",
            "Placement réussi",
            "Part observée (%)",
            "Poids configuré (%)",
          ],
          d.rows.map((r) => [
            e(r.family),
            e(r.draws),
            e(r.success),
            e(number(r.observedPercent)),
            e(number(r.expectedPercent)),
          ]),
        ) +
        `<h3>Questions les plus jouées</h3>` +
        table(
          ["Carte", "Réponses", "Correctes", "Taux (%)"],
          d.questions.map((r) => [
            e(r.name),
            e(r.answers),
            e(r.correct),
            e(number(r.answers ? (100 * r.correct) / r.answers : null)),
          ]),
        ) +
        json("Configuration actuelle", d.config) +
        json("Exemplaires par rareté actuelle", d.rarities);
    }
    if (view[0] === "events") {
      const d = await api("/events");
      html =
        button("Préparer un défi", "new-draft", "event") +
        info(
          "Les défis sont préparés pour un lundi futur. L’aperçu vérifie les unités disponibles et calcule la récompense avec les règles du jeu. Une semaine commencée reste verrouillée.",
        ) +
        table(
          ["Semaine", "Titre", "Objectifs"],
          d.events.map((r) => [
            e(String(r.week_start).slice(0, 10)),
            e(r.title),
            e(r.objectives.map((o) => `${o.label} : ${o.target}`).join(" · ")),
          ]),
        ) +
        json("Défis déjà générés par le jeu", d.challenges);
    }
    if (view[0] === "history") {
      const d = await api("/history");
      html =
        info(
          "Historique Collect, Explorer et Daily depuis l’activation du suivi. Une restauration prépare un brouillon ciblé ; elle ne publie rien automatiquement. Les anciennes fiches Parici restent dans Pilotage → Historique.",
        ) +
        table(
          ["Date", "Type", "Objet", "Auteur", "Détail"],
          d.revisions.map((r) => [
            e(date(r.created_at)),
            e(label(r.domain)),
            e(r.entity_key),
            e(r.actor),
            button("Comparer", "history", r.id),
          ]),
        );
    }
    if (view[0] === "security") {
      const d = await api("/sessions");
      html =
        `<h3>Double authentification</h3><p>${me.mfaEnabled ? "Activée pour les accès à l’administration." : "Non activée sur votre compte."}</p>${button(me.mfaEnabled ? "Désactiver la double authentification" : "Configurer une application", "mfa")}<h3>Sessions de votre compte</h3>` +
        table(
          [
            "Appareil",
            "Première utilisation",
            "Dernière activité",
            "Expiration",
          ],
          d.sessions.map((r) => [
            e(r.user_agent),
            e(date(r.first_seen)),
            e(date(r.last_seen)),
            e(date(r.expires_at)),
          ]),
        ) +
        button("Révoquer toutes mes sessions", "revoke-self") +
        (me.permissions.security
          ? `<h3>Permissions des éditeurs</h3>${button("Configurer les permissions", "permissions")}`
          : "");
    }
    if (view[0] === "campaigns") {
      const d = await api("/campaigns");
      html =
        button("Préparer une notification", "new-campaign") +
        info(
          "Messages dans la cloche du site. Respect du choix du joueur et maximum une campagne sur 7 jours. Prévisualisez l’audience et envoyez-vous un test avant diffusion.",
        ) +
        table(
          ["Titre", "Audience", "État", "Remises", "Lues", "Actions"],
          d.campaigns.map((r) => [
            e(r.title),
            e(label(r.audience)),
            e(label(r.state)),
            e(r.delivered),
            e(r.read),
            r.state === "draft"
              ? button("Prévisualiser", "campaign", r.id)
              : e(date(r.sent_at)),
          ]),
        );
    }
    if (view[0] === "operations") {
      const d = await api("/operations");
      let frontend = null;
      try {
        frontend = await fetch("/admin/build-info.json", {
          cache: "no-store",
        }).then((r) => r.json());
      } catch {}
      const matches =
        frontend?.commit && d.backendCommit
          ? frontend.commit === d.backendCommit
          : null;
      html =
        stats([
          [
            "Publications programmées",
            d.scheduled.find((r) => r.state === "scheduled")?.count || 0,
          ],
          [
            "Publications en échec",
            d.scheduled.find((r) => r.state === "failed")?.count || 0,
          ],
        ]) +
        `<p>Base : ${e(d.database)} · Démarrage : ${e(date(d.startedAt))}</p><p>Frontend : <code>${e(frontend?.commit || "Version locale non identifiée")}</code></p><p>Backend : <code>${e(d.backendCommit || "Version locale non identifiée")}</code></p><p class="${matches === false ? "status--error" : ""}">${matches === true ? "Versions identiques." : matches === false ? "Versions différentes : livraison à vérifier." : "Comparaison indisponible sans deux identifiants de version."}</p>` +
        `<div class="button-row"><a class="btn" href="https://github.com/philippemaraval/Parici/actions/workflows/render-deploy-hook.yml" target="_blank" rel="noopener">Déploiements</a><a class="btn" href="#backups">Sauvegardes</a></div>` +
        `<h3>Dernières opérations en erreur</h3>` +
        table(
          ["Date", "Action", "HTTP"],
          d.errors.map((r) => [
            e(date(r.created_at)),
            e(r.action),
            e(r.status_code),
          ]),
        );
    }
    if (view[0] === "backups") {
      const d = await api("/backups");
      html =
        info(
          "Une sauvegarde n’est marquée réussie que si le dump chiffré, la restauration isolée et l’archivage ont tous réussi. L’absence de résultat signifie qu’aucune preuve n’a été enregistrée.",
        ) +
        `<div class="button-row"><a class="btn" href="${e(d.workflow)}" target="_blank" rel="noopener">Historique et lancement des sauvegardes</a><a class="btn" href="${e(d.procedure)}">Procédure de restauration</a></div>` +
        table(
          ["Date", "Résultat", "Archive", "Vérification"],
          d.runs.map((r) => [
            e(date(r.created_at)),
            e(label(r.status)),
            e(r.backup_name),
            e(r.detail),
          ]),
        );
    }
    if (id !== requestId) return;
    body.innerHTML = html;
    message("Données à jour.");
  } catch (error) {
    if (id === requestId) {
      body.replaceChildren();
      message(error.message, true);
    }
  }
}
function period(days) {
  return `<label class="studio-period">Période<select id="studio-period">${[7, 30, 90].map((n) => `<option value="${n}" ${n === days ? "selected" : ""}>${n} jours</option>`).join("")}</select></label>`;
}
function drawMap(rows) {
  if (!window.L) {
    document.getElementById("studio-map").textContent =
      "Carte indisponible. La liste des énigmes reste accessible.";
    return;
  }
  map = window.L.map("studio-map",{zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false}).setView([48.8566, 2.3522], 12);
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
  }).addTo(map);
  const bounds = [];
  for (const r of rows) {
    if (r.latitude == null || r.longitude == null) continue;
    const point = [Number(r.latitude), Number(r.longitude)];
    bounds.push(point);
    window.L.circleMarker(point, {
      radius: 7,
      color: r.archived_at ? "#88909c" : "#0c1d57",
      fillOpacity: 0.7,
    })
      .addTo(map)
      .bindPopup(document.createTextNode(r.street_name_clean));
  }
  if (bounds.length) map.fitBounds(bounds, { padding: [20, 20], maxZoom: 15,animate:false });
}
async function chooseDraft() {
  show(
    "<h3>Nouveau brouillon</h3>" +
      form(
        field("kind", "Type", "daily", "select", [
          "daily",
          "explorer",
          "card",
          "street",
          "event",
        ]) +
          field(
            "key",
            "Identifiant existant (Collect/Explorer), date ou nom de rue",
            "",
          ) +
          info(
            "Explorer : laissez vide pour une nouvelle énigme. Daily et défi : choisissez ensuite la date dans le formulaire.",
          ),
        "Préparer",
      ),
  );
  bindForm(async (p) => {
    let key = p.key || "new",
      current = null;
    if (
      !["new", ""].includes(key) &&
      ["card", "explorer", "daily"].includes(p.kind)
    )
      current = (await api("/entity/" + p.kind + "/" + encodeURIComponent(key)))
        .current;
    await openDraft(p.kind, key, current);
  });
}
async function openDraft(kind, key = "new", current = null, existing = null) {
  let p = existing?.payload || current || {};
  if (kind === "daily" && current)
    p = { ...p, coordinates: JSON.parse(current.coordinates_json || "[]") };
  let html = field(
    "title",
    "Titre interne",
    existing?.title || p.name || p.street_name || p.street_name_clean || "",
  );
  if (kind === "daily")
    html +=
      field("date", "Journée", p.date || (key !== "new" ? key : ""), "date") +
      `<label>Rechercher une rue<input id="studio-street-search" type="search" placeholder="Nom de rue"></label><div id="studio-street-results" class="button-row"></div>` +
      field("street_name", "Rue", p.street_name || "") +
      field("quartier", "Arrondissement", p.quartier || "") +
      field("longitude", "Longitude", p.coordinates?.[0] ?? "", "number") +
      field("latitude", "Latitude", p.coordinates?.[1] ?? "", "number") +
      field("image_url", "Photo (HTTPS ou fichier local)", p.image_url || "") +
      field(
        "verified",
        "J’ai vérifié la photo, la rue et les coordonnées",
        false,
        "checkbox",
      );
  if (kind === "explorer")
    html +=
      field("way_id", "Identifiant OSM", p.way_id || "", "number") +
      field("street_name_clean", "Rue / réponse", p.street_name_clean || "") +
      field("riddle_text", "Énigme", p.riddle_text || "", "textarea") +
      field("hint_text", "Indice", p.hint_text || "", "textarea") +
      field(
        "explanation_text",
        "Explication après découverte",
        p.explanation_text || "",
        "textarea",
      ) +
      field("image_url", "Image", p.image_url || "") +
      field("latitude", "Latitude", p.latitude ?? "", "number") +
      field("longitude", "Longitude", p.longitude ?? "", "number");
  if (kind === "card")
    html +=
      info("Carte n° " + key + " · " + (current?.name || "")) +
      field(
        "description_override",
        "Description courte (vide = contenu d’origine)",
        p.description_override || "",
        "textarea",
      ) +
      field(
        "description_full_override",
        "Description détaillée",
        p.description_full_override || "",
        "textarea",
      ) +
      field("image_override", "Image de remplacement", p.image_override || "") +
      field(
        "image_credit_override",
        "Crédit image",
        p.image_credit_override || "",
      );
  if (kind === "street")
    html +=
      field("mode", "Catégorie", p.mode || "famous", "select", [
        ["famous", "Rues célèbres"],
        ["main", "Rues principales"],
      ]) +
      field("name", "Rue", p.name || (key === "new" ? "" : key)) +
      field("description", "Description", p.description || "", "textarea");
  if (kind === "event") {
    html += field("week_start", "Lundi de début", p.week_start || "", "date");
    for (let i = 0; i < 3; i++)
      html += `<fieldset><legend>Objectif ${i + 1}${i === 2 ? " (facultatif)" : ""}</legend>${field(
        "kind" + i,
        "Objectif",
        p.objectives?.[i]?.kind ||
          (i === 0 ? "quartier" : i === 1 ? "monument" : ""),
        "select",
        [
          ["", "Aucun"],
          ["arrondissement", "Arrondissements"],
          ["quartier", "Quartiers"],
          ["famous", "Rues célèbres"],
          ["main", "Rues principales"],
          ["monument", "Monuments"],
          ["bus", "Lignes de bus"],
          ["district", "Cartes quartiers"],
        ],
      )}${field("target" + i, "Nombre", p.objectives?.[i]?.target || 1, "number")}</fieldset>`;
  }
  show(
    "<h3>" +
      e(existing ? "Modifier le brouillon" : "Préparer : " + label(kind)) +
      "</h3>" +
      form(html, "Enregistrer le brouillon"),
  );
  bindForm(async (v) => {
    let payload;
    if (kind === "daily")
      payload = {
        date: v.date,
        street_name: v.street_name,
        quartier: v.quartier,
        coordinates: [Number(v.longitude), Number(v.latitude)],
        image_url: v.image_url,
        verified: v.verified === "on",
      };
    if (kind === "explorer")
      payload = {
        ...v,
        way_id: Number(v.way_id),
        latitude: v.latitude === "" ? null : Number(v.latitude),
        longitude: v.longitude === "" ? null : Number(v.longitude),
      };
    if (kind === "card") payload = v;
    if (kind === "street") payload = v;
    if (kind === "event")
      payload = {
        week_start: v.week_start,
        objectives: [0, 1, 2]
          .filter((i) => v["kind" + i])
          .map((i) => ({
            kind: v["kind" + i],
            target: Number(v["target" + i]),
            label: v["kind" + i],
          })),
      };
    const entity_key =
      kind === "daily"
        ? v.date
        : kind === "event"
          ? v.week_start
          : kind === "street"
            ? v.name
            : key;
    const saved = existing
      ? await api("/drafts/" + existing.id, {
          method: "PUT",
          body: { title: v.title, payload, revision: existing.revision },
        })
      : await api("/drafts", {
          method: "POST",
          body: { kind, entity_key, title: v.title, payload },
        });
    dirty = false;
    await previewDraft(saved.id);
  });
  const search = detail.querySelector("#studio-street-search");
  let sequence = 0;
  search?.addEventListener("input", async () => {
    const seq = ++sequence;
    try {
      const d = await api("/streets?q=" + encodeURIComponent(search.value));
      if (seq !== sequence) return;
      const results = detail.querySelector("#studio-street-results");
      results.replaceChildren();
      for (const r of d.streets) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn";
        b.textContent = r.name;
        b.onclick = () => {
          const f = detail.querySelector("form");
          for (const [name, value] of Object.entries({
            street_name: r.name,
            quartier: r.quartier,
            longitude: r.coordinates?.[0],
            latitude: r.coordinates?.[1],
          }))
            f.elements[name].value = value ?? "";
          dirty = true;
          results.replaceChildren();
        };
        results.append(b);
      }
    } catch (error) {
      message(error.message, true);
    }
  });
}
async function previewDraft(id) {
  const d = await api("/drafts/" + id + "/preview", {
      method: "POST",
      body: {},
    }),
    r = d.draft,
    p = r.payload;
  let html = `<h3>${e(r.title)}</h3><p>${e(label(r.kind))} · ${e(label(r.state))}</p>`;
  if (p.image_url || p.image_override)
    html += `<img class="studio-preview-image" src="${e(new URL(p.image_url || p.image_override, API).href)}" alt="Image du contenu préparé">`;
  if (r.kind === "explorer")
    html += `<h4>${e(p.riddle_text)}</h4><p>Indice : ${e(p.hint_text)}</p><p>Réponse : ${e(p.street_name_clean)}</p><p>${e(p.explanation_text)}</p>`;
  if (r.kind === "card")
    html += `<p>${e(p.description_override || "Description d’origine")}</p><p>${e(p.description_full_override || "")}</p>`;
  if (r.kind === "daily")
    html += `<p>${e(p.date)} · ${e(p.street_name)} · ${e(p.quartier)}</p><p>Longitude ${e(p.coordinates[0])} · Latitude ${e(p.coordinates[1])}</p>`;
  if (d.event)
    html +=
      table(
        ["Objectif", "Cible", "Disponible"],
        d.event.objectives.map((o) => [
          e(o.label),
          e(o.target),
          e(o.available),
        ]),
      ) + json("Récompense calculée", d.event.reward);
  html +=
    json("Contenu actuellement publié", d.current) + json("Contenu préparé", p);
  if (
    ["draft", "failed", "scheduled"].includes(r.state) &&
    me.permissions.publish
  )
    html += `<div class="button-row">${button("Publier maintenant", "publish", r.id, 'data-revision="' + r.revision + '"')}${r.state !== "scheduled" ? button("Programmer", "schedule", r.id, 'data-revision="' + r.revision + '"') : ""}</div>`;
  show(html);
}
async function player(id) {
  const d = await api("/players/" + id);
  document.getElementById("studio-player-detail").innerHTML =
    `<h3>${e(d.user.username)}</h3><p>${d.user.suspendedAt ? "Compte suspendu" : "Compte actif"}</p>${button("Préparer une intervention", "intervention", id)}` +
    table(
      ["Date", "Action", "Motif", "Résultat"],
      d.interventions.map((r) => [
        e(date(r.created_at)),
        e(r.action),
        e(r.reason),
        e(JSON.stringify(r.after_json)),
      ]),
    );
}
async function intervention(id) {
  show(
    "<h3>Intervention sur le joueur n° " +
      e(id) +
      "</h3>" +
      form(
        field("action", "Action", "revoke", "select", [
          ["revoke", "Révoquer les sessions"],
          ["suspend", "Suspendre le compte joueur"],
          ["resume", "Réactiver le compte"],
          ["grant-card", "Attribuer un exemplaire de carte"],
          [
            "correct-explorer",
            "Corriger les points d’une étape Explorer résolue",
          ],
        ]) +
          field("cardId", "Identifiant carte (attribution)", "", "number") +
          field("riddleId", "Identifiant énigme (correction)", "", "number") +
          field("points", "Points corrigés (0–70)", "", "number") +
          field("reason", "Motif détaillé", "", "textarea"),
        "Vérifier les conséquences",
      ),
  );
  bindForm(async (v) => {
    if (v.reason.trim().length < 10)
      throw Error("Précisez le motif (10 caractères minimum).");
    const p = {
      action: v.action,
      reason: v.reason,
      requestId: crypto.randomUUID(),
      ...(v.action === "grant-card" ? { cardId: Number(v.cardId) } : {}),
      ...(v.action === "correct-explorer"
        ? { riddleId: Number(v.riddleId), points: Number(v.points) }
        : {}),
    };
    const d = await api("/players/" + id + "/preview", {
      method: "POST",
      body: p,
    });
    show(
      "<h3>Vérifier l’intervention</h3>" +
        json("État avant intervention", d.before) +
        json("Conséquences", d.effects) +
        `<p>Motif : ${e(p.reason)}</p><button id="studio-apply-intervention" class="btn btn-primary">Confirmer l’intervention</button>`,
    );
    document.getElementById("studio-apply-intervention").onclick = async (
      event,
    ) => {
      event.target.disabled = true;
      try {
        await api("/players/" + id + "/intervene", {
          method: "POST",
          body: { ...p, fingerprint: d.fingerprint },
          sensitive: true,
        });
        dialog.close();
        await player(id);
        message("Intervention enregistrée.");
      } catch (error) {
        event.target.disabled = false;
        message(error.message, true);
      }
    };
  });
}
async function simulate() {
  show(
    "<h3>Simuler Explorer</h3>" +
      info(
        "Même géométrie et mêmes règles que le jeu : la plus proche au départ, puis une rue parmi les cinq plus proches restantes. Sans position, toutes les rues restantes sont candidates.",
      ) +
      form(
        field("latitude", "Latitude de départ", 48.8566, "number") +
          field("longitude", "Longitude de départ", 2.3522, "number") +
          field(
            "withoutPosition",
            "Simuler une position indisponible",
            false,
            "checkbox",
          ),
        "Commencer la simulation",
      ) +
      '<div id="studio-simulation"></div>',
  );
  let solved = [];
  bindForm(async (v) => {
    solved = [];
    await step(v);
  });
  async function step(v) {
    const result = await api("/explorer/simulate", {
      method: "POST",
      body: {
        position:
          v.withoutPosition === "on"
            ? null
            : { latitude: Number(v.latitude), longitude: Number(v.longitude) },
        solved,
      },
    });
    const el = document.getElementById("studio-simulation");
    el.innerHTML =
      `<h4>${e(result.choice?.street_name_clean || "Toutes les énigmes ont été tirées.")}</h4><p>${e(result.remaining)} rues restantes</p>` +
      table(
        ["Candidate", "Distance (m)", "Probabilité (%)"],
        result.candidates.map((r) => [
          e(r.name),
          e(number(r.distance)),
          e(number(100 * r.probability)),
        ]),
      );
    if (result.choice) {
      solved.push(result.choice.id);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.textContent = "Simuler la découverte et tirer la suivante";
      b.onclick = async () => {
        try {
          const r = result.choice;
          v = {
            ...v,
            latitude: r.latitude ?? v.latitude,
            longitude: r.longitude ?? v.longitude,
          };
          await step(v);
        } catch (error) {
          message(error.message, true);
        }
      };
      el.append(b);
    }
  }
}
async function permissions() {
  const d = await api("/permissions");
  show(
    "<h3>Permissions des éditeurs</h3>" +
      form(
        field(
          "user",
          "Éditeur",
          "",
          "select",
          d.accounts
            .filter((u) => u.role === "editor")
            .map((u) => [u.id, u.username]),
        ) +
          d.permissions
            .map((p) =>
              field(
                p,
                p,
                ["read", "edit", "publish", "quality"].includes(p),
                "checkbox",
              ),
            )
            .join("") +
          field("reason", "Motif", "", "textarea"),
        "Enregistrer les permissions",
      ),
  );
  const f = detail.querySelector("form");
  const refresh = () => {
    const user = Number(f.elements.user.value);
    for (const p of d.permissions)
      f.elements[p].checked =
        d.overrides.find((r) => r.user_id === user && r.permission === p)
          ?.allowed ?? ["read", "edit", "publish", "quality"].includes(p);
  };
  f.elements.user.onchange = refresh;
  refresh();
  bindForm(async (v) => {
    const permissions = Object.fromEntries(
      d.permissions.map((p) => [p, v[p] === "on"]),
    );
    await api("/permissions/" + v.user, {
      method: "PUT",
      body: { permissions, reason: v.reason },
      sensitive: true,
    });
    dirty = false;
    dialog.close();
    message("Permissions enregistrées ; sessions de l’éditeur révoquées.");
  });
}
async function mfa() {
  if (me.mfaEnabled) {
    await api("/mfa/disable", { method: "POST", body: {}, sensitive: true });
    sessionStorage.removeItem("camino_admin_mfa");
    me.mfaEnabled = false;
    return load();
  }
  const d = await api("/mfa/enroll", {
    method: "POST",
    body: {},
    sensitive: true,
  });
  show(
    "<h3>Configurer la double authentification</h3>" +
      info(
        "Ajoutez cette clé à votre application d’authentification, puis saisissez le code affiché. La clé disparaîtra à la fermeture de cette fenêtre.",
      ) +
      `<code class="studio-secret">${e(d.secret)}</code><p><a href="${e(d.uri)}">Ouvrir l’application compatible</a></p>` +
      form(field("code", "Code à six chiffres"), "Activer"),
  );
  bindForm(async (v) => {
    const r = await api("/mfa/enable", { method: "POST", body: v });
    me.mfaEnabled = true;
    sessionStorage.setItem("camino_admin_mfa", r.proof);
    show(
      "<h3>Codes de récupération</h3>" +
        info(
          "Conservez ces codes dans un endroit sûr. Chaque code est utilisable une fois et ne sera plus affiché.",
        ) +
        `<pre class="command-output">${e(r.recoveryCodes.join("\n"))}</pre>`,
    );
    message("Double authentification activée.");
  });
}
async function newReport() {
  show(
    "<h3>Créer un signalement</h3>" +
      form(
        field("domain", "Domaine", "daily", "select", [
          "camino",
          "daily",
          "collect",
          "explorer",
          "technical",
        ]) +
          field("entity_key", "Identifiant, date ou rue") +
          field("category", "Catégorie", "bug", "select", [
            "image",
            "description",
            "question",
            "geography",
            "bug",
            "other",
          ]) +
          field("detail", "Description", "", "textarea"),
        "Créer",
      ),
  );
  bindForm(async (v) => {
    await api("/reports", { method: "POST", body: v });
    dirty = false;
    dialog.close();
    await load();
  });
}
async function editReport(id) {
  const d = await api("/reports?status=all"),
    r = d.reports.find((r) => String(r.id) === String(id));
  if (!r)
    throw Error("Signalement hors de la fenêtre des 200 derniers résultats.");
  show(
    "<h3>Traiter le signalement</h3>" +
      `<p>${e(r.detail)}</p>` +
      form(
        field("status", "État", r.status, "select", [
          "open",
          "investigating",
          "resolved",
          "dismissed",
        ]) +
          field("severity", "Priorité", r.severity, "select", [
            ["low", "Basse"],
            ["normal", "Normale"],
            ["high", "Haute"],
            ["critical", "Critique"],
          ]) +
          field("assignee_id", "Responsable", r.assignee_id || "", "select", [
            ["", "Non attribué"],
            ...d.assignees.map((u) => [u.id, u.username]),
          ]) +
          field("resolution", "Résolution / notes", r.resolution, "textarea"),
        "Enregistrer",
      ),
  );
  bindForm(async (v) => {
    await api("/reports/" + id, {
      method: "PUT",
      body: {
        ...v,
        assignee_id: v.assignee_id ? Number(v.assignee_id) : null,
        revision: r.revision,
      },
    });
    dirty = false;
    dialog.close();
    await load();
  });
}
async function campaign(id) {
  const d = await api("/campaigns/" + id + "/preview", {
    method: "POST",
    body: {},
  });
  show(
    `<h3>${e(d.title)}</h3><p>${e(d.body)}</p><p>Lien : ${e(d.url)}</p><p>${e(d.count)} destinataires éligibles actuellement.</p>` +
      info(d.note) +
      `<div class="button-row">${button("M’envoyer un test", "test-campaign", id)}${button("Diffuser aux destinataires", "send-campaign", id, 'data-fingerprint="' + d.fingerprint + '"')}</div>`,
  );
}
async function act(b) {
  const { action, id } = b.dataset;
  if (action === "choose-draft") return chooseDraft();
  if (action === "new-draft") return openDraft(id);
  if (action === "edit-entity") {
    const kind = b.dataset.kind;
    return openDraft(
      kind,
      id,
      (await api("/entity/" + kind + "/" + encodeURIComponent(id))).current,
    );
  }
  if (action === "edit-draft") {
    const { draft } = await api("/drafts/" + id + "/preview", {
      method: "POST",
      body: {},
    });
    return openDraft(draft.kind, draft.entity_key, null, draft);
  }
  if (action === "preview-draft") return previewDraft(id);
  if (action === "publish") {
    await api("/drafts/" + id + "/publish", {
      method: "POST",
      body: { revision: Number(b.dataset.revision) },
      sensitive: true,
    });
    dialog.close();
    return load();
  }
  if (action === "schedule") {
    show(
      "<h3>Programmer la publication</h3>" +
        form(
          field("when", "Date et heure locales", "", "datetime-local"),
          "Programmer",
        ),
    );
    return bindForm(async (v) => {
      await api("/drafts/" + id + "/schedule", {
        method: "POST",
        body: {
          revision: Number(b.dataset.revision),
          publishAt: new Date(v.when).toISOString(),
        },
        sensitive: true,
      });
      dirty = false;
      dialog.close();
      await load();
    });
  }
  if (action === "archive-draft") {
    await api("/drafts/" + id + "/archive", {
      method: "POST",
      body: { revision: Number(b.dataset.revision) },
    });
    return load();
  }
  if (action === "new-report") return newReport();
  if (action === "edit-report") return editReport(id);
  if (action === "player")
    return player(document.getElementById("studio-player").value);
  if (action === "intervention") return intervention(id);
  if (action === "simulate") return simulate();
  if (action === "permissions") return permissions();
  if (action === "mfa") return mfa();
  if (action === "revoke-self") {
    await api("/sessions/revoke", {
      method: "POST",
      body: {},
      sensitive: true,
    });
    sessionStorage.removeItem("camino_paris_editor_token");
    sessionStorage.removeItem("camino_admin_mfa");
    location.href = "/admin/";
  }
  if (action === "history") {
    const d = await api("/history"),
      r = d.revisions.find((r) => String(r.id) === id);
    if (!r) throw Error("Révision introuvable");
    const restoreFields =
      {
        card: {
          description_override: "Description courte",
          description_full_override: "Description complète",
          image_override: "Image",
          image_credit_override: "Crédit image",
        },
        explorer: {
          way_id: "Identifiant OSM",
          street_name_clean: "Rue",
          riddle_text: "Énigme",
          hint_text: "Indice",
          explanation_text: "Explication",
          image_url: "Image",
          latitude: "Latitude",
          longitude: "Longitude",
        },
        daily: {
          street_name: "Rue",
          quartier: "Quartier",
          coordinates_json: "Coordonnées",
          image_url: "Image",
        },
      }[r.domain] || {};
    show(
      "<h3>Comparer la révision " +
        e(id) +
        "</h3>" +
        json("Avant", r.before_json) +
        json("Après", r.after_json) +
        (r.before_json && ["card", "daily", "explorer"].includes(r.domain)
          ? "<fieldset><legend>Champs à restaurer</legend>" +
            Object.entries(restoreFields)
              .map(
                ([key, title]) =>
                  '<label><input type="checkbox" data-restore-field="' +
                  e(key) +
                  '" checked> ' +
                  e(title) +
                  "</label>",
              )
              .join("") +
            "</fieldset>" +
            button("Préparer une restauration ciblée", "restore-history", id)
          : ""),
    );
  }
  if (action === "restore-history") {
    const d = await api("/history/" + id + "/restore-draft", {
      method: "POST",
      body: {
        fields: [
          ...dialog.querySelectorAll("[data-restore-field]:checked"),
        ].map((el) => el.dataset.restoreField),
      },
    });
    return previewDraft(d.id);
  }
  if (action === "new-campaign") {
    show(
      "<h3>Préparer une notification</h3>" +
        form(
          field("title", "Titre") +
            field("body", "Message", "", "textarea") +
            field("url", "Lien interne", "/") +
            field("audience", "Audience", "all", "select", [
              "all",
              "active30",
              "inactive30",
            ]),
          "Enregistrer",
        ),
    );
    return bindForm(async (v) => {
      const d = await api("/campaigns", { method: "POST", body: v });
      dirty = false;
      await campaign(d.id);
    });
  }
  if (action === "campaign") return campaign(id);
  if (action === "test-campaign") {
    await api("/campaigns/" + id + "/test", { method: "POST", body: {} });
    return message("Test disponible dans votre cloche sur le site.");
  }
  if (action === "send-campaign") {
    await api("/campaigns/" + id + "/send", {
      method: "POST",
      body: { fingerprint: b.dataset.fingerprint },
      sensitive: true,
    });
    dialog.close();
    return load();
  }
}
for (const el of [body, detail])
  el.addEventListener("click", async (event) => {
    const b = event.target.closest("[data-action]");
    if (!b) return;
    b.disabled = true;
    try {
      await act(b);
    } catch (error) {
      message(error.message, true);
    } finally {
      b.disabled = false;
    }
  });
body.addEventListener("change", (event) => {
  if (event.target.id === "studio-month")
    sessionStorage.setItem("admin_daily_month", event.target.value);
  else if (event.target.id === "studio-period")
    sessionStorage.setItem("admin_analytics_days", event.target.value);
  else if (event.target.id === "studio-report-status")
    sessionStorage.setItem("admin_report_status", event.target.value);
  else return;
  load();
});
window.addEventListener("hashchange", load);
document.getElementById("studio-refresh").onclick = load;
try {
  me = await api("/me");
  document.getElementById("studio-nav").innerHTML = views
    .filter((v) => me.permissions[v[2]])
    .map((v) => `<a href="#${v[0]}" data-view="${v[0]}">${e(v[1])}</a>`)
    .join("");
  await load();
} catch (error) {
  message(error.message + " Connectez-vous depuis l’accueil admin.", true);
}
