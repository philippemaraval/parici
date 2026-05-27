function getBadgeDefinitions(hasReachedGlobalRank, hasReachedVilleRank) {
  return [
    {
      id: "first_game",
      emoji: "🎮",
      name: "Première Partie",
      desc: "Terminer une session",
      check: (profile) => (parseInt(profile.overall?.total_games) || 0) >= 1,
    },
    {
      id: "games_10",
      emoji: "🔟",
      name: "25 Parties",
      desc: "Jouer 25 sessions",
      check: (profile) => (parseInt(profile.overall?.total_games) || 0) >= 25,
    },
    {
      id: "games_50",
      emoji: "💯",
      name: "Habitué",
      desc: "Jouer 100 sessions",
      check: (profile) => (parseInt(profile.overall?.total_games) || 0) >= 100,
    },
    {
      id: "games_100",
      emoji: "💎",
      name: "Vétéran",
      desc: "Jouer 250 sessions",
      check: (profile) => (parseInt(profile.overall?.total_games) || 0) >= 250,
    },
    {
      id: "minot",
      emoji: "🧒",
      name: "Titi Parisien",
      desc: "Atteindre Titi Parisien dans tous les modes et toutes les zones globales (hors Paname entier)",
      check: (profile) => hasReachedGlobalRank(profile, "M"),
    },
    {
      id: "habitue",
      emoji: "⚓",
      name: "Habitué des Quais",
      desc: "Atteindre Habitué dans tous les modes et toutes les zones globales (hors Paname entier)",
      check: (profile) => hasReachedGlobalRank(profile, "H"),
    },
    {
      id: "vrai",
      emoji: "💪",
      name: "Vrai Parigot",
      desc: "Atteindre Vrai Parigot dans tous les modes et toutes les zones globales (hors Paname entier)",
      check: (profile) => hasReachedGlobalRank(profile, "V"),
    },
    {
      id: "maire",
      emoji: "🏛️",
      name: "Préfet de Paris",
      desc: "Atteindre Préfet de Paris dans tous les modes et toutes les zones globales (hors Paname entier)",
      check: (profile) => hasReachedGlobalRank(profile, "MV"),
    },
    {
      id: "ville_minot",
      emoji: "🚀",
      name: "Astronaute",
      desc: "Atteindre Titi Parisien sur Paname entier (Classique, Marathon, Chrono)",
      check: (profile) => hasReachedVilleRank(profile, "M"),
    },
    {
      id: "ville_habitue",
      emoji: "⭐️",
      name: "Étoile",
      desc: "Atteindre Habitué sur Paname entier (Classique, Marathon, Chrono)",
      check: (profile) => hasReachedVilleRank(profile, "H"),
    },
    {
      id: "ville_vrai",
      emoji: "🛸",
      name: "Extraterrestre",
      desc: "Atteindre Vrai Parigot sur Paname entier (Classique, Marathon, Chrono)",
      check: (profile) => hasReachedVilleRank(profile, "V"),
    },
    {
      id: "ville_maire",
      emoji: "👽",
      name: "L'Ovni",
      desc: "Atteindre Préfet de Paris sur Paname entier (Classique, Marathon, Chrono)",
      check: (profile) => hasReachedVilleRank(profile, "MV"),
    },
    {
      id: "celebres",
      emoji: "⭐",
      name: "Étoile de l’Étoile",
      desc: "Jouer en Rues Célèbres",
      check: (profile) => (profile.modes || []).some((modeEntry) => modeEntry.mode === "rues-celebres"),
    },
    {
      id: "ville",
      emoji: "🏙️",
      name: "Explorateur de Paname",
      desc: "Jouer en Paname entier",
      check: (profile) => (profile.modes || []).some((modeEntry) => modeEntry.mode === "ville"),
    },
    {
      id: "monuments",
      emoji: "🗿",
      name: "Touriste Culturel",
      desc: "Jouer en mode Monuments",
      check: (profile) => (profile.modes || []).some((modeEntry) => modeEntry.mode === "monuments"),
    },
    {
      id: "all_zones",
      emoji: "🧭",
      name: "Globe-trotter",
      desc: "Jouer dans chaque zone",
      check: (profile) => {
        const playedModes = new Set((profile.modes || []).map((modeEntry) => modeEntry.mode));
        return [
          "ville",
          "arrondissement",
          "rues-principales",
          "rues-celebres",
          "monuments",
          "arrondissements-ville",
        ].every((mode) => playedModes.has(mode));
      },
    },
    {
      id: "daily_first",
      emoji: "📅",
      name: "Premier Daily",
      desc: "Réussir un Daily Challenge",
      check: (profile) => (parseInt(profile.daily?.successes) || 0) >= 1,
    },
    {
      id: "daily_5",
      emoji: "🔥",
      name: "Série de 10",
      desc: "10 Daily Challenges réussis d'affilée",
      check: (profile) => (parseInt(profile.daily?.max_streak) || 0) >= 10,
    },
    {
      id: "daily_10",
      emoji: "⚡",
      name: "Série de 20",
      desc: "20 Daily Challenges réussis d'affilée",
      check: (profile) => (parseInt(profile.daily?.max_streak) || 0) >= 20,
    },
    {
      id: "daily_30",
      emoji: "🏆",
      name: "Champion du Mois",
      desc: "50 Daily Challenges réussis d'affilée",
      check: (profile) => (parseInt(profile.daily?.max_streak) || 0) >= 50,
    },
    {
      id: "perfect",
      emoji: "🎯",
      name: "Sans Faute",
      desc: "Score de 100 dans une session",
      check: (profile) => (parseFloat(profile.overall?.best_score) || 0) >= 100,
    },
    {
      id: "multi_mode",
      emoji: "🌟",
      name: "Polyvalent",
      desc: "Jouer dans 3 modes de jeu différents",
      check: (profile) => new Set((profile.modes || []).map((modeEntry) => modeEntry.game_type)).size >= 3,
    },
  ];
}

