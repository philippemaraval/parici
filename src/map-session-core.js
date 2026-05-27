export function normalizeArrondissementKey(arrondissementName) {
  if (!arrondissementName) {
    return "";
  }

  let normalized = arrondissementName.trim();
  const legacySuffixMatch = normalized.match(/^(.+)\s+\((L'|L’|La|Le|Les)\)$/i);
  if (legacySuffixMatch) {
    let body = legacySuffixMatch[1].trim();
    let article = legacySuffixMatch[2].trim();
    article = /^l[’']/i.test(article)
      ? "L'"
      : article.charAt(0).toUpperCase() + article.slice(1).toLowerCase();
    normalized = `${article} ${body}`;
  }

  normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  normalized = normalized.replace(/[’`´]/g, "'");
  normalized = normalized.replace(/[-‐‑‒–—]/g, "-");
  normalized = normalized.replace(/\s*-\s*/g, "-");
  normalized = normalized.replace(/\s+/g, " ").toLowerCase();
  return normalized;
}

function isSameArrondissementName(leftArrondissementName, rightArrondissementName) {
  const left = normalizeArrondissementKey(leftArrondissementName);
  const right = normalizeArrondissementKey(rightArrondissementName);
  return left !== "" && right !== "" && left === right;
}

const FREE_MODE_EXCLUDED_PREFIXES = new Set([
  "residence",
  "lotissement",
  "domaine",
  "gare",
  "station",
  "metro",
  "cite",
  "acces",
  "campagne",
  "parc",
  "sentier",
  "cour",
]);

const FREE_MODE_EXCLUDED_KEYWORDS = [
  "hameau",
  "parking",
  "groupe",
  "entree",
  "depose",
  "copropriete",
  "lycee",
  "hlm",
  "hopital",
  "centre",
  "complexe",
];

const FREE_MODE_SAFE_PREFIXES = new Set([
  "rue",
  "boulevard",
  "bd",
  "avenue",
  "av",
  "cours",
  "place",
  "chemin",
  "traverse",
  "impasse",
  "montee",
  "quai",
  "route",
  "corniche",
  "square",
  "promenade",
  "rond-point",
  "esplanade",
  "tunnel",
  "pont",
  "viaduc",
  "autoroute",
  "escaliers",
  "escalier",
  "passerelle",
  "bretelle",
  "vallon",
  "clos",
  "carrefour",
  "echangeur",
  "ancien",
  "ancienne",
  "plage",
  "rampe",
  "passage",
  "allee",
  "allees",
]);

const FREE_MODE_WHITELIST = new Set([
  "parvis madeleine et andre villard",
  "parvis saint-laurent",
  "pas d'ai de l'eboulis",
  "pavillon des intendants",
  "pavillon du parc",
  "placette ange-marius michel",
  "plateau cherchell chaix bryan",
  "plateau sacoman",
  "plateau de malmousque",
  "plateau de l'eglise",
  "plateau des marguerites",
  "plateau des martegaux",
  "plateau du peintre",
  "porte d'air bel",
  "porte de la castellane",
  "porte de la pomme",
  "ront-point robert dor",
  "rond-point robert dor",
  "ront-point abbe jean marcorelles",
  "rond-point abbe jean marcorelles",
  "ront-point monique gallician",
  "rond-point monique gallician",
  "rotonde pierre estrangin",
  "ruelle saint-charles",
  "vieux chemin d'endoume",
  "digue berry",
  "digue est",
  "digue sainte-marie",
  "digue du fort saint-jean",
  "boulevard de la colline",
  "bouvelard de la colline",
  "voie saint-theodore",
  "voie saint -theodore",
  "grand rue",
  "la canebiere",
  "l2",
]);

function normalizeStreetTextForFilters(streetName) {
  return (streetName || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/’/g, "'")
    .replace(/[-‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/[^a-z0-9' -]+/g, " ")
    .replace(/\s+/g, " ");
}

function isExcludedFromVilleAndArrondissement(streetName) {
  const normalized = normalizeStreetTextForFilters(streetName);
  if (!normalized) {
    return true;
  }

  const firstToken = normalized.split(/[\s']/).filter(Boolean)[0];
  if (!firstToken) {
    return true;
  }

  if (normalized === "l2" || normalized.startsWith("l2 ")) {
    return false;
  }

  if (FREE_MODE_WHITELIST.has(normalized)) {
    return false;
  }

  if (FREE_MODE_EXCLUDED_PREFIXES.has(firstToken)) {
    return true;
  }

  if (FREE_MODE_EXCLUDED_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return true;
  }

  if (!FREE_MODE_SAFE_PREFIXES.has(firstToken)) {
    return true;
  }

  return false;
}

export function createArrondissementByArrondissementMap(arrondissementByArrondissement) {
  const map = new Map();
  Object.entries(arrondissementByArrondissement).forEach(([arrondissementName, arrondissement]) => {
    map.set(normalizeArrondissementKey(arrondissementName), arrondissement);
  });
  return map;
}

export function getBaseStreetStyleFromName({
  zoneMode,
  streetName,
  normalizeName,
  uiTheme,
  mainStreetNames,
  famousStreetNames,
}) {
  const normalizedStreetName = normalizeName(streetName || "");
  let color = uiTheme.mapStreet;
  let weight = 5;

  if (zoneMode === "arrondissements-ville") {
    color = "#00000000";
    weight = 0;
  }

  if ((zoneMode === "rues-principales" || zoneMode === "main") && !mainStreetNames.has(normalizedStreetName)) {
    color = "#00000000";
    weight = 0;
  }

  if (zoneMode === "rues-celebres" && !famousStreetNames.has(normalizedStreetName)) {
    color = "#00000000";
    weight = 0;
  }

  if (
    (zoneMode === "ville" || zoneMode === "arrondissement") &&
    isExcludedFromVilleAndArrondissement(normalizedStreetName)
  ) {
    color = "#00000000";
    weight = 0;
  }

  return { color, weight };
}

export function getBaseStreetStyle({
  layerOrFeature,
  zoneMode,
  selectedArrondissement,
  normalizeName,
  uiTheme,
  mainStreetNames,
  famousStreetNames,
}) {
  const feature = layerOrFeature.feature || layerOrFeature;
  let style = getBaseStreetStyleFromName({
    zoneMode,
    streetName: feature?.properties?.name || "",
    normalizeName,
    uiTheme,
    mainStreetNames,
    famousStreetNames,
  });

  if (
    zoneMode === "arrondissement" &&
    selectedArrondissement &&
    !isSameArrondissementName(feature?.properties?.arrondissement || null, selectedArrondissement)
  ) {
    style = { color: "#00000000", weight: 0 };
  }
  return style;
}

export function isStreetVisibleInCurrentMode({
  zoneMode,
  normalizedStreetName,
  arrondissementName,
  selectedArrondissement,
  famousStreetNames,
  mainStreetNames,
}) {
  if (zoneMode === "monuments" || zoneMode === "arrondissements-ville") {
    return false;
  }

  if (zoneMode === "rues-celebres") {
    return famousStreetNames.has(normalizedStreetName);
  }

  if (zoneMode === "rues-principales" || zoneMode === "main") {
    return mainStreetNames.has(normalizedStreetName);
  }

  if (zoneMode === "arrondissement") {
    if (isExcludedFromVilleAndArrondissement(normalizedStreetName)) {
      return false;
    }

    const cleanArrondissementName = typeof arrondissementName === "string" ? arrondissementName.trim() : null;
    if (selectedArrondissement && !isSameArrondissementName(cleanArrondissementName, selectedArrondissement)) {
      return false;
    }
  }

  if (zoneMode === "ville" && isExcludedFromVilleAndArrondissement(normalizedStreetName)) {
    return false;
  }

  return true;
}

export function getCurrentZoneStreets({
  allStreetFeatures,
  zoneMode,
  selectedArrondissement,
  normalizeName,
  mainStreetNames,
  famousStreetNames,
}) {
  if (zoneMode === "arrondissements-ville") {
    return [];
  }

  if (zoneMode === "arrondissement" && selectedArrondissement) {
    return allStreetFeatures.filter(
      (feature) =>
        feature.properties &&
        typeof feature.properties.arrondissement === "string" &&
        isSameArrondissementName(feature.properties.arrondissement, selectedArrondissement) &&
        !isExcludedFromVilleAndArrondissement(normalizeName(feature.properties.name)),
    );
  }

  if (zoneMode === "rues-principales" || zoneMode === "main") {
    return allStreetFeatures.filter((feature) => {
      const normalizedStreetName = normalizeName(feature.properties && feature.properties.name);
      return mainStreetNames.has(normalizedStreetName);
    });
  }

  if (zoneMode === "rues-celebres") {
    return allStreetFeatures.filter((feature) => {
      const normalizedStreetName = normalizeName(feature.properties && feature.properties.name);
      return famousStreetNames.has(normalizedStreetName);
    });
  }

  return allStreetFeatures.filter(
    (feature) => !isExcludedFromVilleAndArrondissement(normalizeName(feature?.properties?.name)),
  );
}

export function buildUniqueStreetList(features, normalizeName) {
  const byNormalizedName = new Map();
  features.forEach((feature) => {
    const rawStreetName =
      typeof feature.properties.name === "string" ? feature.properties.name.trim() : "";
    if (!rawStreetName) {
      return;
    }
    const normalizedStreetName = normalizeName(rawStreetName);
    if (!byNormalizedName.has(normalizedStreetName)) {
      byNormalizedName.set(normalizedStreetName, feature);
    }
  });
  return Array.from(byNormalizedName.values());
}

export function populateArrondissementsUI({
  allStreetFeatures,
  arrondissementByArrondissement,
  onArrondissementChange,
}) {
  const nativeSelect = document.getElementById("arrondissement-select");
  const customList = document.getElementById("arrondissement-select-list");
  const customButton = document.getElementById("arrondissement-select-button");
  const customLabel = customButton ? customButton.querySelector(".custom-select-label") : null;
  if (!nativeSelect) {
    return;
  }

  const arrondissementsByKey = new Map();
  allStreetFeatures.forEach((feature) => {
    const arrondissementName = (feature.properties || {}).arrondissement;
    if (typeof arrondissementName === "string" && arrondissementName.trim() !== "") {
      const trimmed = arrondissementName.trim();
      const arrondissementKey = normalizeArrondissementKey(trimmed);
      if (arrondissementKey && !arrondissementsByKey.has(arrondissementKey)) {
        arrondissementsByKey.set(arrondissementKey, trimmed);
      }
    }
  });

  const arrondissements = Array.from(arrondissementsByKey.values()).sort((left, right) =>
    left.localeCompare(right, "fr", { sensitivity: "base" }),
  );

  nativeSelect.innerHTML = "";
  arrondissements.forEach((arrondissementName) => {
    const option = document.createElement("option");
    option.value = arrondissementName;
    option.textContent = arrondissementName;
    nativeSelect.appendChild(option);
  });

  if (customList) {
    customList.innerHTML = "";
    arrondissements.forEach((arrondissementName) => {
      const item = document.createElement("li");
      item.dataset.value = arrondissementName;

      const text = document.createElement("span");
      text.textContent = arrondissementName;
      item.appendChild(text);

      const arrondissement = arrondissementByArrondissement.get(normalizeArrondissementKey(arrondissementName));
      if (arrondissement) {
        const badge = document.createElement("span");
        badge.className = "difficulty-pill difficulty-pill--arrondissement";
        badge.textContent = arrondissement;
        item.appendChild(badge);
      }

      item.addEventListener("click", () => {
        if (customLabel) {
          customLabel.textContent = arrondissementName;
        }

        const badgeInItem = item.querySelector(".difficulty-pill");
        if (customButton) {
          const badgeInButton = customButton.querySelector(".difficulty-pill");
          if (badgeInItem) {
            const clone = badgeInItem.cloneNode(true);
            if (badgeInButton) {
              badgeInButton.replaceWith(clone);
            } else {
              customButton.appendChild(clone);
            }
          } else if (badgeInButton) {
            badgeInButton.remove();
          }
        }

        nativeSelect.value = arrondissementName;
        onArrondissementChange();
        customList.classList.remove("visible");
      });

      customList.appendChild(item);
    });
  }

  if (arrondissements.length > 0 && customButton) {
    const firstArrondissement = arrondissements[0];
    if (customLabel) {
      customLabel.textContent = firstArrondissement;
    }

    const arrondissement = arrondissementByArrondissement.get(normalizeArrondissementKey(firstArrondissement));
    if (arrondissement) {
      const existingBadge = customButton.querySelector(".difficulty-pill");
      const badge = document.createElement("span");
      badge.className = "difficulty-pill difficulty-pill--arrondissement";
      badge.textContent = arrondissement;
      if (existingBadge) {
        existingBadge.replaceWith(badge);
      } else {
        customButton.appendChild(badge);
      }
    }

    nativeSelect.value = firstArrondissement;
  }
}

export async function loadArrondissementPolygonsMap() {
  const response = await fetch("data/paris_arrondissements.geojson?v=2");
  if (!response.ok) {
    throw new Error(`Erreur HTTP ${response.status}`);
  }

  const payload = await response.json();
  const features = payload.features || [];
  const byName = new Map();
  features.forEach((feature) => {
    const properties = feature.properties || {};
    const arrondissementName = typeof properties.nom_qua === "string" ? properties.nom_qua.trim() : "";
    if (arrondissementName) {
      byName.set(arrondissementName, feature);
    }
  });

  return byName;
}

export function clearArrondissementOverlayLayer(map, arrondissementOverlay) {
  if (arrondissementOverlay) {
    map.removeLayer(arrondissementOverlay);
  }
  return null;
}

export function highlightArrondissementOnMap({
  map,
  L,
  arrondissementName,
  arrondissementPolygonsByName,
  uiTheme,
  existingOverlay,
}) {
  let overlay = clearArrondissementOverlayLayer(map, existingOverlay);
  if (!arrondissementName) {
    return overlay;
  }

  const arrondissementFeature = arrondissementPolygonsByName.get(arrondissementName);
  if (!arrondissementFeature) {
    console.warn("Aucun polygone trouvé pour le arrondissement :", arrondissementName);
    return overlay;
  }

  overlay = L.geoJSON(arrondissementFeature, {
    style: { color: uiTheme.mapArrondissement, weight: 2, fill: false },
    interactive: false,
  }).addTo(map);

  const bounds = overlay.getBounds();
  if (bounds && bounds.isValid && bounds.isValid()) {
    const fitOptions =
      window.innerWidth <= 900
        ? { padding: [40, 40], maxZoom: 14 }
        : { padding: [40, 40] };
    map.fitBounds(bounds, { ...fitOptions, animate: true, duration: 1.5 });
  }

  return overlay;
}
