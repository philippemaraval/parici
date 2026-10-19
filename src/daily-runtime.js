function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function getDailySuccessComment(attempts) {
  if (attempts <= 1) {
    return "Coup de maître !";
  }
  if (attempts <= 3) {
    return "Excellent sens de l'orientation !";
  }
  if (attempts <= 5) {
    return "Il faut plus se concentrer !";
  }
  return "Ouf, sur le fil !";
}

export function saveDailyMetaToStorageRuntime(dailyTargetData, getDailyMetaStorageKey) {
  if (dailyTargetData && dailyTargetData.date) {
    try {
      localStorage.setItem(
        getDailyMetaStorageKey(dailyTargetData.date),
        JSON.stringify({
          date: dailyTargetData.date,
          streetName: dailyTargetData.streetName || "",
          arrondissement: dailyTargetData.arrondissement || "",
          dailyImageUrl: dailyTargetData.dailyImageUrl || "",
        }),
      );
    } catch (error) {
      // Ignore storage errors (private mode/quota exceeded)
    }
  }
}

export function saveDailyGuessesToStorageRuntime({
  dailyTargetData,
  dailyGuessHistory,
  getDailyGuessesStorageKey,
  getDailyMetaStorageKey,
}) {
  if (dailyTargetData && dailyTargetData.date) {
    try {
      const storageKey = getDailyGuessesStorageKey(dailyTargetData.date);
      localStorage.setItem(storageKey, JSON.stringify(dailyGuessHistory));
      saveDailyMetaToStorageRuntime(dailyTargetData, getDailyMetaStorageKey);
    } catch (error) {
      // Ignore storage errors (private mode/quota exceeded)
    }
  }
}

export function restoreDailyGuessesFromStorageRuntime(dailyDate, getDailyGuessesStorageKey) {
  try {
    const storageKey = getDailyGuessesStorageKey(dailyDate);
    const rawValue = localStorage.getItem(storageKey);
    if (!rawValue) {
      return [];
    }
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

export function cleanOldDailyGuessStorageRuntime(dailyDate, {
  getDailyGuessesStorageKey,
  getDailyMetaStorageKey,
}) {
  try {
    const guessesPrefix = getDailyGuessesStorageKey("");
    const metaPrefix = getDailyMetaStorageKey("");
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(guessesPrefix) && !key.endsWith(dailyDate)) {
        localStorage.removeItem(key);
      }
      if (key && key.startsWith(metaPrefix) && !key.endsWith(dailyDate)) {
        localStorage.removeItem(key);
      }
    }
  } catch (error) {
    // Ignore storage cleanup errors
  }
}

export function restoreDailyMetaFromStorageRuntime(dailyDate, dailyTargetData, getDailyMetaStorageKey) {
  if (!dailyDate) {
    return null;
  }

  try {
    const rawValue = localStorage.getItem(getDailyMetaStorageKey(dailyDate));
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue);
    if (!parsed || !parsed.streetName) {
      return null;
    }

    return {
      ...(dailyTargetData || {}),
      date: dailyDate,
      streetName: parsed.streetName,
      arrondissement: parsed.arrondissement || dailyTargetData?.arrondissement || "",
      dailyImageUrl: parsed.dailyImageUrl || dailyTargetData?.dailyImageUrl || "",
    };
  } catch (error) {
    return null;
  }
}

export function removeDailyHighlightRuntime(map, dailyHighlightLayer) {
  if (dailyHighlightLayer && map) {
    map.removeLayer(dailyHighlightLayer);
  }
  return null;
}

