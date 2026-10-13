(function (root) {
  "use strict";
  function candidatePool(ranked, first) { return ranked.slice(0, first ? 1 : Math.min(5, ranked.length)); }
  function choose(ranked, first, random = Math.random) { const pool=candidatePool(ranked,first);return pool[Math.floor(random()*pool.length)]?.riddle; }
  const STOP_WORDS = new Set([
    "RUE",
    "DE",
    "DES",
    "DU",
    "LA",
    "LE",
    "LES",
    "L",
    "D",
    "BOULEVARD",
    "AVENUE",
    "PLACE",
    "SQUARE",
    "COURS",
    "QUAI",
    "PROMENADE",
    "MONTEE",
  ]);
  const STREET_GEOMETRY_ALIASES = new Map();  function normalizeStreetText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/['’]/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((part) => part && !STOP_WORDS.has(part))
      .join(" ");
  }

  function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
    const earthRadius = 6371000;
    const toRad = (value) => (value * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function getMinimumDistanceToFeaturesMeters(position, features) {
    return features.reduce((minDistance, feature) => {
      const distance = getDistanceToGeometryMeters(position, feature.geometry);
      return Math.min(minDistance, distance);
    }, Number.POSITIVE_INFINITY);
  }

  function getDistanceToGeometryMeters(position, geometry) {
    if (!geometry || !geometry.coordinates) return Number.POSITIVE_INFINITY;
    const paths = getGeometryPaths(geometry);
    if (!paths.length) return Number.POSITIVE_INFINITY;

    const point = projectLngLatToMeters(
      [position.longitude, position.latitude],
      position.latitude,
      position.longitude,
    );
    let minDistance = Number.POSITIVE_INFINITY;

    for (const path of paths) {
      if (path.length === 1) {
        minDistance = Math.min(
          minDistance,
          haversineDistanceMeters(position.latitude, position.longitude, path[0][1], path[0][0]),
        );
        continue;
      }

      if ((geometry.type === "Polygon" || geometry.type === "MultiPolygon") && isPointInRing([position.longitude, position.latitude], path)) {
        return 0;
      }

      for (let index = 1; index < path.length; index += 1) {
        const start = projectLngLatToMeters(path[index - 1], position.latitude, position.longitude);
        const end = projectLngLatToMeters(path[index], position.latitude, position.longitude);
        minDistance = Math.min(minDistance, getPointToSegmentDistanceMeters(point, start, end));
      }
    }

    return minDistance;
  }

  function getGeometryPaths(geometry) {
    switch (geometry.type) {
      case "Point":
        return [[geometry.coordinates]];
      case "MultiPoint":
      case "LineString":
        return [geometry.coordinates];
      case "MultiLineString":
      case "Polygon":
        return geometry.coordinates;
      case "MultiPolygon":
        return geometry.coordinates.flatMap((polygon) => polygon);
      case "GeometryCollection":
        return (geometry.geometries || []).flatMap(getGeometryPaths);
      default:
        return [];
    }
  }

  function projectLngLatToMeters(coord, originLat, originLng) {
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    return {
      x: (lng - originLng) * 111320 * Math.cos((originLat * Math.PI) / 180),
      y: (lat - originLat) * 110540,
    };
  }

  function getPointToSegmentDistanceMeters(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);

    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
  }

  function isPointInRing(point, ring) {
    let inside = false;
    const x = point[0];
    const y = point[1];

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      const intersects = ((yi > y) !== (yj > y))
        && (x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi);
      if (intersects) inside = !inside;
    }

    return inside;
  }


 function buildIndex(features) {const byName=new Map();for(const f of features){const n=normalizeStreetText(f.properties?.name);if(!n||!f.geometry)continue;if(!byName.has(n))byName.set(n,[]);byName.get(n).push(f);}return {byName,entries:[...byName].map(([normalizedName,features])=>({normalizedName,features}))};}
 function featuresFor(riddle,index){const raw=normalizeStreetText(riddle.street_name_clean),name=STREET_GEOMETRY_ALIASES.get(raw)||raw;if(!name)return [];const exact=index.byName.get(name)||[];return exact.length?exact:index.entries.filter(e=>e.normalizedName.includes(name)||name.includes(e.normalizedName)).flatMap(e=>e.features);}
 function distance(position,riddle,index){const features=featuresFor(riddle,index);if(features.length)return getMinimumDistanceToFeaturesMeters(position,features);const lat=Number(riddle.latitude),lng=Number(riddle.longitude);return Number.isFinite(lat)&&Number.isFinite(lng)?haversineDistanceMeters(position.latitude,position.longitude,lat,lng):Infinity;}

  const api={candidatePool,choose,buildIndex,featuresFor,distance};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CaminoExplorerSelection=api;
})(typeof window==='object'?window:globalThis);
