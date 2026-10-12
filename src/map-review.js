// A separate overlay keeps answer colors and the current selection intact.
export function reviewMapFeatures(map, L, features) {
  if (!map || !features.length) return;
  map.closePopup();
  const overlay = L.geoJSON({ type: "FeatureCollection", features: [...new Set(features)] }, {
    interactive: false,
    style: { color: "#ff9800", weight: 9, opacity: 1, fillOpacity: 0.35 },
    pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
      interactive: false, radius: 13, color: "#ff9800", weight: 5,
      fillOpacity: 0.35,
    }),
  }).addTo(map);
  const bounds = overlay.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  map.getContainer().scrollIntoView({ block: "nearest", behavior: "smooth" });
  setTimeout(() => overlay.setStyle({ opacity: 0, fillOpacity: 0 }), 450);
  setTimeout(() => overlay.setStyle({ opacity: 1, fillOpacity: 0.35 }), 750);
  setTimeout(() => map.removeLayer(overlay), 1500);
}
