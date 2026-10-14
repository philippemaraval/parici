#!/usr/bin/env node
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { prepareStreetMap } = require("../backend/domains/collect/map-data");
const {
  candidateLocations,
  lines,
  viewAlongStreet,
  bearing,
  distance,
  nearest,
  at,
  length,
} = require("./lib/collect-street-view");
const root = path.resolve(__dirname, ".."),
  hash = (value) =>
    crypto.createHash("sha256").update(value).digest("hex").slice(0, 20);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function loadCredentials(file) {
  if (!file) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(
      /^\s*(GOOGLE_STREET_VIEW_API_KEY|GOOGLE_MAPS_API_KEY)\s*=\s*(.*)$/,
    );
    if (m && !process.env[m[1]])
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  }
}
function inRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function contains(point, features) {
  return features.some((f) => {
    const polygons =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.type === "MultiPolygon"
          ? f.geometry.coordinates
          : [];
    return polygons.some(
      (p) =>
        inRing(point, p[0]) && !p.slice(1).some((hole) => inRing(point, hole)),
    );
  });
}
function localRoads(point, roads, radius = 0.004) {
  return roads.filter((f) => {
    const lines =
      f.geometry.type === "LineString"
        ? [f.geometry.coordinates]
        : f.geometry.type === "MultiLineString"
          ? f.geometry.coordinates
          : [];
    return lines.some((line) =>
      line.some(
        (p) =>
          Math.abs(p[0] - point[0]) < radius &&
          Math.abs(p[1] - point[1]) < radius,
      ),
    );
  });
}
// Areas such as pedestrian squares have no street axis. Aim into their actual
// polygon instead of inventing a direction from a surrounding road.
function areaBoundaries(features) {
  return features.flatMap((f) => {
    const g = f.geometry;
    const polygons =
      g?.type === "Polygon"
        ? [g.coordinates]
        : g?.type === "MultiPolygon"
          ? g.coordinates
          : [];
    return polygons.map((p) => ({
      geometry: { type: "LineString", coordinates: p[0] },
    }));
  });
}
function photoLocations(
  features,
  target,
  extended = false,
  exhaustive = false,
) {
  const segments = lines(features)
    .filter((line) => length(line) > 1)
    .sort((a, b) => length(b) - length(a));
  if (segments.length) {
    if (exhaustive) {
      // Keep short/disconnected portions and both entrances: the longest
      // portion is not necessarily the one covered by a Google camera.
      return segments.flatMap((line) => {
        const metres = length(line);
        const count = Math.max(2, Math.ceil(metres / 15));
        return Array.from({ length: count + 1 }, (_, i) =>
          at(line, (metres * i) / count),
        );
      });
    }
    if (!extended) return candidateLocations(features);
    return segments
      .slice(0, 4)
      .flatMap((line) =>
        [0.5, 0.1, 0.9, 0.25, 0.75, 0.35, 0.65].map((f) =>
          at(line, length(line) * f),
        ),
      );
  }
  const rings = areaBoundaries(features);
  return [
    contains(target, features) ? target : null,
    ...rings.flatMap((f) =>
      (exhaustive
        ? Array.from({ length: 32 }, (_, i) => i / 32)
        : [0.125, 0.375, 0.625, 0.875, 0, 0.25, 0.5, 0.75]
      ).map((fraction) =>
        at(f.geometry.coordinates, length(f.geometry.coordinates) * fraction),
      ),
    ),
  ].filter(Boolean);
}
function streetPhotoView(coordinate, job) {
  if (lines(job.features).length)
    return viewAlongStreet(coordinate, job.features);
  const boundary = nearest(coordinate, areaBoundaries(job.features));
  if (!boundary) return null;
  return {
    heading: bearing(coordinate, job.target),
    distanceMeters: contains(coordinate, job.features)
      ? 0
      : boundary.distanceMeters,
    surface: true,
  };
}
function plan({
  allStreets = false,
  extended = false,
  includePhotographed = false,
  exhaustive = false,
} = {}) {
  const catalog = read(path.join(root, "data/collect_paris_catalog.json"));
  const index = read(path.join(root, "backend/data/streets_index.json"));
  const map = prepareStreetMap(
    read(path.join(root, "backend/data/paris_rues_light.geojson")),
    index,
  );
  const groups = new Map();
  for (const f of map.features) {
    const id = f.properties.collect_entity_id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(f);
  }
  const districts = read(
    path.join(root, "backend/data/paris_arrondissements.geojson"),
  ).features;
  const rank = (c) =>
    c.family === "street"
      ? c.famous
        ? 0
        : c.main
          ? 1
          : 4
      : c.family === "monument"
        ? 2
        : 3;
  const records = catalog.records
    .filter(
      (c) =>
        (includePhotographed || c.illustration.kind !== "photograph") &&
        c.family !== "bus" &&
        (c.family !== "street" || allStreets || c.famous || c.main),
    )
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "fr"));
  return records.map((c) => {
    const features =
      c.family === "street"
        ? groups.get(c.source_entity_id) || []
        : c.family === "district"
          ? districts.filter((f) => f.properties.nom_qua === c.source_entity_id)
          : [];
    const roads =
      c.family === "street" ? features : localRoads(c.centroid, map.features);
    const match = c.family !== "street" ? nearest(c.centroid, roads) : null;
    const projected = match?.coordinate;
    const locations =
      c.family === "street"
        ? photoLocations(features, c.centroid, extended, exhaustive)
        : [
            projected,
            ...(match
              ? [
                  at(
                    match.line,
                    Math.min(length(match.line), match.position + 40),
                  ),
                  at(match.line, Math.max(0, match.position - 40)),
                ]
              : []),
            c.centroid,
          ].filter(Boolean);
    return {
      key: c.family + ":" + c.source_entity_id,
      family: c.family,
      name: c.name,
      target: c.centroid,
      features,
      roads,
      locations,
    };
  });
}
async function generate(
  directory,
  {
    envFile,
    limit,
    allStreets = false,
    only,
    refresh = false,
    extended = false,
    excludedPanoramas = {},
    includePhotographed = false,
    exhaustive = false,
    searchRadius = 35,
    oldestYear = new Date().getUTCFullYear() - 10,
  } = {},
) {
  fs.mkdirSync(directory, { recursive: true });
  loadCredentials(envFile);
  const secret =
    process.env.GOOGLE_STREET_VIEW_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!secret) throw Error("Street View API key unavailable");
  if (includePhotographed && !only?.length)
    throw Error("Photo repairs require an explicit card list");
  if (!Number.isFinite(searchRadius) || searchRadius < 1 || searchRadius > 35)
    throw Error("Street search radius must be between 1 and 35 metres");
  if (
    !Number.isInteger(oldestYear) ||
    oldestYear < 2007 ||
    oldestYear > new Date().getUTCFullYear()
  )
    throw Error("Invalid oldest panorama year");
  let jobs = plan({ allStreets, extended, includePhotographed, exhaustive });
  if (only) jobs = jobs.filter((j) => only.includes(j.key));
  if (limit) jobs = jobs.slice(0, limit);
  let cursor = 0,
    completed = 0,
    generated = 0,
    halt;
  const outcomes = [];
  async function processJob(job) {
    const jobId = hash(job.key),
      receipt = path.join(directory, jobId + ".json");
    if (!refresh && fs.existsSync(receipt)) {
      const existing = read(receipt);
      if (
        existing.status === "OK" &&
        existing.providerVerified &&
        !(excludedPanoramas[job.key] || []).includes(existing.panoId) &&
        existing.candidates.every((c) =>
          fs.existsSync(path.join(directory, c.file)),
        )
      )
        return existing;
    }
    let lastReason = "No suitable outdoor panorama";
    for (const requested of (refresh
      ? [...job.locations.slice(1), job.locations[0]]
      : job.locations
    ).slice(0, exhaustive ? Infinity : extended ? 28 : 3)) {
      const q = new URLSearchParams({
        key: secret,
        location: `${requested[1]},${requested[0]}`,
        radius: job.family === "monument" ? "80" : String(searchRadius),
        source: "outdoor",
      });
      const response = await fetch(
        "https://maps.googleapis.com/maps/api/streetview/metadata?" + q,
        { signal: AbortSignal.timeout(20000) },
      );
      const metadata = await response.json();
      if (
        ["REQUEST_DENIED", "OVER_QUERY_LIMIT", "INVALID_REQUEST"].includes(
          metadata.status,
        )
      )
        throw Error("Street View metadata " + metadata.status);
      if (metadata.status !== "OK") {
        lastReason = metadata.status;
        continue;
      }
      if ((excludedPanoramas[job.key] || []).includes(metadata.pano_id))
        continue;
      if (!/Google/i.test(metadata.copyright || "")) {
        lastReason = "Unverified panorama copyright";
        continue;
      }
      if (!metadata.date || Number(metadata.date.slice(0, 4)) < oldestYear) {
        lastReason = "Panorama too old";
        continue;
      }
      const coordinate = [metadata.location.lng, metadata.location.lat];
      const along =
        job.family === "street"
          ? streetPhotoView(coordinate, job)
          : viewAlongStreet(coordinate, job.roads);
      const gap =
        job.family === "monument"
          ? distance(coordinate, job.target)
          : (along?.distanceMeters ?? Infinity);
      if (
        (job.family === "street" && gap > 18) ||
        (job.family === "monument" && gap > 150) ||
        (job.family === "district" &&
          (!contains(coordinate, job.features) || gap > 25))
      ) {
        lastReason = "Panorama outside target geometry";
        continue;
      }
      const initial =
        job.family === "monument"
          ? bearing(coordinate, job.target)
          : along?.heading;
      if (!Number.isFinite(initial)) {
        lastReason = "Street axis unavailable";
        continue;
      }
      const headings =
        job.family === "monument"
          ? [initial, (initial + 25) % 360]
          : [initial, (initial + 180) % 360];
      const candidates = [];
      for (let choice = 0; choice < headings.length; choice++) {
        const file = jobId + "-" + choice + ".jpg",
          output = path.join(directory, file);
        const pitch =
          job.family === "monument"
            ? /Eiffel|Colonne|Obélisque/i.test(job.name)
              ? 20
              : 8
            : 0;
        const params = new URLSearchParams({
          key: secret,
          pano: metadata.pano_id,
          size: "430x640",
          fov: "85",
          pitch: String(pitch),
          heading: String(headings[choice]),
          return_error_code: "true",
        });
        const image = await fetch(
          "https://maps.googleapis.com/maps/api/streetview?" + params,
          { signal: AbortSignal.timeout(25000) },
        );
        if (
          !image.ok ||
          !image.headers.get("content-type")?.startsWith("image/jpeg")
        )
          throw Error("Photo HTTP " + image.status);
        const bytes = Buffer.from(await image.arrayBuffer());
        if (bytes.length < 6000 || bytes[0] !== 255 || bytes[1] !== 216)
          throw Error("Invalid photograph");
        fs.writeFileSync(output, bytes);
        candidates.push({
          file,
          heading: headings[choice],
          pitch,
          fov: 85,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        });
        generated++;
      }
      const result = {
        key: job.key,
        family: job.family,
        name: job.name,
        status: "OK",
        requestedCoordinate: requested,
        coordinate,
        target: job.target,
        distanceMeters: Math.round(gap * 10) / 10,
        captureDate: metadata.date || null,
        panoId: metadata.pano_id,
        copyright: metadata.copyright,
        providerVerified: true,
        surface: Boolean(along?.surface),
        candidates,
      };
      fs.writeFileSync(receipt, JSON.stringify(result, null, 2) + "\n");
      return result;
    }
    const result = {
      key: job.key,
      name: job.name,
      status: "unavailable",
      reason: lastReason,
    };
    fs.writeFileSync(receipt, JSON.stringify(result, null, 2) + "\n");
    return result;
  }
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (cursor < jobs.length && !halt) {
        const job = jobs[cursor++];
        try {
          outcomes.push(await processJob(job));
        } catch (e) {
          const message = String(e.message).replaceAll(secret, "[redacted]");
          outcomes.push({
            key: job.key,
            name: job.name,
            status: "error",
            reason: message,
          });
          if (/REQUEST_DENIED|OVER_QUERY_LIMIT|INVALID_REQUEST/.test(message))
            halt = message;
        }
        completed++;
        if (completed % 20 === 0)
          console.log(
            `Reviewed metadata: ${completed}/${jobs.length}; photographs downloaded: ${generated}`,
          );
      }
    }),
  );
  fs.writeFileSync(
    path.join(directory, "outcomes.json"),
    JSON.stringify(outcomes, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      planned: jobs.length,
      completed,
      photographs: generated,
      available: outcomes.filter((x) => x.status === "OK").length,
      halt: halt || null,
    }),
  );
  if (halt) throw Error(halt);
  return outcomes;
}
function apply(directory, reviewFile) {
  const review = read(reviewFile),
    catalog = read(path.join(root, "data/collect_paris_catalog.json"));
  const known = new Set(
    catalog.records.map((c) => c.family + ":" + c.source_entity_id),
  );
  const file = path.join(root, "data/collect_photos_paris.json");
  const manifest = fs.existsSync(file) ? read(file) : {};
  for (const decision of review) {
    if (
      !known.has(decision.key) ||
      !decision.evidence ||
      ![0, 1].includes(decision.choice)
    )
      throw Error("Invalid visual approval: " + decision.key);
    const receipt = read(path.join(directory, hash(decision.key) + ".json")),
      candidate = receipt.candidates[decision.choice];
    if (
      receipt.status !== "OK" ||
      !receipt.providerVerified ||
      !/Google/i.test(receipt.copyright || "") ||
      receipt.key !== decision.key ||
      !candidate
    )
      throw Error("Missing photo evidence");
    const bytes = fs.readFileSync(path.join(directory, candidate.file));
    if (
      crypto.createHash("sha256").update(bytes).digest("hex") !==
      candidate.sha256
    )
      throw Error("Candidate changed after review");
    const name = `photo-${hash(decision.key)}-${candidate.sha256.slice(0, 12)}.jpg`;
    fs.writeFileSync(path.join(root, "data/collect_images", name), bytes);
    manifest[decision.key] = {
      image: "/data/collect_images/" + name,
      source: "google-street-view",
      kind: "photograph",
      caption:
        receipt.family === "district"
          ? "Vue photographique du quartier"
          : "Photographie du lieu",
      author: "Google Street View",
      license: "Attribution Google conservée sur la photographie",
      sourcePage: `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(receipt.panoId)}&heading=${candidate.heading}`,
      verifiedEntity: decision.key,
      verification: {
        method:
          receipt.family === "street"
            ? receipt.surface
              ? "geometry-surface-and-visual-review"
              : "geometry-local-axis-and-visual-review"
            : "coordinates-and-visual-review",
        reviewedAt: new Date().toISOString().slice(0, 10),
        coordinate: receipt.coordinate,
        target: receipt.target,
        requestedCoordinate: receipt.requestedCoordinate,
        distanceMeters: receipt.distanceMeters,
        captureDate: receipt.captureDate,
        copyright: receipt.copyright,
        panoId: receipt.panoId,
        heading: candidate.heading,
        pitch: candidate.pitch,
        fov: candidate.fov,
        sha256: candidate.sha256,
        evidence: decision.evidence,
      },
    };
  }
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  console.log("Visually reviewed photographs applied:", review.length);
}
async function main() {
  const args = process.argv.slice(2),
    get = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const directory = get("--output");
  if (!directory) throw Error("--output directory required");
  if (args.includes("--apply"))
    return apply(path.resolve(directory), path.resolve(get("--review")));
  return generate(path.resolve(directory), {
    envFile: get("--env-file"),
    limit: Number(get("--limit")) || undefined,
    allStreets: args.includes("--all-streets"),
    only: get("--only") ? read(get("--only")) : undefined,
    refresh: args.includes("--refresh"),
    extended: args.includes("--extended"),
    exhaustive: args.includes("--exhaustive"),
    searchRadius: get("--search-radius") ? Number(get("--search-radius")) : 35,
    oldestYear: get("--oldest-year") ? Number(get("--oldest-year")) : undefined,
    includePhotographed: args.includes("--include-photographed"),
    excludedPanoramas: get("--exclude-panoramas")
      ? read(get("--exclude-panoramas"))
      : {},
  });
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = {
  plan,
  generate,
  apply,
  contains,
  loadCredentials,
  photoLocations,
  streetPhotoView,
};
