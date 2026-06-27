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

function collectLineSegmentsFromGeometry(geometry, segments) {
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
    geometry.coordinates.forEach(inspectLine);
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((polygonCoords) => polygonCoords.forEach(inspectLine));
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

  features.forEach((feature) => {
    collectLineSegmentsFromGeometry(feature?.geometry || feature, segments);
  });

  if (segments.length === 0) {
    const firstPointFeature = features.find(
      (feature) => (feature?.geometry || feature)?.type === "Point",
    );
    if (firstPointFeature) {
      return (firstPointFeature.geometry || firstPointFeature).coordinates;
    }
    return null;
  }

  const totalMeters = segments.reduce((sum, segment) => sum + segment.lengthMeters, 0);
  let remainingMeters = totalMeters / 2;

  for (const segment of segments) {
    if (remainingMeters <= segment.lengthMeters) {
      return interpolateCoordinates(
        segment.fromCoords,
        segment.toCoords,
        remainingMeters / segment.lengthMeters,
      );
    }
    remainingMeters -= segment.lengthMeters;
  }

  return segments[segments.length - 1].toCoords;
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
