const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  profile:
    '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  rules:
    '<path d="M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V3ZM4 17h16M8 7h8M8 11h6"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/>',
  idea: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9Z"/>',
  contact:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  bell: '<path d="M5 16h14l-2-3V9a5 5 0 0 0-10 0v4ZM10 20h4M12 2v2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;

export function initSiteMenu() {
  const menuButton = document.getElementById("site-menu-toggle");
  const bell = document.getElementById("site-notification-bell");
  if (!menuButton || !bell || window.CaminoShell) return;
  const API = window.CaminoRuntimeConfig?.apiUrl || "http://localhost:3000";
  const token = () => {
    const stored =
      localStorage.getItem("camino_auth_token") ||
      sessionStorage.getItem("camino_paris_session_token");
    if (stored) return stored;
    try {
      const user = JSON.parse(localStorage.getItem("camino_paris_user") || "null");
      return user?.token || (user?.authenticated ? "__cookie_session__" : "");
    } catch {
      return "";
    }
  };
  async function request(path, options = {}) {
    const response = await fetch(API + path, {
      ...options,
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(token() ? { Authorization: "Bearer " + token() } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Object.assign(
        new Error(data.error || "Connexion momentanément indisponible."),
        { status: response.status },
      );
    return data;
  }
  const send = (path, body, method = "POST") =>
    request(path, { method, body: JSON.stringify(body) });
  const drawer = document.createElement("dialog");
  drawer.id = "site-menu-drawer";
  drawer.className = "site-menu-drawer";
  drawer.setAttribute("aria-label", "Menu Parici");
  drawer.innerHTML = `<header class="site-drawer-heading"><a href="/">Parici</a><button type="button" class="site-icon-button" data-close-drawer aria-label="Fermer le menu">${icon("close")}</button></header><nav class="site-drawer-links" aria-label="Menu Parici"><a href="/?view=profile#profile">${icon("profile")}<span>Profil</span></a><button type="button" data-drawer-page="settings">${icon("settings")}<span>Réglages</span></button><a href="/regles.html">${icon("rules")}<span>Règles du jeu</span></a><a href="/versions.html">${icon("history")}<span>Historique des versions</span></a><a href="/remarques.html">${icon("idea")}<span>Remarques et idées</span></a><button type="button" data-drawer-page="contact">${icon("contact")}<span>Contact</span></button></nav><section id="site-drawer-content" hidden></section><a class="site-privacy-link" href="/confidentialite.html">Confidentialité et données</a>`;
  document.body.append(drawer);
  const content = drawer.querySelector("#site-drawer-content");
  const popup = document.createElement("section");
  popup.id = "site-notifications";
  popup.className = "site-notification-panel";
  popup.hidden = true;
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", "Centre de notifications");
  popup.innerHTML = `<header><h2>Notifications</h2><button type="button" class="site-icon-button" data-close-notifications aria-label="Fermer les notifications">${icon("close")}</button></header><div id="site-notification-list"></div><p class="site-notification-feedback" role="status"></p><button type="button" class="site-notification-settings">Réglages des notifications</button>`;
  document.body.append(popup);
  const list = popup.querySelector("#site-notification-list"),
    count = document.getElementById("site-notification-count");
  let currentInbox = null,
    ownerToken = "",
    pending = null,
    acknowledgement = null,
    drawerPage = null,
    drawerClosing = false,
    drawerCloseGeneration = 0,
    settingsState = null;
  const params = new URLSearchParams(location.search);

  function badge(value) {
    value = Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
    count.textContent = String(value);
    count.hidden = value === 0;
    bell.setAttribute(
      "aria-label",
      value
        ? `Notifications · ${value} non lue${value > 1 ? "s" : ""}`
        : "Notifications",
    );
  }
  function notificationDate(value) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return "";
    return `<time datetime="${date.toISOString()}">${escapeHtml(date.toLocaleString("fr-FR", {timeZone:"Europe/Paris",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}))}</time>`;
  }
  function displayInbox() {
    list.innerHTML = !token()
      ? '<p class="site-inbox-empty">Connecte-toi pour retrouver tes notifications.</p><a class="site-inbox-login" href="/?view=profile#profile">Ouvrir mon profil</a>'
      : currentInbox?.items.length
        ? currentInbox.items
            .map(
              (item) =>
                `<a class="site-inbox-item ${item.unread ? "is-unread" : ""}" href="${escapeHtml(item.url)}" data-notification-key="${escapeHtml(item.key)}"><span class="site-inbox-icon site-inbox-icon--${item.kind}">${icon(item.kind === "friend" ? "profile" : "bell")}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small>${notificationDate(item.createdAt)}</span></a>`,
            )
            .join("")
        : `<p class="site-inbox-empty">${currentInbox ? "Tu es à jour." : "Chargement des notifications…"}</p>`;
  }
  function positionPopup() {
    const bounds = bell.getBoundingClientRect();
    popup.style.top = `${Math.max(8, bounds.top)}px`;
    popup.style.right = `${Math.max(8, innerWidth - bounds.right)}px`;
    popup.style.maxHeight = `${Math.max(120, innerHeight - Math.max(8, bounds.top) - 16)}px`;
  }
  function closeNotifications(returnFocus = true) {
    popup.hidden = true;
    bell.setAttribute("aria-expanded", "false");
    if (returnFocus) bell.focus({ preventScroll: true });
  }
  async function acknowledge(snapshot) {
    if (!snapshot || !token()) return;
    if (acknowledgement) return acknowledgement;
    const identity = token();
    acknowledgement = send("/api/site/notifications/open", {
      keys: snapshot.keys,
      socialThrough: snapshot.socialThrough,
      snapshotAt: snapshot.snapshotAt,
    })
      .then(() => {
        if (token() !== identity) return;
        snapshot.items.forEach((item) => (item.unread = false));
        snapshot.unread = 0;
        badge(0);
        displayInbox();
      })
      .catch(() => {
        popup.querySelector('[role="status"]').textContent =
          "Lecture enregistrée sur cet écran. La synchronisation reprendra avec la connexion.";
      })
      .finally(() => {
        acknowledgement = null;
      });
    return acknowledgement;
  }
  async function refreshNotifications() {
    const identity = token();
    if (identity !== ownerToken) {
      ownerToken = identity;
      currentInbox = null;
      badge(0);
      displayInbox();
    }
    if (!identity) return;
    if (pending) return pending;
    pending = request("/api/site/notifications")
      .then(async (data) => {
        if (token() !== identity) return;
        currentInbox = data;
        if (!popup.hidden) {
          badge(0);
          displayInbox();
          await acknowledge(data);
        } else badge(data.unread);
      })
      .catch((error) => {
        if (error.status === 401) {
          currentInbox = null;
          badge(0);
          if (!popup.hidden)
            list.innerHTML =
              '<p class="site-inbox-empty">Reconnecte-toi depuis ton profil.</p>';
        } else if (!popup.hidden) {
          popup.querySelector('[role="status"]').textContent =
            "Les notifications sont momentanément indisponibles.";
          if (!currentInbox)
            list.innerHTML =
              '<p class="site-inbox-empty">Impossible de charger les notifications pour le moment.</p>';
        }
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }
  async function openNotifications() {
    if (token() !== ownerToken) {
      ownerToken = token();
      currentInbox = null;
    }
    if (drawer.open) closeDrawer();
    popup.hidden = false;
    bell.setAttribute("aria-expanded", "true");
    positionPopup();
    badge(0);
    popup.querySelector('[role="status"]').textContent = "";
    displayInbox();
    popup
      .querySelector("[data-close-notifications]")
      .focus({ preventScroll: true });
    if (currentInbox) await acknowledge(currentInbox);
    await refreshNotifications();
  }
  function closeDrawer() {
    if (!drawer.open || drawerClosing) return;
    drawerClosing = true;
    const generation = ++drawerCloseGeneration;
    drawer.classList.add("is-closing");
    Promise.allSettled(drawer.getAnimations().map((animation) => animation.finished)).then(() => {
      if (generation !== drawerCloseGeneration) return;
      drawer.close();
      drawerClosing = false;
      drawer.classList.remove("is-closing");
    });
  }
  function openDrawer(page = null) {
    if (drawerClosing) {
      drawerCloseGeneration++;
      drawerClosing = false;
      drawer.classList.remove("is-closing");
    }
    drawerPage = page;
    closeNotifications(false);
    content.hidden = !page;
    drawer.querySelector(".site-drawer-links").hidden = !!page;
    if (!drawer.open) {
      drawer.showModal();
      document.documentElement.classList.add("site-overlay-open");
    }
    menuButton.setAttribute("aria-expanded", "true");
    if (page === "settings") void settingsView();
    if (page === "contact") {
      content.innerHTML = `<button class="site-drawer-back" type="button">← Menu</button><h2>Contact</h2><p>Une question à propos de Parici ?</p><a class="site-contact-address" href="mailto:camino.sunmedia@gmail.com">camino.sunmedia@gmail.com</a><p>Pour une idée, utilise <a href="/remarques.html">Remarques et idées</a>.</p>${token() ? '<form id="site-report-form"><h3>Signaler un problème</h3><label>Jeu<select name="domain"><option value="camino">Parici</option><option value="daily">Daily</option><option value="technical">Technique</option></select></label><label>Catégorie<select name="category"><option value="bug">Bug</option><option value="image">Image</option><option value="description">Description</option><option value="question">Question</option><option value="geography">Lieu</option><option value="other">Autre</option></select></label><label>Rue, carte ou date concernée<input name="entity_key" maxlength="200"></label><label>Que se passe-t-il ?<textarea name="detail" required minlength="10" maxlength="2000" rows="4"></textarea></label><button type="submit" class="site-settings-save">Envoyer le signalement</button><p role="status" id="site-report-feedback"></p></form>' : '<p>Connecte-toi pour envoyer un signalement depuis ce menu.</p>'}`;
      const reportForm=content.querySelector('#site-report-form');
      if(reportForm)reportForm.onsubmit=async event=>{event.preventDefault();const button=reportForm.querySelector('button');button.disabled=true;try{await send('/api/site/reports',Object.fromEntries(new FormData(reportForm)));reportForm.reset();content.querySelector('#site-report-feedback').textContent='Signalement enregistré. Merci !';}catch(error){content.querySelector('#site-report-feedback').textContent=error.message;}finally{button.disabled=false;}};
    }
  }
  const switchRow = (name, title, detail, enabled) =>
    `<label class="site-setting-row"><span><strong>${title}</strong><small>${detail}</small></span><input type="checkbox" name="${name}" role="switch" ${enabled ? "checked" : ""}><span class="site-switch" aria-hidden="true"></span></label>`;
  async function subscription() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      return (
        (await (
          await navigator.serviceWorker.getRegistration("/")
        )?.pushManager?.getSubscription()) || null
      );
    } catch {
      return null;
    }
  }
  async function settingsView() {
    const sound = localStorage.getItem("camino-paris-sound") !== "off",
      haptics = localStorage.getItem("camino_paris_haptics_enabled") !== "false";
    content.innerHTML = `<button class="site-drawer-back" type="button">← Menu</button><h2>Réglages</h2><p class="site-settings-intro">Ton confort de jeu et ce que tu partages.</p><section class="site-settings-section"><h3>Confort de jeu</h3>${switchRow("sound", "Sons", "Effets sonores du jeu", sound)}${switchRow("haptics", "Vibrations", "Retours tactiles sur les appareils compatibles", haptics)}</section><div id="site-account-settings"><p>Chargement des réglages du compte…</p></div><p id="site-settings-feedback" role="status"></p>`;
    const accountSettings = content.querySelector("#site-account-settings");
    const identity = token();
    if (!identity) {
      content.querySelector("#site-account-settings").innerHTML =
        '<p>Connecte-toi pour régler tes notifications et les préférences de ton compte.</p><a class="site-inbox-login" href="/?view=profile#profile">Ouvrir mon profil</a>';
      return;
    }
    try {
      const sub = await subscription();
      const state = await request(
        "/api/site/settings" +
          (sub?.endpoint
            ? "?endpoint=" + encodeURIComponent(sub.endpoint)
            : ""),
      );
      if (
        token() !== identity ||
        !drawer.open ||
        content.hidden ||
        !accountSettings.isConnected
      )
        return;
      settingsState = state;
      if (accountSettings.isConnected)
        accountSettings.innerHTML = `<section class="site-settings-section"><h3>Notifications</h3><p class="site-settings-note">Les alertes push sont facultatives sur cet appareil. La cloche reste disponible sans les activer.</p>${switchRow("announcements", "Actualités de Parici", "Messages de l’équipe dans la cloche du site", state.announcements !== false)}${switchRow("daily", "Daily", "Un rappel pour le Daily à faire", state.daily && !!sub)}</section>`;
    } catch (error) {
      content.querySelector("#site-account-settings").innerHTML =
        `<p>${escapeHtml(error.status === 401 ? "Reconnecte-toi pour retrouver les réglages de ton compte." : error.message)}</p>`;
    }
  }
  function feedback(message) {
    const el = content.querySelector("#site-settings-feedback");
    if (el) el.textContent = message;
  }
  async function enablePush(channel) {
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    )
      throw new Error(
        "Les notifications push ne sont pas disponibles sur cet appareil.",
      );
    const permission =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (permission !== "granted")
      throw new Error(
        "Autorise les notifications dans ton navigateur pour activer ce rappel.",
      );
    const config = await request("/api/notifications/public-key");
    if (!config.enabled || !config.publicKey)
      throw new Error(
        "Les notifications push sont momentanément indisponibles.",
      );
    const registration = await navigator.serviceWorker.register("/sw.js");
    let sub = await registration.pushManager.getSubscription();
    if (!sub) {
      const key = config.publicKey.replace(/-/g, "+").replace(/_/g, "/");
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(
          atob(key + "=".repeat((4 - (key.length % 4)) % 4)),
          (c) => c.charCodeAt(0),
        ),
      });
    }
    await send("/api/notifications/subscribe", { subscription: sub, channel });
    return sub;
  }
  content.addEventListener("change", async (event) => {
    const input = event.target;
    if (input.type !== "checkbox") return;
    const value = input.checked;
    if (input.name === "sound" || input.name === "haptics") {
      localStorage.setItem(
        input.name === "sound" ? "camino-paris-sound" : "camino_paris_haptics_enabled",
        input.name === "sound" ? (value ? "on" : "off") : String(value),
      );
      window.dispatchEvent(new Event("camino:preferences-change"));
      if (input.name === "haptics" && value) navigator.vibrate?.(20);
      return;
    }
    input.disabled = true;
    feedback("");
    try {
      if(input.name === "announcements") await send("/api/site/settings", {announcements:value}, "PATCH");
      if (value && input.name === "daily") await enablePush("daily");
      if (input.name === "daily") {
        if (!value) {
          const sub = await subscription();
          const result = await send("/api/notifications/unsubscribe", {
            endpoint: sub?.endpoint || "",
          });
          if (sub && !result.keepSubscription) await sub.unsubscribe();
        }
        settingsState.daily = value;
      }
      feedback(
        value ? "Notifications activées." : "Notifications désactivées.",
      );

    } catch (error) {
      input.checked = !value;
      feedback(error.message);
    } finally {
      input.disabled = false;
    }
  });
  drawer.addEventListener("click", (event) => {
    const bounds = drawer.getBoundingClientRect();
    if (
      (event.target === drawer &&
        (event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom)) ||
      event.target.closest("[data-close-drawer]")
    )
      closeDrawer();
    const page = event.target.closest("[data-drawer-page]");
    if (page) openDrawer(page.dataset.drawerPage);
    if (event.target.closest(".site-drawer-back")) {
      drawerPage = null;
      content.hidden = true;
      drawer.querySelector(".site-drawer-links").hidden = false;
    }
  });
  drawer.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDrawer();
  });
  drawer.addEventListener("close", () => {
    document.documentElement.classList.remove("site-overlay-open");
    menuButton.setAttribute("aria-expanded", "false");
    if (popup.hidden) menuButton.focus({ preventScroll: true });
  });
  menuButton.addEventListener("click", () => openDrawer());
  bell.addEventListener("click", () =>
    popup.hidden ? openNotifications() : closeNotifications(),
  );
  popup.querySelector("[data-close-notifications]").onclick = () =>
    closeNotifications();
  popup.querySelector(".site-notification-settings").onclick = () =>
    openDrawer("settings");
  popup.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeNotifications();
    }
    if (event.key === "Tab") {
      const links = [...popup.querySelectorAll("a,button")];
      const first = links[0],
        last = links.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.addEventListener("click", (event) => {
    if (
      !popup.hidden &&
      !popup.contains(event.target) &&
      !bell.contains(event.target)
    )
      closeNotifications(false);
  });
  window.addEventListener("resize", () => {
    if (!popup.hidden) positionPopup();
  });
  document.addEventListener(
    "scroll",
    () => {
      if (!popup.hidden) {
        if (bell.getBoundingClientRect().top < 0) closeNotifications(false);
        else positionPopup();
      }
    },
    { passive: true, capture: true },
  );
  window.addEventListener("storage", () => {
    void refreshNotifications();
    if (drawer.open && drawerPage === "settings") void settingsView();
  });
  window.addEventListener("camino:auth-change", () => {
    void refreshNotifications();
    if (drawer.open && drawerPage === "settings") void settingsView();
  });
  window.addEventListener("focus", () => void refreshNotifications());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refreshNotifications();
  });
  window.CaminoShell = {
    openNotifications,
    openSettings: () => openDrawer("settings"),
    refreshNotifications,
  };
  void refreshNotifications();
  setInterval(() => {
    if (!document.hidden) {
      void refreshNotifications();
      if (token() && /^\/collect/.test(location.pathname))
        window.dispatchEvent(new Event("collect:quota-refresh"));
    }
  }, 20000);
  if (
    params.get("notifications") === "1" ||
    params.get("tab") === "notifications"
  )
    void openNotifications();
  if (params.get("settings") === "1") openDrawer("settings");
}
