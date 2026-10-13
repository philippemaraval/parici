import { initPersonalAlbums } from "./personal-albums-view.js";
import { renderCardArtwork } from "./collect-card-art.js";
import { addTouchBufferForLayerRuntime } from "../../map-runtime.js";
import { loadMonumentsRuntime, loadBusLinesRuntime } from "../../map-runtime.js";
import { avatarMarkup, iconMarkup } from "./camino-art.js";
import { reviewMapFeatures } from "../../map-review.js";
import { UI_THEME } from "../../config.js";
import { computeFeatureCollectionMidpoint } from "../../geometry-center.cjs";
import { renderFragmentMosaic } from "./collect-fragment-view.js";
(() => {
  'use strict';

  const API = window.CaminoRuntimeConfig?.apiUrl || (['localhost', '127.0.0.1'].includes(location.hostname)
    ? 'http://localhost:3000'
    : 'https://parici.onrender.com');
  const token = () => localStorage.getItem('camino_auth_token') || sessionStorage.getItem('camino_paris_session_token') || (JSON.parse(localStorage.getItem('camino_paris_user')||'null')?.authenticated ? '__cookie_session__' : '');
  const els = Object.fromEntries(['collect-quota','collect-game-status','collect-family-label','collect-map-hint',
    'collect-map','collect-next','collect-grid','collect-progress','collect-error','collect-play',
    'collect-social','collect-profile','collect-profile-content','collect-collection','collect-albums','collect-leaderboard','collect-album-grid','collect-badge-grid','collect-ranking']
    .map((id) => [id, document.getElementById(id)]));
  const familyNames = { street: 'Rue', district: 'Quartier', monument: 'Monument', bus: 'Transport' };
  let map;
  let gameRenderer;
  let selectionRenderer;
  let mapReady = false;
  let game;
  let gameRequest = 0;
  let selectedAnswer = null;
  let featureLayer = null;
  let touchLayers = null;
  let destroyFamilyMap = null;
  const isTouchDevice=()=>matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints>0;
  const visibleLayer=layer=>!layer._isHitArea && !layer._isBusHitArea;
  let answering = false;
  let selectionMarker = null;
  const fallbackImage="/apple-touch-icon.png";
  const hintImage=document.getElementById("collect-hint-image");
  hintImage.addEventListener("error",()=>{if(hintImage.getAttribute("src")!==fallbackImage){hintImage.src=fallbackImage;document.getElementById('collect-hint-credit').textContent='Parici';}});
  const questionPanel = document.getElementById("collect-question");
  const exitButton = document.getElementById("collect-exit");
  function leaveMap() {
    mapReady = false;
    document.body.classList.remove("collect-session-active");
    document.documentElement.classList.remove("collect-map-active");
    els["collect-map"].hidden = true;
    exitButton.hidden = true;
    document.getElementById('collect-visual-hint').hidden=true;
  }
  exitButton.addEventListener("click", async () => {
    if(answering)return;
    if(game&&!game.finished){
      exitButton.disabled=true;
      try{await request(`/api/collect/games/${encodeURIComponent(game.gameId)}`,{method:"DELETE"});}
      catch(error){showError(error.message);exitButton.disabled=false;return;}
    }
    pendingGame=null;
    gameRequest++; leaveMap(); questionPanel.hidden=true; game=null; selectedAnswer=null;
    els["collect-next"].hidden=false; els["collect-next"].disabled=false;
    exitButton.disabled=false;
    els["collect-game-status"].hidden=false;delete els["collect-game-status"].dataset.outcome;els["collect-game-status"].textContent="Prêt à jouer ?";
  });
  const questionExit=document.getElementById("collect-question-exit");
  questionExit.addEventListener("click",()=>{if(!answering)exitButton.click();});
  let quotaTimer = null;
  let collectionPayload = null;
  let recentlyAwardedDetail = null;
  let collectionPage = 1;
  let collectionRequest=0, pagedCollection=null;
  let leaderboardRequest=0;
  let pendingGame=null;
  let publicProfileRequest = 0;
  let publicProfileName = '';
  let publicRarityLabels = {};
  let authenticated = false;
  let socialApi=null,socialReady=Promise.resolve();
  const fiveRarityLabels = { 1: 'Commune', 2: 'Peu commune', 3: 'Rare', 4: 'Épique', 5: 'Légendaire' };
  let rarityLabels = fiveRarityLabels;

  const authGate=document.getElementById('collect-auth-gate');
  const gameControls=document.getElementById('collect-game-controls');
  const internalNavigation=document.getElementById('collect-internal-navigation');
  function setCollectAuthentication(connected) {
    authenticated=connected;
    internalNavigation.hidden=!connected;
    authGate.hidden=connected;
    gameControls.hidden=!connected;
    els['collect-quota'].hidden=!connected;
    if(!connected){
      gameRequest++;leaveMap();questionPanel.hidden=true;game=null;selectedAnswer=null;
      els['collect-next'].hidden=true;els['collect-next'].disabled=true;
      els['collect-game-status'].hidden=false;
      delete els['collect-game-status'].dataset.outcome;
      els['collect-game-status'].textContent='Connecte-toi à Parici pour jouer à Collect.';
    }else if(!game){
      els['collect-next'].hidden=false;els['collect-next'].disabled=false;
      els['collect-game-status'].textContent='Prêt à jouer ?';
    }
  }
  setCollectAuthentication(false);

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${API}${path}`, { credentials: "include", ...options, signal: controller.signal, headers: {
        'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(options.headers || {}),
      } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error=new Error(payload.error || `Erreur ${response.status}`);error.status=response.status;
        if(response.status===401)setCollectAuthentication(false);
        throw error;
      }
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('La connexion a expiré. Tu peux sélectionner de nouveau le lieu.');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function showError(message = '') { els['collect-error'].textContent = message; }

  async function refreshQuota() {
    try {
      const quota = await request('/api/collect/quota');
      const nextAt = quota.nextAvailableAt ? new Date(quota.nextAvailableAt).getTime() : 0;
      const remaining = Math.max(0, quota.limit - quota.copies);
      clearInterval(quotaTimer);
      const drawQuota = () => {
        const wait = nextAt - Date.now();
        els['collect-quota'].textContent = remaining
          ? `${quota.copies}/${quota.limit} cartes`
          : `${quota.limit}/${quota.limit} · ${formatCountdown(wait)}`;
        els['collect-quota'].title = remaining ? `${quota.copies}/${quota.limit} cartes gagnées` : `Prochaine carte dans ${formatCountdown(wait)}`;
        els['collect-quota'].setAttribute('aria-label', els['collect-quota'].title);
        if(!game || game.finished)els['collect-next'].textContent=remaining?(pendingGame?'Reprendre la partie':game?'Partie suivante':'Lancer une partie'):'Continuer à jouer sans carte';
        if (nextAt && wait <= 0) { clearInterval(quotaTimer); refreshQuota(); }
      };
      drawQuota();
      if (quota.copies === quota.limit) window.CaminoCollectNotifications?.refresh();
      if (nextAt && nextAt > Date.now()) quotaTimer = setInterval(drawQuota, 1000);
    } catch (_error) { els['collect-quota'].textContent = 'Quota indisponible'; }
  }

  function formatCountdown(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  async function ensureMap() {
    if (map) return;
    await window.loadCollectMapRuntime();
    if (map) return;
    gameRenderer = window.L.canvas({tolerance:5});
    selectionRenderer = window.L.svg();
    map = window.L.map(els['collect-map'], { renderer: gameRenderer, zoomControl: true, preferCanvas: true, doubleClickZoom:false, tapTolerance:isTouchDevice()?25:15 }).setView([48.8566, 2.3522], 12);
    window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Tiles © Esri',
    }).addTo(map);
    map.on('click',()=>{if(game?.card.family==='bus'&&mapReady&&!game.finished&&!answering){selectedAnswer=null;featureLayer?.eachLayer(layer=>{if(visibleLayer(layer)&&layer.setStyle)layer.setStyle({color:'#'+(layer.feature?.properties?.color||'049bc5'),weight:3,opacity:.82});});if(selectionMarker){map.removeLayer(selectionMarker);selectionMarker=null;}}});
  }

  const crosshair=document.createElement('span');crosshair.className='collect-map-crosshair';crosshair.setAttribute('aria-hidden','true');els['collect-map'].append(crosshair);
  els['collect-map'].addEventListener('keydown',event=>{
    if(!mapReady||!game||game.finished||game.question||answering)return;
    if(event.key==='Enter'&&selectedAnswer){event.preventDefault();submitAnswer();return;}
    if(event.key!==' ')return;
    event.preventDefault();
    const center=map.latLngToContainerPoint(map.getCenter());
    let nearest=null,distance=Infinity;
    function segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
    function lineDistance(points){let result=Infinity;for(let i=1;i<points.length;i++)result=Math.min(result,segmentDistance(center,points[i-1],points[i]));return result;}
    function contains(points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>center.y)!==(b.y>center.y)&&center.x<(b.x-a.x)*(center.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
    featureLayer.eachLayer(layer=>{
      if(!visibleLayer(layer))return;
      const geometry=layer.feature?.geometry;if(!geometry)return;
      const toPoint=c=>map.latLngToContainerPoint([c[1],c[0]]);
      let d=Infinity;
      if(geometry.type==='Point')d=center.distanceTo(toPoint(geometry.coordinates));
      else if(['LineString','MultiLineString'].includes(geometry.type)){const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.coordinates;d=Math.min(...lines.map(line=>lineDistance(line.map(toPoint))));}
      else if(['Polygon','MultiPolygon'].includes(geometry.type)){const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;d=polygons.some(rings=>contains(rings[0].map(toPoint))&&!rings.slice(1).some(ring=>contains(ring.map(toPoint))))?0:Infinity;}
      if(d<distance){distance=d;nearest=layer;}
    });
    if(nearest&&distance<=15){markSelection(nearest,featureAnswer(game.card.family,nearest.feature),String(nearest.feature.properties?.quartier||''));showError('Lieu sélectionné au centre. Entrée pour confirmer.');}
    else showError('Aucun lieu sélectionnable au centre. Déplace ou zoome la carte.');
  });

  // Prevent browser pull-to-refresh without stopping Leaflet's gesture handlers.
  els['collect-map'].addEventListener('touchmove', event => {
    if (document.body.classList.contains('collect-session-active') && event.cancelable) event.preventDefault();
  }, { passive: false });

  function featureAnswer(family, feature) {
    const properties = feature?.properties || {};
    if (family === 'district') return properties.nom_qua || properties.name || null;
    if (family === 'street') return properties.collect_entity_id || null;
    return properties.name || null;
  }

  function layerStyle(family) {
    if (family === 'district') return { color: '#233d8b', weight: 2, fillColor: '#7287d8', fillOpacity: 0.28 };
    if (family === 'bus') return { color: '#049bc5', weight: 5, opacity: 0.75 };
    if (family === 'street') return { color: UI_THEME.mapStreet, weight: 3, opacity: 1 };
    return { radius: 8, color: '#fff', weight: 2, fillColor: '#d2463c', fillOpacity: 0.9 };
  }

  function markSelection(_layer, answer, context = '') {
    if (!mapReady || loadedFamily !== game?.card.family || !answer || !game || game.finished || game.question || answering) return;
    if (selectedAnswer?.id === answer && selectedAnswer?.context === context) {submitAnswer(); return;}
    featureLayer.eachLayer(item => {if (visibleLayer(item) && item.setStyle) item.setStyle(layerStyle(game.card.family));});
    selectedAnswer = { id: answer, context };

    featureLayer.eachLayer(item => {
      if (visibleLayer(item) && featureAnswer(game.card.family,item.feature) === answer && item.setStyle) item.setStyle({color:UI_THEME.mapPending,fillColor:UI_THEME.mapPending,weight:8,fillOpacity:0.72});
    });
    if(selectionMarker) map.removeLayer(selectionMarker);
    const matching=loadedFamilyData.features.filter(feature=>featureAnswer(game.card.family,feature)===answer);
    const midpoint=computeFeatureCollectionMidpoint(matching);
    if(midpoint)selectionMarker=window.L.circleMarker([midpoint[1],midpoint[0]],{radius:5,color:'#fff',weight:2,fillColor:'#ff0000',fillOpacity:1,interactive:false,renderer:selectionRenderer}).addTo(map);
  }

  let loadedFamily=null;
  let loadedFamilyData=null;
  const familyMapCache=new Map();
  function getFamilyMap(family){
    if(!familyMapCache.has(family))familyMapCache.set(family,fetch(`${API}/api/collect/map/${encodeURIComponent(family)}`, {signal: AbortSignal.timeout(20000)}).then(async response=>{
      if(!response.ok)throw Error('Données cartographiques indisponibles pour cette famille.');
      return response.json();
    }).catch(error=>{familyMapCache.delete(family);throw error;}));
    return familyMapCache.get(family);
  }
  async function prewarmCollect(){
    try{
      await window.loadCollectMapRuntime();
      if(navigator.connection?.saveData||['slow-2g','2g','3g'].includes(navigator.connection?.effectiveType))return;
      await getFamilyMap('street');
      if(!game&&!document.body.classList.contains('collect-session-active'))await loadFamilyMap('street');
    }catch(_error){/* A launch retries any failed background request. */}
  }
  let familyMapLoad = Promise.resolve();
  function loadFamilyMap(family) {
    familyMapLoad = familyMapLoad.catch(() => {}).then(() => applyFamilyMap(family));
    return familyMapLoad;
  }
  async function applyFamilyMap(family) {
    const [,data]=await Promise.all([ensureMap(),getFamilyMap(family)]);
    loadedFamilyData=data;
    if(selectionMarker){map.removeLayer(selectionMarker);selectionMarker=null;}
    if(featureLayer&&loadedFamily===family&&['street','district'].includes(family)){
      featureLayer.eachLayer(layer=>{featureLayer.resetStyle(layer);if(layer.getTooltip?.()?.options.permanent)layer.unbindTooltip();});
      if(family==='street')map.setView([48.8566, 2.3522],13,{animate:false});
      else map.fitBounds(featureLayer.getBounds(),{padding:[18,18],maxZoom:13,animate:false});
      map.invalidateSize();return;
    }
    loadedFamily = null;
    if (destroyFamilyMap) {destroyFamilyMap();destroyFamilyMap=null;}
    if (featureLayer) { map.removeLayer(featureLayer); featureLayer = null; }
    if (touchLayers) map.removeLayer(touchLayers);
    touchLayers = window.L.layerGroup().addTo(map);
    if (family === 'monument') {
      const result=await loadMonumentsRuntime({map,L:window.L,uiTheme:{mapMonumentStroke:'#fff',mapMonumentFill:'#c43832'},isTouchDevice:isTouchDevice(),runtimeMonuments:data.features,
        handleMonumentClick:(feature,layer)=>markSelection(layer,featureAnswer(family,feature))});
      // Monument markers and touch targets normally create a markerPane canvas.
      // Leaflet keeps that empty canvas after removing the group, and it then
      // intercepts clicks intended for the next family's overlayPane paths.
      // Collect shows one family at a time: all its interactive paths share
      // the same renderer, including the invisible monument touch targets.
      result.monumentsLayer.eachLayer(layer => { layer.options.renderer = gameRenderer; });
      featureLayer=result.monumentsLayer.addTo(map);
    } else if (family === 'bus') {
      await window.loadCollectBusRuntime();
      const result=await loadBusLinesRuntime({map,L:window.L,uiTheme:{mapBusLine:'#c43832'},isTouchDevice:isTouchDevice(),runtimeBusLines:data,groupSegments:true,
        handleBusLineClick:(feature,layer,colorNames=[])=>markSelection(layer,featureAnswer(family,feature))});
      featureLayer=result.busLinesLayer.addTo(map);destroyFamilyMap=result.destroy;
    } else featureLayer = window.L.geoJSON(data, {
      style: () => layerStyle(family),
      pointToLayer: (_feature, latlng) => window.L.circleMarker(latlng, { ...layerStyle(family), radius: 7, fillColor: family === 'street' ? '#f2a900' : '#d2463c', fillOpacity: 0.9 }),
      onEachFeature: (feature, layer) => {
        if (feature.properties?.collect_geometry_source === 'street_index_centroid') layer.bindTooltip('Repère de rue · référentiel Parici');
        layer.on('click', event => {window.L.DomEvent.stop(event); markSelection(layer, featureAnswer(family, feature), String(feature?.properties?.quartier || '')); });
      },
    }).addTo(map);
    if (family === 'street') featureLayer.eachLayer(layer => {
      if (typeof layer.getLatLngs === 'function') addTouchBufferForLayerRuntime(layer, {
        isTouchDevice:isTouchDevice(),
        map:touchLayers,L:window.L,
      });
    });
    if (family !== 'street') map.fitBounds(featureLayer.getBounds(), { padding: [18, 18], maxZoom: 13, animate: false });
    else map.setView([48.8566, 2.3522], 13, { animate: false });
    loadedFamily=family;
    setTimeout(() => map.invalidateSize(), 30);
  }

  async function startGame() {
    if(!authenticated){setCollectAuthentication(false);return;}
    const requestId = ++gameRequest;
    leaveMap();
    showError('');
    els['collect-next'].disabled = true;
    els['collect-next'].textContent = 'Chargement de la partie…';
    els['collect-game-status'].hidden=false;
    els['collect-game-status'].textContent='Préparation du lieu et de la carte…';
    exitButton.disabled=true;
    questionPanel.hidden=true;
    document.getElementById('collect-revealed-card').hidden=true;
    try {
      const runtime=ensureMap();
      const draw=pendingGame?Promise.resolve(pendingGame):request('/api/collect/games',{method:'POST',body:'{}'}).then(payload=>{pendingGame=payload;return payload;});
      const [drawResult,mapResult]=await Promise.allSettled([draw,runtime]);
      if(mapResult.status==='rejected')throw mapResult.reason;
      if(drawResult.status==='rejected')throw drawResult.reason;
      const payload=drawResult.value;
      if (requestId !== gameRequest || !authenticated) return;
      if (!payload.gameId || !payload.card?.name || !familyNames[payload.card.family]) {
        pendingGame=null;
        throw new Error('Le lieu à trouver n’a pas pu être chargé. Relance la partie.');
      }
      const connection=navigator.connection;
      if(!isTouchDevice()&&!connection?.saveData&&(!connection?.effectiveType||connection.effectiveType==='4g')){
        const idle=window.requestIdleCallback||((callback)=>setTimeout(callback,1000));idle(()=>getFamilyMap('district').catch(()=>{}));
      }
      map.invalidateSize();

      game = { ...payload, finished: false };
      selectedAnswer = null;
      renderGuessHistory(payload);
      document.getElementById('collect-visual-hint').hidden=false;
      hintImage.src=safeImage(game.card.imageReference)||fallbackImage;
      hintImage.alt='Indice visuel du lieu à trouver';
      document.getElementById('collect-hint-credit').innerHTML=imageCredit(game.card.imageAttribution);
      document.getElementById('collect-visual-hint').open=true;
      document.getElementById('collect-target-title').textContent=`${familyNames[game.card.family]} à trouver`;
      els['collect-family-label'].innerHTML = cardNameHtml(game.card);
      els['collect-map-hint'].textContent = '';
      els['collect-map-hint'].hidden=true;
      els['collect-game-status'].hidden=true;
      delete els['collect-game-status'].dataset.outcome;
      els['collect-game-status'].textContent = payload.quota?.copies >= payload.quota?.limit ? 'Tu peux continuer à jouer · prochaine carte à la fin du chrono' : `${Number(payload.maxAttempts)||1} essai${Number(payload.maxAttempts)>1?'s':''} pour ce lieu`;
      await loadFamilyMap(game.card.family);
      if (requestId !== gameRequest || !authenticated) return;
      if (!featureLayer?.getLayers().length) {
        familyMapCache.delete(game.card.family);
        throw new Error('La carte est vide. Relance la partie pour la recharger.');
      }
      els['collect-map'].hidden=false;
      document.body.classList.add('collect-session-active');document.documentElement.classList.add('collect-map-active');
      exitButton.hidden=false;
      map.invalidateSize();
      if (game.card.family === 'street') map.setView([48.8566, 2.3522],13,{animate:false,reset:true});
      else map.fitBounds(featureLayer.getBounds(),{padding:[18,18],maxZoom:13,animate:false,reset:true});
      mapReady = true;
      pendingGame=null;
      els['collect-next'].textContent = 'Partie suivante';
      els['collect-next'].hidden = true;
      if(payload.questionPayload)showQuestion(payload.questionPayload);
      request('/api/collect/events',{method:'POST',body:JSON.stringify({kind:'map_ready',gameId:game.gameId})}).catch(()=>{});
    } catch (error) {
      if (requestId !== gameRequest) return;
      showError(error.message === 'Failed to fetch' ? 'Connexion au serveur impossible.' : error.message);
      game = null; leaveMap();
      els['collect-game-status'].hidden=false;
      els['collect-game-status'].textContent = 'Partie indisponible';
      els['collect-next'].hidden=false;
      els['collect-next'].textContent='Réessayer';
    } finally { if (requestId === gameRequest) { els['collect-next'].disabled = Boolean(game && !game.finished); exitButton.disabled=false; } }
  }

  function safeImage(url) {
    if (!url) return '';
    try { const parsed = new URL(url, location.origin); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : ''; }
    catch (_error) { return ''; }
  }

  function fragmentPreview(card, required, count, labels = rarityLabels) {
    const fullCard = renderCard({
      ...card, revealed: true, copy_count: 1, id: null,
      current_rarity: 5, fragments_enabled: true,
      fragments_required: required, fragment_count: count,
      collection_number: card.collection_number ?? card.collectionNumber,
      image_reference: card.image_reference ?? card.imageReference,
    }, labels, true, true);
    return renderFragmentMosaic({ required: Number(required), count: Number(count), fullCardHtml: fullCard });
  }

  function resultFeedback(result) {
    if (!result.correct) return {
      outcome: 'failure',
      status: 'Mauvais emplacement · carte non obtenue',
      hint: 'La bonne réponse est affichée en vert.',
    };
    if (result.fragments?.correct === false) return {
      outcome: 'failure',
      status: 'Mauvaise réponse au QCM · aucun fragment gagné · carte non obtenue',
      hint: 'Placement correct, mais réponse au QCM incorrecte. Aucun fragment gagné.',
    };
    if (result.rewardGranted) return {
      outcome: 'success',
      status: result.fragments ? 'QCM réussi · carte obtenue' : 'Placement réussi · carte obtenue',
      hint: 'Carte obtenue.',
    };
    const reason = result.rewardBlockedReason === 'archived'
      ? 'carte archivée' : result.rewardBlockedReason === 'quota' ? 'quota atteint' : '';
    const suffix = reason ? ` · carte non obtenue (${reason})` : ' · carte non obtenue';
    if (result.fragments?.earned) return {
      outcome: 'progress',
      status: `Bonne réponse au QCM · +1 fragment · ${result.fragments.count}/${result.fragments.required}${suffix}`,
      hint: 'Fragment gagné, carte pas encore obtenue.',
    };
    if (result.fragments) return {
      outcome: 'progress',
      status: `Fragments réunis · ${result.fragments.count}/${result.fragments.required}${suffix}`,
      hint: 'Placement correct, carte non obtenue.',
    };
    return {
      outcome: 'failure',
      status: `Placement correct${suffix}`,
      hint: 'Carte non obtenue.',
    };
  }

  function reveal(result) {
    albumsLoadedAt=0;
    if(Array.isArray(result.guesses)){game.guesses=result.guesses;renderGuessHistory(result);}
    game.finished = true;
    els['collect-next'].disabled = false;
    els['collect-next'].hidden = false;
    const feedback = resultFeedback(result);
    els['collect-game-status'].hidden=false;
    els['collect-game-status'].dataset.outcome=feedback.outcome;
    els['collect-game-status'].textContent=feedback.status;
    els['collect-map-hint'].hidden=false;
    els['collect-map-hint'].textContent=feedback.hint;
    const revealed=document.getElementById('collect-revealed-card');
    const awarded=result.correct === true && result.rewardGranted === true;
    if (awarded) {
      const visualHint = document.getElementById('collect-visual-hint');
      visualHint.open = false;
      visualHint.hidden = true;
    }
    recentlyAwardedDetail = awarded && result.awardedDetail && result.card?.id
      ? {
          ...result.card,
          source_entity_id: result.card.sourceEntityId,
          collection_number: result.card.collectionNumber,
          image_reference: result.card.imageReference,
          image_attribution: result.card.imageAttribution,
          current_rarity: result.card.rarity,
          copy_count: result.ownedCount,
          copies: result.awardedDetail.copies,
          statistics: result.awardedDetail.statistics,
        }
      : null;
    const fragmentCount = Number(result.fragments?.count) || 0;
    const showFragments = result.correct && result.fragments && fragmentCount > 0 && !awarded;
    revealed.hidden = !awarded && !showFragments;
    revealed.classList.remove('collect-reward-flip');
    if (awarded) { void revealed.offsetWidth; revealed.classList.add('collect-reward-flip'); }
    revealed.innerHTML = awarded
      ? renderCard({...result.card,copy_count:result.ownedCount||1,revealed:true,current_rarity:result.card.rarity,fragments_enabled:Boolean(result.card.fragments_enabled ?? result.fragments),fragments_required:result.card.fragments_required ?? result.fragments?.required,fragment_count:result.fragments?.required || 0,collection_number:result.card.collectionNumber,image_reference:result.card.imageReference,image_attribution:result.card.imageAttribution})
      : showFragments ? fragmentPreview(result.card, result.fragments.required, fragmentCount) : '';
    if (result.fragments && !questionPanel.hidden) {
      document.getElementById('collect-question-fragments').innerHTML = fragmentPreview(result.card, result.fragments.required, fragmentCount);
    }
    if (awarded) {
      els['collect-map-hint'].append(result.ownedCount > 1 ? ` · DOUBLON ×${result.ownedCount}` : ' · NOUVELLE');
    }
    if (result.rewardGranted && collectionPayload?.cards) {
      const card = collectionPayload.cards.find(item => String(item.id) === String(result.card.id));
      if (card) card.copy_count = result.ownedCount;
      const active = collectionPayload.cards.filter(item => item.status === 'active');
      const owned = active.filter(item => Number(item.copy_count) > 0).length;
      const progression = document.createElement('small');
      progression.className = 'collect-reveal-progress';
      progression.textContent = `${owned} / ${active.length} cartes trouvées · ${percentage(owned,active.length)} %`;
      els['collect-map-hint'].append(document.createElement('br'), progression);
    }
    if(selectionMarker){map.removeLayer(selectionMarker);selectionMarker=null;}
    const targetId=result.card.sourceEntityId || game.card.name;
    const targets=[];
    featureLayer?.eachLayer(item=>{if(!visibleLayer(item)||!item.setStyle)return;const id=featureAnswer(game.card.family,item.feature);if(id===targetId){item.setStyle({color:UI_THEME.mapCorrect,weight:8,fillColor:UI_THEME.mapCorrect,fillOpacity:0.55,opacity:1});item.bringToFront?.();targets.push(item);}else if(id===selectedAnswer?.id)item.setStyle({color:UI_THEME.mapWrong,weight:7,fillColor:UI_THEME.mapWrong,opacity:1});});
    if(targets.length && !result.correct){const bounds=window.L.featureGroup(targets).getBounds();if(bounds.isValid())map.fitBounds(bounds,{paddingTopLeft:[24,isTouchDevice()?240:30],paddingBottomRight:[24,30],maxZoom:16});const label=document.createElement('span');label.innerHTML='Bonne réponse : '+cardNameHtml(game.card);targets[0].bindTooltip(label,{permanent:true}).openTooltip();}
    for (const badge of result.newBadges || []) els['collect-map-hint'].append(` · Badge : ${badge.name}`);
    refreshQuota();loadWeeklyPlay();renderGoal();
  }

  function renderGuessHistory(payload) {
    let history=document.getElementById('collect-guess-history');
    if(!history){history=document.createElement('div');history.id='collect-guess-history';history.className='collect-guess-history';history.setAttribute('aria-live','polite');document.getElementById('collect-visual-hint').before(history);}
    const guesses=payload.guesses||[],max=Number(payload.maxAttempts)||1;
    const arrows={'nord':'⬆️','nord-est':'↗️','est':'➡️','sud-est':'↘️','sud':'⬇️','sud-ouest':'↙️','ouest':'⬅️','nord-ouest':'↖️'};
    history.innerHTML=`<div class="collect-tries-counter">🎯 ${guesses.length} / ${max} essai${max>1?'s':''}</div>`+(guesses.length?`<div class="daily-history-title">Essais précédents</div><table class="daily-history-table"><thead><tr><th>#</th><th>Lieu tenté</th><th title="Distance approximative entre les centres des lieux">Écart</th><th><span class="sr-only">Direction</span></th></tr></thead><tbody>${guesses.map((guess,index)=>{
      const distance=guess.correct?0:guess.feedback?.distanceMetres,direction=guess.feedback?.direction;
      const label=distance==null?'—':distance>=1000?`${(distance/1000).toFixed(1)} km`:`${Math.round(distance)} m`;
      const name=guess.answerName||answerName(payload.card?.family||game?.card.family,guess.answerEntityId);
      return `<tr class="${index===guesses.length-1?'daily-row-enter':''}"><td>${index+1}</td><td><button type="button" data-review-guess="${index}" class="map-review-button">${escapeHtml(name)}</button></td><td class="${distance<500?'dist-hot':distance<2000?'dist-warm':'dist-cold'}">${label}</td><td class="daily-arrow" aria-label="${escapeHtml(direction||'Direction indisponible')}">${arrows[direction]||''}</td></tr>`;
    }).join('')}</tbody></table>`:'');
    history.querySelectorAll('[data-review-guess]').forEach(button => {
      button.addEventListener('click', () => {
        const guess = guesses[Number(button.dataset.reviewGuess)];
        const family = payload.card?.family || game?.card.family;
        const features = featureLayer?.getLayers().filter(layer => visibleLayer(layer) &&
          featureAnswer(family, layer.feature) === guess.answerEntityId).map(layer => layer.feature) || [];
        reviewMapFeatures(map, window.L, features);
      });
    });
  }
  function answerName(family,id){
    if(family==='bus')return `Ligne ${id}`;
    const feature=familyMapCache.has(family)&&loadedFamily===family?featureLayer?.getLayers().find(layer=>featureAnswer(family,layer.feature)===id)?.feature:null;
    return feature?.properties?.name||id;
  }

  async function submitAnswer() {
    if (!game || game.finished || game.question || !selectedAnswer || answering) return;
    const currentGame = game;
    answering = true; exitButton.disabled=true;
    try {
      const result = await request(`/api/collect/games/${encodeURIComponent(game.gameId)}/answer`, {
        method: 'POST', body: JSON.stringify({ answerEntityId: selectedAnswer.id, answerContext: selectedAnswer.context, requestId: selectedAnswer.requestId ||= crypto.randomUUID() }),
      });
      if (game !== currentGame) return;
      if (result.stage === "guess") { game.guesses=result.guesses;renderGuessHistory(result);selectedAnswer=null;els['collect-map-hint'].hidden=false;els['collect-map-hint'].textContent=`Encore ${result.remainingAttempts} essai${result.remainingAttempts>1?'s':''}. Choisis un autre lieu sur la carte.`; }
      else if (result.stage === "question") showQuestion(result);
      else reveal(result);
    } catch (error) {
      showError(error.message);
    } finally {answering=false;exitButton.disabled=false;}
  }

  function questionSources(result){
    const sources=(result.fragments?.sources||[]).map(s=>safeImage(s)).filter(Boolean);
    return (sources.length?'<p class="collect-question-sources">Sources : '+sources.map((url,i)=>`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(new URL(url).hostname)}${sources.length>1?' '+(i+1):''}</a>`).join(' · ')+'</p>':'')+(result.card?.id?`<button type="button" class="btn-secondary" data-report-card-id="${Number(result.card.id)}" data-report-content="question">Signaler la question</button>`:'');
  }
  function showQuestion(payload) {
    game.question = true;
    game.questionPayload = payload;
    questionPanel.hidden = els['collect-play'].classList.contains('hidden');
    document.getElementById('collect-question-theme').innerHTML = `${cardNameHtml(game.card)} · ${escapeHtml(payload.question.theme)}`;
    document.getElementById('collect-question-title').textContent = payload.question.text;
    document.getElementById('collect-question-progress').textContent = `${payload.fragments.count}/${payload.fragments.required} fragments · Placement réussi`;
    document.getElementById('collect-question-fragments').innerHTML = fragmentPreview(game.card, payload.fragments.required, payload.fragments.count);
    const answers = document.getElementById('collect-question-answers');
    answers.replaceChildren();
    document.getElementById('collect-question-feedback').textContent='';
    document.getElementById('collect-question-continue').hidden=true;
    payload.question.answers.forEach((answer,index) => {
      const button=document.createElement('button'); button.type='button'; button.textContent=answer; button.className='collect-question-answer';
      button.addEventListener('click',async () => {
        if(answering || !game || game.finished) return;
        const currentGame = game;
        answering=true; exitButton.disabled=true; questionExit.disabled=true; answers.querySelectorAll('button').forEach(b=>b.disabled=true);
        try {
          const result=await request(`/api/collect/games/${encodeURIComponent(game.gameId)}/question`,{method:'POST',body:JSON.stringify({answerIndex:index})});
          if (game !== currentGame) return;
          reveal(result);
          document.getElementById('collect-question-progress').textContent = `${result.fragments?.count ?? 0}/${result.fragments?.required ?? game.card.fragments_required} fragments · ${result.fragments?.correct === false ? 'QCM incorrect · carte non obtenue' : result.rewardGranted ? 'Carte obtenue' : 'Fragment gagné · carte non obtenue'}`;
          if (Number.isInteger(result.fragments?.correctIndex)) answers.children[result.fragments.correctIndex].classList.add('is-correct');
          if(result.fragments?.correct===false) button.classList.add('is-incorrect');
          document.getElementById('collect-question-feedback').textContent=`${els['collect-game-status'].textContent}. ${result.fragments?.explanation || ''}`;
          document.getElementById('collect-question-feedback').insertAdjacentHTML('beforeend',questionSources(result));
          document.getElementById('collect-question-continue').hidden=false;
          if(result.correct === true && result.rewardGranted === true){
            questionPanel.hidden=true;
            if(result.fragments?.explanation){
              const explanation=document.createElement('p');explanation.className='collect-reveal-explanation';explanation.textContent=result.fragments.explanation;
              document.getElementById('collect-revealed-card').append(explanation);
              document.getElementById('collect-revealed-card').insertAdjacentHTML('beforeend',questionSources(result));
            }
          }
        } catch(error) {document.getElementById('collect-question-feedback').textContent=error.message; answers.querySelectorAll('button').forEach(b=>b.disabled=false);}
        finally {answering=false;exitButton.disabled=false;questionExit.disabled=false;}
      });
      answers.append(button);
    });
    document.getElementById('collect-question-title').focus();
  }
  document.getElementById('collect-question-continue').addEventListener('click',() => {questionPanel.hidden=true; els['collect-next'].focus();});

  function imageCredit(credit) {
    if(!credit)return '';
    const link=safeImage(credit.sourcePage);
    const text=credit.source?.startsWith('google')?'Google Street View':credit.source==='panoramax'?`Panoramax · ${credit.author||'auteur non indiqué'} · ${credit.license||'licence non indiquée'}`:credit.source==='wikipedia'?`Wikipédia / Wikimedia${credit.author?' · '+credit.author:''}${credit.license?' · '+credit.license:''}`:credit.source==='custom'?(credit.author||''):credit.source==='bus-bild'?`Bus-bild.de${credit.author?' · '+credit.author:''}`:credit.source==='tourisme-marseille'?'Tourisme-Paris.com · crédits sur la page source':credit.source==='office-tourisme-marseille'?'Office de tourisme de Paris · crédits sur la page source':credit.caption||credit.author||'Parici';
    const attribution=link?`<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`:escapeHtml(text);
    return (credit.caption?`<span class="collect-image-caption">${escapeHtml(credit.caption)}</span>`:'')+attribution;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function collectionFilters() {
    return new URLSearchParams({page:String(collectionPage),family:document.getElementById('collect-filter-family').value,
      ownership:document.getElementById('collect-filter-owned').value||'all',rarity:document.querySelector('input[name="collect-rarity"]:checked')?.value||'',
      district:document.getElementById('collect-filter-district').value,arrondissement:document.getElementById('collect-filter-arrondissement').value,
      search:document.getElementById('collect-search').value.trim(),sort:document.getElementById('collect-sort').value});
  }
  async function loadCollection(reset=true) {
    const current=++collectionRequest;
    if(reset)collectionPage=1;
    showError('');
    try {
      let payload;
      if(pagedCollection!==false) {
        try{payload=await request(`/api/collect/collection/page?${collectionFilters()}`);pagedCollection=true;}
        catch(error){if(error.status!==404)throw error;pagedCollection=false;}
      }
      if(!payload)payload=await request('/api/collect/collection');
      if(current!==collectionRequest)return;
      collectionPayload=payload;
      if(pagedCollection){
        collectionPage=payload.page;
        renderCollection();
        renderGoal();
        loadAlbumOptions().then(()=>{if(current===collectionRequest){fillGeographicFiltersFromAlbums();renderGoal();}}).catch(()=>{});
      }else {fillGeographicFilters(payload.cards||[]);renderCollection();renderGoal();}
    }catch(error){if(current===collectionRequest)showError(error.message);}
  }
  function updateCollection(){if(pagedCollection!==false)loadCollection(false);else renderCollection();}
  function fillGeographicFiltersFromAlbums(){
    const select=document.getElementById('collect-filter-district'),current=select.value;
    const choices=(albumsPayload?.albums||[]).filter(a=>a.slug.startsWith('street-district-')).sort((a,b)=>a.name.localeCompare(b.name,'fr'));
    select.innerHTML='<option value="">Tous les quartiers</option>'+choices.map(a=>`<option value="${escapeHtml(a.name)}">${escapeHtml(a.name)} · ${percentage(a.owned_active_card_count,a.active_card_count)} %</option>`).join('');
    if([...select.options].some(o=>o.value===current))select.value=current;
    const arr=document.getElementById('collect-filter-arrondissement');if(!arr.options.length)arr.innerHTML='<option value="">Tous les arrondissements</option>'+Array.from({length:20},(_,i)=>`<option value="${i+1}">${i+1}${i===0?'er':'e'} arrondissement</option>`).join('');
  }

  function renderCollection() {
      const payload = collectionPayload;
      if (!payload) return;
      rarityLabels = payload.rarityLabels?.[5] ? payload.rarityLabels : fiveRarityLabels;
      const cards = payload.cards || [];
      const family = document.getElementById('collect-filter-family').value;
      document.getElementById('collect-district-filter').hidden=family!=='street-district';
      document.getElementById('collect-arrondissement-filter').hidden=family!=='street-arrondissement';
      const familyCards=cards.filter(card=>matchesFamily(card,family));
      const selectedRarity=Number(document.querySelector('input[name="collect-rarity"]:checked')?.value)||0;
      const rarityCards=familyCards.filter(card=>!selectedRarity||(card.fragments_enabled?5:Number(card.current_rarity)||1)===selectedRarity);
      const active=rarityCards.filter(card=>card.status==='active');
      const owned=active.filter(card=>Number(card.copy_count)>0).length;
      els['collect-progress'].textContent=`${owned} / ${active.length} cartes trouvées · ${percentage(owned,active.length)} % · ${rarityCards.reduce((n,c)=>n+Number(c.copy_count),0)} exemplaires`;
      const ownership = document.getElementById('collect-filter-owned').value;
      const rarity = Number(document.querySelector('input[name="collect-rarity"]:checked')?.value) || 0;
      const cardRarity = card => card.fragments_enabled ? 5 : (Number(card.current_rarity) || 1);
      let filtered=familyCards
        .filter(card=>!ownership || (ownership==='owned'?(Number(card.copy_count)>0||(rarity===5&&Number(card.fragment_count)>0)):ownership==='favorites'?Boolean(card.favorite):ownership==='fragments'?Number(card.fragment_count)>0:Number(card.copy_count)===0))
        .filter(card=>!rarity || cardRarity(card)===rarity)
        .filter(card=>!document.getElementById('collect-search').value.trim() || `${card.name||''} ${{street:'R',district:'Q',monument:'M',bus:'B'}[card.family]}-${String(card.collection_number).padStart(card.family==='street'?4:3,'0')}`.toLocaleLowerCase('fr').includes(document.getElementById('collect-search').value.trim().toLocaleLowerCase('fr')))
        .sort((a,b)=>cardRarity(a)-cardRarity(b)
          || String(a.name||'').localeCompare(String(b.name||''),'fr',{numeric:true,sensitivity:'base'})
          || Number(a.collection_number)-Number(b.collection_number));
      const sort=document.getElementById('collect-sort').value;
      if(sort==='name')filtered.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'fr',{numeric:true}));
      if(sort==='copies')filtered.sort((a,b)=>Number(b.copy_count)-Number(a.copy_count));
      if(sort==='recent')filtered.sort((a,b)=>new Date(b.copies?.at(-1)?.obtainedAt||0)-new Date(a.copies?.at(-1)?.obtainedAt||0));
      if(pagedCollection){
        filtered=cards;
        els['collect-progress'].textContent=`${payload.summary.owned} / ${payload.summary.active} cartes trouvées · ${percentage(payload.summary.owned,payload.summary.active)} % · ${payload.summary.copies} exemplaires`;
      }
      const total=pagedCollection?payload.total:filtered.length;
      const pages=Math.max(1,Math.ceil(total/50));collectionPage=Math.min(collectionPage,pages);
      document.getElementById('collect-page-label').textContent=`${total} cartes · Page ${collectionPage} / ${pages}`;
      document.getElementById('collect-prev-page').disabled=collectionPage<=1;
      document.getElementById('collect-next-page').disabled=collectionPage>=pages;
      const pageCards=pagedCollection?cards:filtered.slice((collectionPage-1)*50,collectionPage*50);
      els['collect-grid'].innerHTML = pageCards.map(card=>renderCard(card)).join('') || '<p>Aucune carte dans cette sélection.</p>';
  }

  function percentage(owned,total){return (total?owned/total*100:0).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function matchesFamily(card,family,district=document.getElementById('collect-filter-district').value,arrondissement=document.getElementById('collect-filter-arrondissement').value){
    if(!family)return true;
    if(family==='famous')return card.family==='street' && card.famous;
    if(family==='main')return card.family==='street' && card.main;
    if(family==='street-district')return card.family==='street' && (!district||(card.districts||[card.district]).includes(district));
    if(family==='street-arrondissement')return card.family==='street' && (!arrondissement||(card.arrondissements||[card.arrondissement]).map(Number).includes(Number(arrondissement)));
    return card.family===family;
  }
  function cardNameHtml(card) {
    if(card.family==='bus')return escapeHtml(/^Ligne\s/i.test(String(card.name))?card.name:`Ligne ${card.name}`);
    // Only the uppercase neighbourhood suffix is structural. Keep hyphens
    // inside real street names (e.g. Villeneuve - Bargemon) intact.
    const parts=card.family==='street' && String(card.name||'').match(/^(.*?)\s+-\s+([A-ZÀ-ÖØ-ÞŒ0-9'’ -]+?)(?:\s+-\s+(\d+\s*m))?$/u);
    return parts ? `<span class="collect-place-main">${escapeHtml(parts[1])}</span><small class="collect-place-district">${escapeHtml(parts[2]+(parts[3]?' · '+parts[3]:''))}</small>` : escapeHtml(card.name);
  }
  function renderCard(card,labels=rarityLabels,_privateView=true,detail=false){
    if (!labels?.[5]) labels = fiveRarityLabels;
    const number=`${{street:'R',district:'Q',monument:'M',bus:'B'}[card.family]}-${String(card.collection_number).padStart(card.family==='street'?4:3,'0')}`;
    if(!Number(card.copy_count) && !card.revealed){
      const count=Number(card.fragment_count)||0;
      if(count>0 && [2,3,4].includes(Number(card.fragments_required))){
        return `<article class="collect-tile collect-tile--fragments">${fragmentPreview(card,card.fragments_required,count,labels)}<strong class="collect-fragment-progress"><span>${count}/${card.fragments_required} fragments</span><span>${cardNameHtml(card)}</span></strong></article>`;
      }
      return `<article class="collect-tile collect-tile--hidden"><span class="collect-card-seal" aria-hidden="true">◇</span><strong>Carte à découvrir</strong><small>${escapeHtml(familyNames[card.family])} · ${number}</small></article>`;
    }
    const rarity=card.fragments_enabled?5:(Number(card.current_rarity)||1);
    const stats=card.statistics;
    const metrics=stats?`<div class="collect-card-stats"><span title="Réussite des placements Collect">${Number(stats.attempts)?`${Math.round(100*stats.successes/stats.attempts)} % · ${Number(stats.attempts)} partie${Number(stats.attempts)>1?'s':''}`:'Réussite : —'}</span><span>${stats.circulation==null?'—':Number(stats.circulation)} en circulation</span>${detail&&stats.collectors!=null?`<span>${Number(stats.collectors)} collectionneur${Number(stats.collectors)>1?'s':''}</span>`:''}</div>`:'';
    const description=detail?(card.description_full||card.description||card.short_description):(card.short_description||card.description||'Un lieu à découvrir à Paris.');
    const reportButtons=card.id&&token()?`<div class="collect-card-report-actions"><button type="button" data-report-card-id="${Number(card.id)}" data-report-content="image">Signaler l’image</button><button type="button" data-report-card-id="${Number(card.id)}" data-report-content="description">Signaler la description</button></div>`:'';
    return `<article class="collect-tile collect-card rarity-${rarity}"${!detail&&Number(card.copy_count)>0&&card.id?` data-card-id="${Number(card.id)}" tabindex="0" role="button" aria-label="${escapeHtml(`Voir la fiche : ${card.name}`)}"`:""}>${renderCardArtwork(detail?card:{...card,image_reference:card.image_thumbnail||card.image_reference},labels)}<div class="collect-card-body"><strong class="collect-tile__name">${cardNameHtml(card)}</strong><div class="collect-card-description${detail?' collect-card-description--full':''}"${detail?' tabindex="0" role="region" aria-label="À propos de ce lieu"':''}>${detail?'<h3>À propos de ce lieu</h3>':''}${escapeHtml(description)}</div>${card.location_label?`<p class="collect-card-location">${escapeHtml(card.location_label)}</p>`:''}<div class="collect-card-footer">${metrics}<span>×${card.copy_count} exemplaire${card.copy_count>1?'s':''}</span><span>${card.status==='archived'?'Archivée':'Parici · Collect'}</span></div>${card.fragments_enabled?`<small class="collect-card-fragments">${({2:"Notable",3:"Majeure",4:"Iconique"}[card.fragments_required]||"")} · ${_privateView?`${card.fragment_count||0}/${card.fragments_required} fragments`:"Collection assemblée"}</small>`:''}${!detail&&Number(card.copy_count)>0&&card.id?`<div class="collect-card-actions">${_privateView?`<button type="button" class="collect-favorite-toggle" data-favorite-card-id="${Number(card.id)}" aria-pressed="${Boolean(card.favorite)}" aria-label="${card.favorite?'Retirer des favorites':'Ajouter aux favorites'}">${card.favorite?'★':'☆'}<span class="sr-only">${card.favorite?'Favorite':'Ajouter aux favorites'}</span></button>`:''}</div>`:''}${reportButtons}</div></article>`;
  }
  function cardSources(card){
    const image=imageCredit(card.image_attribution);
    const source=safeImage(card.description_source);
    const sourceHost=source?new URL(source).hostname:'';
    const sourceLabel=sourceHost.endsWith('.wikipedia.org')?'Wikipédia · CC BY-SA':sourceHost==='www.openstreetmap.org'?'OpenStreetMap · ODbL':'Source documentaire';
    const description=source?`<a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceLabel)}</a>`:'';
    return image||description?`<details class="collect-card-sources"><summary>Sources</summary>${image?`<p>${image}</p>`:''}${description?`<p>${description}</p>`:''}</details>`:'';
  }
  function copyHistory(card){
    return Array.isArray(card.copies)&&card.copies.length?`<details class="collect-copy-history"><summary>Historique des exemplaires</summary>${card.copies.map(copy=>`<p>${escapeHtml(copy.source==='daily'?'Daily':copy.source==='weekly'?'Défi hebdomadaire':'Collect')} · ${new Date(copy.obtainedAt).toLocaleDateString('fr-FR')}${copy.dailyAttemptCount?` · ${copy.dailyAttemptCount}/7`:''}</p>`).join('')}</details>`:'';
  }
  function fillGeographicFilters(cards){
    const select=document.getElementById('collect-filter-district'),current=select.value;
    const districts=new Map();
    for(const card of cards){
      if(card.family!=='street')continue;
      for(const districtName of card.districts||[card.district].filter(Boolean)){
        if(!districts.has(districtName))districts.set(districtName,{name:districtName,total:0,owned:0});
        if(card.status==='active'){
          const district=districts.get(districtName);district.total++;
          if(Number(card.copy_count)>0)district.owned++;
        }
      }
    }
    const ordered=[...districts.values()].sort((a,b)=>(b.total?b.owned/b.total:0)-(a.total?a.owned/a.total:0)||a.name.localeCompare(b.name,'fr'));
    select.innerHTML='<option value="">Tous les quartiers</option>'+ordered.map(d=>`<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)} · ${percentage(d.owned,d.total)} % (${d.owned}/${d.total})</option>`).join('');
    if([...select.options].some(o=>o.value===current))select.value=current;
    const arr=document.getElementById('collect-filter-arrondissement');if(!arr.options.length)arr.innerHTML='<option value="">Tous les arrondissements</option>'+Array.from({length:20},(_,i)=>`<option value="${i+1}">${i+1}${i===0?'er':'e'} arrondissement</option>`).join('');
  }

  const personalAlbums=initPersonalAlbums(request,renderCard);
  let albumsPayload=null;
  let albumMap=null,albumLayer=null,albumRequest=0;
  function albumFamily(slug){return slug.startsWith('street-district-')?'street-district':slug.startsWith('street-arrondissement-')?'street-arrondissement':({'streets':'street','famous-streets':'famous','main-streets':'main','districts':'district','monuments':'monument','bus':'bus'}[slug]||'');}
  function renderAlbums(){
    if(!albumsPayload)return;
    const family=document.getElementById('collect-album-family').value;
    const geo=document.getElementById('collect-album-geography');
    const geographic=family==='street-district'||family==='street-arrondissement';
    document.getElementById('collect-album-geography-label').hidden=!geographic;
    const choices=albumsPayload.albums.filter(a=>albumFamily(a.slug)===family).sort((a,b)=>a.name.localeCompare(b.name,'fr',{numeric:true}));
    if(geographic && geo.dataset.family!==family){geo.innerHTML=choices.map(a=>`<option value="${escapeHtml(a.slug)}">${escapeHtml(a.name)}</option>`).join('');geo.dataset.family=family;}
    els['collect-album-grid'].innerHTML=(albumsPayload.albums||[]).filter(a=>family?(albumFamily(a.slug)===family&&(!geographic||a.slug===geo.value)):!a.slug.startsWith('street-district-')&&!a.slug.startsWith('street-arrondissement-')).map(album=>`<article class="collect-album"><button class="collect-album-open" data-album="${escapeHtml(album.slug)}" type="button"><strong>${escapeHtml(album.name)}</strong><span>${socialApi?'Possédées : ':''}${album.owned_active_card_count} / ${album.active_card_count} · ${percentage(album.owned_active_card_count,album.active_card_count)} %</span><span class="collect-progress-track"><i style="width:${Number(album.progress)}%"></i></span>${album.earned_active_card_count!==undefined?`<small class="collect-personal-progress">Gagnées personnellement : ${album.earned_active_card_count} / ${album.active_card_count}</small>`:''}<small>Voir mes lieux sur la carte →</small></button></article>`).join('');
    if(!family)els['collect-album-grid'].insertAdjacentHTML('beforeend',['street-district','street-arrondissement'].map(group=>`<article class="collect-album"><button class="collect-album-open" data-album-group="${group}" type="button"><strong>${group==='street-district'?'Rues par quartier':'Rues par arrondissement'}</strong><small>Choisir ${group==='street-district'?'un quartier':'un arrondissement'} →</small></button></article>`).join(''));
    const basic=new Set(['collect-first-card','collect-10-cards','collect-100-cards','album-streets','album-districts','album-monuments','album-bus','collect-master']);
    const badges=albumsPayload.badges||[];const extra=badges.filter(b=>!basic.has(b.slug)&&(!family||albumFamily(b.slug.replace(/^album-/,''))===family));
    els['collect-badge-grid'].innerHTML=badges.filter(b=>basic.has(b.slug)).map(renderBadge).join('')+(extra.length?`<details class="collect-album-badges"><summary>Badges des albums · ${extra.length}</summary><div class="collect-badge-grid">${extra.map(renderBadge).join('')}</div></details>`:'');
  }
  function renderBadge(badge){
    const symbol=badge.slug==='collect-first-card'?'⭐':badge.slug==='collect-master'?'🏆':badge.slug.startsWith('album-')?'🧭':'💎';
    return `<article tabindex="0" class="collect-badge profile-badge ${badge.earned?'is-earned unlocked':'locked'}" aria-label="${escapeHtml(badge.name)} · ${badge.earned?'Débloqué':'À débloquer'}"><span class="badge-emoji" aria-hidden="true">${badge.earned?avatarMarkup(symbol):iconMarkup('lock')}</span><strong class="badge-name">${escapeHtml(badge.name)}</strong><span>${escapeHtml(badge.description)}</span><small>${badge.earned?`Obtenu le ${new Date(badge.earned_at).toLocaleDateString('fr-FR')}`:'À débloquer'}</small></article>`;
  }
  let albumsRequest=null,albumsLoadedAt=0;
  async function loadAlbumOptions(){
    if(albumsPayload&&Date.now()-albumsLoadedAt<30000)return;
    if(albumsRequest)return albumsRequest;
    albumsRequest=fetchAlbumOptions().finally(()=>{albumsRequest=null;});return albumsRequest;
  }
  async function fetchAlbumOptions(){
    const payload=await request('/api/collect/albums');albumsPayload=payload;albumsLoadedAt=Date.now();
    fillGoalGeography();renderGoal();
    const rankingType=document.getElementById('collect-ranking-type');
    rankingType.querySelectorAll('option[data-album-option]').forEach(option=>option.remove());
    const added=new Set();
    for(const album of payload.albums||[]){
      const family=albumFamily(album.slug);
      const value=['street-district','street-arrondissement'].includes(family)?family:album.slug;
      if(added.has(value))continue;
      added.add(value);
      const option=document.createElement('option');option.value=value;option.textContent=value==='street-district'?'Rues par quartier':value==='street-arrondissement'?'Rues par arrondissement':album.name;option.dataset.albumOption='true';rankingType.append(option);
    }
    return payload;
  }
  async function loadAlbums(){
    showError('');
    try {await loadAlbumOptions();renderAlbums();}
    catch(error){showError(error.message);}
  }
  async function openAlbum(slug){
    const requestId=++albumRequest;
    showError('');
    const view=document.getElementById('collect-album-view');view.hidden=false;
    const album=albumsPayload?.albums.find(a=>a.slug===slug);
    document.getElementById('collect-album-title').textContent=album?.name||'Mon album';
    document.getElementById('collect-album-map-note').textContent='Chargement de l’album…';
    view.scrollIntoView({behavior:'smooth',block:'start'});
    try {
      await window.loadCollectMapRuntime();
      if(!albumMap){albumMap=window.L.map('collect-album-map',{preferCanvas:true}).setView([48.8566, 2.3522],12);window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'}).addTo(albumMap);}
      albumMap.invalidateSize();
      if(albumLayer){albumMap.removeLayer(albumLayer);albumLayer=null;}
      const {cards}=await request(`/api/collect/albums/${encodeURIComponent(slug)}/cards`);
      const families=[...new Set(cards.map(c=>c.family))];
      const collections=await Promise.all(families.map(async family=>{const data=await getFamilyMap(family);const items=new Map(cards.filter(c=>c.family===family).map(c=>[c.name,c]));return data.features.filter(f=>items.has(featureAnswer(family,f))).map(f=>({...f,properties:{...f.properties,collect_owned_name:featureAnswer(family,f),collect_owned:items.get(featureAnswer(family,f)).owned}}));}));
      if(requestId!==albumRequest)return;
      albumLayer=window.L.geoJSON({type:'FeatureCollection',features:collections.flat().sort((a,b)=>Number(a.properties.collect_owned)-Number(b.properties.collect_owned))},{style:f=>({color:f.properties.collect_owned?UI_THEME.mapCorrect:'#999',weight:f.properties.collect_owned?4:2,fillColor:f.properties.collect_owned?UI_THEME.mapCorrect:'#aaa',fillOpacity:0.35,opacity:0.9}),pointToLayer:(f,latlng)=>window.L.circleMarker(latlng,{radius:6,color:'#fff',weight:1,fillColor:f.properties.collect_owned?UI_THEME.mapCorrect:'#999',fillOpacity:1}),onEachFeature:(f,l)=>{const label=document.createElement('span');label.textContent=f.properties.collect_owned_name;l.bindTooltip(label);}}).addTo(albumMap);
      albumMap.setView([48.8566, 2.3522],12);albumMap.invalidateSize();
      document.getElementById('collect-album-map-note').textContent=`${cards.filter(c=>c.owned).length} / ${cards.length} lieux possédés · vert : obtenus · gris : à découvrir.`;
    }catch(error){if(requestId===albumRequest)showError(error.message);}
  }
  els['collect-album-grid'].addEventListener('click',event=>{const group=event.target.closest('[data-album-group]');if(group){document.getElementById('collect-album-family').value=group.dataset.albumGroup;renderAlbums();return;}const button=event.target.closest('[data-album]');if(button)openAlbum(button.dataset.album);});
  document.getElementById('collect-album-family').addEventListener('change',()=>{albumRequest++;document.getElementById('collect-album-view').hidden=true;renderAlbums();});
  document.getElementById('collect-album-geography').addEventListener('change',()=>{renderAlbums();openAlbum(document.getElementById('collect-album-geography').value);});
  document.getElementById('collect-album-close').addEventListener('click',()=>{albumRequest++;document.getElementById('collect-album-view').hidden=true;});

  function renderRankingGeography(){
    const type=document.getElementById('collect-ranking-type').value;
    const label=document.getElementById('collect-ranking-geography-label');
    const select=document.getElementById('collect-ranking-geography');
    const geographic=['street-district','street-arrondissement'].includes(type);
    label.hidden=!geographic;
    if(!geographic||!albumsPayload)return;
    const choices=(albumsPayload.albums||[]).filter(album=>albumFamily(album.slug)===type);
    if(type==='street-district')choices.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'fr',{numeric:true,sensitivity:'base'}));
    const current=select.value;
    select.innerHTML=choices.map(album=>`<option value="${escapeHtml(album.slug)}">${escapeHtml(album.name)}</option>`).join('');
    if(choices.some(album=>album.slug===current))select.value=current;
  }

  function weeklyPrizeLabel(policy){return policy?`Récompense : 1 carte ${fiveRarityLabels[policy.minRarity].toLocaleLowerCase('fr')} à ${fiveRarityLabels[policy.maxRarity].toLocaleLowerCase('fr')} · défi ${policy.difficulty}`:'';}
  function weeklyPrizeMarkup(payload){const reward=payload.reward;return `<p class="collect-weekly-prize" title="${escapeHtml(payload.rewardPolicy?.weights?.map((weight,i)=>`${fiveRarityLabels[i+1]} : ${weight} %`).filter((_,i)=>payload.rewardPolicy.weights[i]>0).join(' · ')||'')}">${escapeHtml(weeklyPrizeLabel(payload.rewardPolicy))}</p>`+(reward?`<details class="collect-weekly-won"><summary>Bravo ! Ta carte bonus : ${escapeHtml(reward.card?.name||'Déjà attribuée')}</summary>${reward.card?renderCard(reward.card):'<p>Cet exemplaire ne fait plus partie de ta collection.</p>'}<a href="/collect.html?panel=collection">Voir ma collection →</a></details>`:'');}
  let weeklyRequest=0;
  async function loadWeeklyPlay(){
    try{const payload=await request('/api/collect/weekly-challenge');document.getElementById('collect-weekly-play').innerHTML=`<h3>Défi de la semaine</h3><ul>${payload.personal.progress.map(g=>`<li>${escapeHtml(g.label)} <strong>${g.current}/${g.target}</strong></li>`).join('')}</ul>`+weeklyPrizeMarkup(payload);}
    catch(_error){document.getElementById('collect-weekly-play').textContent='';}
  }
  let albumGoal=null;
  function showGoal(){
    const node=document.getElementById('collect-album-goal');
    node.textContent=albumGoal?`${albumGoal.name} · ${albumGoal.owned_active_card_count}/${albumGoal.active_card_count} · ${albumGoal.remaining?`encore ${albumGoal.remaining} lieu${albumGoal.remaining>1?'x':''}`:'Album terminé !'}`:'';
    if(albumGoal){document.getElementById('collect-goal-select').value=albumFamily(albumGoal.slug);fillGoalGeography();document.getElementById('collect-goal-geography').value=albumGoal.slug;}
  }
  async function renderGoal(){
    try{const payload=await request('/api/collect/goal');albumGoal=payload.goal;showGoal();}catch(_error){showGoal();}
  }
  function fillGoalGeography(){
    const type=document.getElementById('collect-goal-select').value,select=document.getElementById('collect-goal-geography'),current=select.value;
    document.getElementById('collect-goal-geography-label').hidden=!type;
    const choices=(albumsPayload?.albums||[]).filter(a=>albumFamily(a.slug)===type).sort((a,b)=>a.name.localeCompare(b.name,'fr',{numeric:true}));
    select.innerHTML='<option value="">Choisir '+(type==='street-district'?'un quartier':'un arrondissement')+'</option>'+choices.map(a=>`<option value="${escapeHtml(a.slug)}">${escapeHtml(a.name)} · ${a.owned_active_card_count}/${a.active_card_count}</option>`).join('');
    if(choices.some(a=>a.slug===current))select.value=current;
  }
  document.getElementById('collect-goal-select').addEventListener('change',()=>{fillGoalGeography();if(!document.getElementById('collect-goal-select').value)document.getElementById('collect-goal-geography').dispatchEvent(new Event('change'));});
  document.getElementById('collect-goal-geography').addEventListener('change',async event=>{
    try{const payload=await request('/api/collect/goal',{method:'PUT',body:JSON.stringify({slug:event.target.value})});albumGoal=payload.goal;showGoal();document.getElementById('collect-goal-status').textContent=albumGoal?'Objectif enregistré.':'Objectif retiré.';}
    catch(error){showError(error.message);}
  });
  async function loadWeeklyChallenge(){
    const current=++weeklyRequest;
    const note=document.getElementById('collect-weekly-note');
    const summary=document.getElementById('collect-weekly-summary');
    const ranking=document.getElementById('collect-weekly-ranking');
    try{
      const week=document.getElementById('collect-weekly-week').value;
      const payload=await request('/api/collect/weekly-challenge'+(week?'?week='+encodeURIComponent(week):''));
      if(current!==weeklyRequest)return;
      const date=value=>new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'long',timeZone:'Europe/Paris'});
      const lastDay=new Date(new Date(payload.endsAt).getTime()-1);
      const score=value=>Number(value).toLocaleString('fr-FR',{maximumFractionDigits:2});
      note.textContent=`${date(payload.startsAt)} au ${date(lastDay)}. Seuls les exemplaires Collect obtenus cette semaine comptent.`;
      summary.innerHTML=weeklyPrizeMarkup(payload)+`<h4>Ma progression</h4><ul>${payload.personal.progress.map(goal=>`<li>${escapeHtml(goal.label)} · <strong>${goal.current}/${goal.target}</strong></li>`).join('')}</ul><p><strong>${score(payload.personal.score)} %</strong>${payload.personal.rank?` · rang ${payload.personal.rank}`:''}</p>`;
      const rows=payload.leaderboard||[];
      const medals=['gold','silver','bronze'].map(name=>`<img src="/src/public/icons/medal-${name}.svg" alt="" width="24" height="24">`);
      const playerRow=row=>`<tr class="${Number(row.userId)===Number(payload.personal.userId)?'leaderboard-current-player':''}"><td>${Number(row.rank)<=3?medals[Number(row.rank)-1]:row.rank}</td><th scope="row"><a href="/collect.html?profile=${encodeURIComponent(row.username)}"><span class="leaderboard-avatar">${avatarMarkup(row.avatar||'👤')}</span>${escapeHtml(row.username)}</a></th><td>${score(row.score)} %</td></tr>`;
      const personalOutsideTop=payload.personal.rank!=null && !rows.some(row=>Number(row.userId)===Number(payload.personal.userId));
      ranking.innerHTML=rows.length?`<table class="leaderboard-table"><caption class="sr-only">Classement du défi de la semaine</caption><thead><tr><th scope="col">Rang</th><th scope="col">Joueur</th><th scope="col">Progression</th></tr></thead><tbody>${rows.map(playerRow).join('')}${personalOutsideTop?`<tr class="collect-weekly-rank-gap"><td colspan="3">…</td></tr>${playerRow(payload.personal)}`:''}</tbody></table>`:'<p>Le classement apparaîtra avec les premiers exemplaires Collect de la semaine.</p>';
    }catch(error){if(current!==weeklyRequest)return;note.textContent=error.status===401?'Connecte-toi pour afficher le défi et ta progression.':'Le défi ne peut pas charger pour le moment. Réessaie.';summary.textContent='';ranking.textContent='';}
  }

  document.getElementById('collect-weekly-week').addEventListener('change',loadWeeklyChallenge);
  async function loadWeeklyOptions(){try{const {weeks}=await request('/api/collect/weekly-challenge/history');document.getElementById('collect-weekly-week').innerHTML='<option value="">Cette semaine</option>'+weeks.slice(1).map(w=>`<option value="${escapeHtml(w.week_start)}">Semaine du ${new Date(w.starts_at).toLocaleDateString('fr-FR',{timeZone:'Europe/Paris'})}</option>`).join('');}catch(_error){/* Existing current-week view remains available. */}}

  async function loadLeaderboard() {
    const current=++leaderboardRequest;
    showError('');
    try {
      if(token() && !albumsPayload)await loadAlbumOptions();
      const type = document.getElementById('collect-ranking-type').value;
      renderRankingGeography();
      const note = document.getElementById('collect-ranking-note');
      const geographic=['street-district','street-arrondissement'].includes(type);
      const albumSlug=geographic?document.getElementById('collect-ranking-geography').value:type;
      if(geographic&&!albumSlug)return;
      const payload = await request(type === 'collection' ? '/api/collect/leaderboard'
        : type === 'performance' ? '/api/collect/leaderboard/performance'
        : `/api/collect/leaderboard/albums/${encodeURIComponent(albumSlug)}`);
      if(current!==leaderboardRequest || document.getElementById('collect-ranking-type').value!==type || (geographic&&document.getElementById('collect-ranking-geography').value!==albumSlug))return;
      const rows = type === 'performance' ? payload.rows : payload;
      note.textContent = type === 'performance'
        ? (payload.configured ? `À partir de ${payload.minimumAttempts} parties Collect.` : 'Le nombre minimum de parties reste à définir. Ce classement sera activé après configuration.')
        : type === 'collection' ? 'Cartes uniques possédées, y compris archivées. Les doublons ne modifient pas le classement.' : 'Cartes actives uniques de l’album ; départage par leur rareté cumulée.';
      const score=row=>type==='performance'?percentage(Number(row.success_rate),1)+' %':row.owned_cards;
      const medals=['gold','silver','bronze'].map(name=>`<img src="/src/public/icons/medal-${name}.svg" alt="" width="28" height="28">`);
      document.getElementById('collect-podium').innerHTML=rows.filter(row=>Number(row.rank)<=3).map((row)=>`<a class="collect-podium-player place-${Number(row.rank)}" href="/collect.html?profile=${encodeURIComponent(row.username)}"><span class="collect-podium-medal" aria-hidden="true">${medals[Number(row.rank)-1]}</span><span class="collect-player-avatar">${avatarMarkup(row.avatar||'👤')}</span><strong>${escapeHtml(row.username)}</strong><span>${score(row)} ${type==='performance'?'':'cartes'}</span></a>`).join('');
      els['collect-ranking'].innerHTML=`<table class="leaderboard-table"><caption class="sr-only">Classement Collect</caption><thead><tr><th scope="col">Rang</th><th scope="col">Joueur</th><th scope="col">${type==='performance'?'Réussite':'Cartes'}</th><th scope="col">${type==='performance'?'Parties':type==='collection'?'Exemplaires':'Rareté'}</th></tr></thead><tbody>${rows.map((row)=>`${Number(row.position)>25?'<tr class="collect-weekly-rank-gap"><td colspan="4">…</td></tr>':''}<tr class="${row.current_player?'leaderboard-current-player':Number(row.rank)===1?'leaderboard-first-place':''}"><td>${Number(row.rank)<=3?medals[Number(row.rank)-1]:'#'+Number(row.rank)}</td><th scope="row"><a href="/collect.html?profile=${encodeURIComponent(row.username)}">${avatarMarkup(row.avatar||'👤')} ${escapeHtml(row.username)}</a></th><td>${score(row)}</td><td>${type==='performance'?row.attempts:type==='collection'?row.total_copies:row.rarity_sum+' · rareté'}</td></tr>`).join('')}</tbody></table>`;
      if (!rows.length) els['collect-ranking'].textContent = 'Le classement apparaîtra avec les premières collections.';
    } catch (error) { if(current===leaderboardRequest)showError(error.message); }
  }

  document.querySelectorAll('[data-panel]').forEach((button) => button.addEventListener('click', async () => {
    document.querySelectorAll('[data-panel]').forEach((item) => item.classList.toggle('is-active', item === button));
    const selected = button.dataset.panel === 'community' ? 'social' : button.dataset.panel;
    const url=new URL(location.href);url.searchParams.set('panel',selected === 'social' ? 'community' : selected);
    if(selected!=='profile' && selected!=='social')url.searchParams.delete('profile');
    else {const username=document.getElementById('collect-profile-username').value.trim();if(username)url.searchParams.set('profile',username);}
    history.replaceState(null,'',url);
    button.setAttribute('aria-pressed','true');
    document.querySelectorAll('[data-panel]').forEach(item=>{if(item!==button)item.setAttribute('aria-pressed','false');});
    for (const key of ['play', 'collection', 'albums', 'social']) {
      els[`collect-${key}`].classList.toggle('hidden', key !== selected);
    }
    if (selected !== 'play') {leaveMap(); questionPanel.hidden=true;}
    if (selected === 'play' && map && game) {
      mapReady = loadedFamily === game.card.family;
      document.getElementById('collect-visual-hint').hidden=false;
      els['collect-map'].hidden=false; exitButton.hidden=false; document.body.classList.add('collect-session-active');document.documentElement.classList.add('collect-map-active');
      requestAnimationFrame(() => map.invalidateSize());
      if (game.question && !game.finished) showQuestion(game.questionPayload);
    }
    if (selected === 'collection') await loadCollection();
    if (selected === 'albums') {await loadAlbums();personalAlbums.load();}
    if (selected === 'play') { await loadAlbumOptions().catch(()=>{}); renderRankingGeography(); await Promise.all([loadWeeklyOptions(),loadWeeklyChallenge(),loadLeaderboard()]); }
  }));
  async function loadPublicProfile(username) {
    const requestId = ++publicProfileRequest;
    const content = els['collect-profile-content'];
    content.innerHTML = '<div class="collect-profile-loading" aria-busy="true" aria-label="Chargement du profil"><h2>Chargement du profil…</h2><p class="collect-public-note">Collection du joueur</p><div class="collect-public-stats">'+Array.from({length:4},()=>'<article><strong>—</strong><span>Chargement…</span></article>').join('')+'</div></div>';
    showError('');
    try {
      const profile = await request(`/api/collect/profiles/${encodeURIComponent(username)}`);
      if (requestId !== publicProfileRequest) return;
      const stats = profile.collect;
      publicProfileName=profile.username;publicRarityLabels=profile.rarityLabels;
      content.innerHTML = `<h2>${escapeHtml(profile.username)} · Collect</h2>
        <p class="collect-public-note">Profil public · les détails des exemplaires restent privés.</p>
        <div class="collect-public-stats">
          <article><strong>${stats.unique_cards}</strong><span>Cartes uniques</span></article>
          <article><strong>${stats.total_copies}</strong><span>Exemplaires · ${stats.duplicates} doublon${stats.duplicates > 1 ? 's' : ''}</span></article>
          <article><strong>${stats.success_rate === null ? '—' : percentage(stats.successes,stats.attempts) + ' %'}</strong><span>Réussite · ${stats.attempts} partie${Number(stats.attempts)>1?'s':''} Collect</span></article>
          <article><strong>${percentage(stats.active_unique_cards,stats.active_card_count)} %</strong><span>${stats.active_unique_cards} / ${stats.active_card_count} cartes actives</span></article>
        </div>
        <h3>Albums</h3><div class="collect-profile-search"><label>Famille <select id="collect-public-family">${document.getElementById('collect-album-family').innerHTML}</select></label><label id="collect-public-geography-label" hidden>Choisir <select id="collect-public-geography"></select></label></div><div id="collect-public-albums" class="collect-album-grid"></div><section id="collect-public-map-view" hidden><h3 id="collect-public-map-title"></h3><p id="collect-public-map-note"></p><div id="collect-public-map" class="collect-public-album-map"></div></section>
        <h3>Badges</h3><div class="collect-badge-grid">${stats.badges.filter(badge=>badge.earned).map(renderBadge).join('') || '<p>Aucun badge obtenu pour le moment.</p>'}</div>
        <h3>Collection</h3><div class="collect-profile-search"><label>Famille <select id="collect-public-card-family">${document.getElementById('collect-filter-family').innerHTML}</select></label><label id="collect-public-card-geo-label" hidden>Choisir <select id="collect-public-card-geo"></select></label></div><p id="collect-public-card-progress"></p><div id="collect-public-card-grid" class="collect-grid"></div><div class="collect-pagination"><button id="collect-public-prev" type="button" class="btn-secondary">Précédent</button><span id="collect-public-page"></span><button id="collect-public-next" type="button" class="btn-secondary">Suivant</button></div>`;
      await socialReady;
      if(socialApi)await socialApi.attachProfile(content,profile.username);
      if(/^[1-9]\d{0,17}$/.test(initialParams.get('card')||''))setTimeout(()=>{const b=document.createElement('button');b.dataset.cardId=initialParams.get('card');b.hidden=true;content.append(b);b.click();b.remove();},0);
      let publicPage=1;
      const cardFamily=document.getElementById('collect-public-card-family'),cardGeo=document.getElementById('collect-public-card-geo');
      let publicCardsRequest=0;
      const renderPublicCards=async(initialPage=null)=>{
        const currentCardsRequest=++publicCardsRequest;
        const family=cardFamily.value,geographic=['street-district','street-arrondissement'].includes(family);
        document.getElementById('collect-public-card-geo-label').hidden=!geographic;
        if(geographic&&cardGeo.dataset.family!==family){
          const choices=family==='street-district'?(profile.collection?stats.albums.filter(a=>a.slug.startsWith('street-district-')).map(a=>a.name):[...new Set(profile.cards.filter(c=>c.family==='street').flatMap(c=>c.districts||[c.district]).filter(Boolean))]).sort((a,b)=>a.localeCompare(b,'fr')):Array.from({length:20},(_,i)=>String(i+1));
          cardGeo.innerHTML='<option value="">Tous</option>'+choices.map(value=>`<option value="${escapeHtml(value)}">${escapeHtml(value)}${family==='street-arrondissement'?(value==='1'?'er':'e')+' arrondissement':''}</option>`).join('');cardGeo.dataset.family=family;
        }
        try{
          let pagePayload=initialPage;
          if(profile.collection&&!pagePayload){pagePayload=await request(`/api/collect/profiles/${encodeURIComponent(username)}/collection/page?${new URLSearchParams({family,district:family==='street-district'?cardGeo.value:'',arrondissement:family==='street-arrondissement'?cardGeo.value:'',page:String(publicPage)})}`);}
          if(currentCardsRequest!==publicCardsRequest||requestId!==publicProfileRequest)return;
          const cards=pagePayload?pagePayload.cards:profile.cards.filter(c=>matchesFamily(c,family,family==='street-district'?cardGeo.value:'',family==='street-arrondissement'?cardGeo.value:''));
          const active=cards.filter(c=>c.status==='active'),owned=cards.filter(c=>Number(c.copy_count)>0);
          const activeCount=pagePayload?pagePayload.summary.active:active.length,ownedCount=pagePayload?pagePayload.summary.owned:active.filter(c=>Number(c.copy_count)>0).length;
          document.getElementById('collect-public-card-progress').textContent=`${ownedCount} / ${activeCount} cartes trouvées · ${percentage(ownedCount,activeCount)} %`;
          const pages=Math.max(1,Math.ceil((pagePayload?pagePayload.total:owned.length)/50));publicPage=pagePayload?pagePayload.page:Math.min(publicPage,pages);
          document.getElementById('collect-public-card-grid').innerHTML=(pagePayload?owned:owned.slice((publicPage-1)*50,publicPage*50)).map(c=>renderCard(c,profile.rarityLabels,false)).join('')||'<p>Aucune carte obtenue dans cette sélection.</p>';
          document.getElementById('collect-public-page').textContent=`Page ${publicPage} / ${pages}`;
          document.getElementById('collect-public-prev').disabled=publicPage<=1;document.getElementById('collect-public-next').disabled=publicPage>=pages;
        }catch(error){if(currentCardsRequest===publicCardsRequest&&requestId===publicProfileRequest)showError(error.message);}
      };
      for(const select of [cardFamily,cardGeo])select.addEventListener('change',()=>{publicPage=1;renderPublicCards();});
      document.getElementById('collect-public-prev').addEventListener('click',()=>{publicPage--;renderPublicCards();});
      document.getElementById('collect-public-next').addEventListener('click',()=>{publicPage++;renderPublicCards();});
      renderPublicCards(profile.collection||null);
      const familySelect=document.getElementById('collect-public-family'),geoSelect=document.getElementById('collect-public-geography');
      let publicMap=null,publicLayer=null,mapRequest=0;
      const renderPublicAlbums=()=>{
        const family=familySelect.value,geographic=family==='street-district'||family==='street-arrondissement';
        document.getElementById('collect-public-geography-label').hidden=!geographic;
        const choices=stats.albums.filter(a=>albumFamily(a.slug)===family);
        if(geographic&&geoSelect.dataset.family!==family){geoSelect.innerHTML=choices.map(a=>`<option value="${escapeHtml(a.slug)}">${escapeHtml(a.name)}</option>`).join('');geoSelect.dataset.family=family;}
        document.getElementById('collect-public-albums').innerHTML=stats.albums.filter(a=>family?(albumFamily(a.slug)===family&&(!geographic||a.slug===geoSelect.value)):!a.slug.startsWith('street-district-')&&!a.slug.startsWith('street-arrondissement-')).map(a=>`<article class="collect-album"><button class="collect-album-open" data-public-album="${escapeHtml(a.slug)}"><strong>${escapeHtml(a.name)}</strong><span>${a.owned_active_card_count} / ${a.active_card_count} · ${percentage(a.owned_active_card_count,a.active_card_count)} %</span><small>Voir les lieux sur la carte →</small></button></article>`).join('');
      };
      const openPublicAlbum=async slug=>{
        const current=++mapRequest;
        try{
          document.getElementById('collect-public-map-view').hidden=false;
          document.getElementById('collect-public-map-title').textContent=stats.albums.find(a=>a.slug===slug)?.name||'Album';
          await window.loadCollectMapRuntime();
          if(!publicMap){publicMap=window.L.map('collect-public-map',{preferCanvas:true}).setView([48.8566, 2.3522],12);window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'}).addTo(publicMap);}
          const {cards}=await request(`/api/collect/profiles/${encodeURIComponent(username)}/albums/${encodeURIComponent(slug)}/cards`);
          const features=(await Promise.all([...new Set(cards.map(c=>c.family))].map(async family=>{const data=await getFamilyMap(family),items=new Map(cards.filter(c=>c.family===family).map(c=>[c.name,c]));return data.features.filter(f=>items.has(featureAnswer(family,f))).map(f=>({...f,properties:{...f.properties,collect_name:featureAnswer(family,f),collect_owned:items.get(featureAnswer(family,f)).owned}}));}))).flat().sort((a,b)=>Number(a.properties.collect_owned)-Number(b.properties.collect_owned));
          if(current!==mapRequest||requestId!==publicProfileRequest)return;
          if(publicLayer)publicMap.removeLayer(publicLayer);
          publicLayer=window.L.geoJSON({type:'FeatureCollection',features},{style:f=>({color:f.properties.collect_owned?UI_THEME.mapCorrect:'#999',weight:f.properties.collect_owned?4:2,fillOpacity:0.35}),pointToLayer:(f,ll)=>window.L.circleMarker(ll,{radius:6,color:'#fff',weight:1,fillColor:f.properties.collect_owned?UI_THEME.mapCorrect:'#999',fillOpacity:1}),onEachFeature:(f,l)=>{const label=document.createElement('span');label.textContent=f.properties.collect_name;l.bindTooltip(label);}}).addTo(publicMap);
          publicMap.invalidateSize();document.getElementById('collect-public-map-note').textContent=`${cards.filter(c=>c.owned).length} / ${cards.length} lieux · vert : obtenus · gris : à découvrir.`;
        }catch(error){showError(error.message);}
      };
      familySelect.addEventListener('change',()=>{renderPublicAlbums();document.getElementById('collect-public-map-view').hidden=true;mapRequest++;});
      geoSelect.addEventListener('change',()=>{renderPublicAlbums();openPublicAlbum(geoSelect.value);});
      document.getElementById('collect-public-albums').addEventListener('click',event=>{const button=event.target.closest('[data-public-album]');if(button)openPublicAlbum(button.dataset.publicAlbum);});
      renderPublicAlbums();
      const linkedAlbum=initialParams.get('album');
      if(socialApi&&linkedAlbum&&stats.albums.some(a=>a.slug===linkedAlbum))await openPublicAlbum(linkedAlbum);
    } catch (error) { if (requestId === publicProfileRequest) content.textContent = error.message; }
  }
  const detailDialog=document.createElement('dialog');
  detailDialog.className='collect-card-dialog';detailDialog.setAttribute('aria-label','Fiche de la carte');
  document.body.append(detailDialog);
  let detailMap=null,detailRequest=0;
  detailDialog.addEventListener('close',()=>{detailRequest++;detailMap?.remove();detailMap=null;});
  document.body.addEventListener('keydown',event=>{
    if (!['Enter',' '].includes(event.key) || !event.target.matches('.collect-card[data-card-id]')) return;
    event.preventDefault(); event.target.click();
  });
  document.body.addEventListener('click',async event=>{
    const reportButton=event.target.closest('[data-report-card-id]');
    if(reportButton){
      if(reportButton.disabled)return;
      reportButton.disabled=true;
      try{
        await request(`/api/collect/cards/${reportButton.dataset.reportCardId}/reports`,{method:'POST',body:JSON.stringify({contentType:reportButton.dataset.reportContent})});
        reportButton.textContent=({image:'Image signalée',description:'Description signalée',question:'Question signalée'})[reportButton.dataset.reportContent];
      }catch(error){reportButton.disabled=false;showError(error.message);}
      return;
    }
    const favoriteButton=event.target.closest('[data-favorite-card-id]');
    if(favoriteButton){
      const card=collectionPayload?.cards?.find(item=>Number(item.id)===Number(favoriteButton.dataset.favoriteCardId));
      if(favoriteButton.disabled)return;
      favoriteButton.disabled=true;
      try {const id=favoriteButton.dataset.favoriteCardId;const result=await request(`/api/collect/cards/${id}/favorite`,{method:'PUT',body:JSON.stringify({favorite:favoriteButton.getAttribute('aria-pressed')!=='true'})});
        if(card)card.favorite=result.favorite;
        if(String(recentlyAwardedDetail?.id)===String(id))recentlyAwardedDetail.favorite=result.favorite;
        document.querySelectorAll(`[data-favorite-card-id="${id}"]`).forEach(button=>{button.setAttribute('aria-pressed',String(result.favorite));button.setAttribute('aria-label',result.favorite?'Retirer des favorites':'Ajouter aux favorites');button.innerHTML=(result.favorite?'★':'☆')+`<span class="sr-only">${result.favorite?'Favorite':'Ajouter aux favorites'}</span>`;button.disabled=false;});
        if(!els['collect-collection'].classList.contains('hidden')){if(pagedCollection)loadCollection(false);else renderCollection();}}
      catch(error){favoriteButton.disabled=false;showError(error.message);}
      return;
    }
    const button=event.target.closest('[data-card-id]');if(!button)return;
    if(event.target.closest('button,a,input,select,textarea,summary') && !event.target.matches('[data-card-id]'))return;
    const publicView=Boolean(button.closest('#collect-profile-content'));
    const current=++detailRequest;
    detailDialog.innerHTML='<button type="button" class="btn-secondary collect-detail-close">Fermer</button><div id="collect-detail-body">Chargement de la fiche…</div>';
    detailDialog.querySelector('button').addEventListener('click',()=>detailDialog.close());
    detailDialog.showModal();
    try {
      const path=publicView?`/api/collect/profiles/${encodeURIComponent(publicProfileName)}/cards/${button.dataset.cardId}`:`/api/collect/cards/${button.dataset.cardId}`;
      const card=!publicView && String(recentlyAwardedDetail?.id)===button.dataset.cardId
        ? recentlyAwardedDetail
        : await request(path);
      if(current!==detailRequest)return;
      const stats=card.statistics||{};
      document.getElementById('collect-detail-body').innerHTML=renderCard(card,publicView?publicRarityLabels:rarityLabels,!publicView,true)+(card.wikipedia_url?`<a class="collect-wikipedia-link" href="${escapeHtml(card.wikipedia_url)}" target="_blank" rel="noopener noreferrer" aria-label="Lire l’article Wikipédia"><span aria-hidden="true">W</span> Wikipédia</a>`:'')+`<details class="collect-rarity-help"><summary>Comprendre la rareté</summary><p>Commune à Épique : la difficulté au premier essai, réévaluée chaque mois après suffisamment de parties. Légendaire : carte à assembler par fragments. La rareté affichée ne représente pas une probabilité fixe de tirage.</p></details>`+(publicView?'':copyHistory(card))+`<p>${stats.attempts?`${percentage(stats.successes,stats.attempts)} % de placements réussis · ${stats.attempts} partie${Number(stats.attempts)>1?'s':''} Collect`:'Aucune tentative Collect enregistrée pour ce lieu.'}</p><div id="collect-detail-map" aria-label="Localisation de la carte"></div><p id="collect-detail-map-note"></p>${cardSources(card)}`;
      await socialReady;if(socialApi&&current===detailRequest)await socialApi.mountCard(document.getElementById('collect-detail-body'),card,publicView,publicView?publicProfileName:null);
      const [,data]=await Promise.all([window.loadCollectMapRuntime(),getFamilyMap(card.family)]);
      if(current!==detailRequest)return;
      const features=data.features.filter(f=>featureAnswer(card.family,f)===card.source_entity_id||featureAnswer(card.family,f)===card.name);
      if(!features.length){document.getElementById('collect-detail-map').hidden=true;document.getElementById('collect-detail-map-note').textContent='Localisation indisponible dans le référentiel actuel.';return;}
      detailMap=window.L.map('collect-detail-map',{preferCanvas:true});
      window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri'}).addTo(detailMap);
      const layer=window.L.geoJSON({type:'FeatureCollection',features},{style:{color:UI_THEME.mapCorrect,weight:5},pointToLayer:(_f,ll)=>window.L.circleMarker(ll,{radius:8,color:UI_THEME.mapCorrect})}).addTo(detailMap);
      detailMap.fitBounds(layer.getBounds(),{padding:[24,24],maxZoom:16});
    }catch(error){if(current===detailRequest){const note=document.getElementById('collect-detail-map-note');(note||document.getElementById('collect-detail-body')).textContent=error.message;}}
  });
  document.getElementById('collect-profile-form').addEventListener('submit', event => {
    event.preventDefault();
    const username = document.getElementById('collect-profile-username').value.trim();
    if (username) {
      const url=new URL(location.href);url.searchParams.set('panel','community');url.searchParams.set('profile',username);
      history.replaceState(null,'',url);loadPublicProfile(username);
    }
  });
  for (const id of ['collect-filter-family', 'collect-filter-owned','collect-filter-district','collect-filter-arrondissement']) document.getElementById(id).addEventListener('change', () => { collectionPage = 1; updateCollection(); });
  document.getElementById('collect-filter-rarity').addEventListener('change', () => { collectionPage = 1; updateCollection(); });
  let searchTimer;document.getElementById('collect-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{collectionPage=1;updateCollection();},250);});
  document.getElementById('collect-sort').addEventListener('change',()=>{collectionPage=1;updateCollection();});
  document.getElementById('collect-prev-page').addEventListener('click', () => { collectionPage -= 1; updateCollection(); });
  document.getElementById('collect-next-page').addEventListener('click', () => { collectionPage += 1; updateCollection(); });
  document.getElementById('collect-ranking-type').addEventListener('change',()=>{renderRankingGeography();loadLeaderboard();});
  document.getElementById('collect-ranking-geography').addEventListener('change',loadLeaderboard);
  const initialParams=new URLSearchParams(location.search);
  const publicUsername=initialParams.get('profile');
  if(publicUsername)document.getElementById('collect-profile-username').value=publicUsername;
  const requestedPanel=initialParams.get('panel');
  function openCommunityTab(tab) {
    const social = tab === 'social';
    els['collect-profile'].hidden = social;
    document.getElementById('collect-social-space').hidden = !social;
    document.querySelectorAll('[data-community-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.communityTab===tab)));
    if (!social) {
      const username=document.getElementById('collect-profile-username').value.trim();
      if(username)void loadPublicProfile(username);
    }
  }
  document.querySelectorAll('[data-community-tab]').forEach(button=>button.addEventListener('click',()=>openCommunityTab(button.dataset.communityTab)));
  const initialPanel=['play','collection','albums','community'].includes(requestedPanel)?requestedPanel:(['social','profile'].includes(requestedPanel)||publicUsername?'community':'play');
  document.querySelector(`[data-panel="${initialPanel}"]`).click();
  if(publicUsername || requestedPanel==='profile')openCommunityTab('profile');
  const handleImageError = event => {
    if (event.target.tagName !== 'IMG' || event.target===hintImage || event.target.closest('.leaflet-container,summary,.camino-inline-icon')) return;
    const placeholder = document.createElement('img'); placeholder.className = 'collect-placeholder'; placeholder.src=fallbackImage; placeholder.alt='Logo Parici';
    if(event.target.getAttribute('src')!==fallbackImage)event.target.replaceWith(placeholder);
  };
  document.querySelector('.collect-shell').addEventListener('error',handleImageError,true);
  detailDialog.addEventListener('error',handleImageError,true);

  els['collect-next'].addEventListener('click', startGame);
  function restoreMapInteraction() {
    if (!map || !game || game.finished || !document.body.classList.contains('collect-session-active')) return;
    if (!answering) exitButton.disabled = false;
    map.dragging?.enable();
    map.touchZoom?.enable();
    map.scrollWheelZoom?.enable();
    requestAnimationFrame(() => map.invalidateSize({ pan: false, animate: false }));
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)restoreMapInteraction();});
  window.addEventListener('collect:quota-refresh', () => { if (authenticated) refreshQuota(); });
  window.addEventListener('pageshow',restoreMapInteraction);
  window.addEventListener('focus',restoreMapInteraction);
  async function initializeAuthenticatedPlay() {
    if(!token()){setCollectAuthentication(false);return;}
    els['collect-game-status'].textContent='Vérification de la connexion…';
    try{
      await request('/api/session');
      setCollectAuthentication(true);
      refreshQuota();
      socialReady=(async()=>{
        const config=await request('/api/collect/v2/config').catch(()=>({enabled:false}));
        if(!config.enabled)return;
        const css=document.createElement('link');css.rel='stylesheet';css.href='/src/public/css/collect-social.css?v=20261008-v2';document.head.append(css);
        const moduleUrl=new URL('/src/public/js/collect-social-view.js?v=20261008-v2',location.href).href;
        const {initSocial}=await import(moduleUrl);
        socialApi=await initSocial({request,refresh:async()=>{collectionPayload=null;pagedCollection=null;albumsPayload=null;albumsLoadedAt=0;await loadCollection();await loadAlbumOptions();renderAlbums();await loadLeaderboard();}});
        const ownershipSelect=document.getElementById('collect-filter-owned');for(const [value,text]of [['earned','Gagnées personnellement'],['trade','Obtenues par échange']]){const option=document.createElement('option');option.value=value;option.textContent=text;ownershipSelect.append(option);}
        if(publicProfileName&&!els['collect-profile-content'].querySelector('[data-v2-profile]'))await socialApi.attachProfile(els['collect-profile-content'],publicProfileName);
        if(['social','community'].includes(initialParams.get('panel')) && !publicUsername){document.querySelector('[data-panel="community"]').click();document.querySelector('[data-community-tab="social"]').click();}
      })().catch(error=>showError(error.message));
      const idle=window.requestIdleCallback||((callback)=>setTimeout(callback,250));
      idle(()=>{prewarmCollect();if(!navigator.connection?.saveData)loadAlbumOptions().catch(()=>{});});
      try{const {game:pending}=await request('/api/collect/games/pending');if(pending){pendingGame=pending;els['collect-next'].textContent='Reprendre la partie';els['collect-game-status'].textContent='Une partie est en cours · reprends-la pour continuer.';}}catch(error){if(error.status!==404)showError(error.message);}
      loadWeeklyPlay();

    }catch(_error){setCollectAuthentication(false);}
  }
  request('/api/health').then(health=>{if(health.database==='ready'&&Number(health.collectApiVersion||0)<4){const notice=document.createElement('p');notice.className='collect-compatibility-notice';notice.setAttribute('role','status');notice.textContent='Collect est en cours de mise à jour. Recharge cette page dans quelques instants.';document.querySelector('.collect-shell').append(notice);}}).catch(()=>{});
  initializeAuthenticatedPlay();
})();
