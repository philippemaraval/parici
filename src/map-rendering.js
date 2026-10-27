// Build and project paths in short batches, with one final canvas redraw.
export async function buildMapLayer(L, map, data, options, renderer, signal) {
  const layer = L.geoJSON([], options).addTo(map);
  const redraw = renderer?._requestRedraw;
  if (redraw) renderer._requestRedraw = () => {};
  try {
    await addGeoJSONFeaturesInBatches(layer, data.features, { signal });
    return layer;
  } catch (error) {
    map.removeLayer(layer);
    throw error;
  } finally {
    if (redraw) {
      renderer._requestRedraw = redraw;
      redraw.call(renderer, {});
    }
  }
}

export function indexCollectLayers(layer, answerFor) {
  const index = new Map();
  layer.eachLayer((item) => {
    if (item._isHitArea || item._isBusHitArea) return;
    const answer = answerFor(item.feature);
    if (!index.has(answer)) index.set(answer, []);
    index.get(answer).push(item);
  });
  return index;
}

// The time budget also limits batches of unusually complex geometries.
export async function addGeoJSONFeaturesInBatches(
  layer,
  features,
  {
    signal,
    maxFeatures = 100,
    budgetMs = 4,
    yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0)),
  } = {},
) {
  let index = 0;
  while (index < features.length) {
    signal?.throwIfAborted();
    const start = performance.now();
    let added = 0;
    do {
      layer.addData(features[index++]);
      added += 1;
    } while (
      index < features.length &&
      added < maxFeatures &&
      performance.now() - start < budgetMs
    );
    if (index < features.length) await yieldTask();
  }
}