export function highlightDailyTargetRuntime({
  targetGeometry,
  isSuccess,
  map,
  L,
  uiTheme,
  dailyHighlightLayer,
  fitBounds = true,
}) {
  let nextLayer = removeDailyHighlightRuntime(map, dailyHighlightLayer);
  if (!targetGeometry || !map) {
    return nextLayer;
  }

  let parsedTarget;
  try {
    parsedTarget = typeof targetGeometry === "string" ? JSON.parse(targetGeometry) : targetGeometry;
  } catch (error) {
    console.error("Invalid target geometry:", error);
    return nextLayer;
  }

  let geoJsonPayload = null;
  if (parsedTarget && typeof parsedTarget === "object") {
    if (parsedTarget.type === "FeatureCollection" || parsedTarget.type === "Feature") {
      geoJsonPayload = parsedTarget;
    } else if (Array.isArray(parsedTarget)) {
      const features = parsedTarget
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }
          if (entry.type === "Feature" && entry.geometry) {
            return entry;
          }
          if (entry.type && entry.coordinates) {
            return { type: "Feature", geometry: entry, properties: {} };
          }
          return null;
        })
        .filter(Boolean);
      if (features.length > 0) {
        geoJsonPayload = { type: "FeatureCollection", features };
      }
    } else if (parsedTarget.type && parsedTarget.coordinates) {
      geoJsonPayload = { type: "Feature", geometry: parsedTarget, properties: {} };
    }
  }

  if (!geoJsonPayload) {
    console.warn("Unsupported target geometry payload for daily highlight");
    return nextLayer;
  }

  const color = isSuccess ? uiTheme.mapCorrect : uiTheme.mapWrong;
  nextLayer = L.geoJSON(geoJsonPayload, {
    style: { color, weight: 6, opacity: 1, dashArray: isSuccess ? null : "8, 4" },
  }).addTo(map);

  if (!fitBounds) {
    return nextLayer;
  }

  try {
    if (nextLayer && Object.keys(nextLayer._layers).length > 0) {
      const bounds = nextLayer.getBounds();
      if (bounds && bounds.isValid()) {
        map.fitBounds(bounds, {
          padding: [40, 40],
          maxZoom: 16,
          animate: true,
          duration: 1.5,
        });
      }
    }
  } catch (error) {
    console.error("Could not fit logic bounds", error);
  }

  return nextLayer;
}

