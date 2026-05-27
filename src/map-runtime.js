export function addTouchBufferForLayerRuntime(layer, { isTouchDevice, map, L }) {
  if (!isTouchDevice || !map) {
    return;
  }
  if (layer.touchBuffer) {
    return;
  }

  const latLngs = layer.getLatLngs();
  if (!latLngs || latLngs.length === 0) {
    return;
  }

  const hitArea = L.polyline(latLngs, {
    color: "#000000",
    weight: 30,
    opacity: 0,
    interactive: true,
  });

  hitArea.on("click", (event) => {
    if (L && L.DomEvent && L.DomEvent.stop) {
      L.DomEvent.stop(event);
    }
    layer.fire("click");
  });
  hitArea.on("mouseover", () => layer.fire("mouseover"));
  hitArea.on("mouseout", () => layer.fire("mouseout"));
  hitArea.addTo(map);
  layer.touchBuffer = hitArea;
}

function scheduleIdleTask(callback) {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 1000 });
    return;
  }
  setTimeout(() => callback({ timeRemaining: () => 8 }), 16);
}

function addTouchBuffersInBatches(layers, addTouchBufferForLayer) {
  if (!layers.length || typeof addTouchBufferForLayer !== "function") {
    return;
  }

  let index = 0;
  const runBatch = (deadline) => {
    let processed = 0;
    while (
      index < layers.length &&
      processed < 80 &&
      (!deadline || deadline.didTimeout || !deadline.timeRemaining || deadline.timeRemaining() > 4)
    ) {
      addTouchBufferForLayer(layers[index]);
      index += 1;
      processed += 1;
    }

    if (index < layers.length) {
      scheduleIdleTask(runBatch);
    }
  };

  scheduleIdleTask(runBatch);
}

