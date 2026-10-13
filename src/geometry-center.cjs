"use strict";

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000;
  const toRadians = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRadians;
  const dLon = (lon2 - lon1) * toRadians;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toRadians) *
      Math.cos(lat2 * toRadians) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

function interpolateCoordinates(fromCoords, toCoords, ratio) {
  const [fromLon, fromLat] = fromCoords;
  const [toLon, toLat] = toCoords;
  return [
    fromLon + (toLon - fromLon) * ratio,
    fromLat + (toLat - fromLat) * ratio,
  ];
}

function projectCoordinatesOnSegment(pointCoords, fromCoords, toCoords) {
  const referenceLat = pointCoords[1];
  const cosLat = Math.cos((referenceLat * Math.PI) / 180);
  const pointX = pointCoords[0] * cosLat;
  const pointY = pointCoords[1];
  const fromX = fromCoords[0] * cosLat;
  const fromY = fromCoords[1];
  const toX = toCoords[0] * cosLat;
  const toY = toCoords[1];
  const dx = toX - fromX;
  const dy = toY - fromY;
  const lengthSquared = dx * dx + dy * dy;
  const ratio =
    lengthSquared > 0
      ? Math.max(0, Math.min(1, ((pointX - fromX) * dx + (pointY - fromY) * dy) / lengthSquared))
      : 0;
  const coordinates = interpolateCoordinates(fromCoords, toCoords, ratio);
  const projectedX = coordinates[0] * cosLat;
  const projectedY = coordinates[1];
  return {
    coordinates,
    distanceSquared:
      (pointX - projectedX) * (pointX - projectedX) +
      (pointY - projectedY) * (pointY - projectedY),
  };
}

function computeRingCentroid(ringCoords) {
  if (!Array.isArray(ringCoords) || ringCoords.length < 3) {
    return null;
  }

  let doubledArea = 0;
  let centroidLon = 0;
  let centroidLat = 0;
  for (let index = 0; index < ringCoords.length; index += 1) {
    const current = ringCoords[index];
    const next = ringCoords[(index + 1) % ringCoords.length];
    if (!Array.isArray(current) || !Array.isArray(next)) {
      continue;
    }
    const cross = current[0] * next[1] - next[0] * current[1];
    doubledArea += cross;
    centroidLon += (current[0] + next[0]) * cross;
    centroidLat += (current[1] + next[1]) * cross;
  }

  if (Math.abs(doubledArea) < Number.EPSILON) {
    return null;
  }
  return {
    coordinates: [
      centroidLon / (3 * doubledArea),
      centroidLat / (3 * doubledArea),
    ],
    area: Math.abs(doubledArea / 2),
  };
}

function computePolygonCentroid(polygonCoords) {
  if (!Array.isArray(polygonCoords) || polygonCoords.length === 0) {
    return null;
  }
  const outer = computeRingCentroid(polygonCoords[0]);
  if (!outer) {
    return null;
  }

  let weightedLon = outer.coordinates[0] * outer.area;
  let weightedLat = outer.coordinates[1] * outer.area;
  let totalArea = outer.area;
  polygonCoords.slice(1).forEach((ring) => {
    const hole = computeRingCentroid(ring);
    if (!hole) {
      return;
    }
    weightedLon -= hole.coordinates[0] * hole.area;
    weightedLat -= hole.coordinates[1] * hole.area;
    totalArea -= hole.area;
  });

  if (totalArea <= Number.EPSILON) {
    return outer;
  }
  return {
    coordinates: [weightedLon / totalArea, weightedLat / totalArea],
    area: totalArea,
  };
}

function collectGeometryParts(geometry, segments, polygons, points) {
  if (!geometry || !Array.isArray(segments)) {
    return;
  }

  function inspectLine(lineCoords) {
    if (!Array.isArray(lineCoords)) {
      return;
    }
    for (let index = 0; index < lineCoords.length - 1; index++) {
      const fromCoords = lineCoords[index];
      const toCoords = lineCoords[index + 1];
      if (!Array.isArray(fromCoords) || !Array.isArray(toCoords)) {
        continue;
      }
      const lengthMeters = getDistanceMeters(
        fromCoords[1],
        fromCoords[0],
        toCoords[1],
        toCoords[0],
      );
      if (Number.isFinite(lengthMeters) && lengthMeters > 0) {
        segments.push({ fromCoords, toCoords, lengthMeters });
      }
    }
  }

  if (geometry.type === "LineString") {
    inspectLine(geometry.coordinates);
  } else if (geometry.type === "MultiLineString") {
    geometry.coordinates.forEach(inspectLine);
  } else if (geometry.type === "Polygon") {
    const polygon = computePolygonCentroid(geometry.coordinates);
    if (polygon) polygons.push(polygon);
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygonCoords) => {
      const polygon = computePolygonCentroid(polygonCoords);
      if (polygon) polygons.push(polygon);
    });
  } else if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    points.push(geometry.coordinates);
  }
}

function computeFeatureCollectionMidpoint(featureCollection) {
  const features =
    featureCollection?.type === "FeatureCollection"
      ? Array.isArray(featureCollection.features)
        ? featureCollection.features
        : []
      : Array.isArray(featureCollection)
        ? featureCollection
        : featureCollection
          ? [featureCollection]
          : [];
  const segments = [];
  const polygons = [];
  const points = [];

  features.forEach((feature) => {
    collectGeometryParts(feature?.geometry || feature, segments, polygons, points);
  });

  if (polygons.length > 0) {
    const totalArea = polygons.reduce((sum, polygon) => sum + polygon.area, 0);
    if (totalArea > Number.EPSILON) {
      return polygons.reduce(
        (center, polygon) => [
          center[0] + (polygon.coordinates[0] * polygon.area) / totalArea,
          center[1] + (polygon.coordinates[1] * polygon.area) / totalArea,
        ],
        [0, 0],
      );
    }
  }

  if (segments.length === 0) {
    if (points.length > 0) {
      return points.reduce(
        (center, point) => [
          center[0] + point[0] / points.length,
          center[1] + point[1] / points.length,
        ],
        [0, 0],
      );
    }
    return null;
  }

  const totalMeters = segments.reduce((sum, segment) => sum + segment.lengthMeters, 0);
  const weightedCenter = segments.reduce(
    (center, segment) => {
      const weight = segment.lengthMeters / totalMeters;
      return [
        center[0] + ((segment.fromCoords[0] + segment.toCoords[0]) / 2) * weight,
        center[1] + ((segment.fromCoords[1] + segment.toCoords[1]) / 2) * weight,
      ];
    },
    [0, 0],
  );

  let nearestProjection = null;
  for (const segment of segments) {
    const projection = projectCoordinatesOnSegment(
      weightedCenter,
      segment.fromCoords,
      segment.toCoords,
    );
    if (
      !nearestProjection ||
      projection.distanceSquared < nearestProjection.distanceSquared
    ) {
      nearestProjection = projection;
    }
  }

  return nearestProjection?.coordinates || weightedCenter;
}

module.exports = { computeFeatureCollectionMidpoint, getDistanceMeters };
