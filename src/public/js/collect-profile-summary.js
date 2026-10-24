const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderCollectProfileSummary(collect, username) {
  if (!collect) return '';
  const number = key => Number(collect[key]) || 0;
  const archived = Math.max(0, number('unique_cards') - number('active_unique_cards'));
  const albums = (collect.albums || []).filter(a => a.complete).length;
  const badges = (collect.badges || []).filter(b => b.earned).length;
  const visibility = {public:'Collection publique',friends:'Collection réservée à vos amis',private:'Collection privée'}[collect.visibility] || 'Confidentialité à vérifier dans Collect';
  return `<section class="profile-daily-summary profile-collect-summary" aria-label="Votre collection Collect">
    <h3 class="profile-section-heading">Collect · Paris en cartes</h3>
    <div class="profile-stats-grid">
      <div class="profile-stat"><span class="profile-stat-value">${number('unique_cards')}</span><span class="profile-stat-label">Cartes uniques</span></div>
      <div class="profile-stat"><span class="profile-stat-value">${number('total_copies')}</span><span class="profile-stat-label">Exemplaires</span></div>
      <div class="profile-stat"><span class="profile-stat-value">${collect.success_rate == null ? '—' : number('success_rate')+' %'}</span><span class="profile-stat-label">Réussite Collect · ${number('attempts')} partie${number('attempts')===1?'':'s'}</span></div>
    </div>
    <p>${number('active_unique_cards')} / ${number('active_card_count')} cartes actives · ${number('progress')} %${archived ? ` · ${archived} carte${archived>1?'s':''} archivée${archived>1?'s':''} conservée${archived>1?'s':''}`:''}</p>
    <p>${albums} album${albums===1?'':'s'} complet${albums===1?'':'s'} · ${badges} badge${badges===1?'':'s'} obtenu${badges===1?'':'s'}</p>
    <p>${visibility}</p>
    <div class="profile-collect-links">${collect.visibility==='public'?`<a href="/collect.html?profile=${escape(encodeURIComponent(username))}">Voir mon profil public Collect</a> · `:''}<a href="/collect.html?panel=collection">Voir ma collection</a> · <a href="/collect.html">Jouer à Collect</a> · <a href="/collect.html?settings=1">Confidentialité et alertes</a></div>
  </section>`;
}
