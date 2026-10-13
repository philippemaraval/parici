"use strict";
const { distance, normalize } = require("./daily");
const fail = (message) => Object.assign(new Error(message), { status: 400 });
function plaqueMatches(text, name) {
  const clean = (v) =>
    normalize(v)
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(
        (w) =>
          w &&
          ![
            "rue",
            "avenue",
            "boulevard",
            "chemin",
            "des",
            "les",
            "la",
            "le",
            "de",
            "du",
            "d",
            "l",
          ].includes(w),
      )
      .join(" ");
  const target = clean(name),
    ocr = clean(text);
  if (!target || !ocr) return false;
  if (ocr.includes(target)) return true;
  const distance = (a, b) => {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++)
        next[j] = Math.min(
          next[j - 1] + 1,
          row[j] + 1,
          row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      row = next;
    }
    return row[b.length];
  };
  const words = ocr.split(" "),
    n = target.split(" ").length;
  for (let size = Math.max(1, n - 1); size <= n + 1; size++)
    for (let i = 0; i + size <= words.length; i++) {
      const candidate = words.slice(i, i + size).join(" ");
      if (
        distance(candidate, target) <=
        Math.min(3, Math.floor(target.length * 0.25))
      )
        return true;
    }
  return false;
}
let streetFeatures;
function distanceToRiddle(point, riddle) {
  if (!streetFeatures) {
    const fs = require("node:fs"),
      path = require("node:path");
    streetFeatures = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../data/paris_rues_light.geojson"),
      ),
    ).features;
  }
  const geometryName = (value) =>
    normalize(value)
      .replace(/['’]/g, " ")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(
        (word) =>
          word &&
          ![
            "rue",
            "de",
            "des",
            "du",
            "la",
            "le",
            "les",
            "l",
            "d",
            "boulevard",
            "avenue",
            "place",
            "square",
            "cours",
            "quai",
            "promenade",
            "montee",
          ].includes(word),
      )
      .join(" ");
  const aliases = new Map();
  const rawTarget = geometryName(riddle.street_name_clean),
    target = aliases.get(rawTarget) || rawTarget;
  const exact = streetFeatures.filter(
    (f) =>
      geometryName(f.properties?.name) === target ||
      (riddle.way_id != null &&
        Number(
          String(
            f.properties?.way_id ||
              f.properties?.id ||
              f.properties?.osm_id ||
              "",
          ).replace(/^way\//, ""),
        ) === Number(riddle.way_id)),
  );
  const features = exact.length
    ? exact
    : streetFeatures.filter((f) => {
        const name = geometryName(f.properties?.name);
        return (
          name && target && (name.includes(target) || target.includes(name))
        );
      });
  if (!features.length)
    return riddle.latitude != null && riddle.longitude != null
      ? distance(point, [Number(riddle.longitude), Number(riddle.latitude)])
      : Infinity;
  const rad = Math.PI / 180,
    scaleX = 6371000 * rad * Math.cos(point[1] * rad),
    scaleY = 6371000 * rad;
  const project = (p) => [
    (p[0] - point[0]) * scaleX,
    (p[1] - point[1]) * scaleY,
  ];
  let nearest = Infinity;
  function walk(coordinates) {
    if (typeof coordinates[0]?.[0] === "number") {
      const line = coordinates.map(project);
      for (let i = 1; i < line.length; i++) {
        const [x, y] = line[i - 1],
          [u, v] = line[i],
          dx = u - x,
          dy = v - y,
          t = Math.max(
            0,
            Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)),
          );
        nearest = Math.min(nearest, Math.hypot(x + t * dx, y + t * dy));
      }
    } else coordinates.forEach(walk);
  }
  features.forEach((f) => walk(f.geometry.coordinates));
  return nearest;
}
function stepResult(body, riddle, session, now = Date.now()) {
  if (!session) throw fail("Démarrez cette étape avant de la valider");
  if (typeof body.ocr_text !== "string" || body.ocr_text.length > 2000)
    throw fail("Texte de plaque invalide");
  if (!plaqueMatches(body.ocr_text, riddle.street_name_clean))
    throw fail("La plaque ne correspond pas à cette énigme");
  const point = [Number(body.longitude), Number(body.latitude)];
  if (
    body.latitude == null ||
    body.longitude == null ||
    !point.every(Number.isFinite) ||
    Math.abs(point[0]) > 180 ||
    Math.abs(point[1]) > 90
  )
    throw fail("Position requise");
  if (distanceToRiddle(point, riddle) > 100)
    throw fail("Position trop éloignée du lieu");
  const elapsed = Math.max(
    0,
    Math.round((now - new Date(session.started_at).getTime()) / 1000),
  );
  const walkingTime = Math.min(1200, elapsed);
  const points =
    50 +
    Math.max(0, 20 - Math.ceil(walkingTime / 60)) -
    (session.hint_used ? 15 : 0);
  return {
    startedAt: session.started_at,
    solvedAt: new Date(now).toISOString(),
    pointsEarned: points,
    walkingTimeSeconds: walkingTime,
    hintsUsed: session.hint_used ? 1 : 0,
  };
}
module.exports = { stepResult, plaqueMatches, distanceToRiddle };
