const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const labels = { 1: "Commune", 2: "Peu commune", 3: "Rare", 4: "Épique", 5: "Légendaire" };
export function renderCardArtwork(card, rarityLabels = labels) {
  const rarity = card.fragments_enabled ? 5 : Number(card.current_rarity) || 1;
  const number = `${{ street: "R", district: "Q", monument: "M", bus: "B" }[card.family] || "R"}-${String(card.collection_number).padStart(card.family === "street" ? 4 : 3, "0")}`;
  const image = /^(?:\/(?!\/)|https:\/\/)/.test(card.image_reference || "") ? card.image_reference : "/apple-touch-icon.png";
  const source = card.image_attribution?.source;
  const photographic = source?.startsWith("google") || source === "panoramax" || source === "wikipedia" || /\/collect_images\/(?:photo-|panoramax-|wikimedia-)/.test(image);
  const author = card.image_attribution?.author;
  const credit = source === "panoramax" ? `Panoramax · ${author || ""}` : source === "wikipedia" ? `Wikimedia · ${author || ""}` : source?.startsWith("google") && author && author !== "Google Street View" ? `Google Street View · ${author}` : "Google Street View";
  const photoCredit = photographic ? `<span class="collect-card-photo-credit" title="${escape(credit)}">${escape(credit)}</span>` : '';
  const daily = card.daily_origin || card.copies?.some(copy => copy.source === "daily");
  return `<div class="collect-card-art${image === "/apple-touch-icon.png" ? " collect-card-art--logo" : ""}${photographic && card.family === "monument" ? " collect-card-art--monument-photo" : ""}${photographic && card.family === "bus" ? " collect-card-art--transport-photo" : ""}"><img src="${escape(image)}" alt="" loading="${card.revealed ? 'eager' : 'lazy'}" decoding="async"><header><span>${{ street: "Rue", district: "Quartier", monument: "Monument", bus: "Transport" }[card.family] || "Rue"}</span><span>${number}</span></header><div class="collect-card-rarity">${"★".repeat(rarity)} · ${escape(rarityLabels[rarity] || labels[rarity])}</div>${photoCredit}${daily ? '<span class="collect-card-daily" title="Carte gagnée au Daily" aria-label="Carte gagnée au Daily">D</span>' : ""}</div>`;
}
export function renderDailyCardReward(reward) {
  if (!reward?.card) return "";
  const card = reward.card;
  const rarity = card.fragments_enabled ? 5 : Number(card.current_rarity) || 1;
  return `<section class="daily-card-reward" aria-label="Carte gagnée au Daily"><p><strong>Bravo ! Vous avez gagné cette carte.</strong></p><article class="collect-card rarity-${rarity}">${renderCardArtwork({ ...card, daily_origin: true, revealed: true })}<div class="collect-card-body"><strong class="collect-tile__name">${escape(card.name)}</strong><p class="collect-card-description">${escape(card.short_description || card.description || "Un lieu à collectionner à Paris.")}</p></div></article><a class="btn-primary daily-collect-link" href="/collect.html">Découvrir Collect →</a><p>Retrouvez votre carte et collectionnez d’autres lieux de Paris.</p></section>`;
}
