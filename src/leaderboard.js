import { API_URL, LEADERBOARD_VISIBLE_ROWS } from "./config.js";

const TITLE_THRESHOLDS_BY_MODE = {
  classique: {
    "rues-celebres": { M: 60, H: 100, V: 140, MV: 180 },
    "arrondissements-ville": { M: 60, H: 100, V: 140, MV: 180 },
    "rues-principales": { M: 50, H: 90, V: 130, MV: 170 },
    arrondissement: { M: 40, H: 80, V: 120, MV: 160 },
    ville: { M: 30, H: 70, V: 110, MV: 150 },
    monuments: { M: 40, H: 80, V: 120, MV: 160 },
  },
  marathon: {
    "rues-celebres": { M: 10, H: 20, V: 35, MV: 55 },
    "arrondissements-ville": { M: 10, H: 20, V: 35, MV: 55 },
    "rues-principales": { M: 9, H: 18, V: 30, MV: 48 },
    ville: { M: 8, H: 16, V: 28, MV: 44 },
    monuments: { M: 9, H: 18, V: 30, MV: 46 },
  },
  chrono: {
    "rues-celebres": { M: 7, H: 11, V: 16, MV: 22 },
    "arrondissements-ville": { M: 7, H: 11, V: 16, MV: 22 },
    "rues-principales": { M: 6, H: 10, V: 14, MV: 19 },
    arrondissement: { M: 5, H: 8, V: 12, MV: 16 },
    ville: { M: 4, H: 7, V: 10, MV: 14 },
    monuments: { M: 5, H: 8, V: 12, MV: 16 },
  },
};

export const TITLE_NAMES = [
  "🏛️ Préfet de Paris",
  "💪 Vrai Parigot",
  "⚓ Habitué des Quais",
  "🧒 Titi Parisien",
  "🧳 Touriste",
];

const SCORING_GAME_TYPES = ["classique", "marathon", "chrono"];
const SCORING_ZONES = ["rues-celebres", "rues-principales", "arrondissement", "monuments", "arrondissements-ville"];

export const ZONE_LABELS = {
  ville: "Paname entier",
  "rues-principales": "Rues principales",
  "rues-celebres": "Rues célèbres",
  "arrondissements-ville": "Arrondissements",
  arrondissement: "Rues par arrondissement",
  monuments: "Monuments",
};

export const GAME_LABELS = {
  classique: "Classique",
  marathon: "Marathon",
  chrono: "Chrono",
  lecture: "Lecture",
};

const ZONE_ORDER = ["rues-celebres", "rues-principales", "arrondissement", "ville", "monuments", "arrondissements-ville"];
const GAME_ORDER = ["classique", "marathon", "chrono", "lecture"];

export function buildArrondissementMarathonThresholds(maxItems) {
  const total = Math.max(1, parseInt(maxItems, 10) || 55);
  const minot = Math.min(total, Math.max(1, Math.ceil(0.1 * total)));
  const habitue = Math.min(total, Math.max(minot + 1, Math.ceil(0.2 * total)));
  const vrai = Math.min(total, Math.max(habitue + 1, Math.ceil(0.35 * total)));
  const maire = Math.min(total, Math.max(vrai + 1, Math.ceil(0.55 * total)));
  return { M: minot, H: habitue, V: vrai, MV: maire };
}

export function getTitleThresholds(mode, gameType = "classique", maxItems = 0) {
  const modeThresholds = TITLE_THRESHOLDS_BY_MODE[gameType] || TITLE_THRESHOLDS_BY_MODE.classique;
  if (gameType === "marathon" && mode === "arrondissement") {
    return buildArrondissementMarathonThresholds(maxItems);
  }

  return (
    modeThresholds[mode] ||
    modeThresholds.arrondissement ||
    TITLE_THRESHOLDS_BY_MODE.classique[mode] ||
    TITLE_THRESHOLDS_BY_MODE.classique.arrondissement
  );
}

export function getTitleScoreValue(highScore, bestItemsCorrect, gameType = "classique") {
  if (gameType === "classique") {
    return parseFloat(highScore) || 0;
  }
  const parsedItems = parseFloat(bestItemsCorrect);
  return Number.isFinite(parsedItems) ? parsedItems : parseFloat(highScore) || 0;
}