export function renderDailyGuessHistoryRuntime({
  dailyGuessHistory,
  onReviewGuess,
  finalStatus,
  dailyTargetData,
  onLayoutShift,
  normalizeArrondissementKey,
  arrondissementByArrondissement,
  calculateStreetLengthFromFeatures,
  allStreetFeatures,
  normalizeName,
}) {
  try {
    const historyRoot = document.getElementById("daily-guesses-history");
    const targetPanelEl = document.querySelector(".target-panel");
    if (!historyRoot) {
      return;
    }

    const previousDailyImageHintEl = historyRoot.querySelector(".daily-image-hint");
    const previousDailyImageHintOpen = previousDailyImageHintEl
      ? previousDailyImageHintEl.open
      : null;

    const dailyImageUrl =
      typeof dailyTargetData?.dailyImageUrl === "string"
        ? dailyTargetData.dailyImageUrl.trim()
        : "";
    const persistedDailyImageHintOpen =
      typeof dailyTargetData?.dailyImageHintOpen === "boolean"
        ? dailyTargetData.dailyImageHintOpen
        : null;
    const dailyImageHintOpenByDefault =
      persistedDailyImageHintOpen ?? previousDailyImageHintOpen ?? true;
    const shouldShowVisualHint = Boolean(dailyImageUrl && !finalStatus);
    const shouldShowHistory =
      dailyGuessHistory.length !== 0 || (finalStatus && finalStatus.success) || shouldShowVisualHint;

    if (!shouldShowHistory) {
      if (targetPanelEl) {
        targetPanelEl.classList.remove("target-panel--daily-image-open");
      }
      historyRoot.style.display = "none";
      historyRoot.innerHTML = "";
      if (typeof onLayoutShift === "function") {
        requestAnimationFrame(() => onLayoutShift());
      }
      return;
    }

    historyRoot.style.display = "block";
    let html = "";

    if (dailyGuessHistory.length > 0) {
      html += '<div class="daily-history-title">Essais précédents</div>';
      html += '<table class="daily-history-table">';
      html += '<thead><tr><th>#</th><th>Rue tentée</th><th title="Distance entre les milieux des deux voies">Écart</th><th><span class="sr-only">Direction</span></th></tr></thead>';
      html += "<tbody>";

      dailyGuessHistory.forEach((guess, index) => {
        const distanceLabel =
          guess.distance >= 1000
            ? `${(guess.distance / 1000).toFixed(1)} km`
            : `${Math.round(guess.distance)} m`;
        const isLastAnimatedRow = index === dailyGuessHistory.length - 1 && !finalStatus;

        let distanceClass = "dist-cold";
        if (guess.distance < 500) {
          distanceClass = "dist-hot";
        } else if (guess.distance < 2000) {
          distanceClass = "dist-warm";
        }

        html += `<tr class="${isLastAnimatedRow ? "daily-row-enter" : ""}">`;
        html += `<td>${index + 1}</td>`;
        html += `<td><button type="button" class="map-review-button" data-review-guess="${index}"></button></td>`;
        html += `<td class="${distanceClass}">${distanceLabel}</td>`;
        html += `<td class="daily-arrow">${guess.arrow || ""}</td>`;
        html += "</tr>";
      });

      html += "</tbody></table>";
    }

    const guessCount = dailyGuessHistory.length;
    if (dailyTargetData && !finalStatus && (shouldShowVisualHint || guessCount >= 2)) {
      html += '<div class="daily-hints">';
      html += '<div class="daily-hints-title">💡 Indices</div>';

      if (shouldShowVisualHint) {
        const imageAlt = dailyTargetData.displayStreetName || dailyTargetData.streetName
          ? `Photo indice de ${dailyTargetData.displayStreetName || dailyTargetData.streetName}`
          : "Photo indice du Daily";
        html += `<details class="daily-image-hint"${dailyImageHintOpenByDefault ? " open" : ""}>`;
        html += '<summary class="daily-image-hint-summary">🖼️ Photo indice</summary>';
        html += '<div class="daily-image-hint-body">';
        html += `<img src="${escapeHtml(dailyImageUrl)}" alt="${escapeHtml(imageAlt)}" loading="lazy" decoding="async">`;
        html += "</div>";
        html += "</details>";
      }

      const arrondissementName = dailyTargetData.arrondissement || "";
      try {
        if (guessCount >= 2) {
          const normalizedArrondissement = normalizeArrondissementKey(arrondissementName);
          if (arrondissementByArrondissement && arrondissementByArrondissement.has(normalizedArrondissement)) {
            const arrondissement = arrondissementByArrondissement.get(normalizedArrondissement);
            if (arrondissement) {
              html += `<div class="daily-hint">📍 Arrondissement : <strong>${arrondissement}</strong></div>`;
            }
          }
        }
      } catch (error) {
        console.error("Error with Hint 1:", error);
      }

      if (guessCount >= 4 && arrondissementName) {
        html += `<div class="daily-hint">🏘️ Arrondissement : <strong>${arrondissementName}</strong></div>`;
      }

      if (guessCount >= 6 && dailyTargetData.streetName) {
        try {
          const lengthMeters = calculateStreetLengthFromFeatures(
            dailyTargetData.streetName,
            allStreetFeatures,
            normalizeName,
          );
          if (lengthMeters > 0) {
            const lengthLabel =
              lengthMeters >= 1000
                ? `${(lengthMeters / 1000).toFixed(1)} km`
                : `${Math.round(lengthMeters)} m`;
            html += `<div class="daily-hint">📏 Longueur : <strong>~ ${lengthLabel}</strong></div>`;
          }
        } catch (error) {
          console.error("Error with Hint 3:", error);
        }
      }

      html += "</div>";
    }

    historyRoot.innerHTML = html;
    historyRoot.querySelectorAll('[data-review-guess]').forEach(button => {
      const guess = dailyGuessHistory[Number(button.dataset.reviewGuess)];
      button.textContent = guess.streetName;
      button.addEventListener('click', () => onReviewGuess?.(guess));
    });

    const dailyImageHintEl = historyRoot.querySelector(".daily-image-hint");
    if (targetPanelEl) {
      const syncDailyImageOpenClass = () => {
        if (dailyTargetData && typeof dailyTargetData === "object" && dailyImageHintEl) {
          dailyTargetData.dailyImageHintOpen = dailyImageHintEl.open;
        }
        targetPanelEl.classList.toggle(
          "target-panel--daily-image-open",
          Boolean(dailyImageHintEl && dailyImageHintEl.open),
        );
        if (typeof onLayoutShift === "function") {
          requestAnimationFrame(() => onLayoutShift());
        }
      };

      if (dailyImageHintEl) {
        dailyImageHintEl.addEventListener("toggle", syncDailyImageOpenClass);
        syncDailyImageOpenClass();
      } else {
        targetPanelEl.classList.remove("target-panel--daily-image-open");
      }

      requestAnimationFrame(() => {
        targetPanelEl.scrollTop = targetPanelEl.scrollHeight;
      });
    }
    if (typeof onLayoutShift === "function") {
      requestAnimationFrame(() => onLayoutShift());
    }
  } catch (error) {
    console.error("Error in renderDailyGuessHistory:", error);
  }
}