export function computeBadgesRuntime(profile, hasReachedGlobalRank, hasReachedVilleRank) {
  return getBadgeDefinitions(hasReachedGlobalRank, hasReachedVilleRank).map((definition) => ({
    ...definition,
    unlocked: definition.check(profile),
  }));
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getProfileErrorMessage(error) {
  const raw = typeof error?.message === "string" ? error.message.trim() : "";
  if (!raw) {
    return "Erreur inconnue";
  }
  return raw.length > 140 ? `${raw.slice(0, 137)}...` : raw;
}

function isAuthFailureStatus(status) {
  return status === 401 || status === 403;
}

function weightedAverage(rows, key) {
  let weightTotal = 0;
  let weightedSum = 0;
  rows.forEach((row) => {
    const weight = toNumber(row?.games_played, 0);
    const value = toNumber(row?.[key], 0);
    if (weight > 0) {
      weightTotal += weight;
      weightedSum += value * weight;
    }
  });
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}

function getTrendMeta(weeklyProgress) {
  const currentWindow = weeklyProgress.slice(-4);
  const previousWindow = weeklyProgress.slice(-8, -4);
  const currentAvg = weightedAverage(currentWindow, "avg_score");
  const previousAvg = weightedAverage(previousWindow, "avg_score");
  if (previousAvg <= 0 && currentAvg <= 0) {
    return { icon: "→", label: "Stable", delta: 0 };
  }
  if (previousAvg <= 0) {
    return { icon: "↗", label: "En hausse", delta: currentAvg };
  }
  const delta = currentAvg - previousAvg;
  if (delta > 1) {
    return { icon: "↗", label: "En hausse", delta };
  }
  if (delta < -1) {
    return { icon: "↘", label: "En baisse", delta };
  }
  return { icon: "→", label: "Stable", delta };
}

function getModeLabel(mode, zoneLabels) {
  return zoneLabels?.[mode] || mode || "—";
}

function getHeatClass(gamesPlayed, successRate) {
  if (gamesPlayed < 3) {
    return "profile-heat--unknown";
  }
  if (successRate >= 70) {
    return "profile-heat--known";
  }
  if (successRate >= 45) {
    return "profile-heat--mid";
  }
  return "profile-heat--weak";
}

function buildProfileCompactStatsHTML(profile, zoneLabels) {
  const weeklyProgress = Array.isArray(profile.weekly_progress) ? profile.weekly_progress : [];
  const arrondissementStats = Array.isArray(profile.arrondissement_stats) ? profile.arrondissement_stats : [];
  const difficultyStats = Array.isArray(profile.difficulty_stats) ? profile.difficulty_stats : [];

  const globalSuccessRate = weightedAverage(difficultyStats, "success_rate");
  const globalAvgTime = weightedAverage(difficultyStats, "avg_time_sec");
  const trend = getTrendMeta(weeklyProgress);

  const weakestMode = [...difficultyStats]
    .filter((row) => toNumber(row.games_played) > 2)
    .sort((left, right) => toNumber(left.success_rate) - toNumber(right.success_rate))[0];
  const insight = weakestMode
    ? `Zone à travailler: ${getModeLabel(weakestMode.mode, zoneLabels)} (${toNumber(weakestMode.success_rate).toFixed(1)}% de réussite).`
    : "Joue quelques sessions pour débloquer des insights personnalisés.";

  const maxWeeklyGames = Math.max(1, ...weeklyProgress.map((row) => toNumber(row.games_played, 0)));
  const weeklyChartHtml = weeklyProgress.length > 0
    ? weeklyProgress
      .map((row) => {
        const gamesPlayed = toNumber(row.games_played, 0);
        const barHeight = gamesPlayed > 0 ? Math.max(4, Math.round((gamesPlayed / maxWeeklyGames) * 44)) : 2;
        const avgScore = toNumber(row.avg_score, 0).toFixed(1);
        return `
          <div class="profile-weekly-col" title="${row.label} : ${gamesPlayed} parties • score moyen ${avgScore}">
            <div class="profile-weekly-bar" style="height:${barHeight}px"></div>
            <span class="profile-weekly-col-label">${row.label}</span>
          </div>`;
      })
      .join("")
    : '<p class="profile-stats-empty">Pas assez de sessions pour afficher une évolution.</p>';

  const heatChipsHtml = arrondissementStats.length > 0
    ? arrondissementStats.slice(0, 24).map((row) => {
      const gamesPlayed = toNumber(row.games_played, 0);
      const successRate = toNumber(row.success_rate, 0);
      const heatClass = getHeatClass(gamesPlayed, successRate);
      return `<span class="profile-heat-chip ${heatClass}" title="${row.arrondissement_name}: ${successRate.toFixed(1)}% • ${gamesPlayed} parties">${row.arrondissement_name}</span>`;
    }).join("")
    : '<p class="profile-stats-empty">Aucune donnée arrondissement pour le moment.</p>';

  const arrondissementRowsHtml = arrondissementStats.length > 0
    ? arrondissementStats.slice(0, 10).map((row) => `
      <tr>
        <td>${row.arrondissement_name}</td>
        <td>${toNumber(row.success_rate, 0).toFixed(1)}%</td>
        <td>${toNumber(row.avg_time_sec, 0).toFixed(1)} s</td>
      </tr>`).join("")
    : '<tr><td colspan="3">Aucune donnée disponible.</td></tr>';

  const orderedModes = ["rues-celebres", "arrondissements-ville", "rues-principales", "arrondissement", "ville", "monuments"];
  const difficultyMap = new Map(difficultyStats.map((row) => [row.mode, row]));
  const difficultyRows = orderedModes
    .filter((mode) => difficultyMap.has(mode))
    .map((mode) => difficultyMap.get(mode));

  const difficultyBarsHtml = difficultyRows.length > 0
    ? difficultyRows.map((row) => {
      const successRate = Math.max(0, Math.min(100, toNumber(row.success_rate, 0)));
      const avgTime = toNumber(row.avg_time_sec, 0);
      return `
        <div class="profile-difficulty-row">
          <div class="profile-difficulty-head">
            <span>${getModeLabel(row.mode, zoneLabels)}</span>
            <span>${successRate.toFixed(1)}%</span>
          </div>
          <div class="profile-difficulty-bar-track">
            <div class="profile-difficulty-bar-fill" style="width:${successRate.toFixed(0)}%"></div>
          </div>
          <div class="profile-difficulty-meta">⏱ ${avgTime.toFixed(1)} s</div>
        </div>`;
    }).join("")
    : '<p class="profile-stats-empty">Aucune donnée de difficulté disponible.</p>';

  return `
    <section class="profile-compact-stats">
      <div class="profile-compact-header">Mes stats (compact)</div>
      <div class="profile-kpi-grid">
        <div class="profile-kpi-card">
          <span class="profile-kpi-value">${globalSuccessRate.toFixed(1)}%</span>
          <span class="profile-kpi-label">Réussite globale</span>
        </div>
        <div class="profile-kpi-card">
          <span class="profile-kpi-value">${globalAvgTime.toFixed(1)} s</span>
          <span class="profile-kpi-label">Temps moyen</span>
        </div>
        <div class="profile-kpi-card">
          <span class="profile-kpi-value">${trend.icon} ${trend.delta >= 0 ? "+" : ""}${trend.delta.toFixed(1)}</span>
          <span class="profile-kpi-label">Progression</span>
        </div>
      </div>
      <p class="profile-compact-insight">${insight}</p>

      <div class="profile-stats-accordion" id="profile-stats-accordion">
        <details class="profile-stats-section" open>
          <summary>Évolution hebdomadaire</summary>
          <div class="profile-stats-section-content">
            <div class="profile-weekly-chart">${weeklyChartHtml}</div>
          </div>
        </details>

        <details class="profile-stats-section">
          <summary>Carte de chaleur arrondissements</summary>
          <div class="profile-stats-section-content">
            <div class="profile-heat-grid">${heatChipsHtml}</div>
          </div>
        </details>

        <details class="profile-stats-section">
          <summary>Temps moyen par arrondissement</summary>
          <div class="profile-stats-section-content">
            <table class="profile-mini-table">
              <thead>
                <tr><th>Arrondissement</th><th>Réussite</th><th>Temps</th></tr>
              </thead>
              <tbody>${arrondissementRowsHtml}</tbody>
            </table>
          </div>
        </details>

        <details class="profile-stats-section">
          <summary>Réussite par difficulté</summary>
          <div class="profile-stats-section-content">
            <div class="profile-difficulty-list">${difficultyBarsHtml}</div>
          </div>
        </details>
      </div>
    </section>`;
}

function bindSingleOpenAccordion(container) {
  const accordion = container?.querySelector("#profile-stats-accordion");
  if (!accordion) {
    return;
  }
  const sections = Array.from(accordion.querySelectorAll("details"));
  sections.forEach((section) => {
    section.addEventListener("toggle", () => {
      if (!section.open) {
        return;
      }
      sections.forEach((other) => {
        if (other !== section) {
          other.open = false;
        }
      });
    });
  });
}

export function renderUserStickerRuntime(currentUser) {
  const sticker = document.getElementById("user-sticker");
  const loginHint = document.getElementById("login-hint");
  if (!sticker) {
    return;
  }

  if (currentUser && currentUser.username) {
    const avatarValue = currentUser.avatar || "👤";
    const avatarEl = document.createElement("span");
    const nameEl = document.createElement("span");
    avatarEl.className = "user-sticker-avatar";
    avatarEl.textContent = avatarValue;
    nameEl.className = "user-sticker-name";
    nameEl.textContent = currentUser.username;
    sticker.replaceChildren(avatarEl, nameEl);
    sticker.style.display = "inline-flex";
    if (loginHint) {
      loginHint.style.display = "none";
    }
    return;
  }

  sticker.textContent = "";
  sticker.style.display = "none";
  if (loginHint) {
    loginHint.style.display = "";
  }
}

export function updateUserUIRuntime({
  currentUser,
  renderUserSticker,
  loadProfile,
}) {
  const currentUserLabel = document.getElementById("current-user-label");
  const authBlock = document.querySelector(".auth-block");
  const logoutBtn = document.getElementById("logout-btn");
  const dailyModeBtn = document.getElementById("daily-mode-btn");
  const friendsChallengeBtn = document.getElementById("friends-challenge-toggle");

  if (currentUser && currentUser.username) {
    if (currentUserLabel) {
      currentUserLabel.textContent = `Connecté en tant que ${currentUser.username}`;
    }
    renderUserSticker();

    if (authBlock) {
      authBlock.querySelectorAll("input").forEach((input) => {
        input.style.display = "none";
      });
      authBlock
        .querySelectorAll("button:not(#logout-btn)")
        .forEach((button) => {
          button.style.display = "none";
        });
    }

    if (logoutBtn) {
      logoutBtn.style.display = "inline-block";
    }
    if (dailyModeBtn) {
      dailyModeBtn.style.display = "inline-flex";
    }
    if (friendsChallengeBtn) {
      friendsChallengeBtn.style.display = "inline-flex";
    }

    const profilePanel = document.getElementById("profile-panel");
    if (profilePanel) {
      profilePanel.style.display = "block";
    }
    loadProfile();
    return;
  }

  if (currentUserLabel) {
    currentUserLabel.textContent = "Non connecté.";
  }
  renderUserSticker();

  if (authBlock) {
    authBlock.querySelectorAll("input").forEach((input) => {
      input.style.display = "";
    });
    authBlock
      .querySelectorAll("button:not(#logout-btn)")
      .forEach((button) => {
        button.style.display = "";
      });
  }

  if (logoutBtn) {
    logoutBtn.style.display = "none";
  }
  if (dailyModeBtn) {
    dailyModeBtn.style.display = "none";
  }
  if (friendsChallengeBtn) {
    friendsChallengeBtn.style.display = "none";
  }

  const profilePanel = document.getElementById("profile-panel");
  if (profilePanel) {
    profilePanel.style.display = "none";
  }
}

export function loadProfileRuntime({
  currentUser,
  apiUrl,
  saveCurrentUserToStorage,
  renderUserSticker,
  getGlobalRankMeta,
  getPlayerTitle,
  zoneLabels,
  gameLabels,
  hasReachedGlobalRank,
  hasReachedVilleRank,
  initAvatarSelector,
  onProfileRendered,
  onAuthFailure,
}) {
  if (!currentUser || !currentUser.token) {
    return;
  }

  const profileContent = document.getElementById("profile-content");
  if (!profileContent) {
    return;
  }

  profileContent.innerHTML =
    '<div class="skeleton skeleton-avatar"></div><div class="skeleton skeleton-line skeleton-line--60"></div><div class="skeleton skeleton-block"></div><div class="skeleton skeleton-line skeleton-line--80"></div>';

  fetch(`${apiUrl}/api/profile`, {
    headers: { Authorization: `Bearer ${currentUser.token}` },
  })
    .then(async (response) => {
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        let errorCode = "";
        try {
          const payload = await response.json();
          if (payload && typeof payload.error === "string" && payload.error.trim()) {
            message = payload.error.trim();
          }
          if (payload && typeof payload.code === "string" && payload.code.trim()) {
            errorCode = payload.code.trim();
          }
        } catch (error) {
          // Keep default HTTP message if response body is not JSON.
        }
        const httpError = new Error(message);
        httpError.httpStatus = response.status;
        httpError.errorCode = errorCode;
        throw httpError;
      }
      return response.json();
    })
    .then((profile) => {
      try {
        if (currentUser) {
          const nextAvatar = profile.avatar || "👤";
          const nextUsername = profile.username || currentUser.username;
          const changed = currentUser.avatar !== nextAvatar || currentUser.username !== nextUsername;

          currentUser.avatar = nextAvatar;
          currentUser.username = nextUsername;

          if (changed) {
            saveCurrentUserToStorage(currentUser);
          }
          renderUserSticker();
        }

        const bestScore = parseFloat(profile.overall?.best_score) || 0;
        const globalRankMeta = getGlobalRankMeta(profile);
        const globalTitle = globalRankMeta.title;
        const totalGames = parseInt(profile.overall?.total_games) || 0;
        const averageScore = parseFloat(profile.overall?.avg_score) || 0;
        const dailyTotalDays = parseInt(profile.daily?.total_days) || 0;
        const dailySuccesses = parseInt(profile.daily?.successes) || 0;
        const dailyAverageAttempts = parseFloat(profile.daily?.avg_attempts) || 0;
        const memberSince = profile.memberSince
          ? new Date(profile.memberSince).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
          : "—";

        let html = `
          <div class="profile-header">
            <div class="profile-avatar">
              ${profile.avatar || "👤"}
              <button type="button" class="edit-avatar-badge" id="btn-edit-avatar" title="Changer d'avatar" aria-label="Changer d'avatar">✏️</button>
            </div>
            <div class="profile-info">
              <div class="profile-name">${profile.username}</div>
              <div class="profile-title">
                <a
                  href="/arbre-rangs.html"
                  class="profile-rank-link"
                  title="Afficher l'arbre d'avancement des rangs"
                >
                  ${globalTitle}
                </a>
              </div>
            </div>
          </div>

          <div class="profile-stats-grid">
            <div class="profile-stat">
              <span class="profile-stat-value">${totalGames}</span>
              <span class="profile-stat-label">Parties</span>
            </div>
            <div class="profile-stat">
              <span class="profile-stat-value">${bestScore.toFixed(1)}</span>
              <span class="profile-stat-label">Meilleur</span>
            </div>
            <div class="profile-stat">
              <span class="profile-stat-value">${averageScore}</span>
              <span class="profile-stat-label">Moyenne</span>
            </div>
            <div class="profile-stat">
              <span class="profile-stat-value">${dailySuccesses}/${dailyTotalDays}</span>
              <span class="profile-stat-label">Daily ✅</span>
            </div>
          </div>`;
        html += buildProfileCompactStatsHTML(profile, zoneLabels);

        if (profile.modes && profile.modes.length > 0) {
          html += '<details class="profile-section-collapsible">';
          html += '<summary class="profile-section-title">Détail par mode</summary>';
          html += '<div class="profile-modes">';
          profile.modes.forEach((modeEntry) => {
            const zoneLabel = zoneLabels[modeEntry.mode] || modeEntry.mode;
            const gameLabel = gameLabels[modeEntry.game_type] || modeEntry.game_type;
            const highScore = parseFloat(modeEntry.high_score) || 0;
            const scoreLabel =
              modeEntry.game_type === "classique"
                ? highScore.toFixed(1)
                : String(Math.round(highScore));
            const title = getPlayerTitle(
              highScore,
              modeEntry.mode,
              modeEntry.game_type,
              modeEntry.best_items_total || 0,
              modeEntry.best_items_correct || 0,
            );
            html += `
              <div class="profile-mode-row">
                <div class="profile-mode-name">${zoneLabel} — ${gameLabel}</div>
                <div class="profile-mode-details">
                  <span>🏆 ${scoreLabel}</span>
                  <span>📊 Ø${parseFloat(modeEntry.avg_score).toFixed(1)}</span>
                  <span>🎮 ${modeEntry.games_played}</span>
                </div>
                <div class="profile-mode-title">${title}</div>
              </div>`;
          });
          html += "</div></details>";
        }

        if (dailyTotalDays > 0) {
          html += `
            <div class="profile-daily-summary">
              <span>📅 Daily : ${dailyAverageAttempts} essais en moyenne</span>
              ${profile.daily?.current_streak > 0 ? `<br><span class="profile-daily-current-streak">🔥 Série actuelle : ${profile.daily.current_streak}</span>` : ""}
              ${profile.daily?.max_streak > 0 ? `<br><span class="profile-daily-best-streak">🏆 Meilleure série : ${profile.daily.max_streak}</span>` : ""}
            </div>`;
        }

        html += `
          <section class="profile-notification-card">
            <div class="profile-notification-title">Rappel Daily</div>
            <p id="daily-reminder-status" class="profile-notification-status">Chargement…</p>
            <div class="profile-notification-actions">
              <button type="button" id="daily-reminder-enable-btn" class="btn-secondary">Activer le rappel quotidien</button>
              <button type="button" id="daily-reminder-disable-btn" class="btn-tertiary hidden">Désactiver</button>
            </div>
          </section>`;

        const badges = computeBadgesRuntime(profile, hasReachedGlobalRank, hasReachedVilleRank);
        const unlocked = badges.filter((badge) => badge.unlocked);
        const locked = badges.filter((badge) => !badge.unlocked);

        html += `<details class="profile-section-collapsible">`;
        html += `<summary class="profile-badges-title">Succès (${unlocked.length}/${badges.length})</summary>`;
        html += '<div class="profile-badges-grid">';

        unlocked.forEach((badge) => {
          html += `<div class="profile-badge unlocked" tabindex="0" title="${badge.name}\n✅ ${badge.desc}" data-tooltip="${badge.name}\n✅ ${badge.desc}" aria-label="${badge.name} débloqué. ${badge.desc}">
            <span class="badge-emoji">${badge.emoji}</span>
            <span class="badge-name">${badge.name}</span>
          </div>`;
        });

        locked.forEach((badge) => {
          html += `<div class="profile-badge locked" tabindex="0" title="${badge.name}\n🔒 ${badge.desc}" data-tooltip="${badge.name}\n🔒 ${badge.desc}" aria-label="${badge.name} verrouillé. ${badge.desc}">
            <span class="badge-emoji">🔒</span>
            <span class="badge-name">${badge.name}</span>
          </div>`;
        });

        html += "</div></details>";
        html += `<div class="profile-member-since">Membre depuis le ${memberSince}</div>`;

        profileContent.innerHTML = html;
        initAvatarSelector(profile.avatar || "👤", globalRankMeta.level);
        bindSingleOpenAccordion(profileContent);
        if (typeof onProfileRendered === "function") {
          onProfileRendered();
        }
      } catch (renderError) {
        const reason = escapeHtml(getProfileErrorMessage(renderError));
        console.warn("Profile render error:", renderError?.message || renderError);
        profileContent.innerHTML = `<p class="profile-unavailable">Profil indisponible: ${reason}</p>`;
      }
    })
    .catch((error) => {
      if (isAuthFailureStatus(error?.httpStatus)) {
        if (typeof onAuthFailure === "function") {
          onAuthFailure(error);
          return;
        }
        profileContent.innerHTML = '<p class="profile-unavailable">Session expirée. Reconnectez-vous.</p>';
        return;
      }
      const reason = escapeHtml(getProfileErrorMessage(error));
      console.warn("Profile error:", error?.message || error);
      profileContent.innerHTML = `<p class="profile-unavailable">Profil indisponible: ${reason}</p>`;
    });
}

