"use strict";
// Reproducible content from the checked-in Paris inventories; no external data or invented history.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const {
  buildStreetEntities,
} = require("../backend/domains/collect/street-entities");
const { shouldKeepStreetForGame } = require("../street_filter");
const { FAMOUS_STREET_NAMES, MAIN_STREET_NAMES } = require("../data_rules");
const {
  computeFeatureCollectionMidpoint,
} = require("../src/geometry-center.cjs");
const root = path.resolve(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const slug = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const streets = read("backend/data/streets_index.json").filter((s) =>
  shouldKeepStreetForGame({ name: s.name, osm_name: s.osmName }),
);
const entities = buildStreetEntities(streets).entities;
const roads = read("data/paris_rues_light.geojson").features;
const preparedRoads =
  require("../backend/domains/collect/map-data").prepareStreetMap(
    { type: "FeatureCollection", features: structuredClone(roads) },
    streets,
  ).features;
const entityRoads = new Map();
for (const f of preparedRoads) {
  const key = f.properties.collect_entity_id;
  if (!entityRoads.has(key)) entityRoads.set(key, []);
  entityRoads.get(key).push(f);
}
const districts = read("data/paris_arrondissements.geojson").features;
const official = read("data/paris_quartiers.geojson").features;
const monuments = read("data/paris_monuments.geojson").features;
const transport = read("data/paris_transit_lines.geojson").features;
const explorer = read("data/explorer_paris.json");
const editorial = read("data/collect_paris_editorial.json");
const descriptions = read("data/collect_descriptions.json");
const fragmentRequirements = read("data/collect_paris_fragments.json");
const photoExclusions = fs.existsSync(
  path.join(root, "data/collect_photo_exclusions_paris.json"),
)
  ? read("data/collect_photo_exclusions_paris.json")
  : {};
const reviewedPhotos = fs.existsSync(
  path.join(root, "data/collect_photos_paris.json"),
)
  ? read("data/collect_photos_paris.json")
  : {};
const inRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
};
const at = (p) =>
  official.find((f) => {
    const polygons =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.coordinates;
    return polygons.some(
      (poly) => inRing(p, poly[0]) && !poly.slice(1).some((r) => inRing(p, r)),
    );
  });
const famous = new Set([...FAMOUS_STREET_NAMES].map(norm)),
  main = new Set([...MAIN_STREET_NAMES].map(norm));
const roadNames = new Map();
for (const f of roads) {
  const n = norm(f.properties.name);
  if (!roadNames.has(n)) roadNames.set(n, []);
  roadNames.get(n).push(f);
}
const photoNames = new Map();
for (const file of fs.readdirSync(path.join(root, "data/daily_images"))) {
  const match = /^\d{4}-\d{2}-\d{2}__(.+)\.jpg$/.exec(file);
  if (match && !photoNames.has(match[1]))
    photoNames.set(match[1], "/data/daily_images/" + file);
}
const albums = [
  { slug: "streets", name: "Toutes les rues", family: "street" },
  { slug: "famous-streets", name: "Rues célèbres", family: "street" },
  { slug: "main-streets", name: "Rues principales", family: "street" },
  { slug: "districts", name: "Quartiers", family: "district" },
  { slug: "monuments", name: "Monuments", family: "monument" },
  { slug: "bus", name: "Transports franciliens", family: "bus" },
  ...Array.from({ length: 20 }, (_, i) => ({
    slug: "street-arrondissement-" + (i + 1),
    name: `Rues · ${i + 1}${i ? "e" : "er"} arrondissement`,
    family: "street",
  })),
  ...districts.map((f) => ({
    slug: "street-district-" + slug(f.properties.nom_qua),
    name: "Rues · " + f.properties.nom_qua,
    family: "street",
  })),
];
const records = [],
  quarterNumbers = {};
