const NS = "http://www.w3.org/2000/svg";
export const normalizeArea = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

export function areaColor(row) {
  if (!row || !Number(row.games_played) || row.success_rate == null)
    return "#e4e7eb";
  const rate = Number(row.success_rate);
  return rate >= 70 ? "#33865b" : rate >= 45 ? "#f2a900" : "#db7951";
}

// Historical scores carry quarter names; new district labels and those aliases
// resolve to the same arrondissement without changing stored game identifiers.
export function aggregateArrondissementStats(stats, features) {
  const aliases = new Map();
  for (const { properties } of features) {
    for (const name of [properties.name, ...(properties.aliases || [])]) {
      aliases.set(normalizeArea(name), properties.number);
    }
  }
  const result = new Map();
  for (const row of stats) {
    const key = normalizeArea(row.arrondissement_name);
    const numeric = key.match(
      /^(?:PARIS)?(?:75[01])?(\d{1,2})(?:ER|E|EME)?(?:ARRONDISSEMENT|ARDT)?$/,
    );
    const number = aliases.get(key) || (numeric ? Number(numeric[1]) : 0);
    if (number < 1 || number > 20) continue;
    const games = Math.max(0, Number(row.games_played) || 0);
    const measured =
      row.success_rate == null
        ? 0
        : Math.max(0, Number(row.measured_games ?? games) || 0);
    const entry = result.get(number) || {
      games_played: 0,
      measured_games: 0,
      weighted_rate: 0,
      success_rate: null,
    };
    entry.games_played += games;
    entry.measured_games += measured;
    entry.weighted_rate += measured * (Number(row.success_rate) || 0);
    entry.success_rate = entry.measured_games
      ? entry.weighted_rate / entry.measured_games
      : null;
    result.set(number, entry);
  }
  return result;
}

export function mountProfileHeatmap(root, stats) {
  const host = root.querySelector("[data-profile-heatmap]");
  if (!host) return;
  const details = host.closest("details");
  let loading = false;
  const render = async () => {
    if (!details.open || loading) return;
    loading = true;
    try {
      const response = await fetch(
        "/data/paris_arrondissements_progress.geojson",
      );
      if (!response.ok) throw new Error("Carte indisponible");
      const data = await response.json();
      if (!host.isConnected) return;
      const rows = aggregateArrondissementStats(stats, data.features);
      const polygons = (feature) =>
        feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates]
          : feature.geometry.type === "MultiPolygon"
            ? feature.geometry.coordinates
            : [];
      const project = ([lon, lat]) => [
        lon * Math.cos((48.86 * Math.PI) / 180),
        -lat,
      ];
      const projected = data.features
        .flatMap((f) => polygons(f).flat(2))
        .map(project);
      const xs = projected.map((p) => p[0]),
        ys = projected.map((p) => p[1]);
      const minX = Math.min(...xs),
        minY = Math.min(...ys);
      const scale = Math.min(
        360 / (Math.max(...xs) - minX),
        320 / (Math.max(...ys) - minY),
      );
      const toScreen = (point) => {
        const [x, y] = project(point);
        return [
          ((x - minX) * scale + 10).toFixed(2),
          ((y - minY) * scale + 10).toFixed(2),
        ];
      };
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute(
        "viewBox",
        `0 0 ${((Math.max(...xs) - minX) * scale + 20).toFixed(2)} ${((Math.max(...ys) - minY) * scale + 20).toFixed(2)}`,
      );
      svg.setAttribute(
        "aria-label",
        "Carte des 20 arrondissements de Paris, colorés selon votre taux de réussite",
      );
      const info = document.createElement("p");
      info.className = "profile-heatmap-info";
      info.setAttribute("aria-live", "polite");
      info.textContent = "Touchez un arrondissement pour voir vos résultats.";
      for (const feature of data.features) {
        const { name, number, labelPoint } = feature.properties;
        const row = rows.get(number);
        const label =
          row && Number(row.games_played) > 0 && row.success_rate != null
            ? `${name} : ${Number(row.success_rate).toFixed(1)} % de réussite · ${row.games_played} parties`
            : `${name} : pas encore de résultat mesurable`;
        const path = document.createElementNS(NS, "path");
        path.setAttribute(
          "d",
          polygons(feature)
            .map((polygon) =>
              polygon
                .map(
                  (ring) =>
                    ring
                      .map(
                        (point, i) =>
                          `${i ? "L" : "M"}${toScreen(point).join(",")}`,
                      )
                      .join(" ") + "Z",
                )
                .join(" "),
            )
            .join(" "),
        );
        path.setAttribute("fill", areaColor(row));
        path.setAttribute("fill-rule", "evenodd");
        path.setAttribute("tabindex", "0");
        path.setAttribute("role", "button");
        path.setAttribute("aria-label", label);
        const title = document.createElementNS(NS, "title");
        title.textContent = label;
        path.append(title);
        const select = () => {
          info.textContent = label;
          svg
            .querySelectorAll(".is-selected")
            .forEach((p) => p.classList.remove("is-selected"));
          path.classList.add("is-selected");
        };
        path.addEventListener("click", select);
        path.addEventListener("focus", select);
        path.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select();
          }
        });
        svg.append(path);
        const text = document.createElementNS(NS, "text");
        const [x, y] = toScreen(labelPoint);
        text.setAttribute("x", x);
        text.setAttribute("y", y);
        text.setAttribute("aria-hidden", "true");
        text.textContent = String(number);
        svg.append(text);
      }
      const credit = document.createElement("a");
      credit.href =
        "https://opendata.paris.fr/explore/dataset/arrondissements/";
      credit.textContent = "Limites : Ville de Paris";
      credit.className = "profile-heatmap-credit";
      host.replaceChildren(svg, info, credit);
    } catch {
      loading = false;
      host.textContent =
        "La carte n’a pas pu être chargée. Fermez puis rouvrez cette rubrique pour réessayer.";
    }
  };
  details.addEventListener("toggle", render);
  render();
}