export function getGlobalRankLevelForTitleIndex(titleIndex) {
  const parsed = parseInt(titleIndex, 10);
  return Math.max(0, 4 - (isNaN(parsed) ? 4 : parsed));
}

function getGlobalRankTitleFromLevel(level) {
  return level >= 4
    ? TITLE_NAMES[0]
    : level >= 3
      ? TITLE_NAMES[1]
      : level >= 2
        ? TITLE_NAMES[2]
        : level >= 1
          ? TITLE_NAMES[3]
          : TITLE_NAMES[4];
}

function buildScoringComboMap(userStats) {
  const combos = new Map();
  (userStats?.modes || []).forEach((modeStats) => {
    if (!modeStats || !SCORING_GAME_TYPES.includes(modeStats.game_type) || !SCORING_ZONES.includes(modeStats.mode)) {
      return;
    }
    combos.set(`${modeStats.mode}|${modeStats.game_type}`, modeStats);
  });
  return combos;
}

export function hasReachedGlobalRank(userStats, rankLetter) {
  const combos = buildScoringComboMap(userStats);
  return SCORING_GAME_TYPES.every((gameType) =>
    SCORING_ZONES.every((zoneMode) => {
      const combo = combos.get(`${zoneMode}|${gameType}`);
      if (!combo) {
        return false;
      }

      const thresholds = getTitleThresholds(zoneMode, gameType, combo.best_items_total || 0);
      const scoreValue = getTitleScoreValue(combo.high_score, combo.best_items_correct, gameType);
      return typeof thresholds?.[rankLetter] === "number" && scoreValue >= thresholds[rankLetter];
    }),
  );
}

function getGlobalRankLevel(userStats) {
  return hasReachedGlobalRank(userStats, "MV")
    ? 4
    : hasReachedGlobalRank(userStats, "V")
      ? 3
      : hasReachedGlobalRank(userStats, "H")
        ? 2
        : hasReachedGlobalRank(userStats, "M")
          ? 1
          : 0;
}

export function getGlobalRankMeta(userStats) {
  const level = getGlobalRankLevel(userStats);
  return { level, title: getGlobalRankTitleFromLevel(level) };
}

export function hasReachedVilleRank(userStats, rankLetter) {
  const combos = buildScoringComboMap(userStats);
  return SCORING_GAME_TYPES.every((gameType) => {
    const combo = combos.get(`ville|${gameType}`);
    if (!combo) {
      return false;
    }
    const thresholds = getTitleThresholds("ville", gameType, combo.best_items_total || 0);
    const scoreValue = getTitleScoreValue(combo.high_score, combo.best_items_correct, gameType);
    return typeof thresholds?.[rankLetter] === "number" && scoreValue >= thresholds[rankLetter];
  });
}

