"use strict";
const { getDistanceMeters } = require("../../src/geometry-center.cjs");
const distance = (a, b) => getDistanceMeters(a[1], a[0], b[1], b[0]);
function bearing(a, b) {
  const r = Math.PI / 180,
    lat1 = a[1] * r,
    lat2 = b[1] * r,
    dx = (b[0] - a[0]) * r;
  return (
    (Math.atan2(
      Math.sin(dx) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dx),
    ) /
      r +
      360) %
    360
  );
}
function lines(features) {
  return features.flatMap((f) =>
    f.geometry?.type === "LineString"
      ? [f.geometry.coordinates]
      : f.geometry?.type === "MultiLineString"
        ? f.geometry.coordinates
        : [],
  );
}
function length(line) {
  return line.slice(1).reduce((sum, p, i) => sum + distance(line[i], p), 0);
}
function at(line, metres) {
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const step = distance(line[i - 1], line[i]);
    if (step > 0 && walked + step >= metres) {
      const t = Math.max(0, (metres - walked) / step);
      return [0, 1].map(
        (axis) => line[i - 1][axis] + t * (line[i][axis] - line[i - 1][axis]),
      );
    }
    walked += step;
  }
  return line.at(-1);
}
function nearest(point, features) {
  const cos = Math.cos((point[1] * Math.PI) / 180);
  let result = null;
  for (const line of lines(features)) {
    let walked = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i],
        dx = (b[0] - a[0]) * cos,
        dy = b[1] - a[1];
      const size = dx * dx + dy * dy;
      if (!size) continue;
      const ratio = Math.max(
        0,
        Math.min(
          1,
          ((point[0] - a[0]) * cos * dx + (point[1] - a[1]) * dy) / size,
        ),
      );
      const projected = [
        a[0] + ratio * (b[0] - a[0]),
        a[1] + ratio * (b[1] - a[1]),
      ];
      const gap = distance(point, projected),
        segmentLength = distance(a, b);
      if (!result || gap < result.distanceMeters)
        result = {
          line,
          coordinate: projected,
          position: walked + ratio * segmentLength,
          distanceMeters: gap,
        };
      walked += segmentLength;
    }
  }
  return result;
}
function viewAlongStreet(point, features, reverse = false) {
  const match = nearest(point, features);
  if (!match) return null;
  const total = length(match.line);
  const start = at(match.line, Math.max(0, match.position - 12));
  const end = at(match.line, Math.min(total, match.position + 12));
  if (distance(start, end) < 1) return null;
  // Local tangent, not the chord between the ends of a winding street.
  return {
    heading: reverse ? bearing(end, start) : bearing(start, end),
    distanceMeters: match.distanceMeters,
    coordinate: match.coordinate,
  };
}
function candidateLocations(features) {
  const line = lines(features)
    .filter((l) => l.length > 1)
    .sort((a, b) => length(b) - length(a))[0];
  if (!line) return [];
  const total = length(line);
  return [0.5, 0.25, 0.75].map((fraction) => at(line, total * fraction));
}
function axisDifference(a, b) {
  const delta = Math.abs(((a - b + 540) % 360) - 180);
  return Math.min(delta, 180 - delta);
}
module.exports = {
  bearing,
  distance,
  lines,
  length,
  at,
  nearest,
  viewAlongStreet,
  candidateLocations,
  axisDifference,
};
