const EXCLUDED_PREFIXES = new Set([
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

const EXCLUDED_KEYWORDS = [
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

const SAFE_PREFIXES = new Set([
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

const RAW_WHITELIST = [
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
  "voie saint -theodore",
  "voie saint-theodore",
  "grand rue",
  "la canebiere",
  "l2",
];

function normalizeStreetNameForFilter(streetName) {
  return String(streetName || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`´]/g, "'")
    .replace(/[-‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/[^a-z0-9' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const WHITELIST = new Set(RAW_WHITELIST.map((entry) => normalizeStreetNameForFilter(entry)));
const EXCLUDED_TAG_VALUES = new Map([
  ["highway", new Set(["cycleway", "platform", "path", "track"])],
  ["footway", new Set(["sidewalk"])],
  ["conveying", new Set(["forward", "backward"])],
  ["public_transport", new Set(["station"])],
]);

function normalizeTagValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function shouldExcludeOsmTags(tags = {}) {
  for (const [key, excludedValues] of EXCLUDED_TAG_VALUES.entries()) {
    if (excludedValues.has(normalizeTagValue(tags[key]))) {
      return true;
    }
  }
  return false;
}

function shouldKeepStreetForGame(input = {}) {
  const tags = input.properties || input;
  const { name } = tags;
  const normalizedName = normalizeStreetNameForFilter(name);
  if (!normalizedName) {
    return false;
  }

  if (shouldExcludeOsmTags(tags)) {
    return false;
  }

  let firstToken = normalizedName.split(/[\s']/).filter(Boolean)[0] || "";
  if (normalizedName === "l2" || normalizedName.startsWith("l2 ")) {
    firstToken = "autoroute";
  }

  if (WHITELIST.has(normalizedName)) {
    return true;
  }

  if (EXCLUDED_PREFIXES.has(firstToken)) {
    return false;
  }

  for (const keyword of EXCLUDED_KEYWORDS) {
    if (keyword === "hlm") {
      if (/\bhlm\b/.test(normalizedName)) {
        return false;
      }
    } else if (normalizedName.includes(keyword)) {
      return false;
    }
  }

  if (!SAFE_PREFIXES.has(firstToken)) {
    return false;
  }

  return true;
}

module.exports = {
  normalizeStreetNameForFilter,
  shouldExcludeOsmTags,
  shouldKeepStreetForGame,
};
