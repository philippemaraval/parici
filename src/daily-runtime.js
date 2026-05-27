function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
      html += "<thead><tr><th>#</th><th>Rue tentée</th><th>Distance</th><th></th></tr></thead>";
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
        html += `<td>${guess.streetName}</td>`;
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
        const imageAlt = dailyTargetData.streetName
          ? `Photo indice de ${dailyTargetData.streetName}`
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
        text += "🟩 🏁\n";
        return;
      }

      let tile = "🟥";
      if (guess.distance < 500) {
        tile = "🟩";
      } else if (guess.distance < 2000) {
        tile = "🟨";
      }
      text += `${tile} ${guess.arrow || "•"}\n`;
    });
  } else {
    text += "Aucun essai enregistré.\n";
  }

  if (minDistance !== null && Number.isFinite(minDistance)) {
    text += `\n🎯 Meilleure distance: ${formatDailyDistanceForShare(minDistance)}\n`;
  }

  text += "Essaie de faire mieux sur parici.netlify.app";

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

export function handleDailyShareImageRuntime({
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

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    showMessage("Erreur lors de la génération", "error");
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const resultLabel = result.success ? result.attempts : "X";
  const streetName = dailyTargetData.streetName || "Rue inconnue";
  const dateLabel = getDailyShareDateLabel(dailyTargetData?.date);
  const minDistance =
    dailyGuessHistory.length > 0
      ? Math.min(...dailyGuessHistory.map((guess) => guess.distance))
      : null;
  const dailyImageUrl =
    typeof dailyTargetData.dailyImageUrl === "string"
      ? dailyTargetData.dailyImageUrl.trim()
      : "";
  const bestDistanceLabel =
    minDistance !== null && Number.isFinite(minDistance)
      ? formatDailyDistanceForShare(minDistance)
      : "—";

  function drawWrappedCenterText(text, center, context, maxWidth, startY, lineHeight, maxLines) {
    const lines = [];
    const words = String(text).split(/\s+/);
    let currentLine = "";

    words.forEach((word) => {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (context.measureText(testLine).width <= maxWidth || !currentLine) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    });

    if (currentLine) {
      lines.push(currentLine);
    }

    const drawCount = Math.min(lines.length, maxLines);
    for (let i = 0; i < drawCount; i++) {
      let line = lines[i];
      if (i === maxLines - 1 && lines.length > maxLines) {
        line += "…";
      }
      context.fillText(line, center, startY + i * lineHeight);
    }

    return drawCount;
  }

  function drawContainedImage(context, image, frame, radius = 16) {
    if (!image || !image.naturalWidth || !image.naturalHeight) {
      return;
    }

    const framePadding = 8;
    const availableWidth = Math.max(1, frame.w - framePadding * 2);
    const availableHeight = Math.max(1, frame.h - framePadding * 2);
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const frameRatio = availableWidth / availableHeight;
    let drawWidth = availableWidth;
    let drawHeight = availableHeight;

    if (imageRatio > frameRatio) {
      drawHeight = availableWidth / imageRatio;
    } else {
      drawWidth = availableHeight * imageRatio;
    }

    const drawX = frame.x + (frame.w - drawWidth) / 2;
    const drawY = frame.y + (frame.h - drawHeight) / 2;

    context.save();
    context.beginPath();
    context.roundRect(frame.x, frame.y, frame.w, frame.h, radius);
    context.clip();
    const frameGradient = context.createLinearGradient(frame.x, frame.y, frame.x, frame.y + frame.h);
    frameGradient.addColorStop(0, "rgba(15,23,42,0.9)");
    frameGradient.addColorStop(1, "rgba(30,41,59,0.88)");
    context.fillStyle = frameGradient;
    context.fillRect(frame.x, frame.y, frame.w, frame.h);
    context.drawImage(
      image,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    );
    context.restore();
  }

  const topGradient = ctx.createLinearGradient(0, 0, 0, height);
  topGradient.addColorStop(0, "#f8dca5");
  topGradient.addColorStop(0.35, "#f2a900");
  topGradient.addColorStop(0.68, "#02273b");
  topGradient.addColorStop(1, "#02273b");
  ctx.fillStyle = topGradient;
  ctx.fillRect(0, 0, width, height);

  const horizonY = height * 0.47;

  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#fff5cc";
  ctx.beginPath();
  ctx.arc(200, 190, 110, 0, 2 * Math.PI);
  ctx.fill();
  ctx.globalAlpha = 1;

  const seaGradient = ctx.createLinearGradient(0, horizonY, 0, height);
  seaGradient.addColorStop(0, "rgba(18,41,122,0.85)");
  seaGradient.addColorStop(1, "rgba(12,29,87,0.95)");
  ctx.fillStyle = seaGradient;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  ctx.fillStyle = "rgba(10,23,69,0.55)";
  ctx.beginPath();
  ctx.moveTo(0, horizonY + 30);
  ctx.lineTo(120, horizonY + 8);
  ctx.lineTo(220, horizonY - 22);
  ctx.lineTo(340, horizonY + 18);
  ctx.lineTo(470, horizonY - 8);
  ctx.lineTo(600, horizonY + 26);
  ctx.lineTo(760, horizonY - 3);
  ctx.lineTo(910, horizonY + 20);
  ctx.lineTo(1080, horizonY + 5);
  ctx.lineTo(1080, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const y = horizonY + 120 + 50 * i;
    ctx.beginPath();
    ctx.moveTo(80, y);
    ctx.bezierCurveTo(220, y - 18, 380, y + 20, 560, y);
    ctx.bezierCurveTo(730, y - 20, 910, y + 18, 1000, y);
    ctx.stroke();
  }

  const panel = { x: 60, y: 60, w: width - 120, h: height - 120 };
  ctx.fillStyle = "rgba(2, 6, 23, 0.68)";
  ctx.beginPath();
  ctx.roundRect(panel.x, panel.y, panel.w, panel.h, 36);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#f8fafc";
  ctx.font = '700 66px "Montserrat", "Avenir Next", "Segoe UI", sans-serif';
  ctx.fillText("CAMINO DAILY", centerX, 170);

  ctx.fillStyle = "rgba(226,232,240,0.95)";
  ctx.font = '500 32px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
  ctx.fillText(`Défi du ${dateLabel}`, centerX, 220);

  ctx.fillStyle = "#fde68a";
  ctx.font = '600 32px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
  ctx.fillText("Rue du jour", centerX, 280);

  ctx.fillStyle = "#ffffff";
  ctx.font = '700 42px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
  drawWrappedCenterText(streetName, centerX, ctx, 820, 338, 54, 2);

  const scoreCard = { x: centerX - 150, y: 410, w: 300, h: 170 };
  ctx.fillStyle = result.success ? "#1f9d66" : "#d2463c";
  ctx.beginPath();
  ctx.roundRect(scoreCard.x, scoreCard.y, scoreCard.w, scoreCard.h, 28);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = '700 82px "Montserrat", "Avenir Next", "Segoe UI", sans-serif';
  ctx.fillText(`${resultLabel}/7`, centerX, scoreCard.y + 98);
  ctx.font = '600 28px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
  ctx.fillText(result.success ? "Défi réussi" : "Défi non résolu", centerX, scoreCard.y + 140);

  const rowsStartY = 610;
  const rowHeight = 74;
  const photoPanelTop = rowsStartY + 2 * (rowHeight + 12) - 6;
  const photoPanelBottomInset = 70;
  const photoPanel = {
    x: centerX + 20,
    y: photoPanelTop,
    w: panel.x + panel.w - 70 - (centerX + 20),
    h: Math.max(320, panel.y + panel.h - photoPanelTop - photoPanelBottomInset),
  };
  const rowX = panel.x + 70;
  const rowRightLimit = photoPanel.x - 20;
  const rowWidth = Math.max(300, rowRightLimit - rowX);

  if (dailyGuessHistory.length > 0) {
    dailyGuessHistory.slice(0, 7).forEach((guess, index) => {
      const rowY = rowsStartY + index * (rowHeight + 12);
      const isFinalSuccessRow = result.success && index === dailyGuessHistory.length - 1;

      let accent = "#d2463c";
      if (isFinalSuccessRow || guess.distance < 500) {
        accent = "#1f9d66";
      } else if (guess.distance < 2000) {
        accent = "#a85a00";
      }

      ctx.fillStyle = "rgba(15,23,42,0.62)";
      ctx.beginPath();
      ctx.roundRect(rowX, rowY, rowWidth, rowHeight, 20);
      ctx.fill();

      ctx.strokeStyle = "rgba(148,163,184,0.25)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.fillStyle = "#e2e8f0";
      ctx.font = '600 30px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
      ctx.textAlign = "left";
      ctx.fillText(`#${index + 1}`, rowX + 24, rowY + 47);

      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(rowX + 112, rowY + 14, 42, 42, 10);
      ctx.fill();

      ctx.fillStyle = "#f8fafc";
      ctx.font = '600 34px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
      ctx.fillText(isFinalSuccessRow ? "🏁" : guess.arrow || "•", rowX + 174, rowY + 49);

      ctx.fillStyle = isFinalSuccessRow ? "#86efac" : "#e2e8f0";
      ctx.font = '600 30px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
      ctx.fillText(
        isFinalSuccessRow ? "Trouvé !" : formatDailyDistanceForShare(guess.distance),
        rowX + 224,
        rowY + 48,
      );
    });
  } else {
    ctx.fillStyle = "rgba(226,232,240,0.9)";
    ctx.font = '600 30px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
    ctx.fillText("Aucun essai enregistré", rowX, rowsStartY + 44);
  }

  ctx.fillStyle = "rgba(15,23,42,0.82)";
  ctx.beginPath();
  ctx.roundRect(photoPanel.x, photoPanel.y, photoPanel.w, photoPanel.h, 20);
  ctx.fill();

  ctx.strokeStyle = "rgba(148,163,184,0.3)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const bestCenterX = photoPanel.x + photoPanel.w / 2;
  const photoHostY = photoPanel.y + photoPanel.h - 24;
  const photoTryAgainY = photoHostY - 32;
  const photoDistanceY = photoTryAgainY - 32;
  const photoFrame = {
    x: photoPanel.x + 20,
    y: photoPanel.y + 58,
    w: photoPanel.w - 40,
    h: Math.max(140, photoPanel.h - 190),
  };
  ctx.textAlign = "center";
  ctx.fillStyle = "#f8fafc";
  ctx.font = '700 28px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
  ctx.fillText("🖼️ Indice visuel", bestCenterX, photoPanel.y + 34);

  ctx.fillStyle = "rgba(30,41,59,0.65)";
  ctx.beginPath();
  ctx.roundRect(photoFrame.x, photoFrame.y, photoFrame.w, photoFrame.h, 16);
  ctx.fill();

  ctx.strokeStyle = "rgba(148,163,184,0.35)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.roundRect(photoFrame.x, photoFrame.y, photoFrame.w, photoFrame.h, 16);
  ctx.stroke();

  ctx.fillStyle = "rgba(226,232,240,0.85)";
  ctx.font = '600 22px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
  ctx.fillText(
    dailyImageUrl ? "Chargement photo…" : "Photo non disponible",
    bestCenterX,
    photoFrame.y + photoFrame.h / 2 + 8,
  );

  ctx.fillStyle = "#cbd5e1";
  ctx.font = '500 22px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
  ctx.fillText(`🎯 Meilleure distance: ${bestDistanceLabel}`, bestCenterX, photoDistanceY);
  ctx.fillText("Essaie de faire mieux sur", bestCenterX, photoTryAgainY);

  ctx.fillStyle = "#93c5fd";
  ctx.font = '700 24px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
  ctx.fillText("parici.netlify.app", bestCenterX, photoHostY);

  const finalizeShareImage = () => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        showMessage("Erreur lors de la génération", "error");
        return;
      }

      const file = new File([blob], "parici-daily.png", { type: "image/png" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: "Parici - Défi Quotidien",
            text: `${dailyTargetData.streetName} • ${resultLabel}/7\nEssaie de faire mieux sur parici.netlify.app`,
            files: [file],
          });
          showMessage("Partagé !", "success");
          return;
        } catch (error) {
          if (error.name === "AbortError") {
            return;
          }
        }
      }

      if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          showMessage("Image copiée dans le presse-papier !", "success");
          return;
        } catch (error) {
          // fallback to download below
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "parici-daily.png";
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      showMessage("Image téléchargée !", "success");
    }, "image/png");
  };

  if (dailyImageUrl) {
    const dailyImage = new Image();
    dailyImage.decoding = "async";
    dailyImage.onload = () => {
      drawContainedImage(ctx, dailyImage, photoFrame, 14);
      ctx.strokeStyle = "rgba(226,232,240,0.75)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(photoFrame.x, photoFrame.y, photoFrame.w, photoFrame.h, 14);
      ctx.stroke();
      finalizeShareImage();
    };
    dailyImage.onerror = () => {
      ctx.fillStyle = "rgba(254,226,226,0.92)";
      ctx.font = '600 22px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
      ctx.fillText("Photo indisponible", bestCenterX, photoFrame.y + photoFrame.h / 2 + 8);
      finalizeShareImage();
    };
    dailyImage.src = dailyImageUrl;
    return;
  }

  finalizeShareImage();
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
      handleDailyShareImage(result);
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
