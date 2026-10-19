import { getDailySuccessComment } from "./daily-runtime.js";
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
  const performanceLabel =
    result.success
      ? getDailySuccessComment(result.attempts)
      : minDistance !== null && Number.isFinite(minDistance)
        ? `Meilleure distance: ${formatDailyDistanceForShare(minDistance)}`
        : "Meilleure distance: —";

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
  topGradient.addColorStop(0, "#d9f1e8");
  topGradient.addColorStop(0.35, "#1f9d66");
  topGradient.addColorStop(0.68, "#0f6f49");
  topGradient.addColorStop(1, "#064e3b");
  ctx.fillStyle = topGradient;
  ctx.fillRect(0, 0, width, height);

  const horizonY = height * 0.47;

  const seaGradient = ctx.createLinearGradient(0, horizonY, 0, height);
  seaGradient.addColorStop(0, "rgba(15,111,73,0.88)");
  seaGradient.addColorStop(1, "rgba(6,78,59,0.97)");
  ctx.fillStyle = seaGradient;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  const roofscape = [
    { x: -20, w: 145, top: 2, roof: 44, chimneys: [24, 104] },
    { x: 118, w: 132, top: 14, roof: 34, chimneys: [38] },
    { x: 242, w: 168, top: -6, roof: 50, chimneys: [32, 126] },
    { x: 402, w: 142, top: 10, roof: 38, chimneys: [98] },
    { x: 536, w: 172, top: -2, roof: 47, chimneys: [35, 139] },
    { x: 700, w: 130, top: 13, roof: 35, chimneys: [28] },
    { x: 822, w: 160, top: 3, roof: 45, chimneys: [119] },
    { x: 974, w: 130, top: 16, roof: 34, chimneys: [42, 94] },
  ];

  roofscape.forEach(({ x, w, top, roof, chimneys }, buildingIndex) => {
    const roofBaseY = horizonY + top;
    const bodyBottomY = horizonY + 112;
    ctx.fillStyle = buildingIndex % 2
      ? "rgba(3, 72, 54, 0.78)"
      : "rgba(2, 61, 47, 0.82)";
    ctx.fillRect(x, roofBaseY, w, bodyBottomY - roofBaseY);

    ctx.fillStyle = buildingIndex % 2
      ? "rgba(217,241,232,0.25)"
      : "rgba(167,243,208,0.22)";
    ctx.beginPath();
    ctx.moveTo(x - 8, roofBaseY);
    ctx.lineTo(x + 20, roofBaseY - roof);
    ctx.lineTo(x + w - 20, roofBaseY - roof);
    ctx.lineTo(x + w + 8, roofBaseY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(2,44,34,0.72)";
    chimneys.forEach((offset, chimneyIndex) => {
      const chimneyHeight = 18 + (chimneyIndex % 2) * 8;
      ctx.fillRect(x + offset, roofBaseY - roof - chimneyHeight + 5, 12, chimneyHeight);
      ctx.fillRect(x + offset - 2, roofBaseY - roof - chimneyHeight + 2, 16, 5);
    });

    ctx.fillStyle = "rgba(236,253,245,0.2)";
    for (let dormerX = x + 31; dormerX < x + w - 20; dormerX += 42) {
      ctx.fillRect(dormerX, roofBaseY - 24, 14, 17);
      ctx.beginPath();
      ctx.moveTo(dormerX - 2, roofBaseY - 24);
      ctx.lineTo(dormerX + 7, roofBaseY - 34);
      ctx.lineTo(dormerX + 16, roofBaseY - 24);
      ctx.closePath();
      ctx.fill();
    }
  });

  const eiffelCenterX = 874;
  const eiffelTopY = horizonY - 250;
  const eiffelBaseY = horizonY + 62;
  ctx.save();
  ctx.fillStyle = "rgba(2,44,34,0.9)";
  ctx.strokeStyle = "rgba(167,243,208,0.34)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(eiffelCenterX - 3, eiffelTopY);
  ctx.quadraticCurveTo(eiffelCenterX - 10, horizonY - 100, eiffelCenterX - 88, eiffelBaseY);
  ctx.lineTo(eiffelCenterX - 48, eiffelBaseY);
  ctx.quadraticCurveTo(eiffelCenterX - 15, horizonY - 95, eiffelCenterX, eiffelTopY + 12);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(eiffelCenterX + 3, eiffelTopY);
  ctx.quadraticCurveTo(eiffelCenterX + 10, horizonY - 100, eiffelCenterX + 88, eiffelBaseY);
  ctx.lineTo(eiffelCenterX + 48, eiffelBaseY);
  ctx.quadraticCurveTo(eiffelCenterX + 15, horizonY - 95, eiffelCenterX, eiffelTopY + 12);
  ctx.closePath();
  ctx.fill();

  ctx.fillRect(eiffelCenterX - 15, eiffelTopY + 62, 30, 7);
  ctx.fillRect(eiffelCenterX - 38, horizonY - 76, 76, 10);
  ctx.fillRect(eiffelCenterX - 71, horizonY - 7, 142, 13);

  ctx.lineWidth = 3;
  [
    { y: eiffelTopY + 93, half: 17 },
    { y: horizonY - 112, half: 30 },
    { y: horizonY - 42, half: 55 },
    { y: horizonY + 26, half: 76 },
  ].forEach(({ y, half }) => {
    ctx.beginPath();
    ctx.moveTo(eiffelCenterX - half, y);
    ctx.lineTo(eiffelCenterX + half, y);
    ctx.stroke();
  });

  ctx.lineWidth = 2;
  for (let level = 0; level < 6; level += 1) {
    const upperY = eiffelTopY + 70 + level * 38;
    const lowerY = upperY + 38;
    const upperHalf = 11 + level * 10;
    const lowerHalf = upperHalf + 10;
    ctx.beginPath();
    ctx.moveTo(eiffelCenterX - upperHalf, upperY);
    ctx.lineTo(eiffelCenterX + lowerHalf, lowerY);
    ctx.moveTo(eiffelCenterX + upperHalf, upperY);
    ctx.lineTo(eiffelCenterX - lowerHalf, lowerY);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(2,44,34,0.95)";
  ctx.fillRect(eiffelCenterX - 3, eiffelTopY - 29, 6, 32);
  ctx.fillRect(eiffelCenterX - 7, eiffelTopY + 45, 14, 20);
  ctx.restore();

  const panel = { x: 60, y: 60, w: width - 120, h: height - 120 };
  ctx.fillStyle = "rgba(2, 44, 34, 0.64)";
  ctx.beginPath();
  ctx.roundRect(panel.x, panel.y, panel.w, panel.h, 36);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#f8fafc";
  ctx.font = '700 66px "Montserrat", "Avenir Next", "Segoe UI", sans-serif';
  ctx.fillText("PARICI DAILY", centerX, 170);

  ctx.fillStyle = "rgba(226,232,240,0.95)";
  ctx.font = '500 32px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
  ctx.fillText(`Défi du ${dateLabel}`, centerX, 220);

  ctx.fillStyle = "#a7f3d0";
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
        accent = "#34d399";
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

      ctx.fillStyle = isFinalSuccessRow ? "#86efac" : "#e2e8f0";
      ctx.font = '600 30px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
      ctx.fillText(
        isFinalSuccessRow ? "Trouvé !" : formatDailyDistanceForShare(guess.distance),
        rowX + 174,
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
  const visualHintLabel = "Indice visuel";
  const visualHintIconSize = 24;
  const visualHintGap = 10;
  const visualHintTextWidth = ctx.measureText(visualHintLabel).width;
  const visualHintWidth = visualHintIconSize + visualHintGap + visualHintTextWidth;
  const visualHintX = bestCenterX - visualHintWidth / 2;
  const visualHintY = photoPanel.y + 34;

  // Draw the icon separately: Safari/iOS reports unreliable Canvas metrics for
  // colour emoji, which used to push the label to the right of the panel centre.
  ctx.save();
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.roundRect(visualHintX, visualHintY - 19, visualHintIconSize, 20, 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(visualHintX + 17, visualHintY - 13, 2.5, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(visualHintX + 3, visualHintY - 2);
  ctx.lineTo(visualHintX + 9, visualHintY - 9);
  ctx.lineTo(visualHintX + 13, visualHintY - 5);
  ctx.lineTo(visualHintX + 16, visualHintY - 8);
  ctx.lineTo(visualHintX + 21, visualHintY - 2);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "left";
  ctx.fillText(visualHintLabel, visualHintX + visualHintIconSize + visualHintGap, visualHintY);
  ctx.textAlign = "center";

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
  ctx.fillText(`🎯 ${performanceLabel}`, bestCenterX, photoDistanceY, photoPanel.w - 30);
  ctx.fillText("Essaie de faire mieux sur", bestCenterX, photoTryAgainY);

  ctx.fillStyle = "#6ee7b7";
  ctx.font = '700 24px "Nunito", "Avenir Next", "Segoe UI", sans-serif';
  ctx.fillText("parici-ajm.pages.dev", bestCenterX, photoHostY);

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
            text: `${dailyTargetData.streetName} • ${resultLabel}/7\nEssaie de faire mieux sur parici-ajm.pages.dev`,
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