const source = "https://opendata.paris.fr/explore/dataset/quartier_paris/";
function question(
  key,
  theme,
  text,
  correct,
  distractors,
  explanation,
  sources,
) {
  const choices = [correct, ...distractors.filter((x) => x !== correct)].slice(
    0,
    4,
  );
  if (new Set(choices).size !== 4) return null;
  const hex = crypto.createHash("sha256").update(key).digest("hex");
  const index = parseInt(hex.slice(0, 2), 16) % 4;
  [choices[0], choices[index]] = [choices[index], choices[0]];
  return {
    id:
      hex.slice(0, 8) +
      "-" +
      hex.slice(8, 12) +
      "-5" +
      hex.slice(13, 16) +
      "-a" +
      hex.slice(17, 20) +
      "-" +
      hex.slice(20, 32),
    theme,
    text,
    answers: choices,
    correct_index: index,
    explanation,
    sources,
  };
}
function add(family, id, name, features, point, extra = {}) {
  const heritage = descriptions[family + ":" + id];
  const loc = point && at(point),
    quarter = loc?.properties.l_qu,
    arr = loc?.properties.c_ar;
  const imageKey = crypto
    .createHash("sha256")
    .update(family + ":" + id)
    .digest("hex")
    .slice(0, 20);
  const art = "/data/collect_images/" + imageKey + ".svg";
  const curated =
    family === "monument" && editorial.find((x) => x.name === name);
  const historic =
    family === "street" &&
    explorer.find((x) => norm(x.street_name_clean) === norm(name));
  const reviewedPhoto = reviewedPhotos[family + ":" + id];
  const excluded = photoExclusions[family + ":" + id];
  const candidatePhoto =
    reviewedPhoto?.image ||
    (family === "street"
      ? historic?.image_url || photoNames.get(slug(name))
      : null);
  const photo =
    excluded && (!reviewedPhoto || excluded.images.includes(candidatePhoto))
      ? null
      : candidatePhoto;
  const membership = [
    {
      street: "streets",
      district: "districts",
      monument: "monuments",
      bus: "bus",
    }[family],
  ];
  if (family === "street") {
    if (extra.famous) membership.push("famous-streets");
    else if (extra.main) membership.push("main-streets");
    for (const n of extra.districts || [])
      membership.push("street-district-" + slug(n));
    if (arr) membership.push("street-arrondissement-" + arr);
  }
  const location = quarter
    ? `${quarter} · ${arr}${arr === 1 ? "er" : "e"} arrondissement`
    : "Paris et Île-de-France";
  const short =
    heritage?.short ||
    extra.short ||
    `${name} : ${family === "street" ? "voie" : family === "district" ? "quartier" : "repère"} du catalogue parisien${quarter ? ", repère situé dans le quartier " + quarter : ""}.`;
  const geography = point
    ? ` Son repère est situé ${quarter ? "dans le quartier " + quarter + ", " : ""}${arr ? "dans le " + arr + (arr === 1 ? "er" : "e") + " arrondissement de Paris." : "dans le référentiel francilien."}`
    : "";
  const detailed =
    heritage?.text ||
    curated?.text ||
    historic?.explanation_text ||
    extra.full ||
    `${short}${geography} ${family === "street" ? "Les quartiers traversés dans le référentiel sont : " + (extra.districts || []).join(", ") + ". La carte utilise la géométrie de jeu ; une voie peut traverser plusieurs quartiers." : "Le repère provient du référentiel cartographique utilisé dans le jeu."}`;
  const record = {
    family,
    source_entity_id: id,
    name,
    image_reference: photo || "/apple-touch-icon.png",
    // Same provisional difficulty scale as Camino; observed performance can revise it.
    base_rarity:
      family === "street"
        ? extra.famous
          ? 1
          : extra.main
            ? 2
            : 4
        : family === "district"
          ? 1
          : 3,
    fragments_required: curated
      ? 3
      : historic
        ? fragmentRequirements[family + ":" + id] || 3
        : 0,
    album_slugs: membership,
    description: short,
    short_description: short,
    detailed_description: detailed,
    description_full: detailed,
    description_source:
      heritage?.source ||
      curated?.source ||
      historic?.source_url ||
      extra.source ||
      "https://www.openstreetmap.org/copyright",
    location_label: location,
    district: quarter || null,
    districts: extra.districts || (quarter ? [quarter] : []),
    arrondissement: arr || null,
    arrondissements: arr ? [arr] : [],
    famous: !!extra.famous,
    main: !!extra.main,
    centroid: point,
    art_key: imageKey,
    illustration: {
      source: photo ? "parici-photo" : "parici-logo",
      caption: photo
        ? "Photographie du référentiel Daily Paris"
        : "Logo Parici",
      sourcePage: photo ? "https://www.google.com/streetview/" : null,
      author: photo ? "Google Street View" : "Parici",
      license: photo
        ? "Attribution conservée sur la photographie"
        : "Logo Parici",
    },
    questions: [],
  };
  if (reviewedPhoto && photo) record.illustration = { ...reviewedPhoto };
  if (historic && loc) {
    record.questions = [
      question(
        id + ":quartier",
        "Géographie",
        "Dans quel quartier administratif se situe le repère cartographique de cette voie ?",
        quarter,
        official.map((f) => f.properties.l_qu),
        `Le repère de ${name} est situé dans le quartier ${quarter}, d’après les limites administratives de Paris.`,
        [source],
      ),
      question(
        id + ":arrondissement",
        "Géographie",
        "Dans quel arrondissement se situe ce repère cartographique ?",
        String(arr),
        Array.from({ length: 20 }, (_, i) => String(i + 1)),
        `Ce repère appartient au ${arr}${arr === 1 ? "er" : "e"} arrondissement. La question concerne le repère, pas l’intégralité de la voie.`,
        [source],
      ),
      question(
        id + ":histoire",
        "Patrimoine",
        "Quel repère ou fait est associé à cette voie ?",
        historic.explanation_text,
        explorer.filter((x) => x !== historic).map((x) => x.explanation_text),
        historic.explanation_text,
        [historic.source_url],
      ),
    ].filter(Boolean);
    if (!record.questions.length) record.fragments_required = 0;
  }
  if (curated && loc) {
    record.questions = [
      question(
        id + ":patrimoine",
        "Patrimoine",
        curated.question,
        curated.answer,
        curated.distractors,
        curated.text,
        [curated.source],
      ),
      question(
        id + ":quartier",
        "Géographie",
        "Dans quel quartier administratif se situe le repère de ce monument ?",
        quarter,
        official.map((f) => f.properties.l_qu),
        `Le repère de ${name} appartient au quartier ${quarter} dans le référentiel de jeu.`,
        [source],
      ),
      question(
        id + ":arrondissement",
        "Géographie",
        "Dans quel arrondissement se situe le repère de ce monument ?",
        String(arr),
        Array.from({ length: 20 }, (_, i) => String(i + 1)),
        `Le repère de ${name} appartient au ${arr}${arr === 1 ? "er" : "e"} arrondissement.`,
        [source],
      ),
    ].filter(Boolean);
  }
  records.push(record);
  // An isolated observed outline is a visual clue, never a fabricated street photograph.
  const lines = [];
  function walk(v) {
    if (!Array.isArray(v)) return;
    if (typeof v[0]?.[0] === "number") lines.push(v);
    else v.forEach(walk);
  }
  for (const f of features) walk(f.geometry.coordinates);
  const hasOutline = lines.some((line) => line.length > 1);
  const context =
    !hasOutline && point
      ? roads.filter((f) => {
          const coords =
            f.geometry.type === "LineString"
              ? f.geometry.coordinates
              : f.geometry.coordinates.flat();
          return coords.some(
            (p) =>
              Math.abs(p[0] - point[0]) < 0.003 &&
              Math.abs(p[1] - point[1]) < 0.002,
          );
        })
      : [];
  const frame =
    point && !hasOutline
      ? [point[0] - 0.003, point[0] + 0.003, point[1] - 0.002, point[1] + 0.002]
      : null;
  const pts = lines.flat(),
    xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  let graphic = "";
  if (pts.length > 1) {
    const xmin = Math.min(...xs),
      xmax = Math.max(...xs),
      ymin = Math.min(...ys),
      ymax = Math.max(...ys),
      scale = Math.min(
        360 / Math.max((xmax - xmin) * 0.66, 1e-6),
        300 / Math.max(ymax - ymin, 1e-6),
      );
    graphic = lines
      .map(
        (line) =>
          '<polyline points="' +
          line
            .filter(
              (_, i) => i % Math.max(1, Math.floor(line.length / 150)) === 0,
            )
            .map(
              (p) =>
                `${(220 + (p[0] - (xmin + xmax) / 2) * 0.66 * scale).toFixed(1)},${(225 - (p[1] - (ymin + ymax) / 2) * scale).toFixed(1)}`,
            )
            .join(" ") +
          '" fill="none" stroke="#23814d" stroke-width="5" stroke-linejoin="round"/>',
      )
      .join("");
  } else if (point) {
    const project = (p) =>
      `${(40 + ((p[0] - frame[0]) / (frame[1] - frame[0])) * 360).toFixed(1)},${(75 + ((frame[3] - p[1]) / (frame[3] - frame[2])) * 300).toFixed(1)}`;
    graphic =
      '<g clip-path="url(#map-frame)">' +
      context
        .map((f) => {
          const paths =
            f.geometry.type === "LineString"
              ? [f.geometry.coordinates]
              : f.geometry.coordinates;
          return paths
            .map(
              (line) =>
                '<polyline points="' +
                line.map(project).join(" ") +
                '" fill="none" stroke="#a8b5c8" stroke-width="2"/>',
            )
            .join("");
        })
        .join("") +
      '<circle cx="220" cy="225" r="10" fill="#23814d" stroke="white" stroke-width="3"/></g>';
  }
  const imageKind = photo ? "photograph" : "logo";
  record.illustration.kind = imageKind;
  record.illustration.caption = photo
    ? record.illustration.caption
    : "Logo Parici";
  const caption = !hasOutline
    ? "Repère de jeu · voies voisines"
    : "Illustration cartographique · Paris";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="560" viewBox="0 0 440 560"><defs><clipPath id="map-frame"><rect x="35" y="70" width="370" height="310" rx="12"/></clipPath></defs><rect width="440" height="560" rx="24" fill="#f9f5e9"/><text x="220" y="52" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#12297a">PARICI · ${escape({ street: "RUE", district: "QUARTIER", monument: "MONUMENT", bus: "TRANSPORT" }[family])}</text>${graphic}<text x="220" y="455" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#12297a">${escape(name.length > 49 ? name.slice(0, 46) + "…" : name)}</text><text x="220" y="515" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#526485">${caption}</text><text x="220" y="537" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#526485">© OpenStreetMap contributors · Parici</text></svg>`;
  fs.writeFileSync(path.join(root, art), svg);
}
fs.mkdirSync(path.join(root, "data/collect_images"), { recursive: true });
for (const e of entities.sort((a, b) => a.id.localeCompare(b.id, "fr"))) {
  const features =
    entityRoads.get(e.id) ||
    roadNames.get(norm(e.sources[0].osmName || e.name)) ||
    [];
  add(
    "street",
    e.id,
    e.name,
    features,
    computeFeatureCollectionMidpoint(features) || e.sources[0].centroid,
    {
      famous: e.sources.some(
        (s) => famous.has(norm(s.name)) || famous.has(norm(s.osmName)),
      ),
      main: e.sources.some(
        (s) => main.has(norm(s.name)) || main.has(norm(s.osmName)),
      ),
      districts: [...new Set(e.sources.map((s) => s.quartier))],
    },
  );
}
for (const f of districts.sort((a, b) =>
  a.properties.nom_qua.localeCompare(b.properties.nom_qua, "fr"),
)) {
  const point = computeFeatureCollectionMidpoint([f]);
  add("district", f.properties.nom_qua, f.properties.nom_qua, [f], point);
  const record = records.at(-1);
  if (record.arrondissement)
    quarterNumbers[f.properties.nom_qua] = record.arrondissement;
}
for (const f of monuments.sort((a, b) =>
  a.properties.name.localeCompare(b.properties.name, "fr"),
))
  add(
    "monument",
    f.properties.name,
    f.properties.name,
    [f],
    f.geometry.coordinates,
  );