export function updateDailyUIRuntime({
  isDailyMode,
  dailyTargetData,
  dailyGuessHistory,
}) {
  const userStatus = dailyTargetData ? dailyTargetData.userStatus : {};
  const attempts = Math.max(dailyGuessHistory.length, userStatus.attempts_count || 0);
  const remaining = 7 - attempts;

  if (isDailyMode) {
    const targetPanelTitle = document.getElementById("target-panel-title");
    if (targetPanelTitle) {
      if (userStatus.success) {
        targetPanelTitle.textContent = "🎉 Défi réussi !";
      } else {
        targetPanelTitle.textContent =
          remaining <= 0
            ? "❌ Défi échoué"
            : `🎯 Défi quotidien — ${remaining} essai${remaining > 1 ? "s" : ""} restant${remaining > 1 ? "s" : ""}`;
      }
    }
  }

  const triesCounter = document.getElementById("daily-tries-counter");
  if (triesCounter) {
    if (isDailyMode) {
      triesCounter.style.display = "flex";
      triesCounter.innerHTML = `<span>🎯</span> ${attempts} / 7 essais`;
    } else {
      triesCounter.style.display = "none";
    }
  }
}

export function handleDailyShareTextRuntime({
  result,
  dailyTargetData,
  dailyGuessHistory,
  getDailyShareDateLabel,
  formatDailyDistanceForShare,
  showMessage,
}) {
  if (!dailyTargetData) {
    return;
  }

  const scoreLabel = result.success ? result.attempts : "X";
  const dateLabel = getDailyShareDateLabel(dailyTargetData?.date);
  const streetName = dailyTargetData.streetName || "Rue inconnue";
  const minDistance =
    dailyGuessHistory.length > 0
      ? Math.min(...dailyGuessHistory.map((guess) => guess.distance))
      : null;

  let text = `🗺️ Parici Daily — ${dateLabel}\n📍 Rue: ${streetName}\n${result.success ? "✅" : "❌"} Résultat: ${scoreLabel}/7\n\n`;

  if (dailyGuessHistory.length > 0) {
    dailyGuessHistory.forEach((guess, index) => {
      if (result.success && index === dailyGuessHistory.length - 1) {
        text += "🟩 Trouvé !\n";
        return;
      }

      let tile = "🟥";
      if (guess.distance < 500) {
        tile = "🟩";
      } else if (guess.distance < 2000) {
        tile = "🟨";
      }
      text += `${tile} ${formatDailyDistanceForShare(guess.distance)}\n`;
    });
  } else {
    text += "Aucun essai enregistré.\n";
  }

  if (result.success) {
    text += `\n🎯 ${getDailySuccessComment(result.attempts)}\n`;
  } else if (minDistance !== null && Number.isFinite(minDistance)) {
    text += `\n🎯 Meilleure distance: ${formatDailyDistanceForShare(minDistance)}\n`;
  }

  text += "Essaie de faire mieux sur parici-ajm.pages.dev";

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showMessage("Texte copié !", "success");
      })
      .catch(() => showMessage("Erreur lors de la copie", "error"));
    return;
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    showMessage("Texte copié !", "success");
  } catch (error) {
    showMessage("Impossible de copier", "error");
  }
}

export async function handleDailyShareImageRuntime(options) {
  try { const module=await import("./daily-share-image.js");return module.handleDailyShareImageRuntime(options); }
  catch { options.showMessage("Le partage de l’image est indisponible. Réessayez.","error"); }
}

