(async function () {
  "use strict";
  const { avatarMarkup } = await import("/src/public/js/camino-art.js");

  const identity = (() => {try{return JSON.parse(localStorage.getItem("camino_paris_user") || "null")?.id || "guest";}catch{return "guest";}})();
  const STORAGE_KEY = "parici_explorer_state_v1:" + identity;
  const QUEUE_KEY = "parici_explorer_sync_queue:" + identity;
  const COMPLETED_KEY = "parici_explorer_completed:" + identity;
  const API_ORIGIN = window.CaminoRuntimeConfig?.apiUrl || "http://localhost:3000";
  const API_BASE = `${API_ORIGIN}/api/explorer`;
  const STARTING_RULE_VERSION = "nearest-street-v1";
  const RIDDLE_TIME_LIMIT_SECONDS = 20 * 60;
  const STREET_PROXIMITY_RADIUS_METERS = 100;
  const EXPLORER_IMAGE_MANIFEST_URL = "/data/explorer_images/manifest.json";
  const EXPLORER_DEFAULT_IMAGE_URL = "/src/public/img/explorer-default.svg";
  const TESSERACT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const EXPLORER_LOAD_TIMEOUT_MS = 15000;
  const STOP_WORDS = new Set([
    "RUE",
    "DE",
    "DES",
    "DU",
    "LA",
    "LE",
    "LES",
    "L",
    "D",
    "BOULEVARD",
    "AVENUE",
    "PLACE",
    "SQUARE",
    "COURS",
    "QUAI",
    "PROMENADE",
    "MONTEE",
  ]);
  const AMBIGUOUS_SINGLE_NAME_TOKENS = new Set(["GRAND", "GRANDE", "SAINT", "SAINTE"]);
  const STREET_GEOMETRY_ALIASES = new Map();

  const els = {};
  let state = loadState();
  let tickInterval = null;
  let leaderboardInterval = null;
  let streetGeometryIndexPromise = null;
  let ocrWorkerPromise = null;
  let tesseractScriptPromise = null;
  let explorerImageManifest = [];

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
  window.addEventListener("online", flushSyncQueue);
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "CAMINO_EXPLORER_SYNC") flushSyncQueue();
  });

  function isSmartphone() {
    if (navigator.userAgentData?.mobile === true) return true;
    return /Android.*Mobile|iPhone|iPod|IEMobile|Opera Mini|webOS|BlackBerry/i.test(
      navigator.userAgent || "",
    );
  }

  async function init() {
    bindElements();
    navigator.serviceWorker?.register("/sw.js").catch(()=>{});
    if (!isSmartphone()) {
      document.body.classList.add("explorer-device-blocked");
      document.querySelector(".explorer-app")?.setAttribute("data-view", "device-blocked");
      els["explorer-mobile-required"]?.classList.remove("hidden");
      return;
    }
    try {


      bindEvents();
      loadExplorerLeaderboard();
      startLeaderboardRefresh();
      loadExplorerImageManifest();
      await loadRiddles();
      await loadServerProgress();
      restoreCompletedState();
      if (state.started && !state.completed) {
        await ensureCurrentRiddle();
      }
    } catch (error) {
      console.error("Explorer initialization failed:", error?.message || error);
      setFeedback("Le chargement a rencontré un problème. Réessayez dans quelques instants.", "error");
    } finally {
      render();
      flushSyncQueue();
    }
  }

  function bindElements() {
    [
      "explorer-score",
      "explorer-solved",
      "explorer-total",
      "explorer-loading",
      "explorer-mobile-required",
      "explorer-empty",
      "explorer-start",
      "explorer-start-btn",
      "explorer-riddle",
      "explorer-discovery",
      "explorer-discovery-title",
      "explorer-discovery-text",
      "explorer-continue-btn",
      "explorer-complete",
      "explorer-riddle-image",
      "explorer-riddle-image-avif",
      "explorer-riddle-image-webp",
      "explorer-riddle-text",
      "explorer-hint",
      "explorer-hint-btn",
      "explorer-photo-input",
      "explorer-feedback",
      "explorer-timer",
      "explorer-final-score",
      "explorer-final-time",
      "explorer-album",
      "explorer-export-album",
      "explorer-leaderboard",
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  async function loadExplorerLeaderboard() {
    const root = els["explorer-leaderboard"];
    if (!root) return;
    try {
      const response = await fetch(`${API_BASE}/leaderboard?limit=25`, {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rows = Array.isArray(payload.leaderboard) ? payload.leaderboard : [];
      if (!rows.length) {
        root.textContent = "Aucun score Explorer enregistré pour le moment.";
        return;
      }
      const body = rows.map((row, index) => {
        const rank = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : String(index + 1);
        const minutes = Math.round((Number(row.total_walking_time_seconds) || 0) / 60);
        return `<tr${String(row.username || "").trim() === getStoredUsername().trim() ? ' class="leaderboard-current-player"' : ""}><td>${rank}</td><td><span class="explorer-leaderboard-avatar">${avatarMarkup(row.avatar)}</span>${escapeHtml(row.username || "Anonyme")}</td><td>${Number(row.total_score) || 0}</td><td>${minutes} min</td></tr>`;
      }).join("");
      root.innerHTML = `<table><thead><tr><th>#</th><th>Joueur</th><th>Score</th><th>Temps</th></tr></thead><tbody>${body}</tbody></table>`;
    } catch (error) {
      root.textContent = "Classement Explorer indisponible pour le moment.";
    }
  }

  function startLeaderboardRefresh() {
    clearInterval(leaderboardInterval);
    leaderboardInterval = setInterval(loadExplorerLeaderboard, 15000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") loadExplorerLeaderboard();
    });
  }

  function escapeHtml(value) {
    const span = document.createElement("span");
    span.textContent = String(value ?? "");
    return span.innerHTML;
  }

  function bindEvents() {
    els["explorer-start-btn"]?.addEventListener("click", startGame);
    els["explorer-hint-btn"]?.addEventListener("click", showHint);
    els["explorer-photo-input"]?.addEventListener("change", handlePhotoSubmit);
    els["explorer-continue-btn"]?.addEventListener("click", continueAfterExplanation);
    els["explorer-export-album"]?.addEventListener("click", exportAlbum);
  }

  async function startGame() {
    if (state.started || state.completed || !state.riddles.length) return;
    if (!getAuthToken()) {setFeedback("Connectez-vous depuis le profil pour enregistrer votre exploration.","warning");return;}
    const button = els["explorer-start-btn"];
    if (button) {
      button.disabled = true;
      button.textContent = "Préparation de la recherche…";
    }
    try {
      await ensureCurrentRiddle();
      state.started = Boolean(getCurrentRiddle());
      saveState();
      setFeedback("");
      render();
    } catch (error) {
      setFeedback("La recherche n’a pas pu démarrer. Vérifiez votre connexion puis réessayez.", "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Commencer la recherche";
      }
    }
  }

  async function loadRiddles() {
    try {
      const response = await fetchWithTimeout(`${API_BASE}/riddles`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const active = state.started && !state.solved[String(state.currentRiddleId)] ? state.riddles.find(r=>String(r.id)===String(state.currentRiddleId)) : null;
      state.riddles = Array.isArray(payload.riddles) ? payload.riddles : [];
      if(active) {const index=state.riddles.findIndex(r=>String(r.id)===String(active.id));if(index<0)state.riddles.push(active);else state.riddles[index]=active;}
      saveState();
    } catch (error) {
      state.riddles = Array.isArray(state.riddles) ? state.riddles : [];
      setFeedback("Mode hors-ligne : énigmes chargées depuis le cache local.", "warning");
    }
  }

  async function loadServerProgress() {
    const token=getAuthToken();if(!token)return;
    try {
      const response=await fetchWithTimeout(`${API_BASE}/progress`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if(!response.ok)throw new Error('Progression indisponible');
      const result=await response.json();
      for(const row of result.progress||[])state.solved[String(row.riddle_id)]={...row,server_verified:true};
      if(state.solved[String(state.currentRiddleId)]){state.currentRiddleId=null;state.currentStartedAt=null;}
      if(result.profile?.completed){state.completed=true;setLocalStorageItem(COMPLETED_KEY,'1');}
      saveState();
    }catch{setFeedback('Progression locale conservée ; synchronisation à la reconnexion.','warning');}
  }

  async function loadExplorerImageManifest() {
    try {
      const response = await fetchWithTimeout(EXPLORER_IMAGE_MANIFEST_URL, {
        cache: "default",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      explorerImageManifest = Array.isArray(payload.images) ? payload.images : [];
      refreshCurrentRiddleImage();
    } catch (error) {
      explorerImageManifest = [];
      console.warn("Explorer image manifest unavailable:", error?.message || error);
    }
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXPLORER_LOAD_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal, credentials: "include" });
    } finally {
      clearTimeout(timeout);
    }
  }

  function restoreCompletedState() {
    if (localStorage.getItem(COMPLETED_KEY) === "1") {
      state.completed = true;
    }
  }

  async function ensureCurrentRiddle() {
    if (state.pendingExplanationRiddleId) {
      return;
    }
    if (shouldPickClosestRiddle() && state.startingRuleVersion !== STARTING_RULE_VERSION) {
      state.currentRiddleId = null;
      state.currentStartedAt = null;
      state.startingRuleVersion = STARTING_RULE_VERSION;
      saveState();
      await selectNextRiddle();
      return;
    }
    const currentRiddle = getCurrentRiddle();
    if (!currentRiddle) {
      await selectNextRiddle();
    } else { enqueueStep("start",currentRiddle.id); }
  }

  async function selectNextRiddle() {
    if (!state.riddles.length) {
      render();
      return;
    }
    if (state.currentRiddleId && !state.solved[String(state.currentRiddleId)]) {
      setFeedback("Trouvez la rue en cours pour débloquer l’énigme suivante.", "info");
      render();
      return;
    }

    const remaining = state.riddles.filter((riddle) => !state.solved[String(riddle.id)]);
    if (!remaining.length) {
      completeGame();
      return;
    }

    const choice = shouldPickClosestRiddle()
      ? await pickClosestRiddle(remaining)
      : await pickNearbyRandomRiddle(remaining);

    enqueueStep("start", choice.id);
    state.currentRiddleId = choice.id;
    state.currentStartedAt = new Date().toISOString();
    state.currentHintsUsed = 0;
    saveState();
    render();
  }

  function shouldPickClosestRiddle() {
    return !Object.keys(state.solved || {}).length;
  }

  async function pickClosestRiddle(remaining) {
    const position = await getCurrentPositionSafe();
    if (!position) return remaining[Math.floor(Math.random() * remaining.length)];

    const sorted = await rankRiddlesByDistance(position, remaining);
    return window.CaminoExplorerSelection.choose(sorted, true) || remaining[0];
  }

  async function pickNearbyRandomRiddle(remaining) {
    const position = await getCurrentPositionSafe();
    if (!position) return remaining[Math.floor(Math.random() * remaining.length)];

    const sorted = await rankRiddlesByDistance(position, remaining);
    return window.CaminoExplorerSelection.choose(sorted, false) || sorted[0].riddle;
  }

  async function rankRiddlesByDistance(position, riddles) {
    const ranked = await Promise.all(riddles.map(async (riddle) => ({
      riddle,
      distance: await getRiddleDistanceFromPosition(position, riddle),
    })));
    ranked.sort((a, b) => a.distance - b.distance);
    return ranked;
  }

  function showHint() {
    const riddle = getCurrentRiddle();
    if (!riddle) return;
    if (state.currentHintsUsed > 0) return;
    if (!window.confirm("Afficher l’indice retirera 15 points à cette étape.")) return;
    enqueueStep("hint", riddle.id);
    state.currentHintsUsed = 1;
    saveState();
    render();
  }

  async function handlePhotoSubmit(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const riddle = getCurrentRiddle();
    if (!riddle) return;

    event.target.disabled = true;
    els["explorer-riddle"]?.setAttribute("aria-busy", "true");
    setFeedback("Photo reçue. Analyse de la plaque en cours…", "info");
    let dataUrl;
    let recognition;
    try {
      dataUrl = await readFileAsDataUrl(file);
      recognition = await recognizeStreetFromPhoto(dataUrl, riddle.street_name_clean);
    } catch (error) {
      console.warn("Explorer OCR failed:", error?.message || error);
      setFeedback("Analyse impossible. Reprenez une photo nette, de face et rapprochée de la plaque.", "error");
      event.target.disabled = false;
      els["explorer-riddle"]?.removeAttribute("aria-busy");
      return;
    }

    const { match, ocrText } = recognition;
    if (match.ok) {
      setFeedback("Plaque reconnue. Vérification de votre position en cours…", "info");
      const proximity = await getRiddleProximity(riddle);
      if (!proximity.ok) {
        setFeedback(`Plaque reconnue, mais ${lowercaseFirst(proximity.message)}`, "error");
        event.target.disabled = false;
        els["explorer-riddle"]?.removeAttribute("aria-busy");
        return;
      }

      setFeedback("Plaque et position reconnues. Rue validée.", "success");
      solveCurrentRiddle({
        photoDataUrl: "",
        ocrText,
        normalizedOcr: match.normalizedOcr,
        distance: match.distance,
        locationDistanceMeters: proximity.distanceMeters,
        locationAccuracyMeters: proximity.accuracyMeters,
        latitude: proximity.latitude, longitude: proximity.longitude,
      });
      storeSolvedPhoto(riddle.id, dataUrl);
      event.target.disabled = false;
      els["explorer-riddle"]?.removeAttribute("aria-busy");
      return;
    }

    setFeedback("Plaque non reconnue. Cadrez uniquement la plaque, de face, avec le nom bien lisible.", "error");
    event.target.disabled = false;
    els["explorer-riddle"]?.removeAttribute("aria-busy");
  }

  function solveCurrentRiddle(details) {
    const riddle = getCurrentRiddle();
    const now = new Date();
    const elapsedSeconds = Math.min(
      RIDDLE_TIME_LIMIT_SECONDS,
      Math.max(0, Math.round((now - new Date(state.currentStartedAt)) / 1000)),
    );
    const pointsEarned = computeStepPoints(elapsedSeconds, state.currentHintsUsed);
    const progress = {
      riddle_id: riddle.id,
      started_at: state.currentStartedAt,
      solved_at: now.toISOString(),
      hints_used: state.currentHintsUsed,
      points_earned: pointsEarned,
      walking_time_seconds: elapsedSeconds,
      ocr_text: details.ocrText,
      normalized_ocr_text: details.normalizedOcr,
      levenshtein_distance: details.distance,
      location_distance_meters: details.locationDistanceMeters,
      location_accuracy_meters: details.locationAccuracyMeters,
      latitude: details.latitude, longitude: details.longitude,
      client_validated: true,
    };

    state.solved[String(riddle.id)] = progress;
    if (details.photoDataUrl) state.photos[String(riddle.id)] = details.photoDataUrl;
    state.currentRiddleId = null;
    state.currentStartedAt = null;
    state.currentHintsUsed = 0;
    state.pendingExplanationRiddleId = riddle.id;
    saveState();
    clearInterval(tickInterval);
    tickInterval = null;
    render();
    enqueueSync(progress);
  }

  function continueAfterExplanation() {
    state.pendingExplanationRiddleId = null;
    saveState();
    const remaining = state.riddles.filter((item) => !state.solved[String(item.id)]);
    if (!remaining.length) {
      completeGame();
      return;
    }
    selectNextRiddle();
  }

  function completeGame() {
    state.completed = true;
    state.completedAt = state.completedAt || new Date().toISOString();
    setLocalStorageItem(COMPLETED_KEY, "1");
    saveState();
    enqueueFinalScore();
    render();
  }

  function computeStepPoints(elapsedSeconds, hintsUsed) {
    const elapsedMinutes = Math.ceil(elapsedSeconds / 60);
    const base = 50 + Math.max(0, 20 - elapsedMinutes);
    return Math.max(0, base - (hintsUsed ? 15 : 0));
  }

  function render() {
    const solvedItems = Object.values(state.solved || {});
    const totalScore = solvedItems.reduce((sum, item) => sum + (Number(item.points_earned) || 0), 0);
    els["explorer-score"].textContent = String(totalScore);
    const syncStatus=document.getElementById('explorer-sync-status');
    if(syncStatus){syncStatus.textContent=solvedItems.some(item=>!item.server_verified)?'Résultats en attente de confirmation.':'Résultats confirmés par le serveur.';}

    els["explorer-solved"].textContent = String(solvedItems.length);
    els["explorer-total"].textContent = String(state.riddles.length);

    toggle(els["explorer-loading"], false);
    toggle(els["explorer-empty"], !state.completed && state.riddles.length === 0);
    toggle(els["explorer-start"], !state.completed && state.riddles.length > 0 && !state.started);
    toggle(els["explorer-riddle"], !state.completed && state.started && state.riddles.length > 0 && !state.pendingExplanationRiddleId);
    toggle(els["explorer-discovery"], !state.completed && Boolean(state.pendingExplanationRiddleId));
    toggle(els["explorer-complete"], state.completed);

    if (state.completed) {
      renderComplete(totalScore);
    } else if (state.pendingExplanationRiddleId) {
      renderExplanation();
    } else {
      renderRiddle();
    }
  }

  function renderRiddle() {
    const riddle = getCurrentRiddle();
    if (!riddle) return;
    refreshCurrentRiddleImage();
    els["explorer-riddle-text"].textContent = riddle.riddle_text;
    els["explorer-hint"].textContent = riddle.hint_text;
    toggle(els["explorer-hint"], state.currentHintsUsed > 0);
    if (els["explorer-hint-btn"]) {
      const hintIsVisible = state.currentHintsUsed > 0;
      els["explorer-hint-btn"].disabled = hintIsVisible;
      els["explorer-hint-btn"].textContent = hintIsVisible
        ? "Indice affiché (−15 points)"
        : "Afficher l’indice (−15 points)";
    }
    startTimer();
  }

  function refreshCurrentRiddleImage() {
    const riddle = getCurrentRiddle();
    if (!riddle) return;
    const image = els["explorer-riddle-image"];
    if (!image) return;
    const localImage = findExplorerImage(riddle.street_name_clean);
    const avifSource = els["explorer-riddle-image-avif"];
    const webpSource = els["explorer-riddle-image-webp"];
    if (avifSource) avifSource.srcset = buildResponsiveSrcset(localImage?.sources?.avif);
    if (webpSource) webpSource.srcset = buildResponsiveSrcset(localImage?.sources?.webp);
    image.onerror = () => {
      image.onerror = null;
      if (avifSource) avifSource.srcset = "";
      if (webpSource) webpSource.srcset = "";
      image.src = riddle.image_url || EXPLORER_DEFAULT_IMAGE_URL;
    };
    image.src = localImage?.url || riddle.image_url || EXPLORER_DEFAULT_IMAGE_URL;
    image.sizes = "(max-width: 700px) 100vw, 700px";
    image.alt = `Image historique : ${riddle.street_name_clean}`;
  }

  function buildResponsiveSrcset(variants) {
    if (!Array.isArray(variants)) return "";
    return variants
      .filter((variant) => variant?.src && Number(variant.width) > 0)
      .map((variant) => `${variant.src} ${variant.width}w`)
      .join(", ");
  }

  function findExplorerImage(streetName) {
    const target = normalizeExplorerImageName(streetName);
    if (!target) return null;

    const exact = explorerImageManifest.find((item) => normalizeExplorerImageName(item.name) === target);
    if (exact?.url) return exact;

    const targetWords = new Set(target.split(" "));
    const candidates = explorerImageManifest
      .map((item) => {
        const normalized = normalizeExplorerImageName(item.name);
        const words = normalized.split(" ");
        const shared = words.filter((word) => targetWords.has(word)).length;
        const coverage = shared / Math.max(targetWords.size, words.length);
        return { item, coverage };
      })
      .filter(({ coverage }) => coverage >= 0.75)
      .sort((a, b) => b.coverage - a.coverage);

    return candidates[0]?.item || null;
  }

  function normalizeExplorerImageName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((word) => !["LA", "LE", "LES", "DE", "DES", "DU", "D", "L"].includes(word))
      .join(" ");
  }

  function renderExplanation() {
    clearInterval(tickInterval);
    tickInterval = null;
    const riddle = state.riddles.find(
      (item) => String(item.id) === String(state.pendingExplanationRiddleId),
    );
    if (!riddle) {
      state.pendingExplanationRiddleId = null;
      saveState();
      selectNextRiddle();
      return;
    }
    els["explorer-discovery-title"].textContent = riddle.street_name_clean;
    els["explorer-discovery-text"].textContent = riddle.explanation_text || riddle.riddle_text;
    const source=document.getElementById("explorer-discovery-source");
    if(source){source.hidden=!/^https?:\/\//.test(riddle.source_url||'');if(!source.hidden)source.href=riddle.source_url;}

  }

  function renderComplete(totalScore) {
    const totalSeconds = Object.values(state.solved || {}).reduce(
      (sum, item) => sum + (Number(item.walking_time_seconds) || 0),
      0,
    );
    els["explorer-final-score"].textContent = String(totalScore);
    els["explorer-final-time"].textContent = `${Math.round(totalSeconds / 60)} min`;
    els["explorer-album"].innerHTML = Object.values(state.photos || {})
      .map((src) => `<img src="${src}" alt="Photo locale de plaque de rue">`)
      .join("");
  }

  function startTimer() {
    clearInterval(tickInterval);
    updateTimer();
    tickInterval = setInterval(updateTimer, 1000);
  }

  function updateTimer() {
    if (!state.currentStartedAt) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(state.currentStartedAt).getTime()) / 1000));
    const remaining = Math.max(0, RIDDLE_TIME_LIMIT_SECONDS - elapsed);
    const minutes = Math.floor(remaining / 60).toString().padStart(2, "0");
    const seconds = (remaining % 60).toString().padStart(2, "0");
    els["explorer-timer"].textContent = `${minutes}:${seconds}`;
    if (remaining === 0) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  function enqueueStep(type,id) {
    const queue=readJson(QUEUE_KEY,[]);
    queue.push({type,payload:{riddle_id:id}});
    setLocalStorageItem(QUEUE_KEY,JSON.stringify(queue));
    flushSyncQueue();
  }
  function enqueueSync(progress) {
    const queue = readJson(QUEUE_KEY, []);
    queue.push({ type: "progress", payload: progress });
    setLocalStorageItem(QUEUE_KEY, JSON.stringify(queue));
    registerBackgroundSync();
    flushSyncQueue();
  }

  function enqueueFinalScore() {
    const items = Object.values(state.solved || {});
    const payload = {
      total_score: items.reduce((sum, item) => sum + (Number(item.points_earned) || 0), 0),
      total_walking_time_seconds: items.reduce((sum, item) => sum + (Number(item.walking_time_seconds) || 0), 0),
      completed_at: state.completedAt,
    };
    const queue = readJson(QUEUE_KEY, []);
    queue.push({ type: "leaderboard", payload });
    setLocalStorageItem(QUEUE_KEY, JSON.stringify(queue));
    registerBackgroundSync();
    flushSyncQueue();
  }

  let flushingSync = false;
  async function flushSyncQueue() {
    if(flushingSync)return;
    const token = getAuthToken();
    const queue = readJson(QUEUE_KEY, []);
    if (!navigator.onLine || !token || !queue.length) return;

    flushingSync = true;
    const remaining = [];
    for (const item of queue) {
      try {
        const url = item.type === "leaderboard" ? `${API_BASE}/leaderboard` : ["start","hint"].includes(item.type) ? `${API_BASE}/riddles/${item.payload.riddle_id}/${item.type}` : `${API_BASE}/progress/sync`;
        const response = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(item.payload),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if(item.type === "progress") {
          const confirmed=await response.json();
          for(const row of confirmed.saved || []) {
            const local=state.solved[String(row.riddle_id)];
            if(local)Object.assign(local,{points_earned:row.points_earned,walking_time_seconds:row.walking_time_seconds,hints_used:row.hints_used,server_verified:true});
          }
          saveState();
        }
      } catch (error) {
        remaining.push(item);
      }
    }
    const additions=readJson(QUEUE_KEY,[]).slice(queue.length);
    setLocalStorageItem(QUEUE_KEY, JSON.stringify([...remaining,...additions]));
    flushingSync=false;
    render();
    if (remaining.length < queue.length) loadExplorerLeaderboard();
    if(additions.length)queueMicrotask(flushSyncQueue);
  }

  function getAuthToken() {
    const persistentToken = localStorage.getItem("camino_auth_token");
    if (persistentToken) return persistentToken;
    const sessionToken = sessionStorage.getItem("camino_paris_session_token");
    if (sessionToken) return sessionToken;
    const candidates = ["camino_paris_user", "caminoCurrentUser", "currentUser", "camino_current_user"];
    for (const key of candidates) {
      const value = readJson(key, null);
      if (value?.token) return value.token;
      if (value?.authenticated && value?.id) return "__cookie_session__";
    }
    return "";
  }

  function getStoredUsername() {
    const candidates = ["camino_paris_user", "caminoCurrentUser", "currentUser", "camino_current_user"];
    for (const key of candidates) {
      const value = readJson(key, null);
      if (value?.username) return String(value.username);
    }
    return "";
  }

  function registerBackgroundSync() {
    navigator.serviceWorker?.ready?.then(registration=>registration.sync?.register("camino-explorer-sync")).catch(()=>{});
  }

  async function recognizeStreetFromPhoto(dataUrl, streetName) {
    try {
      await loadTesseract();
    } catch (error) {
      console.warn("Explorer OCR runtime unavailable:", error?.message || error);
    }
    if (!window.Tesseract?.recognize && !window.Tesseract?.createWorker) {
      const ocrText = window.prompt("Reconnaissance indisponible. Saisissez le texte lu sur la plaque :") || "";
      return { ocrText, match: matchStreetInOcr(ocrText, streetName) };
    }

    const variants = await createOcrImageVariants(dataUrl);
    const texts = [];
    let failedAttempts = 0;
    let bestMatch = { ok: false, normalizedOcr: "", distance: Number.POSITIVE_INFINITY };

    for (let index = 0; index < variants.length; index += 1) {
      setFeedback(`Analyse en cours : lecture ${index + 1} sur ${variants.length}…`);
      let text = "";
      try {
        text = await recognizeText(variants[index], index);
      } catch (error) {
        failedAttempts += 1;
        console.warn(`Explorer OCR attempt ${index + 1} failed:`, error?.message || error);
        continue;
      }
      if (text) texts.push(text);
      const combinedText = texts.join("\n");
      const match = matchStreetInOcr(combinedText, streetName);
      if (match.distance < bestMatch.distance) bestMatch = match;
      if (match.ok) return { ocrText: combinedText, match };
    }

    if (failedAttempts === variants.length) {
      throw new Error("All OCR attempts failed");
    }
    return { ocrText: texts.join("\n"), match: bestMatch };
  }

  function loadTesseract() {
    if (window.Tesseract?.recognize || window.Tesseract?.createWorker) {
      return Promise.resolve(window.Tesseract);
    }
    if (tesseractScriptPromise) return tesseractScriptPromise;

    tesseractScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TESSERACT_SCRIPT_URL;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => reject(new Error("Impossible de charger le moteur OCR"));
      document.head.appendChild(script);
    }).catch((error) => {
      tesseractScriptPromise = null;
      throw error;
    });
    return tesseractScriptPromise;
  }

  async function recognizeText(image, attemptIndex) {
    if (window.Tesseract?.createWorker) {
      if (!ocrWorkerPromise) {
        ocrWorkerPromise = window.Tesseract.createWorker("fra").then(async (worker) => {
          await worker.setParameters({
            preserve_interword_spaces: "1",
          });
          return worker;
        }).catch((error) => {
          ocrWorkerPromise = null;
          throw error;
        });
      }
      const worker = await ocrWorkerPromise;
      await worker.setParameters({
        tessedit_pageseg_mode: ["6", "11", "7"][attemptIndex] || "6",
      });
      const result = await worker.recognize(image);
      return result?.data?.text || "";
    }

    const result = await window.Tesseract.recognize(image, "fra");
    return result?.data?.text || "";
  }

  async function createOcrImageVariants(dataUrl) {
    const image = await loadImage(dataUrl);
    const longestSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const scale = Math.max(0.35, Math.min(8, 2200 / Math.max(1, longestSide)));
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const base = document.createElement("canvas");
    base.width = width;
    base.height = height;
    const context = base.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);

    return [
      base.toDataURL("image/png"),
      transformOcrCanvas(base, false),
      transformOcrCanvas(base, true),
    ];
  }

  function transformOcrCanvas(source, thresholded) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const values = new Uint8Array(imageData.data.length / 4);
    const histogram = new Array(256).fill(0);

    for (let index = 0; index < imageData.data.length; index += 4) {
      const grayscale = Math.round(
        imageData.data[index] * 0.299
        + imageData.data[index + 1] * 0.587
        + imageData.data[index + 2] * 0.114,
      );
      values[index / 4] = grayscale;
      histogram[grayscale] += 1;
    }

    const low = getHistogramPercentile(histogram, values.length, 0.05);
    const high = getHistogramPercentile(histogram, values.length, 0.95);
    const threshold = (low + high) / 2;
    for (let pixel = 0; pixel < values.length; pixel += 1) {
      const normalized = Math.max(0, Math.min(255, ((values[pixel] - low) * 255) / Math.max(1, high - low)));
      const value = thresholded ? (values[pixel] >= threshold ? 0 : 255) : 255 - normalized;
      const index = pixel * 4;
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
      imageData.data[index + 3] = 255;
    }
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function getHistogramPercentile(histogram, total, percentile) {
    const target = total * percentile;
    let count = 0;
    for (let value = 0; value < histogram.length; value += 1) {
      count += histogram[value];
      if (count >= target) return value;
    }
    return histogram.length - 1;
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to decode photo"));
      image.src = dataUrl;
    });
  }

  async function createStoredPhotoDataUrl(dataUrl) {
    try {
      const image = await loadImage(dataUrl);
      const longestSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
      const scale = Math.min(1, 1000 / Math.max(1, longestSide));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
      canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.68);
    } catch (error) {
      console.warn("Explorer photo compression failed:", error?.message || error);
      return "";
    }
  }

  async function storeSolvedPhoto(riddleId, dataUrl) {
    const storedPhotoDataUrl = await createStoredPhotoDataUrl(dataUrl);
    if (!storedPhotoDataUrl) return;
    state.photos[String(riddleId)] = storedPhotoDataUrl;
    saveState();
  }

  function normalizeStreetText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/['’]/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((part) => part && !STOP_WORDS.has(part))
      .join(" ");
  }

  function normalizeStreetTextWithTypes(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/['’]/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function matchStreetInOcr(ocrText, streetName) {
    const normalizedOcr = normalizeStreetText(ocrText);
    const normalizedTarget = normalizeStreetText(streetName);
    const fullOcr = normalizeStreetTextWithTypes(ocrText);
    const fullTarget = normalizeStreetTextWithTypes(streetName);
    if (!normalizedOcr || !normalizedTarget || !fullOcr || !fullTarget) {
      return { ok: false, normalizedOcr, distance: Number.POSITIVE_INFINITY };
    }

    const fullMatch = getBestTextMatch(fullOcr, fullTarget);
    const nameMatch = getBestTextMatch(normalizedOcr, normalizedTarget);
    const targetNameTokens = normalizedTarget.split(" ").filter(Boolean);
    const requireFullLabel = targetNameTokens.length === 1
      && AMBIGUOUS_SINGLE_NAME_TOKENS.has(targetNameTokens[0]);
    const acceptedMatch = fullMatch.ok || (!requireFullLabel && nameMatch.ok);
    const bestMatch = requireFullLabel || fullMatch.distance <= nameMatch.distance ? fullMatch : nameMatch;
    return {
      ok: acceptedMatch,
      normalizedOcr,
      distance: bestMatch.distance,
    };
  }

  function getBestTextMatch(normalizedOcr, normalizedTarget) {
    const ocrTokens = normalizedOcr.split(" ");
    const targetTokens = normalizedTarget.split(" ");
    const paddedOcr = ` ${normalizedOcr} `;
    const compactOcr = normalizedOcr.replace(/\s+/g, "");
    const compactTarget = normalizedTarget.replace(/\s+/g, "");
    if (
      paddedOcr.includes(` ${normalizedTarget} `)
      || (compactTarget.length >= 5 && compactOcr.includes(compactTarget))
      || targetTokens.every((token) => ocrTokens.includes(token))
    ) {
      return { ok: true, distance: 0 };
    }

    const candidates = new Set(ocrTokens);
    const minimumWindowSize = Math.max(1, targetTokens.length - 1);
    const maximumWindowSize = Math.min(ocrTokens.length, targetTokens.length + 1);
    for (let size = minimumWindowSize; size <= maximumWindowSize; size += 1) {
      for (let start = 0; start <= ocrTokens.length - size; start += 1) {
        candidates.add(ocrTokens.slice(start, start + size).join(" "));
      }
    }

    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      bestDistance = Math.min(bestDistance, levenshteinDistance(candidate, normalizedTarget));
    }
    const tolerance = Math.max(1, Math.ceil(normalizedTarget.length * 0.25));
    return {
      ok: bestDistance <= tolerance,
      distance: bestDistance,
    };
  }

  function lowercaseFirst(value) {
    const text = String(value || "");
    return text ? `${text[0].toLowerCase()}${text.slice(1)}` : text;
  }

  function levenshteinDistance(a, b) {
    const left = String(a || "");
    const right = String(b || "");
    const matrix = Array.from({ length: left.length + 1 }, (_, index) => [index]);
    for (let j = 1; j <= right.length; j += 1) matrix[0][j] = j;
    for (let i = 1; i <= left.length; i += 1) {
      for (let j = 1; j <= right.length; j += 1) {
        const cost = left[i - 1] === right[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        );
      }
    }
    return matrix[left.length][right.length];
  }

  function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
    const earthRadius = 6371000;
    const toRad = (value) => (value * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function getRiddleDistanceFromPosition(position, riddle) {
    try { return window.CaminoExplorerSelection.distance(position,riddle,await loadStreetGeometryIndex()); }
    catch { const latitude=Number(riddle.latitude),longitude=Number(riddle.longitude);return Number.isFinite(latitude)&&Number.isFinite(longitude)?haversineDistanceMeters(position.latitude,position.longitude,latitude,longitude):Infinity; }
  }

  async function getRiddleProximity(riddle) {
    const position = await getCurrentPositionSafe();
    if (!position) {
      return {
        ok: false,
        message: "Position indisponible. Activez la géolocalisation pour valider la plaque.",
      };
    }

    const features = await getStreetFeaturesForRiddle(riddle);
    if (!features.length) {
      return {
        ok: false,
        message: "Géométrie de rue indisponible. Impossible de vérifier la position.",
      };
    }

    const distanceMeters = getMinimumDistanceToFeaturesMeters(position, features);
    if (!Number.isFinite(distanceMeters)) {
      return {
        ok: false,
        message: "Géométrie de rue indisponible. Impossible de vérifier la position.",
      };
    }

    if (distanceMeters > STREET_PROXIMITY_RADIUS_METERS) {
      return {
        ok: false,
        distanceMeters,
        accuracyMeters: position.accuracy,
        message: `Vous êtes à ${Math.round(distanceMeters)} m de la rue. Approchez-vous à moins de ${STREET_PROXIMITY_RADIUS_METERS} m pour valider.`,
      };
    }

    return {
      ok: true,
      distanceMeters,
      accuracyMeters: position.accuracy,
      latitude: position.latitude, longitude: position.longitude,
    };
  }

  async function getStreetFeaturesForRiddle(riddle) {
    try {
      const index = await loadStreetGeometryIndex();
      const rawTarget = normalizeStreetText(riddle.street_name_clean);
      const normalizedTarget = STREET_GEOMETRY_ALIASES.get(rawTarget) || rawTarget;
      if (!normalizedTarget) return [];

      const exactMatches = index.byName.get(normalizedTarget) || [];
      if (exactMatches.length) return exactMatches;

      return index.entries
        .filter((entry) => (
          entry.normalizedName.includes(normalizedTarget)
          || normalizedTarget.includes(entry.normalizedName)
        ))
        .flatMap((entry) => entry.features);
    } catch (error) {
      console.warn("Explorer street geometry unavailable:", error?.message || error);
      return [];
    }
  }

  async function loadStreetGeometryIndex() {
    if (!streetGeometryIndexPromise) {
      streetGeometryIndexPromise = fetch(`${API_ORIGIN}/api/streets-light`, {
        cache: "force-cache",
        credentials: "include",
      })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((payload) => {
          const byName = new Map();
          const features = Array.isArray(payload.features) ? payload.features : [];
          for (const feature of features) {
            const normalizedName = normalizeStreetText(feature?.properties?.name);
            if (!normalizedName || !feature?.geometry) continue;
            if (!byName.has(normalizedName)) byName.set(normalizedName, []);
            byName.get(normalizedName).push(feature);
          }
          return {
            byName,
            entries: Array.from(byName, ([normalizedName, entryFeatures]) => ({
              normalizedName,
              features: entryFeatures,
            })),
          };
        });
    }
    return streetGeometryIndexPromise;
  }

  function getMinimumDistanceToFeaturesMeters(position, features) {
    return features.reduce((minDistance, feature) => {
      const distance = getDistanceToGeometryMeters(position, feature.geometry);
      return Math.min(minDistance, distance);
    }, Number.POSITIVE_INFINITY);
  }

  function getDistanceToGeometryMeters(position, geometry) {
    if (!geometry || !geometry.coordinates) return Number.POSITIVE_INFINITY;
    const paths = getGeometryPaths(geometry);
    if (!paths.length) return Number.POSITIVE_INFINITY;

    const point = projectLngLatToMeters(
      [position.longitude, position.latitude],
      position.latitude,
      position.longitude,
    );
    let minDistance = Number.POSITIVE_INFINITY;

    for (const path of paths) {
      if (path.length === 1) {
        minDistance = Math.min(
          minDistance,
          haversineDistanceMeters(position.latitude, position.longitude, path[0][1], path[0][0]),
        );
        continue;
      }

      if ((geometry.type === "Polygon" || geometry.type === "MultiPolygon") && isPointInRing([position.longitude, position.latitude], path)) {
        return 0;
      }

      for (let index = 1; index < path.length; index += 1) {
        const start = projectLngLatToMeters(path[index - 1], position.latitude, position.longitude);
        const end = projectLngLatToMeters(path[index], position.latitude, position.longitude);
        minDistance = Math.min(minDistance, getPointToSegmentDistanceMeters(point, start, end));
      }
    }

    return minDistance;
  }

  function getGeometryPaths(geometry) {
    switch (geometry.type) {
      case "Point":
        return [[geometry.coordinates]];
      case "MultiPoint":
      case "LineString":
        return [geometry.coordinates];
      case "MultiLineString":
      case "Polygon":
        return geometry.coordinates;
      case "MultiPolygon":
        return geometry.coordinates.flatMap((polygon) => polygon);
      case "GeometryCollection":
        return (geometry.geometries || []).flatMap(getGeometryPaths);
      default:
        return [];
    }
  }

  function projectLngLatToMeters(coord, originLat, originLng) {
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    return {
      x: (lng - originLng) * 111320 * Math.cos((originLat * Math.PI) / 180),
      y: (lat - originLat) * 110540,
    };
  }

  function getPointToSegmentDistanceMeters(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);

    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
  }

  function isPointInRing(point, ring) {
    let inside = false;
    const x = point[0];
    const y = point[1];

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      const intersects = ((yi > y) !== (yj > y))
        && (x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi);
      if (intersects) inside = !inside;
    }

    return inside;
  }

  function getCurrentPositionSafe() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
      );
    });
  }

  function getCurrentRiddle() {
    return state.riddles.find((riddle) => String(riddle.id) === String(state.currentRiddleId)) || null;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function exportAlbum() {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Album Parici Explorer</title></head><body>${Object.values(state.photos || {}).map((src) => `<img style="max-width:100%;margin:12px 0;display:block" src="${src}">`).join("")}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "album-parici-explorer.html";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function loadState() {
    const stored = readJson(STORAGE_KEY, {});
    const hasExistingRun = Boolean(
      stored.completed
      || stored.currentRiddleId
      || stored.pendingExplanationRiddleId
      || Object.keys(stored.solved || {}).length,
    );
    return {
      riddles: [],
      solved: {},
      photos: {},
      started: hasExistingRun,
      currentRiddleId: null,
      currentStartedAt: null,
      currentHintsUsed: 0,
      pendingExplanationRiddleId: null,
      startingRuleVersion: null,
      completed: false,
      completedAt: null,
      ...stored,
    };
  }

  function saveState() {
    const serialized = JSON.stringify(state);
    if (setLocalStorageItem(STORAGE_KEY, serialized)) return;

    // Photos are optional souvenirs; progression must remain playable if storage is full.
    state.photos = {};
    setLocalStorageItem(STORAGE_KEY, JSON.stringify(state));
  }

  function setLocalStorageItem(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn(`Explorer local storage unavailable for ${key}:`, error?.message || error);
      return false;
    }
  }

  function readJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function toggle(element, visible) {
    element?.classList.toggle("hidden", !visible);
  }

  function setFeedback(message, type = "info") {
    if (!els["explorer-feedback"]) return;
    els["explorer-feedback"].textContent = message || "";
    els["explorer-feedback"].className = message
      ? `explorer-feedback explorer-feedback--${type}`
      : "explorer-feedback";
  }
})();