export const AVATAR_UNLOCKS = [
  { emoji: "👤", reqScore: 0, reqTitleIdx: 4 },
  { emoji: "🧑", reqScore: 0, reqTitleIdx: 4 },
  { emoji: "👧", reqScore: 0, reqTitleIdx: 4 },

  { emoji: "🧒", reqScore: 50, reqTitleIdx: 3 },
  { emoji: "🛴", reqScore: 50, reqTitleIdx: 3 },
  { emoji: "🍕", reqScore: 50, reqTitleIdx: 3 },

  { emoji: "⚓", reqScore: 80, reqTitleIdx: 2 },
  { emoji: "🐟", reqScore: 80, reqTitleIdx: 2 },
  { emoji: "⛵", reqScore: 80, reqTitleIdx: 2 },
  { emoji: "🌊", reqScore: 80, reqTitleIdx: 2 },

  { emoji: "💪", reqScore: 120, reqTitleIdx: 1 },
  { emoji: "☀️", reqScore: 120, reqTitleIdx: 1 },
  { emoji: "🏖️", reqScore: 120, reqTitleIdx: 1 },
  { emoji: "😎", reqScore: 120, reqTitleIdx: 1 },

  { emoji: "🏛️", reqScore: 150, reqTitleIdx: 0 },
  { emoji: "🦅", reqScore: 150, reqTitleIdx: 0, desc: "Gabian" },
  { emoji: "⚽", reqScore: 150, reqTitleIdx: 0 },
  { emoji: "👑", reqScore: 150, reqTitleIdx: 0 },

  {
    emoji: "🚀",
    name: "Astronaute",
    desc: "Atteindre Titi Parisien sur la Paname entier (Classique, Marathon, Chrono)",
    check: (userStats) => hasReachedVilleRank(userStats, "M"),
  },
  {
    emoji: "⭐️",
    name: "Étoile",
    desc: "Atteindre Habitué sur la Paname entier (Classique, Marathon, Chrono)",
    check: (userStats) => hasReachedVilleRank(userStats, "H"),
  },
  {
    emoji: "🛸",
    name: "Extraterrestre",
    desc: "Atteindre Vrai Parigot sur la Paname entier (Classique, Marathon, Chrono)",
    check: (userStats) => hasReachedVilleRank(userStats, "V"),
  },
  {
    emoji: "👽",
    name: "L'Ovni",
    desc: "Atteindre Préfet de Paris sur la Paname entier (Classique, Marathon, Chrono)",
    check: (userStats) => hasReachedVilleRank(userStats, "MV"),
  },
];

export function getPlayerTitle(score, zoneMode, gameType = "classique", itemsTotal = 0, itemsCorrect = null) {
  const thresholds = getTitleThresholds(zoneMode, gameType, itemsTotal);
  const scoreValue = getTitleScoreValue(score, itemsCorrect, gameType);
  return scoreValue >= thresholds.MV
    ? TITLE_NAMES[0]
    : scoreValue >= thresholds.V
      ? TITLE_NAMES[1]
      : scoreValue >= thresholds.H
        ? TITLE_NAMES[2]
        : scoreValue >= thresholds.M
          ? TITLE_NAMES[3]
          : TITLE_NAMES[4];
}

function hasLeaderboardRows(boards) {
  return Object.values(boards || {}).some((rows) => Array.isArray(rows) && rows.length > 0);
}