export function updateDailyResultPanelRuntime({
  isSessionRunning,
  dailyGuessHistory,
  dailyTargetData,
  isDailyGameOver,
  setDailyGuessHistory,
  getTodayDailyStorageDate,
  getDailyGuessesStorageKey,
  restoreDailyMetaFromStorage,
  ensureDailyShareContext,
  handleDailyShareText,
  handleDailyShareImage,
  showMessage,
}) {
  const panel = document.getElementById("daily-result-panel");
  const content = document.getElementById("daily-result-content");
  if (!panel || !content) {
    return;
  }

  if (isSessionRunning) {
    panel.classList.add("hidden");
    panel.style.display = "none";
    content.innerHTML = "";
    return;
  }

  let guesses = Array.isArray(dailyGuessHistory) ? dailyGuessHistory.slice() : [];
  const dailyDate = dailyTargetData?.date || getTodayDailyStorageDate();

  if (guesses.length === 0 && !isDailyGameOver && dailyDate) {
    const stored = localStorage.getItem(getDailyGuessesStorageKey(dailyDate));
    if (stored) {
      try {
        guesses = JSON.parse(stored);
      } catch (error) {
        guesses = [];
      }
    }
  }

  if (!Array.isArray(guesses)) {
    guesses = [];
  }

  if (guesses.length === 0) {
    panel.classList.add("hidden");
    panel.style.display = "none";
    content.innerHTML = "";
    return;
  }

  const normalizedGuesses = guesses.slice(0, 7).map((guess) => ({ ...guess }));
  setDailyGuessHistory(normalizedGuesses);
  restoreDailyMetaFromStorage(dailyDate);

  const isSuccess = guesses.some((guess) => guess.distance < 20);
  const isFinished = isSuccess || guesses.length >= 7 || isDailyGameOver;

  if (!isFinished) {
    panel.classList.add("hidden");
    panel.style.display = "none";
    content.innerHTML = "";
    return;
  }

  const result = {
    success: isSuccess,
    attempts: guesses.length,
  };

  let html = "";
  if (isSuccess) {
    const attempts = result.attempts;
    html += `<div class="daily-result daily-result--success">🎉 Bravo, vous avez trouvé la rue en ${attempts} essai${attempts > 1 ? "s" : ""} !</div>`;
  } else {
    const minDistance = Math.min(...guesses.map((guess) => guess.distance));
    const minDistanceLabel =
      minDistance >= 1000
        ? `${(minDistance / 1000).toFixed(1)} km`
        : `${Math.round(minDistance)} m`;
    const targetStreetName = dailyTargetData?.streetName || "Rue inconnue";
    html += `<div class="daily-result daily-result--fail">Votre meilleur score est ${minDistanceLabel} en sept essais.<br>La rue cible était « ${targetStreetName} ».</div>`;
  }

  html += '<div class="daily-share-buttons">';
  html += '<button id="daily-share-text" class="btn-secondary daily-share-btn">📋 Copier le texte</button>';
  html += '<button id="daily-share-image" class="btn-primary daily-share-btn">📸 Partager l\'image</button>';
  html += "</div>";
  html += '<p class="daily-share-hint">L\'image est plus impactante sur les réseaux !</p>';

  content.innerHTML = html;
  panel.classList.remove("hidden");
  panel.style.display = "block";

  const shareTextBtn = document.getElementById("daily-share-text");
  const shareImageBtn = document.getElementById("daily-share-image");

  if (shareTextBtn) {
    shareTextBtn.onclick = async () => {
      shareTextBtn.disabled = true;
      const contextReady = await ensureDailyShareContext(dailyDate, guesses);
      shareTextBtn.disabled = false;
      if (!contextReady) {
        showMessage("Impossible de préparer le partage du Daily.", "error");
        return;
      }
      handleDailyShareText(result);
    };
  }

  if (shareImageBtn) {
    shareImageBtn.onclick = async () => {
      shareImageBtn.disabled = true;
      const contextReady = await ensureDailyShareContext(dailyDate, guesses);
      shareImageBtn.disabled = false;
      if (!contextReady) {
        showMessage("Impossible de préparer le partage du Daily.", "error");
        return;
      }
      shareImageBtn.disabled = true;
      try {
        await handleDailyShareImage(result);
      } finally {
        shareImageBtn.disabled = false;
      }
    };
  }
}

export function fitTargetStreetTextRuntime(targetStreetElementId = "target-street") {
  const targetStreetEl = document.getElementById(targetStreetElementId);
  if (!targetStreetEl) {
    return;
  }

  targetStreetEl.style.fontSize = "";
  targetStreetEl.style.whiteSpace = "";
  targetStreetEl.style.overflowWrap = "";
  targetStreetEl.style.wordBreak = "";

  if (!window.matchMedia("(max-width: 900px)").matches) {
    return;
  }

  targetStreetEl.style.whiteSpace = "normal";
  targetStreetEl.style.overflowWrap = "anywhere";
  targetStreetEl.style.wordBreak = "break-word";

  const targetPanelEl = targetStreetEl.closest(".target-panel");
  if (targetPanelEl && !targetPanelEl.classList.contains("target-panel--daily-image-open")) {
    targetPanelEl.scrollTop = 0;
  }

  let low = 12;
  let high = 18;
  let best = 12;
  const maxLines = 3;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    targetStreetEl.style.fontSize = `${mid}px`;
    const lineHeight = parseFloat(window.getComputedStyle(targetStreetEl).lineHeight) || mid * 1.2;
    const renderedLines = Math.max(1, Math.round(targetStreetEl.scrollHeight / lineHeight));
    if (renderedLines <= maxLines) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  targetStreetEl.style.fontSize = `${best}px`;
}
