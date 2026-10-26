const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function renderResultProgress(root, result) {
  root.replaceChildren();
  root.hidden = Boolean(result.review);
  if (root.hidden) return;
  const awarded = result.correct && result.rewardGranted;
  const progress = result.progress;
  const fragments = result.fragments;
  const title = awarded ? (Number(result.ownedCount) > 1 ? `Doublon · ${result.ownedCount} exemplaires` : "Nouvelle carte !")
    : fragments?.earned ? `+${fragments.earned} fragment · ${fragments.count}/${fragments.required}`
    : result.correct ? "Lieu retrouvé" : "Un lieu à revoir";
  let body = awarded ? `<p>${escape(result.card?.name)} · ${escape(result.card?.rarityLabel)}</p>`
    : fragments ? `<p>${fragments.earned ? `Encore ${Math.max(0,fragments.required-fragments.count)} fragment${fragments.required-fragments.count>1?'s':''} pour assembler cette carte.` : `Fragments conservés : ${fragments.count}/${fragments.required}.`}</p>`
    : `<p>${result.rewardBlockedReason === 'quota' && result.correct ? 'Quota atteint : aucune carte gagnée.' : result.rewardBlockedReason === 'archived' ? 'Cette carte n’est plus disponible.' : 'Aucune carte ni aucun fragment gagné.'}</p>`;
  if (awarded && fragments?.earned) body+=`<p>+${fragments.earned} fragment · ${fragments.count}/${fragments.required} · Carte assemblée</p>`;
  if (progress?.collection) {
    const c=progress.collection;
    body+=`<p>Collection : ${c.before}${c.before!==c.after?` → ${c.after}`:''}/${c.total} cartes</p>`;
  }
  const albums=(progress?.albums||[]).slice(0,3);
  if (albums.length) body+=`<ul>${albums.map(a=>`<li${a.complete?' class="collect-result-complete"':''}><strong>${escape(a.name)}</strong>${a.targeted?' · Album ciblé':''}<span>${a.before} → ${a.after}/${a.total}${a.complete?' · Album terminé !':` · Encore ${a.total-a.after} carte${a.total-a.after>1?'s':''}`}</span><span class="collect-result-track" aria-hidden="true"><i style="--before:${100*a.before/a.total}%;--after:${100*a.after/a.total}%"></i></span></li>`).join('')}</ul>`;
  if (result.newBadges?.length) body+=`<p>${result.newBadges.map(b=>`Badge obtenu : ${escape(b.name)}`).join(' · ')}</p>`;
  const album=albums.find(a=>a.targeted)||albums.find(a=>a.complete);
  if(album)body+=`<button type="button" class="btn-tertiary" data-result-album="${escape(album.slug)}">Ouvrir ${escape(album.name)}</button>`;
  if(progress?.otherAlbumCount)body+=`<button type="button" class="btn-tertiary" data-result-album="">Voir les autres albums (+${progress.otherAlbumCount})</button>`;
  root.innerHTML=`<h3>${escape(title)}</h3>${body}`;
}