function appendZoneLeaderboards(rootElement, boards) {
  const boardKeys = Object.keys(boards || {});
  const groupedByZone = {};

  boardKeys.forEach((key) => {
    const [zoneMode, gameType, arrondissementNameOrNull] = key.split("|");
    const rows = boards[key];
    if (!rows || rows.length === 0) {
      return;
    }
    if (!groupedByZone[zoneMode]) {
      groupedByZone[zoneMode] = {};
    }
    if (!groupedByZone[zoneMode][gameType]) {
      groupedByZone[zoneMode][gameType] = [];
    }
    groupedByZone[zoneMode][gameType].push({ arrondissementName: arrondissementNameOrNull || null, rows });
  });

  ZONE_ORDER.forEach((zoneMode) => {
    if (!groupedByZone[zoneMode]) {
      return;
    }

    const groupedByGameType = groupedByZone[zoneMode];
    const zoneDetails = document.createElement("details");
    zoneDetails.className = "leaderboard-zone-details";
    const zoneSummary = document.createElement("summary");
    zoneSummary.innerHTML = `<span class="leaderboard-zone-title">${ZONE_LABELS[zoneMode] || zoneMode}</span>`;
    zoneDetails.appendChild(zoneSummary);

    const zoneContent = document.createElement("div");
    zoneContent.className = "leaderboard-zone-content";

    GAME_ORDER.forEach((gameType) => {
      if (!groupedByGameType[gameType]) {
        return;
      }

      const sections = groupedByGameType[gameType];
      const modeContainer = document.createElement("div");
      modeContainer.className = "leaderboard-mode-container";

      const modeTitle = document.createElement("h4");
      modeTitle.className = "leaderboard-mode-title";
      modeTitle.textContent = GAME_LABELS[gameType] || gameType;
      modeContainer.appendChild(modeTitle);

      sections.sort((left, right) =>
        left.arrondissementName && right.arrondissementName
          ? left.arrondissementName.localeCompare(right.arrondissementName)
          : 0,
      );

      sections.forEach((sectionData) => {
        const isArrondissementSection = zoneMode === "arrondissement" && sectionData.arrondissementName && sectionData.arrondissementName !== "unknown";
        const section = document.createElement(isArrondissementSection ? "details" : "div");
        section.className = "leaderboard-section";

        if (isArrondissementSection) {
          const arrondissementSummary = document.createElement("summary");
          arrondissementSummary.className = "leaderboard-arrondissement-title";
          arrondissementSummary.textContent = sectionData.arrondissementName;
          section.appendChild(arrondissementSummary);
        }

        const table = document.createElement("table");
        table.className = "leaderboard-table";
        const thead = document.createElement("thead");
        const foundColumnLabel =
          zoneMode === "arrondissements-ville"
            ? "Arrondissements trouvés"
            : zoneMode === "monuments"
              ? "Monuments trouvés"
              : "Rues trouvées";
        let header = "<tr><th>#</th><th>Joueur</th>";
        header += gameType === "classique" ? "<th>Score</th>" : `<th>${foundColumnLabel}</th>`;
        if (gameType === "marathon") {
          header += "<th>Max zone</th>";
        }
        if (gameType === "chrono") {
          header += "<th>Temps</th>";
        }
        header += "</tr>";
        thead.innerHTML = header;
        table.appendChild(thead);

        const visibleTbody = document.createElement("tbody");
        const hiddenTbody = document.createElement("tbody");
        hiddenTbody.className = "leaderboard-hidden-rows";
        hiddenTbody.style.display = "none";

        sectionData.rows.forEach((row, index) => {
          const tr = document.createElement("tr");
          const rank = (index === 0 ? "🥇 " : index === 1 ? "🥈 " : index === 2 ? "🥉 " : "") || `${index + 1}`;
          const title = getPlayerTitle(
            row.high_score || 0,
            zoneMode,
            gameType,
            row.items_total || 0,
            row.items_correct || 0,
          );
          const playerAvatar = row.avatar || "👤";

          let rowHtml = `<td>${rank}</td><td><span class="leaderboard-avatar">${playerAvatar}</span>${row.username || "Anonyme"}<br><small class="leaderboard-player-meta">${title}</small></td>`;
          const scoreCell =
            gameType === "classique"
              ? typeof row.high_score === "number"
                ? row.high_score.toFixed(1)
                : "-"
              : `${row.items_correct || 0}`;
          rowHtml += `<td>${scoreCell}</td>`;
          if (gameType === "marathon") {
            rowHtml += `<td>${row.items_total || 0}</td>`;
          }
          if (gameType === "chrono") {
            rowHtml += `<td>${(row.time_sec || 0).toFixed(1)}s</td>`;
          }
          tr.innerHTML = rowHtml;

          if (index < LEADERBOARD_VISIBLE_ROWS) {
            visibleTbody.appendChild(tr);
          } else {
            hiddenTbody.appendChild(tr);
          }
        });

        table.appendChild(visibleTbody);
        table.appendChild(hiddenTbody);
        section.appendChild(table);

        if (sectionData.rows.length > LEADERBOARD_VISIBLE_ROWS) {
          const toggleWrap = document.createElement("div");
          toggleWrap.className = "leaderboard-toggle-wrap";
          const toggleButton = document.createElement("button");
          toggleButton.className = "leaderboard-toggle-btn";
          toggleButton.textContent = "▼ Voir les autres scores";
          toggleButton.onclick = () => {
            if (hiddenTbody.style.display === "none") {
              hiddenTbody.style.display = "table-row-group";
              toggleButton.textContent = "▲ Masquer les scores";
            } else {
              hiddenTbody.style.display = "none";
              toggleButton.textContent = "▼ Voir les autres scores";
            }
          };
          toggleWrap.appendChild(toggleButton);
          section.appendChild(toggleWrap);
        }

        modeContainer.appendChild(section);
      });

      zoneContent.appendChild(modeContainer);
    });

    zoneDetails.appendChild(zoneContent);
    rootElement.appendChild(zoneDetails);
  });
}

