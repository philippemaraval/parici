export function getDistanceMeters(lat1, lon1, lat2, lon2) {
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

export function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  // Approximate local projection (meters) to avoid degree-based distances.
  const earthRadius = 6371000;
  const cosLat = Math.cos((px * Math.PI) / 180);

  const pxMeters = (py * cosLat * earthRadius * Math.PI) / 180;
  const pyMeters = (px * earthRadius * Math.PI) / 180;

  const x1Meters = (x1 * cosLat * earthRadius * Math.PI) / 180;
  const y1Meters = (y1 * earthRadius * Math.PI) / 180;
  const x2Meters = (x2 * cosLat * earthRadius * Math.PI) / 180;
  const y2Meters = (y2 * earthRadius * Math.PI) / 180;

  const dx = x2Meters - x1Meters;
  const dy = y2Meters - y1Meters;
  const l2 = dx * dx + dy * dy;
  let t = 0;
  if (l2 !== 0) {
    t = Math.max(
      0,
      Math.min(1, ((pxMeters - x1Meters) * dx + (pyMeters - y1Meters) * dy) / l2),
    );
  }

  const projX = x1Meters + t * dx;
  const projY = y1Meters + t * dy;
  const dist2 = (pxMeters - projX) * (pxMeters - projX) + (pyMeters - projY) * (pyMeters - projY);
  return Math.sqrt(dist2);
}

function isPointInRing(lon, lat, ringCoords) {
  if (!Array.isArray(ringCoords) || ringCoords.length < 3) {
    return false;
  }

  let inside = false;
  for (let i = 0, j = ringCoords.length - 1; i < ringCoords.length; j = i++) {
    const [xi, yi] = ringCoords[i];
    const [xj, yj] = ringCoords[j];
    const crossesLatitude = yi > lat !== yj > lat;
    if (!crossesLatitude) {
      continue;
    }
    const edgeDenominator = yj - yi;
    const intersectionLon = ((xj - xi) * (lat - yi)) / (edgeDenominator || Number.EPSILON) + xi;
    if (lon < intersectionLon) {
      inside = !inside;
    }
  }

  return inside;
}

function isPointInsidePolygon(lon, lat, polygonCoords) {
  if (!Array.isArray(polygonCoords) || polygonCoords.length === 0) {
    return false;
  }

  const [outerRing, ...holeRings] = polygonCoords;
  if (!isPointInRing(lon, lat, outerRing)) {
    return false;
  }

  for (const holeRing of holeRings) {
    if (isPointInRing(lon, lat, holeRing)) {
      return false;
    }
  }

  return true;
}

export function getDistanceToFeature(lat, lon, geometry) {
  if (!geometry) {
    return 0;
  }
  let minDistance = Number.POSITIVE_INFINITY;

  function inspectLine(lineCoords) {
    for (let index = 0; index < lineCoords.length - 1; index++) {
      const [x1, y1] = lineCoords[index];
      const [x2, y2] = lineCoords[index + 1];
      const segmentDistance = pointToSegmentDistance(lat, lon, x1, y1, x2, y2);
      if (segmentDistance < minDistance) {
        minDistance = segmentDistance;
      }
    }
  }

  if (geometry.type === "LineString") {
    inspectLine(geometry.coordinates);
  } else if (geometry.type === "MultiLineString") {
    geometry.coordinates.forEach(inspectLine);
  } else if (geometry.type === "Point") {
    minDistance = getDistanceMeters(lat, lon, geometry.coordinates[1], geometry.coordinates[0]);
  } else if (geometry.type === "Polygon") {
    if (isPointInsidePolygon(lon, lat, geometry.coordinates)) {
      return 0;
    }
    geometry.coordinates.forEach(inspectLine);
  } else if (geometry.type === "MultiPolygon") {
    for (const polygonCoords of geometry.coordinates) {
      if (isPointInsidePolygon(lon, lat, polygonCoords)) {
        return 0;
      }
      polygonCoords.forEach(inspectLine);
    }
  }

  return Number.isFinite(minDistance) ? minDistance : 0;
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

export function computeFeatureCollectionMidpoint(featureCollection) {
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

export function calculateStreetLengthFromFeatures(streetTarget, allStreetFeatures, normalizeName) {
  try {
    if (!streetTarget || !Array.isArray(allStreetFeatures)) {
      return 0;
    }

    const targetProperties = streetTarget.properties || streetTarget;
    const streetId = String(
      targetProperties.street_id || targetProperties.streetId || targetProperties.id || "",
    ).trim();
    const streetName =
      typeof streetTarget === "string"
        ? streetTarget
        : targetProperties.streetName || targetProperties.name || "";
    const normalizedStreetName = normalizeName(streetName);
    const features = allStreetFeatures.filter((candidate) => {
      if (!candidate?.properties || !candidate.geometry) {
        return false;
      }
      if (streetId) {
        return candidate.properties.street_id === streetId || candidate.properties.id === streetId;
      }
      return (
        candidate.properties.name &&
        normalizeName(candidate.properties.name) === normalizedStreetName
      );
    });
    if (features.length === 0) {
      return 0;
    }

    let totalMeters = 0;
    for (const feature of features) {
      const geometry = feature.geometry;
      if (geometry.type === "LineString") {
        for (let index = 0; index < geometry.coordinates.length - 1; index++) {
          const [lon1, lat1] = geometry.coordinates[index];
          const [lon2, lat2] = geometry.coordinates[index + 1];
          totalMeters += getDistanceMeters(lat1, lon1, lat2, lon2);
        }
      } else if (geometry.type === "MultiLineString") {
        for (const line of geometry.coordinates) {
          for (let index = 0; index < line.length - 1; index++) {
            const [lon1, lat1] = line[index];
            const [lon2, lat2] = line[index + 1];
            totalMeters += getDistanceMeters(lat1, lon1, lat2, lon2);
          }
        }
      }
    }

    return totalMeters;
  } catch (error) {
    console.error("Error calculating street length:", error);
    return 0;
  }
}

export function computeFeatureCentroid(feature) {
  const geometry = feature.geometry;
  let coordinates = [];
  if (geometry.type === "LineString") {
    coordinates = geometry.coordinates;
  } else if (geometry.type === "MultiLineString") {
    coordinates = geometry.coordinates.flat();
  } else if (geometry.type === "Polygon") {
    coordinates = geometry.coordinates[0] || [];
  } else if (geometry.type === "MultiPolygon") {
    coordinates = geometry.coordinates.flatMap((polygonCoords) => polygonCoords[0] || []);
  } else if (geometry.type === "Point") {
    return geometry.coordinates;
  } else {
    return [2.3522, 48.8566];
  }

  if (coordinates.length === 0) {
    return [2.3522, 48.8566];
  }

  const [sumLon, sumLat] = coordinates.reduce(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1]],
    [0, 0],
  );
  return [sumLon / coordinates.length, sumLat / coordinates.length];
}
