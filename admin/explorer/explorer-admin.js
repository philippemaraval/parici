(function () {
  "use strict";

  const API_ORIGIN =
    window.CaminoRuntimeConfig?.apiUrl || "http://localhost:3000";
  const API_BASE = `${API_ORIGIN}/api/explorer`;
  const STORAGE_KEY = "camino_paris_editor_user";
  const fields = {};
  let riddles = [];
  let streetSuggestions = [];
  let dirty = false;
  let editingRevision = null;
  let searchRequest = 0;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindFields();
    bindEvents();
    initPreview();
    try {
      const session = await ensureEditorAccess();
      showAuthenticatedSession(session);
      renderPreview();
      await loadRiddles();
      setGlobalStatus("Les énigmes Explorer sont à jour.", "success");
    } catch (error) {
      showAuthenticationRequired();
      setGlobalStatus(`Accès impossible : ${error.message}`, "error");
    }
  }

  let previewMap, previewCircle, simulatedMarker, previewStreet, streetFeatures;
  let simulatedPosition = null;
  function initPreview() {
    if (window.L) {
      previewMap = L.map("explorer-editor-map").setView([48.859, 2.361], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(previewMap);
      previewMap.on("click", (event) => {
        simulatedPosition = event.latlng;
        renderPreview();
      });
    }
    fields["explorer-admin-form"].addEventListener("input", () =>
      renderPreview(),
    );
    document.getElementById("explorer-simulate").onclick = async () => {
      const result = document.getElementById("explorer-simulation-result");
      if (!simulatedPosition) {
        result.textContent =
          "Renseignez les coordonnées et choisissez une position sur la carte.";
        return;
      }
      const get = (id) => fields[id].value;
      try {
        const payload = await apiFetch("/admin/simulate", {
          method: "POST",
          body: JSON.stringify({
            riddle: {
              way_id: Number(get("explorer-way-id")),
              street_name_clean: get("explorer-street-name"),
              latitude: nullableNumber(get("explorer-latitude")),
              longitude: nullableNumber(get("explorer-longitude")),
              riddle_text: get("explorer-riddle-text-admin"),
              hint_text: get("explorer-hint-text-admin"),
              explanation_text: get("explorer-explanation-text-admin"),
              image_url: get("explorer-image-url"),
            },
            answer: {
              latitude: simulatedPosition.lat,
              longitude: simulatedPosition.lng,
              ocr_text: document.getElementById("explorer-simulation-ocr")
                .value,
            },
          }),
        });
        result.textContent = `${payload.valid ? "Validation réussie" : "Validation refusée"} · Plaque ${payload.plaqueMatches ? "reconnue" : "non reconnue"} · Distance ${payload.distanceMeters ?? "inconnue"} m. Aucun score enregistré.`;
      } catch (error) {
        result.textContent = error.message;
      }
    };
    fetch(API_ORIGIN + "/api/streets-light")
      .then((response) => response.json())
      .then((payload) => {
        streetFeatures = payload.features || [];
        renderPreview();
      })
      .catch(() => {});
    renderPreview();
  }
  function renderPreview() {
    for (const [target, field] of [
      ["riddle", "riddle-text-admin"],
      ["hint", "hint-text-admin"],
      ["explanation", "explanation-text-admin"],
    ])
      document.getElementById("explorer-preview-" + target).textContent =
        fields["explorer-" + field].value;
    const image = document.getElementById("explorer-preview-image"),
      url = fields["explorer-image-url"].value.trim();
    image.hidden = !/^(https?:\/\/|\/[^/])/.test(url);
    if (!image.hidden) image.src = new URL(url, API_ORIGIN).href;
    if (!previewMap) return;
    previewMap.invalidateSize();
    const lat = nullableNumber(fields["explorer-latitude"].value),
      lng = nullableNumber(fields["explorer-longitude"].value);
    if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      return;
    const point = L.latLng(lat, lng);
    if (!previewCircle || previewCircle.getLatLng().distanceTo(point) > 1) {
      previewCircle?.remove();
      previewCircle = L.circle(point, { radius: 100, color: "#23814d" }).addTo(
        previewMap,
      );
      previewMap.setView(point, 17);
      simulatedPosition = point;
    }
    simulatedMarker?.remove();
    simulatedMarker = L.circleMarker(simulatedPosition || point, {
      radius: 7,
      color: "#12297a",
      fillOpacity: 1,
    }).addTo(previewMap);
    previewStreet?.remove();
    if (streetFeatures) {
      const name = fields["explorer-street-name"].value;
      previewStreet = L.geoJSON(
        streetFeatures.filter((feature) => feature.properties?.name === name),
        { style: { color: "#23814d", weight: 5 } },
      ).addTo(previewMap);
    }
  }

  function bindFields() {
    [
      "explorer-admin-form",
      "explorer-riddle-id",
      "explorer-street-search",
      "explorer-street-options",
      "explorer-way-id",
      "explorer-street-name",
      "explorer-latitude",
      "explorer-longitude",
      "explorer-riddle-text-admin",
      "explorer-hint-text-admin",
      "explorer-explanation-text-admin",
      "explorer-image-url",
      "explorer-image-file",
      "explorer-admin-feedback",
      "explorer-admin-list",
      "explorer-admin-reset",
      "explorer-global-status",
      "explorer-auth-required",
      "explorer-admin-content",
      "explorer-session-user",
      "explorer-session-role",
      "explorer-refresh",
      "explorer-logout",
      "explorer-form-title",
      "explorer-riddle-count",
      "manage-users-link",
    ].forEach((id) => {
      fields[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    fields["explorer-admin-form"].addEventListener("submit", saveRiddle);
    fields["explorer-image-file"].addEventListener("change", uploadImage);
    fields["explorer-admin-reset"].addEventListener("click", () => resetForm());
    fields["explorer-admin-form"].addEventListener("input", () => {
      dirty = true;
    });
    window.addEventListener("beforeunload", (event) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    document
      .getElementById("explorer-filter")
      .addEventListener("input", renderList);
    document
      .getElementById("explorer-show-archived")
      .addEventListener("change", renderList);
    fields["explorer-street-search"].addEventListener(
      "input",
      debounce(searchStreets, 250),
    );
    fields["explorer-street-search"].addEventListener(
      "change",
      applySelectedStreet,
    );
    fields["explorer-refresh"].addEventListener("click", refreshRiddles);
    fields["explorer-logout"].addEventListener("click", logout);
  }

  async function ensureEditorAccess() {
    const token = getAuthToken();
    if (!token) {
      throw new Error("connectez-vous depuis le tableau de bord.");
    }
    const response = await window.fetch(`${API_ORIGIN}/api/editor/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.canEdit) {
      throw new Error(
        payload.error || "ce compte ne dispose pas des droits d’édition.",
      );
    }
    return payload;
  }

  function showAuthenticatedSession(session) {
    fields["explorer-auth-required"].classList.add("hidden");
    fields["explorer-admin-content"].classList.remove("hidden");
    fields["explorer-session-user"].textContent = session.username || "-";
    fields["explorer-session-role"].textContent = formatRole(session.role);
    fields["manage-users-link"].classList.toggle(
      "hidden",
      !session.canManageUsers,
    );
  }

  function showAuthenticationRequired() {
    fields["explorer-admin-content"].classList.add("hidden");
    fields["explorer-auth-required"].classList.remove("hidden");
  }

  function formatRole(role) {
    return (
      {
        admin: "Administrateur",
        editor: "Éditeur",
        player: "Joueur",
      }[role] ||
      role ||
      "Joueur"
    );
  }

  async function refreshRiddles() {
    const button = fields["explorer-refresh"];
    button.disabled = true;
    button.textContent = "Actualisation…";
    setGlobalStatus("Actualisation des énigmes…", "info");
    try {
      await loadRiddles();
      setGlobalStatus("Les énigmes Explorer sont à jour.", "success");
    } catch (error) {
      setGlobalStatus(`Actualisation impossible : ${error.message}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Actualiser les énigmes";
    }
  }

  async function logout() {
    if (dirty && !window.confirm("Quitter sans enregistrer votre saisie ?"))
      return;
    try {
      await window.fetch(`${API_ORIGIN}/api/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem("camino_paris_editor_token");
    window.location.assign("/admin/");
  }

  async function loadRiddles() {
    const payload = await apiFetch("/admin/riddles");
    riddles = Array.isArray(payload.riddles) ? payload.riddles : [];
    renderList();
  }

  async function searchStreets() {
    const requestId = ++searchRequest;
    const query = fields["explorer-street-search"].value.trim();
    if (query.length < 2) {
      streetSuggestions = [];
      fields["explorer-street-options"].replaceChildren();
      return;
    }
    try {
      const payload = await apiFetch(
        `/admin/streets?q=${encodeURIComponent(query)}`,
      );
      if (requestId !== searchRequest) return;
      streetSuggestions = Array.isArray(payload.streets) ? payload.streets : [];
      fields["explorer-street-options"].innerHTML = streetSuggestions
        .map(
          (street) => `<option value="${escapeHtml(street.label)}"></option>`,
        )
        .join("");
    } catch (error) {
      if (requestId === searchRequest)
        setFeedback(`Recherche impossible : ${error.message}`, "error");
    }
  }

  function applySelectedStreet() {
    const label = fields["explorer-street-search"].value.trim();
    const street = streetSuggestions.find(
      (candidate) => candidate.label === label,
    );
    if (!street) return;
    fields["explorer-way-id"].value = street.way_id || "";
    fields["explorer-street-name"].value =
      street.street_name_clean || street.label || "";
    fields["explorer-latitude"].value = street.latitude ?? "";
    fields["explorer-longitude"].value = street.longitude ?? "";
    renderPreview();
  }

  async function saveRiddle(event) {
    event.preventDefault();
    const submitButton =
      event.submitter ||
      fields["explorer-admin-form"].querySelector('[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Enregistrement…";
    const id = fields["explorer-riddle-id"].value.trim();
    const payload = {
      expectedRevision: editingRevision,
      way_id: Number(fields["explorer-way-id"].value),
      street_name_clean: fields["explorer-street-name"].value.trim(),
      latitude: nullableNumber(fields["explorer-latitude"].value),
      longitude: nullableNumber(fields["explorer-longitude"].value),
      riddle_text: fields["explorer-riddle-text-admin"].value.trim(),
      hint_text: fields["explorer-hint-text-admin"].value.trim(),
      explanation_text: fields["explorer-explanation-text-admin"].value.trim(),
      image_url: fields["explorer-image-url"].value.trim(),
    };
    const method = id ? "PUT" : "POST";
    const path = id
      ? `/admin/riddles/${encodeURIComponent(id)}`
      : "/admin/riddles";
    try {
      await apiFetch(path, { method, body: JSON.stringify(payload) });
      setFeedback("L’énigme a été enregistrée.", "success");
      resetForm(true);
      await loadRiddles();
    } catch (error) {
      setFeedback(`Enregistrement impossible : ${error.message}`, "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Enregistrer l’énigme";
    }
  }

  async function uploadImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setFeedback("L’image doit peser au maximum 5 Mo.", "error");
      return;
    }
    event.target.disabled = true;
    setFeedback("Import de l’image en cours…");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const payload = await apiFetch("/admin/images", {
        method: "POST",
        body: JSON.stringify({ file_name: file.name, data_url: dataUrl }),
      });
      fields["explorer-image-url"].value = payload.image_url
        ? new URL(payload.image_url, API_ORIGIN).href
        : "";
      dirty = true;
      setFeedback(
        "L’image a été importée et son adresse a été renseignée.",
        "success",
      );
    } catch (error) {
      setFeedback(`Import impossible : ${error.message}`, "error");
    } finally {
      event.target.disabled = false;
    }
  }

  async function deleteRiddle(id, button) {
    const riddle = riddles.find((item) => String(item.id) === String(id));
    const restore = Boolean(riddle.archived_at);
    if (
      !window.confirm(
        restore
          ? `Réactiver « ${riddle.street_name_clean} » ?`
          : `Archiver « ${riddle.street_name_clean} » ? Les progressions de ${riddle.player_count || 0} joueur(s) seront conservées.`,
      )
    )
      return;
    button.disabled = true;
    try {
      await apiFetch(
        `/admin/riddles/${encodeURIComponent(id)}${restore ? "/restore" : ""}`,
        {
          method: restore ? "POST" : "DELETE",
          body: JSON.stringify({ expectedRevision: riddle.revision }),
        },
      );
      await loadRiddles();
      setFeedback(
        restore
          ? "L’énigme a été réactivée."
          : "L’énigme a été archivée ; les progressions sont conservées.",
        "success",
      );
    } catch (error) {
      setFeedback(`Action impossible : ${error.message}`, "error");
    } finally {
      button.disabled = false;
    }
  }

  function editRiddle(id) {
    if (dirty && !window.confirm("Remplacer la saisie non enregistrée ?"))
      return;
    dirty = false;
    const riddle = riddles.find((item) => String(item.id) === String(id));
    if (!riddle) return;
    editingRevision = riddle.revision;
    setTimeout(renderPreview, 0);
    fields["explorer-riddle-id"].value = riddle.id;
    fields["explorer-way-id"].value = riddle.way_id;
    fields["explorer-street-name"].value = riddle.street_name_clean;
    fields["explorer-latitude"].value = riddle.latitude ?? "";
    fields["explorer-longitude"].value = riddle.longitude ?? "";
    fields["explorer-riddle-text-admin"].value = riddle.riddle_text;
    fields["explorer-hint-text-admin"].value = riddle.hint_text;
    fields["explorer-explanation-text-admin"].value =
      riddle.explanation_text || "";
    fields["explorer-image-url"].value = riddle.image_url;
    fields["explorer-street-search"].value = riddle.street_name_clean;
    fields["explorer-form-title"].textContent =
      `Modifier « ${riddle.street_name_clean} »`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm(force = false) {
    if (
      !force &&
      dirty &&
      !window.confirm("Effacer la saisie non enregistrée ?")
    )
      return;
    dirty = false;
    editingRevision = null;
    fields["explorer-admin-form"].reset();
    fields["explorer-riddle-id"].value = "";
    fields["explorer-form-title"].textContent = "Créer une énigme";
  }

  function renderList() {
    fields["explorer-riddle-count"].textContent =
      `${riddles.length} énigme${riddles.length > 1 ? "s" : ""}`;
    if (!riddles.length) {
      fields["explorer-admin-list"].innerHTML =
        '<p class="explorer-admin-list-empty">Aucune énigme configurée.</p>';
      return;
    }
    const query = document
      .getElementById("explorer-filter")
      .value.trim()
      .toLocaleLowerCase("fr");
    const showArchived = document.getElementById(
      "explorer-show-archived",
    ).checked;
    const filtered = riddles.filter(
      (riddle) =>
        (showArchived || !riddle.archived_at) &&
        `${riddle.street_name_clean} ${riddle.riddle_text}`
          .toLocaleLowerCase("fr")
          .includes(query),
    );
    fields["explorer-riddle-count"].textContent =
      `${filtered.length} énigmes affichées sur ${riddles.length}`;
    fields["explorer-admin-list"].innerHTML = filtered
      .map(
        (riddle) => `
        <article class="explorer-admin-row">
          <div>
            <strong>${escapeHtml(riddle.street_name_clean)}</strong><small>${riddle.archived_at ? " · Archivée" : " · Active"} · ${Number(riddle.player_count || 0)} joueur(s)</small>
            <p>${escapeHtml(String(riddle.riddle_text).slice(0, 180))}</p>
          </div>
          <div class="explorer-actions">
            <button class="explorer-btn" data-edit="${riddle.id}" type="button">Modifier</button>
            <button class="explorer-btn btn-danger-outline" data-delete="${riddle.id}" type="button">${riddle.archived_at ? "Réactiver" : "Archiver"}</button>
          </div>
        </article>`,
      )
      .join("");
    fields["explorer-admin-list"]
      .querySelectorAll("[data-edit]")
      .forEach((button) => {
        button.addEventListener("click", () => editRiddle(button.dataset.edit));
      });
    fields["explorer-admin-list"]
      .querySelectorAll("[data-delete]")
      .forEach((button) => {
        button.addEventListener("click", () =>
          deleteRiddle(button.dataset.delete, button),
        );
      });
  }

  async function apiFetch(path, options = {}) {
    const token = getAuthToken();
    const response = await window.fetch(`${API_BASE}${path}`, {
      ...options,
      signal: AbortSignal.timeout(45000),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return response.json();
  }

  function getAuthToken() {
    const sessionToken =
      sessionStorage.getItem("camino_paris_editor_token") ||
      sessionStorage.getItem("camino_paris_session_token");
    if (sessionToken) return sessionToken;
    for (const key of [
      STORAGE_KEY,
      "camino_paris_user",
      "caminoCurrentUser",
      "currentUser",
      "camino_current_user",
    ]) {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        if (value?.token) return value.token;
      } catch (error) {
        // Ignore corrupted local auth caches.
      }
    }
    return "";
  }

  function nullableNumber(value) {
    if (String(value).trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function setFeedback(message, type = "info") {
    fields["explorer-admin-feedback"].textContent = message;
    fields["explorer-admin-feedback"].className =
      `explorer-feedback explorer-feedback--${type}`;
  }

  function setGlobalStatus(message, type = "info") {
    fields["explorer-global-status"].textContent = message;
    fields["explorer-global-status"].className = `status status--${type}`;
  }

  function debounce(fn, delay) {
    let timeout = null;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    };
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