function getCurrentMonthlyLeaderboardLabel() {
  const label = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  }).format(new Date());
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatShortDate(dateValue) {
  if (!dateValue) {
    return "";
  }
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${dateValue}T12:00:00`));
}

function appendWeeklyDailyLeaderboard(rootElement, weeklyPayload) {
  const weeklyRows = Array.isArray(weeklyPayload?.rows) ? weeklyPayload.rows : [];
  const weeklyDetails = document.createElement("details");
  weeklyDetails.className = "leaderboard-zone-details";
  weeklyDetails.open = true;

  const weeklySummary = document.createElement("summary");
  const rangeLabel =
    weeklyPayload?.weekStart && weeklyPayload?.weekEnd
      ? ` — ${formatShortDate(weeklyPayload.weekStart)} au ${formatShortDate(weeklyPayload.weekEnd)}`
      : "";
  weeklySummary.innerHTML = `<span class="leaderboard-zone-title">Classement Daily hebdomadaire${rangeLabel}</span>`;
  weeklyDetails.appendChild(weeklySummary);

  const weeklyContent = document.createElement("div");
  weeklyContent.className = "leaderboard-zone-content";

  if (weeklyRows.length === 0) {
    weeklyContent.innerHTML = "<p>Aucun score Daily cette semaine.</p>";
    weeklyDetails.appendChild(weeklyContent);
    rootElement.appendChild(weeklyDetails);
    return;
  }

  const table = document.createElement("table");
  table.className = "leaderboard-table";
  table.innerHTML = "<thead><tr><th>#</th><th>Joueur</th><th>Réussites</th><th>Essais</th><th>Meilleur écart</th></tr></thead>";

  const tbody = document.createElement("tbody");
  weeklyRows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const rank = (index === 0 ? "🥇 " : index === 1 ? "🥈 " : index === 2 ? "🥉 " : "") || `${index + 1}`;
    const playerAvatar = row.avatar || "👤";
    const bestDistance =
      row.best_distance_meters === null || row.best_distance_meters === undefined
        ? "—"
        : `${Math.round(row.best_distance_meters)}m`;
    tr.innerHTML = `<td>${rank}</td><td><span class="leaderboard-avatar">${playerAvatar}</span>${row.username || "Anonyme"}<br><small class="leaderboard-player-meta">${row.days_played || 0} Daily joué${row.days_played > 1 ? "s" : ""}</small></td><td>${row.successes || 0}</td><td>${row.total_attempts || 0}</td><td>${bestDistance}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const modeContainer = document.createElement("div");
  modeContainer.className = "leaderboard-mode-container";
  const modeTitle = document.createElement("h4");
  modeTitle.className = "leaderboard-mode-title";
  modeTitle.textContent = "Semaine lundi-dimanche";
  modeContainer.appendChild(modeTitle);

  const section = document.createElement("div");
  section.className = "leaderboard-section";
  section.appendChild(table);
  modeContainer.appendChild(section);

  weeklyContent.appendChild(modeContainer);
  weeklyDetails.appendChild(weeklyContent);
  rootElement.appendChild(weeklyDetails);
}