export function initAvatarSelectorRuntime({
  currentAvatar,
  globalRankLevel,
  renderAvatarGrid,
}) {
  const btnEdit = document.getElementById("btn-edit-avatar");
  const modal = document.getElementById("avatar-selector-modal");
  const closeBtn = document.getElementById("avatar-modal-close");
  const grid = document.getElementById("avatar-grid");
  const profileStatsGrid = document.querySelector(".profile-stats-grid");

  if (!btnEdit || !modal || !grid || !closeBtn) {
    return;
  }

  if (profileStatsGrid && profileStatsGrid.parentNode) {
    profileStatsGrid.parentNode.insertBefore(modal, profileStatsGrid.nextSibling);
  }

  btnEdit.addEventListener("click", () => {
    modal.style.display = "block";
    renderAvatarGrid(currentAvatar, globalRankLevel);
  });

  closeBtn.addEventListener("click", () => {
    modal.style.display = "none";
  });
}

export function renderAvatarGridRuntime({
  currentAvatar,
  globalRankLevel,
  avatarUnlocks,
  titleNames,
  currentUser,
  getGlobalRankLevelForTitleIndex,
  apiUrl,
  saveCurrentUserToStorage,
  updateUserUI,
  showMessage,
}) {
  const grid = document.getElementById("avatar-grid");
  if (!grid) {
    return;
  }

  grid.innerHTML = "";

  avatarUnlocks.forEach((avatarDef) => {
    let requiredLevel = 0;
    let isUnlocked = false;

    if (typeof avatarDef.check === "function") {
      isUnlocked = avatarDef.check(currentUser);
    } else {
      requiredLevel = getGlobalRankLevelForTitleIndex(avatarDef.reqTitleIdx);
      isUnlocked = globalRankLevel >= requiredLevel;
    }

    const item = document.createElement("button");
    item.type = "button";
    item.className = "avatar-item";
    item.textContent = avatarDef.emoji;

    if (avatarDef.emoji === currentAvatar) {
      item.classList.add("selected");
    }

    if (typeof avatarDef.check === "function") {
      if (!isUnlocked) {
        item.classList.add("locked");
        item.title = `Titre spécifique requis:\n🔒 ${avatarDef.name}\n(${avatarDef.desc})`;
        item.setAttribute("aria-disabled", "true");
      } else {
        item.title = `Débloqué:\n✅ ${avatarDef.name}\n- ${avatarDef.desc}`;
      }
    } else {
      const requiredTitle = titleNames[avatarDef.reqTitleIdx];
      if (!isUnlocked) {
        item.classList.add("locked");
        item.title = `Titre global requis:\n🔒 ${requiredTitle}\n(à atteindre dans tous les modes et zones)`;
        item.setAttribute("aria-disabled", "true");
      } else {
        item.title = `Débloqué:\n✅ ${requiredTitle} (global)`;
        if (avatarDef.desc) {
          item.title += ` - ${avatarDef.desc}`;
        }
      }
    }

    item.setAttribute("data-tooltip", item.title || "");

    if (isUnlocked) {
      item.addEventListener("click", () => {
        fetch(`${apiUrl}/api/profile/avatar`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentUser.token}`,
          },
          body: JSON.stringify({ avatar: avatarDef.emoji }),
        })
          .then((response) => {
            if (!response.ok) {
              throw new Error("Erreur sauvegarde avatar");
            }
            return response.json();
          })
          .then(() => {
            currentUser.avatar = avatarDef.emoji;
            saveCurrentUserToStorage(currentUser);
            updateUserUI();
            const modal = document.getElementById("avatar-selector-modal");
            if (modal) {
              modal.style.display = "none";
            }
            showMessage("Avatar mis à jour !", "success");
          })
          .catch((error) => {
            console.error(error);
            showMessage("Erreur lors de la sauvegarde de l'avatar", "error");
          });
      });
    }

    grid.appendChild(item);
  });
}

export function sendScoreToServerRuntime({
  isDailyMode,
  currentUser,
  apiUrl,
  payload,
  loadAllLeaderboards,
}) {
  if (isDailyMode || !currentUser || !currentUser.token) {
    return;
  }

  try {
    fetch(`${apiUrl}/api/scores`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentUser.token}`,
      },
      body: JSON.stringify({
        mode: payload.zoneMode,
        gameType: payload.gameMode,
        score: payload.score,
        itemsCorrect: payload.itemsCorrect,
        itemsTotal: payload.itemsTotal,
        timeSec: payload.totalTimeSec,
        arrondissementName: payload.arrondissementName,
        sessionId: payload.sessionId,
      }),
    })
      .then((response) => response.json())
      .then(() => {
        loadAllLeaderboards();
      })
      .catch((error) => {
        console.error("Erreur envoi score :", error);
      });
  } catch (error) {
    console.error("Erreur envoi score (synchrone) :", error);
  }
}