for (const f of transport.sort((a, b) =>
  a.properties.name.localeCompare(b.properties.name, "fr", { numeric: true }),
))
  add(
    "bus",
    f.properties.name,
    f.properties.name,
    [f],
    computeFeatureCollectionMidpoint([f]),
    {
      short: f.properties.long_name,
      full: `${f.properties.name} : ${f.properties.long_name}. Le tracé de jeu correspond au référentiel francilien disponible.`,
      source: "https://www.openstreetmap.org/copyright",
    },
  );
const previousCatalog = fs.existsSync(
  path.join(root, "data/collect_paris_catalog.json"),
)
  ? read("data/collect_paris_catalog.json")
  : { records: [] };
const numberingPath = path.join(root, "data/collect_numbering_paris.json");
const numbering = fs.existsSync(numberingPath)
  ? read("data/collect_numbering_paris.json")
  : {};
for (const r of previousCatalog.records)
  numbering[r.family + ":" + r.source_entity_id] ??= r.collection_number;
const previousNumbers = new Map(Object.entries(numbering));
const maximumNumbers = {};
for (const [key, number] of previousNumbers) {
  const family = key.slice(0, key.indexOf(":"));
  maximumNumbers[family] = Math.max(maximumNumbers[family] || 0, number);
}
const numbers = {};
for (const r of records) {
  r.collection_number =
    previousNumbers.get(r.family + ":" + r.source_entity_id) ||
    (maximumNumbers[r.family] = (maximumNumbers[r.family] || 0) + 1);
  numbering[r.family + ":" + r.source_entity_id] = r.collection_number;
  numbers[r.family] = (numbers[r.family] || 0) + 1;
}
fs.writeFileSync(numberingPath, JSON.stringify(numbering));
const manifest = Object.fromEntries(
  records.map((r) => [
    r.family + ":" + r.source_entity_id,
    {
      ...r.illustration,
      image: r.image_reference,
      verifiedEntity: r.family + ":" + r.source_entity_id,
    },
  ]),
);
fs.writeFileSync(
  path.join(root, "data/collect_paris_catalog.json"),
  JSON.stringify({
    version: 2,
    generated_from: "Paris checked-in inventories, October 2026",
    albums,
    records,
  }),
);
fs.writeFileSync(
  path.join(root, "data/collect_images/manifest.json"),
  JSON.stringify(manifest),
);
fs.writeFileSync(
  path.join(root, "data/collect_quartier_arrondissement.json"),
  JSON.stringify(quarterNumbers),
);
console.log(
  JSON.stringify({
    cards: numbers,
    total: records.length,
    fragments: records.filter((r) => r.fragments_required).length,
    photos: records.filter((r) => r.illustration.kind === "photograph").length,
  }),
);