export function loadAllLeaderboards() {
  const leaderboardRoot = document.getElementById("leaderboard");
  if (!leaderboardRoot) {
    return;
  }

  leaderboardRoot.innerHTML =
    '<div class="skeleton skeleton-line skeleton-line--50"></div><div class="skeleton skeleton-block"></div><div class="skeleton skeleton-block"></div>';

  Promise.all([
    fetch(`${API_URL}/api/leaderboards`).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    }),
    fetch(`${API_URL}/api/leaderboards?period=month`).then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    }),
    fetch(`${API_URL}/api/daily/leaderboard`)
      .then((response) => (response.ok ? response.json() : []))
      .catch(() => []),
    fetch(`${API_URL}/api/daily/leaderboard/weekly`)
      .then((response) => (response.ok ? response.json() : { rows: [] }))
      .catch(() => ({ rows: [] })),
  ])
    .then(([allBoards, monthlyBoards, dailyRows, weeklyDaily]) => {
      const hasAllTimeRows = hasLeaderboardRows(allBoards);
      const hasMonthlyRows = hasLeaderboardRows(monthlyBoards);
      const hasDailyRows = !!(dailyRows && dailyRows.length > 0);
      const hasWeeklyRows = Array.isArray(weeklyDaily?.rows) && weeklyDaily.rows.length > 0;

      if (!hasAllTimeRows && !hasMonthlyRows && !hasDailyRows && !hasWeeklyRows) {
        leaderboardRoot.innerHTML = "<p>Aucun score enregistré.</p>";
        return;
      }

      leaderboardRoot.innerHTML = "";

      if (hasDailyRows) {
        const dailyDetails = document.createElement("details");
        dailyDetails.className = "leaderboard-zone-details";
        dailyDetails.open = true;

        const dailySummary = document.createElement("summary");
        const todayStr = new Intl.DateTimeFormat("fr-FR", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
        }).format(new Date());
        dailySummary.innerHTML = `<span class="leaderboard-zone-title">Daily du ${todayStr}</span>`;
        dailyDetails.appendChild(dailySummary);

        const dailyContent = document.createElement("div");
        dailyContent.className = "leaderboard-zone-content";

        const table = document.createElement("table");
        table.className = "leaderboard-table";
        table.innerHTML = "<thead><tr><th>#</th><th>Joueur</th><th>Résultat</th></tr></thead>";

        const tbody = document.createElement("tbody");
        dailyRows.forEach((row, index) => {
          const tr = document.createElement("tr");
          const rank = (index === 0 ? "🥇 " : index === 1 ? "🥈 " : index === 2 ? "🥉 " : "") || `${index + 1}`;
          const playerAvatar = row.avatar || "👤";
          const resultText = row.success 
            ? `${row.attempts_count}/7` 
            : `❌ ${Math.round(row.best_distance_meters || 0)}m`;
          tr.innerHTML = `<td>${rank}</td><td><span class="leaderboard-avatar">${playerAvatar}</span>${row.username || "Anonyme"}</td><td>${resultText}</td>`;
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        const modeContainer = document.createElement("div");
        modeContainer.className = "leaderboard-mode-container";
        const modeTitle = document.createElement("h4");
        modeTitle.className = "leaderboard-mode-title";
        modeTitle.textContent = "Défi du Jour";
        modeContainer.appendChild(modeTitle);

        const section = document.createElement("div");
        section.className = "leaderboard-section";
        section.appendChild(table);
        modeContainer.appendChild(section);

        dailyContent.appendChild(modeContainer);
        dailyDetails.appendChild(dailyContent);
        leaderboardRoot.appendChild(dailyDetails);
      }

      appendWeeklyDailyLeaderboard(leaderboardRoot, weeklyDaily);

      if (hasAllTimeRows) {
        appendZoneLeaderboards(leaderboardRoot, allBoards);
      }

      const monthlyDetails = document.createElement("details");
      monthlyDetails.className = "leaderboard-zone-details";
      monthlyDetails.open = true;
      const monthlySummary = document.createElement("summary");
      monthlySummary.innerHTML = `<span class="leaderboard-zone-title">Classement mensuel — ${getCurrentMonthlyLeaderboardLabel()}</span>`;
      monthlyDetails.appendChild(monthlySummary);

      const monthlyContent = document.createElement("div");
      monthlyContent.className = "leaderboard-zone-content";
      if (hasMonthlyRows) {
        appendZoneLeaderboards(monthlyContent, monthlyBoards);
      } else {
        monthlyContent.innerHTML = "<p>Aucun score ce mois-ci.</p>";
      }
      monthlyDetails.appendChild(monthlyContent);
      leaderboardRoot.appendChild(monthlyDetails);

      if (!hasDailyRows) {
        const firstDetails = leaderboardRoot.querySelector("details");
        if (firstDetails) {
          firstDetails.open = true;
        }
      }
    })
    .catch((error) => {
      console.warn("Leaderboard indisponible :", error.message);
      leaderboardRoot.innerHTML = "<p>Aucun score enregistré.</p>";
    });
}

export function loadLeaderboard() {
  loadAllLeaderboards();
}