export async function loadStreetsRuntime({
  map,
  L,
  uiTheme,
  apiUrl = "",
  isTouchDevice = false,
  normalizeName,
  getBaseStreetStyle,
  isStreetVisibleInCurrentMode,
  isLayerHighlighted,
  handleStreetClick,
  addTouchBufferForLayer,
  getStreetHighlightStyle,
}) {
  const startedAt = performance.now();
  const remoteApiBase = String(apiUrl || "").trim().replace(/\/+$/, "");
  const candidateRequests = [
    {
      url: "data/paris_rues_light.geojson?v=13",
      options: {},
    },
  ];
  if (remoteApiBase) {
    candidateRequests.push({
      url: `${remoteApiBase}/api/streets-light`,
      options: {},
    });
  }

  let response = null;
  let selectedUrl = "";
  let lastError = null;
  for (const candidate of candidateRequests) {
    try {
      const nextResponse = await fetch(candidate.url, candidate.options);
      if (!nextResponse.ok) {
        lastError = new Error(`Erreur HTTP ${nextResponse.status} (${candidate.url})`);
        continue;
      }
      response = nextResponse;
      selectedUrl = candidate.url;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!response) {
    throw lastError || new Error("Impossible de charger les rues");
  }

  const payload = await response.json();
  const allStreetFeatures = payload.features || [];
  const streetLayersById = new Map();
  const streetLayersByName = new Map();
  const touchBufferQueue = [];
  let gameId = 0;

  const streetsLayer = L.geoJSON(allStreetFeatures, {
    style(feature) {
      return getBaseStreetStyle(feature);
    },
    onEachFeature: (feature, layer) => {
      const normalizedStreetName = normalizeName(feature.properties.name);
      const arrondissementName = feature.properties.arrondissement || null;
      feature._gameId = gameId++;
      streetLayersById.set(feature._gameId, layer);
      layer.feature = feature;

      if (!streetLayersByName.has(normalizedStreetName)) {
        streetLayersByName.set(normalizedStreetName, []);
      }
      streetLayersByName.get(normalizedStreetName).push(layer);

      if (isStreetVisibleInCurrentMode(normalizedStreetName, arrondissementName)) {
        touchBufferQueue.push(layer);
      }

      if (!isTouchDevice) {
        let hoverTimeoutId = null;
        layer.on("mouseover", () => {
          clearTimeout(hoverTimeoutId);
          hoverTimeoutId = setTimeout(() => {
            if (!isStreetVisibleInCurrentMode(normalizedStreetName, arrondissementName)) {
              return;
            }
            (streetLayersByName.get(normalizedStreetName) || []).forEach((candidateLayer) => {
              if (candidateLayer.__pariciLockedStyle) {
                candidateLayer.setStyle(candidateLayer.__pariciLockedStyle);
                return;
              }
              const highlightStyle =
                typeof getStreetHighlightStyle === "function"
                  ? getStreetHighlightStyle(uiTheme.mapStreetHover)
                  : { weight: 7, color: uiTheme.mapStreetHover };
              candidateLayer.setStyle(highlightStyle);
            });
          }, 50);
        });

        layer.on("mouseout", () => {
          clearTimeout(hoverTimeoutId);
          hoverTimeoutId = setTimeout(() => {
            if (!isStreetVisibleInCurrentMode(normalizedStreetName, arrondissementName)) {
              return;
            }
            (streetLayersByName.get(normalizedStreetName) || []).forEach((candidateLayer) => {
              if (candidateLayer.__pariciLockedStyle) {
                candidateLayer.setStyle(candidateLayer.__pariciLockedStyle);
                return;
              }
              if (isLayerHighlighted(candidateLayer)) {
                return;
              }
              const baseStyle = getBaseStreetStyle(candidateLayer);
              candidateLayer.setStyle({ weight: baseStyle.weight, color: baseStyle.color });
            });
          }, 50);
        });
      }

      layer.on("click", (clickEvent) => {
        if (isStreetVisibleInCurrentMode(normalizedStreetName, arrondissementName)) {
          handleStreetClick(feature, layer, clickEvent);
        }
      });
    },
  }).addTo(map);

  if (isTouchDevice) {
    addTouchBuffersInBatches(touchBufferQueue, addTouchBufferForLayer);
  }

  return {
    allStreetFeatures,
    streetLayersById,
    streetLayersByName,
    streetsLayer,
    loadedFrom: selectedUrl || candidateRequests[0].url,
    loadedMs: (performance.now() - startedAt).toFixed(0),
  };
}

function getArrondissementBaseStyle(uiTheme) {
  return {
    color: uiTheme.mapArrondissement,
    weight: 2,
    opacity: 0.9,
    fillColor: uiTheme.mapArrondissement,
    fillOpacity: 0.16,
  };
}

function getArrondissementHoverStyle(uiTheme) {
  return {
    color: uiTheme.mapStreetHover,
    weight: 2.5,
    opacity: 1,
    fillColor: uiTheme.mapStreetHover,
    fillOpacity: 0.24,
  };
}

export async function loadArrondissementsRuntime({
  map,
  L,
  uiTheme,
  normalizeArrondissementKey,
  handleArrondissementClick,
}) {
  const response = await fetch("data/paris_arrondissements.geojson?v=2");
  if (!response.ok) {
    throw new Error(`Impossible de charger les arrondissements (HTTP ${response.status}).`);
  }

  const payload = await response.json();
  const allArrondissementFeatures = (payload.features || []).filter((feature) => {
    const name = feature?.properties?.nom_qua;
    const geometryType = feature?.geometry?.type;
    return (
      typeof name === "string" &&
      name.trim() !== "" &&
      (geometryType === "Polygon" || geometryType === "MultiPolygon")
    );
  });

  const arrondissementPolygonsByName = new Map();
  const arrondissementLayersByKey = new Map();
  allArrondissementFeatures.forEach((feature) => {
    const arrondissementName = feature.properties.nom_qua.trim();
    arrondissementPolygonsByName.set(arrondissementName, feature);
  });

  const arrondissementsLayer = L.geoJSON(
    { type: "FeatureCollection", features: allArrondissementFeatures },
    {
      style: () => getArrondissementBaseStyle(uiTheme),
      onEachFeature: (feature, layer) => {
        const arrondissementName = feature?.properties?.nom_qua || "";
        const arrondissementKey =
          typeof normalizeArrondissementKey === "function"
            ? normalizeArrondissementKey(arrondissementName)
            : arrondissementName;

        if (arrondissementKey) {
          if (!arrondissementLayersByKey.has(arrondissementKey)) {
            arrondissementLayersByKey.set(arrondissementKey, []);
          }
          arrondissementLayersByKey.get(arrondissementKey).push(layer);
        }

        let hoverTimeoutId = null;

        layer.on("mouseover", () => {
          if (layer.__pariciLockedStyle) {
            return;
          }
          clearTimeout(hoverTimeoutId);
          hoverTimeoutId = setTimeout(() => {
            if (!layer.__pariciLockedStyle) {
              layer.setStyle(getArrondissementHoverStyle(uiTheme));
            }
          }, 30);
        });

        layer.on("mouseout", () => {
          if (layer.__pariciLockedStyle) {
            return;
          }
          clearTimeout(hoverTimeoutId);
          hoverTimeoutId = setTimeout(() => {
            if (!layer.__pariciLockedStyle) {
              layer.setStyle(getArrondissementBaseStyle(uiTheme));
            }
          }, 30);
        });

        layer.on("click", (event) => {
          if (typeof handleArrondissementClick === "function") {
            handleArrondissementClick(feature, layer, event);
          }
        });
      },
    },
  );

  return {
    allArrondissementFeatures,
    arrondissementPolygonsByName,
    arrondissementLayersByKey,
    arrondissementsLayer,
  };
}

export async function loadMonumentsRuntime({
  map,
  L,
  uiTheme,
  isTouchDevice,
  handleMonumentClick,
  allowedMonumentNames,
  runtimeMonuments,
}) {
  const normalizeMonumentName = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’`´]/g, "'")
      .replace(/[-‐‑‒–—]/g, "-")
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, " ");

  let sourceFeatures = null;
  const useRuntimeMonuments = Array.isArray(runtimeMonuments);
  if (Array.isArray(runtimeMonuments)) {
    sourceFeatures = runtimeMonuments;
  } else {
    const response = await fetch("data/paris_monuments.geojson");
    if (!response.ok) {
      throw new Error(`Impossible de charger les monuments (HTTP ${response.status}).`);
    }

    const payload = await response.json();
    sourceFeatures = payload.features || [];
  }
  const normalizedAllowedMonumentNames =
    allowedMonumentNames instanceof Set
      ? new Set(
        Array.from(allowedMonumentNames)
          .map((value) => normalizeMonumentName(value))
          .filter(Boolean),
      )
      : new Set();
  const hasMonumentFilter = !useRuntimeMonuments && normalizedAllowedMonumentNames.size > 0;
  const allMonuments = (sourceFeatures || []).filter(
    (feature) =>
      feature.geometry &&
      feature.geometry.type === "Point" &&
      feature.properties &&
      typeof feature.properties.name === "string" &&
      feature.properties.name.trim() !== "" &&
      (!hasMonumentFilter ||
        normalizedAllowedMonumentNames.has(normalizeMonumentName(feature.properties.name))),
  );

  let monumentsLayer = L.geoJSON(
    { type: "FeatureCollection", features: allMonuments },
    {
      renderer: L.svg({ pane: "markerPane" }),
      pointToLayer: (feature, latlng) => {
        const marker = L.circleMarker(latlng, {
          radius: 8,
          color: uiTheme.mapMonumentStroke,
          weight: 3,
          fillColor: uiTheme.mapMonumentFill,
          fillOpacity: 1,
          pane: "markerPane",
        });
        if (isTouchDevice) {
          marker._monumentFeature = feature;
        }
        return marker;
      },
      onEachFeature: (feature, layer) => {
        layer.on("click", () => handleMonumentClick(feature, layer));
      },
    },
  );

  if (isTouchDevice && monumentsLayer) {
    monumentsLayer.eachLayer((layer) => {
      const feature = layer._monumentFeature;
      if (!feature) {
        return;
      }
      const latlng = layer.getLatLng();
      const hitArea = L.circleMarker(latlng, {
        radius: 18,
        fillOpacity: 0,
        opacity: 0,
        pane: "markerPane",
      });
      hitArea.on("click", () => handleMonumentClick(feature, layer));
      hitArea._visibleMarker = layer;
      hitArea._isHitArea = true;
      monumentsLayer.addLayer(hitArea);
    });
  }

  return { allMonuments, monumentsLayer };
}

export function setLectureTooltipsEnabledRuntime(enabled, {
  streetsLayer,
  monumentsLayer,
  arrondissementsLayer,
  getBaseStreetStyle,
  isStreetVisibleInCurrentMode,
  normalizeName,
  isTouchDevice,
}) {
  function unbindLectureTap(layer) {
    if (layer.__lectureTapTooltipBound) {
      if (layer.__lectureTapTooltipFn) {
        layer.off("click", layer.__lectureTapTooltipFn);
      }
      layer.__lectureTapTooltipBound = false;
      layer.__lectureTapTooltipFn = null;
    }
  }

  function unbindMonumentTap(layer) {
    if (layer.__monumentTapBound) {
      if (layer.__monumentTapFn) {
        layer.off("click", layer.__monumentTapFn);
      }
      layer.__monumentTapBound = false;
      layer.__monumentTapFn = null;
    }
  }

  function unbindHitAreaTap(layer) {
    if (layer.__hitAreaTooltipBound) {
      if (layer.__hitAreaTooltipFn) {
        layer.off("click", layer.__hitAreaTooltipFn);
      }
      layer.__hitAreaTooltipBound = false;
      layer.__hitAreaTooltipFn = null;
    }
  }

  if (streetsLayer) {
    streetsLayer.eachLayer((layer) => {
      const streetName = layer.feature?.properties?.name || "";
      if (!streetName) {
        return;
      }

      const normalizedStreetName =
        typeof normalizeName === "function" ? normalizeName(streetName) : streetName;
      const arrondissementName =
        typeof layer.feature?.properties?.arrondissement === "string"
          ? layer.feature.properties.arrondissement
          : null;
      const isVisibleInCurrentMode =
        typeof isStreetVisibleInCurrentMode === "function"
          ? isStreetVisibleInCurrentMode(normalizedStreetName, arrondissementName)
          : getBaseStreetStyle(layer).weight > 0;

      if (enabled) {
        if (isVisibleInCurrentMode) {
          if (!layer.getTooltip()) {
            layer.bindTooltip(streetName, {
              direction: "top",
              sticky: !isTouchDevice,
              opacity: 0.9,
              className: "street-tooltip",
            });
          }

          if (isTouchDevice && !layer.__lectureTapTooltipBound) {
            layer.__lectureTapTooltipBound = true;
            layer.on(
              "click",
              (layer.__lectureTapTooltipFn = () => {
                if (layer.getTooltip()) {
                  layer.openTooltip();
                }

                if (streetsLayer) {
                  streetsLayer.eachLayer((candidateLayer) => {
                    if (candidateLayer !== layer && candidateLayer.getTooltip && candidateLayer.getTooltip()) {
                      candidateLayer.closeTooltip();
                    }
                  });
                }

                if (monumentsLayer) {
                  monumentsLayer.eachLayer((candidateLayer) => {
                    if (candidateLayer !== layer && candidateLayer.getTooltip && candidateLayer.getTooltip()) {
                      candidateLayer.closeTooltip();
                    }
                  });
                }
              }),
            );
          }
        } else {
          if (layer.getTooltip()) {
            layer.unbindTooltip();
          }
          unbindLectureTap(layer);
        }
      } else {
        unbindLectureTap(layer);
        if (layer.getTooltip()) {
          layer.closeTooltip();
          layer.unbindTooltip();
        }
      }
    });
  }

  if (monumentsLayer) {
    monumentsLayer.eachLayer((layer) => {
      if (layer._isHitArea) {
        if (enabled && isTouchDevice && !layer.__hitAreaTooltipBound) {
          layer.__hitAreaTooltipBound = true;
          layer.on(
            "click",
            (layer.__hitAreaTooltipFn = () => {
              const visibleMarker = layer._visibleMarker;
              if (!visibleMarker || !visibleMarker.getTooltip()) {
                return;
              }
              monumentsLayer.eachLayer((candidateLayer) => {
                if (
                  candidateLayer !== visibleMarker &&
                  candidateLayer.getTooltip &&
                  candidateLayer.getTooltip()
                ) {
                  candidateLayer.closeTooltip();
                }
              });
              visibleMarker.toggleTooltip();
            }),
          );
        } else if (!enabled || !isTouchDevice) {
          unbindHitAreaTap(layer);
        }
        return;
      }

      const monumentName = layer.feature?.properties?.name || "";
      if (!monumentName) {
        return;
      }

      if (enabled) {
        if (!layer.getTooltip()) {
          layer.bindTooltip(monumentName, {
            direction: "top",
            sticky: false,
            permanent: false,
            opacity: 0.9,
            className: "monument-tooltip",
          });
        }
        if (isTouchDevice && !layer.__monumentTapBound) {
          layer.__monumentTapBound = true;
          layer.on(
            "click",
            (layer.__monumentTapFn = () => {
              monumentsLayer.eachLayer((candidateLayer) => {
                if (
                  candidateLayer !== layer &&
                  candidateLayer.getTooltip &&
                  candidateLayer.getTooltip()
                ) {
                  candidateLayer.closeTooltip();
                }
              });
              if (layer.getTooltip()) {
                layer.toggleTooltip();
              }
            }),
          );
        } else if (!isTouchDevice) {
          unbindMonumentTap(layer);
        }
      } else {
        unbindMonumentTap(layer);
        if (layer.getTooltip()) {
          layer.closeTooltip();
          layer.unbindTooltip();
        }
      }
    });
  }

  if (arrondissementsLayer) {
    arrondissementsLayer.eachLayer((layer) => {
      const arrondissementName = layer.feature?.properties?.nom_qua || "";
      if (!arrondissementName) {
        return;
      }

      if (enabled) {
        if (!layer.getTooltip()) {
          layer.bindTooltip(arrondissementName, {
            direction: "top",
            sticky: !isTouchDevice,
            permanent: false,
            opacity: 0.9,
            className: "street-tooltip",
          });
        }
      } else if (layer.getTooltip()) {
        layer.closeTooltip();
        layer.unbindTooltip();
      }
    });
  }
}
