export function setupVisitStats(apiRequest) {
  const state = { visitStatsMode: "daily", visitStatsPayloads: {} };
  const refs = {
    openVisitStatsBtn: document.getElementById("open-visit-stats-btn"),
    visitStatsModal: document.getElementById("visit-stats-modal"),
    visitStatsPanel: document.querySelector("#visit-stats-modal .modal-panel"),
    closeVisitStatsBtn: document.getElementById("close-visit-stats-btn"),
    visitStatsDailyTab: document.getElementById("visit-stats-daily-tab"),
    visitStatsHourlyTab: document.getElementById("visit-stats-hourly-tab"),
    visitStatsSummary: document.getElementById("visit-stats-summary"),
    visitStatsAverages: document.getElementById("visit-stats-averages"),
    visitStatsAverage7: document.getElementById("visit-stats-average-7"),
    visitStatsAverage15: document.getElementById("visit-stats-average-15"),
    visitStatsAverage30: document.getElementById("visit-stats-average-30"),
    visitStatsNote: document.getElementById("visit-stats-note"),
    visitStatsChart: document.getElementById("visit-stats-chart"),
    visitStatsTableBody: document.getElementById("visit-stats-table-body"),
    visitStatsPeriodHeading: document.getElementById(
      "visit-stats-period-heading",
    ),
    visitStatsVisitsHeading: document.getElementById(
      "visit-stats-visits-heading",
    ),
    visitStatsUniqueHeading: document.getElementById(
      "visit-stats-unique-heading",
    ),
  };
  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return "-";
    }
    return new Intl.NumberFormat("fr-FR").format(number);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value || "");
    }
    return date.toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Europe/Paris",
    });
  }

  function formatDay(value) {
    if (!value) {
      return "-";
    }
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleDateString("fr-FR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  function formatShortDay(value) {
    if (!value) {
      return "";
    }
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    });
  }

  function getDateKeyInZone(date = new Date(), timeZone = "Europe/Paris") {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  }

  function addDaysToDateKey(dateKey, deltaDays) {
    const date = new Date(`${dateKey}T12:00:00`);
    date.setDate(date.getDate() + deltaDays);
    return date.toISOString().slice(0, 10);
  }

  function setVisitStatsLoading(message) {
    if (refs.visitStatsSummary) {
      refs.visitStatsSummary.textContent = message;
    }
    if (refs.visitStatsNote) {
      refs.visitStatsNote.textContent = "";
    }
    if (refs.visitStatsTableBody) {
      refs.visitStatsTableBody.innerHTML = "";
    }
    if (refs.visitStatsChart) {
      refs.visitStatsChart.textContent = "";
    }
    [
      refs.visitStatsAverage7,
      refs.visitStatsAverage15,
      refs.visitStatsAverage30,
    ]
      .filter(Boolean)
      .forEach((element) => {
        element.textContent = "—";
      });
  }

  function buildVisitChartRows(payload, dayCount = 30) {
    if (Array.isArray(payload?.chartRows) && payload.chartRows.length) {
      return payload.chartRows.slice(-dayCount).map((row) => ({
        day: row.day,
        uniqueVisitors: Number(row.uniqueVisitors || 0),
        totalVisits: Math.max(
          row.totalVisits === null || row.totalVisits === undefined
            ? 0
            : Number(row.totalVisits) || 0,
          Number(row.uniqueVisitors || 0),
        ),
        cumulativeTotal: Number(row.cumulativeTotal || 0),
      }));
    }
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const rowsByDay = new Map(rows.map((row) => [String(row.day || ""), row]));
    const endDay = getDateKeyInZone();
    const days = Array.from({ length: dayCount }, (_, index) =>
      addDaysToDateKey(endDay, index - dayCount + 1),
    );
    const dailyRows = days.map((day) => {
      const row = rowsByDay.get(day) || {};
      const totalVisits =
        row.totalVisits === null || row.totalVisits === undefined
          ? 0
          : Number(row.totalVisits) || 0;
      const uniqueVisitors = Number(row.uniqueVisitors || 0);
      return {
        day,
        totalVisits: Math.max(totalVisits, uniqueVisitors),
        uniqueVisitors,
      };
    });
    const allTimeTotal = Number(payload?.totalVisits || 0);
    let visitsAfterCurrentDay = 0;
    for (let index = dailyRows.length - 1; index >= 0; index -= 1) {
      dailyRows[index].cumulativeTotal = Math.max(
        0,
        allTimeTotal - visitsAfterCurrentDay,
      );
      visitsAfterCurrentDay += dailyRows[index].totalVisits;
    }
    return dailyRows;
  }

  function getAverageDailyUniqueVisitors(chartRows, dayCount) {
    const periodRows = chartRows.slice(-dayCount);
    if (!periodRows.length) {
      return 0;
    }
    const total = periodRows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.uniqueVisitors) || 0),
      0,
    );
    return total / periodRows.length;
  }

  function renderVisitStatsAverages(payload) {
    const chartRows = buildVisitChartRows(payload);
    const averageRefs = [
      [refs.visitStatsAverage7, 7],
      [refs.visitStatsAverage15, 15],
      [refs.visitStatsAverage30, 30],
    ];
    const formatter = new Intl.NumberFormat("fr-FR", {
      maximumFractionDigits: 1,
    });
    averageRefs.forEach(([element, dayCount]) => {
      if (element) {
        element.textContent = formatter.format(
          getAverageDailyUniqueVisitors(chartRows, dayCount),
        );
      }
    });
  }

  function renderVisitStatsChart(payload) {
    if (!refs.visitStatsChart) {
      return;
    }
    const chartRows = buildVisitChartRows(payload);
    if (!chartRows.length) {
      refs.visitStatsChart.textContent = "";
      return;
    }

    const width = 860;
    const height = 320;
    const margin = { top: 28, right: 78, bottom: 46, left: 54 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const maxDailyValue = Math.max(
      1,
      ...chartRows.map((row) => Math.max(row.totalVisits, row.uniqueVisitors)),
    );
    const cumulativeValues = chartRows.map((row) => row.cumulativeTotal);
    const cumulativeMin = Math.min(...cumulativeValues);
    const cumulativeMax = Math.max(...cumulativeValues);
    const cumulativeRange = Math.max(1, cumulativeMax - cumulativeMin);
    const bandWidth = plotWidth / chartRows.length;
    const barWidth = Math.max(3, Math.min(10, bandWidth * 0.28));

    const xForIndex = (index) =>
      margin.left + bandWidth * index + bandWidth / 2;
    const yForDaily = (value) =>
      margin.top + plotHeight - (value / maxDailyValue) * plotHeight;
    const yForCumulative = (value) =>
      margin.top +
      plotHeight -
      ((value - cumulativeMin) / cumulativeRange) * plotHeight;

    const gridLines = [0, 0.25, 0.5, 0.75, 1]
      .map((ratio) => {
        const y = margin.top + plotHeight - ratio * plotHeight;
        const label = formatNumber(Math.round(maxDailyValue * ratio));
        return `
        <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="visit-chart-grid" />
        <text x="${margin.left - 8}" y="${y + 4}" class="visit-chart-axis-label" text-anchor="end">${label}</text>
      `;
      })
      .join("");

    const cumulativeLabels = [cumulativeMin, cumulativeMax]
      .map((value) => {
        const y = yForCumulative(value);
        return `<text x="${width - margin.right + 8}" y="${y + 4}" class="visit-chart-axis-label visit-chart-axis-label--right">${formatNumber(value)}</text>`;
      })
      .join("");

    const bars = chartRows
      .map((row, index) => {
        const centerX = xForIndex(index);
        const totalHeight = Math.max(
          0,
          margin.top + plotHeight - yForDaily(row.totalVisits),
        );
        const uniqueHeight = Math.max(
          0,
          margin.top + plotHeight - yForDaily(row.uniqueVisitors),
        );
        return `
        <rect x="${centerX - barWidth - 1}" y="${yForDaily(row.totalVisits)}" width="${barWidth}" height="${totalHeight}" class="visit-chart-bar visit-chart-bar--total">
          <title>${formatDay(row.day)} - visites : ${formatNumber(row.totalVisits)}</title>
        </rect>
        <rect x="${centerX + 1}" y="${yForDaily(row.uniqueVisitors)}" width="${barWidth}" height="${uniqueHeight}" class="visit-chart-bar visit-chart-bar--unique">
          <title>${formatDay(row.day)} - visiteurs uniques : ${formatNumber(row.uniqueVisitors)}</title>
        </rect>
      `;
      })
      .join("");

    const linePoints = chartRows
      .map(
        (row, index) =>
          `${xForIndex(index)},${yForCumulative(row.cumulativeTotal)}`,
      )
      .join(" ");
    const lineDots = chartRows
      .map((row, index) => {
        const x = xForIndex(index);
        const y = yForCumulative(row.cumulativeTotal);
        return `<circle cx="${x}" cy="${y}" r="2.5" class="visit-chart-dot"><title>${formatDay(row.day)} - cumul total : ${formatNumber(row.cumulativeTotal)}</title></circle>`;
      })
      .join("");

    const xLabels = chartRows
      .filter(
        (_, index) =>
          index === 0 ||
          index === chartRows.length - 1 ||
          (index + 1) % 7 === 0,
      )
      .map((row, index, selectedRows) => {
        const originalIndex = chartRows.findIndex(
          (candidate) => candidate.day === row.day,
        );
        const anchor =
          index === 0
            ? "start"
            : index === selectedRows.length - 1
              ? "end"
              : "middle";
        return `<text x="${xForIndex(originalIndex)}" y="${height - 16}" class="visit-chart-axis-label" text-anchor="${anchor}">${formatShortDay(row.day)}</text>`;
      })
      .join("");

    refs.visitStatsChart.innerHTML = `
    <div class="visit-chart-legend">
      <span><i class="visit-chart-swatch visit-chart-swatch--total"></i>Visiteurs quotidiens</span>
      <span><i class="visit-chart-swatch visit-chart-swatch--unique"></i>Visiteurs uniques quotidiens</span>
      <span><i class="visit-chart-swatch visit-chart-swatch--line"></i>Total cumulé</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Visites quotidiennes, visiteurs uniques et total cumulé sur les 30 derniers jours">
      <text x="${margin.left}" y="18" class="visit-chart-title">30 derniers jours</text>
      <text x="${margin.left}" y="${height - 2}" class="visit-chart-axis-caption">Visites quotidiennes</text>
      <text x="${width - margin.right}" y="${height - 2}" class="visit-chart-axis-caption visit-chart-axis-caption--right" text-anchor="end">Total cumulé</text>
      ${gridLines}
      ${cumulativeLabels}
      <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" class="visit-chart-axis" />
      ${bars}
      <polyline points="${linePoints}" class="visit-chart-line" />
      ${lineDots}
      ${xLabels}
    </svg>
  `;
  }

  function renderVisitStats(payload) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (refs.visitStatsSummary) {
      const totalVisits = formatNumber(payload?.totalVisits);
      const dayCount = formatNumber(payload?.chartRows?.length || rows.length);
      refs.visitStatsSummary.textContent = `${totalVisits} visites au total sur ${dayCount} jours affichés.`;
    }
    if (refs.visitStatsNote) {
      refs.visitStatsNote.textContent =
        payload?.note ||
        "Les visites quotidiennes ne sont disponibles qu’à partir de l’activation du suivi.";
    }
    renderVisitStatsAverages(payload);
    renderVisitStatsChart(payload);
    if (!refs.visitStatsTableBody) {
      return;
    }
    if (!rows.length) {
      refs.visitStatsTableBody.innerHTML =
        '<tr><td colspan="3">Aucune donnée de visite disponible.</td></tr>';
      return;
    }
    refs.visitStatsTableBody.innerHTML = rows
      .map((row) => {
        const visits =
          row.totalVisits === null || row.totalVisits === undefined
            ? "Non suivi"
            : formatNumber(row.totalVisits);
        return `
        <tr>
          <td>${formatDay(row.day)}</td>
          <td>${visits}</td>
          <td>${formatNumber(row.uniqueVisitors)}</td>
        </tr>
      `;
      })
      .join("");
  }

  function formatHourRange(hour) {
    const normalizedHour = Math.max(0, Math.min(23, Number(hour) || 0));
    const nextHour = (normalizedHour + 1) % 24;
    return `${String(normalizedHour).padStart(2, "0")}h-${String(nextHour).padStart(2, "0")}h`;
  }

  function renderHourlyVisitStatsChart(payload) {
    if (!refs.visitStatsChart) {
      return;
    }
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (!rows.length) {
      refs.visitStatsChart.textContent = "";
      return;
    }

    const width = 860;
    const height = 300;
    const margin = { top: 28, right: 24, bottom: 46, left: 54 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const maxValue = Math.max(
      1,
      ...rows.map((row) => Number(row.averageVisits || 0)),
    );
    const bandWidth = plotWidth / rows.length;
    const barWidth = Math.max(6, bandWidth * 0.68);
    const yForValue = (value) =>
      margin.top + plotHeight - (Number(value || 0) / maxValue) * plotHeight;

    const gridLines = [0, 0.25, 0.5, 0.75, 1]
      .map((ratio) => {
        const y = margin.top + plotHeight - ratio * plotHeight;
        return `
        <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="visit-chart-grid" />
        <text x="${margin.left - 8}" y="${y + 4}" class="visit-chart-axis-label" text-anchor="end">${formatNumber(maxValue * ratio)}</text>
      `;
      })
      .join("");

    const bars = rows
      .map((row, index) => {
        const value = Number(row.averageVisits || 0);
        const x = margin.left + bandWidth * index + (bandWidth - barWidth) / 2;
        const y = yForValue(value);
        return `<rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(0, margin.top + plotHeight - y)}" class="visit-chart-bar visit-chart-bar--total"><title>${formatHourRange(row.hour)} : ${formatNumber(value)} visites par jour, ${formatNumber(row.averageUniqueVisitors)} visiteurs uniques par jour</title></rect>`;
      })
      .join("");

    const xLabels = rows
      .filter((row) => Number(row.hour) % 3 === 0 || Number(row.hour) === 23)
      .map((row) => {
        const index = rows.findIndex(
          (candidate) => Number(candidate.hour) === Number(row.hour),
        );
        const x = margin.left + bandWidth * index + bandWidth / 2;
        return `<text x="${x}" y="${height - 16}" class="visit-chart-axis-label" text-anchor="middle">${String(row.hour).padStart(2, "0")}h</text>`;
      })
      .join("");

    refs.visitStatsChart.innerHTML = `
    <div class="visit-chart-legend">
      <span><i class="visit-chart-swatch visit-chart-swatch--total"></i>Moyenne de sessions par jour</span>
    </div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Répartition des sessions par heure">
      <text x="${margin.left}" y="18" class="visit-chart-title">Moyenne journalière par heure</text>
      ${gridLines}
      <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" class="visit-chart-axis" />
      ${bars}
      ${xLabels}
    </svg>
  `;
  }

  function renderHourlyVisitStats(payload) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (refs.visitStatsSummary) {
      const firstSeen = payload?.firstSeenAt
        ? formatDateTime(payload.firstSeenAt)
        : "date inconnue";
      refs.visitStatsSummary.textContent = `Moyenne calculée sur ${formatNumber(payload?.dayCount)} jours suivis depuis le ${firstSeen}.`;
    }
    if (refs.visitStatsNote) {
      refs.visitStatsNote.textContent =
        payload?.note || "Heures affichées dans le fuseau Europe/Paris.";
    }
    renderHourlyVisitStatsChart(payload);
    if (!refs.visitStatsTableBody) {
      return;
    }
    refs.visitStatsTableBody.innerHTML =
      rows
        .map(
          (row) => `
      <tr>
        <td>${formatHourRange(row.hour)}</td>
        <td>${formatNumber(row.averageVisits)}</td>
        <td>${formatNumber(row.averageUniqueVisitors)}</td>
      </tr>
    `,
        )
        .join("") ||
      '<tr><td colspan="3">Aucune donnée horaire disponible.</td></tr>';
  }

  function updateVisitStatsTabs(mode) {
    const isHourly = mode === "hourly";
    refs.visitStatsDailyTab?.classList.toggle("is-active", !isHourly);
    refs.visitStatsDailyTab?.setAttribute("aria-selected", String(!isHourly));
    refs.visitStatsHourlyTab?.classList.toggle("is-active", isHourly);
    refs.visitStatsHourlyTab?.setAttribute("aria-selected", String(isHourly));
    refs.visitStatsAverages?.classList.toggle("hidden", isHourly);
    if (refs.visitStatsPeriodHeading) {
      refs.visitStatsPeriodHeading.textContent = isHourly ? "Heure" : "Date";
    }
    if (refs.visitStatsVisitsHeading) {
      refs.visitStatsVisitsHeading.textContent = isHourly
        ? "Moyenne de visites / jour"
        : "Visites suivies";
    }
    if (refs.visitStatsUniqueHeading) {
      refs.visitStatsUniqueHeading.textContent = isHourly
        ? "Moyenne de visiteurs uniques / jour"
        : "Visiteurs uniques";
    }
    refs.visitStatsChart?.setAttribute(
      "aria-label",
      isHourly
        ? "Graphique de la répartition des visites par heure"
        : "Graphique des visites sur les 30 derniers jours",
    );
  }

  async function selectVisitStatsMode(mode) {
    const normalizedMode = mode === "hourly" ? "hourly" : "daily";
    state.visitStatsMode = normalizedMode;
    updateVisitStatsTabs(normalizedMode);
    const cachedPayload = state.visitStatsPayloads[normalizedMode];
    if (cachedPayload) {
      if (normalizedMode === "hourly") renderHourlyVisitStats(cachedPayload);
      else renderVisitStats(cachedPayload);
      return;
    }

    setVisitStatsLoading("Chargement des statistiques de visites...");
    try {
      if (normalizedMode === "hourly") {
        const payload = await apiRequest("/api/editor/visits/hourly");
        state.visitStatsPayloads.hourly = payload;
        if (state.visitStatsMode === "hourly") renderHourlyVisitStats(payload);
        return;
      }

      const [payload, publicCounter] = await Promise.all([
        apiRequest("/api/editor/visits/daily"),
        apiRequest("/api/visitors/count", { auth: false }).catch(() => null),
      ]);
      const publicVisitCount = Number(publicCounter?.visits);
      if (Number.isFinite(publicVisitCount) && publicVisitCount >= 0) {
        const previousTotal = Number(payload?.totalVisits);
        const cumulativeOffset = Number.isFinite(previousTotal)
          ? publicVisitCount - previousTotal
          : 0;
        payload.totalVisits = publicVisitCount;
        if (cumulativeOffset && Array.isArray(payload.chartRows)) {
          payload.chartRows = payload.chartRows.map((row) => ({
            ...row,
            cumulativeTotal: Math.max(
              0,
              Number(row.cumulativeTotal || 0) + cumulativeOffset,
            ),
          }));
        }
      }
      state.visitStatsPayloads.daily = payload;
      if (state.visitStatsMode === "daily") renderVisitStats(payload);
    } catch (error) {
      setVisitStatsLoading(`Chargement impossible : ${error.message}`);
    }
  }

  function closeVisitStatsModal() {
    if (!refs.visitStatsModal) {
      return;
    }
    refs.visitStatsModal.classList.add("hidden");
  }

  async function openVisitStatsModal() {
    if (!refs.visitStatsModal) {
      return;
    }
    refs.visitStatsModal.classList.remove("hidden");
    refs.visitStatsPanel?.focus();
    state.visitStatsPayloads = {};
    await selectVisitStatsMode(state.visitStatsMode);
  }

  if (refs.openVisitStatsBtn) {
    refs.openVisitStatsBtn.addEventListener("click", openVisitStatsModal);
  }
  if (refs.closeVisitStatsBtn) {
    refs.closeVisitStatsBtn.addEventListener("click", closeVisitStatsModal);
  }
  refs.visitStatsDailyTab?.addEventListener("click", () => {
    selectVisitStatsMode("daily");
  });
  refs.visitStatsHourlyTab?.addEventListener("click", () => {
    selectVisitStatsMode("hourly");
  });
  refs.visitStatsModal?.addEventListener("click", (event) => {
    if (event.target?.hasAttribute("data-close-visit-stats")) {
      closeVisitStatsModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !refs.visitStatsModal?.classList.contains("hidden")
    ) {
      closeVisitStatsModal();
    }
  });
}
