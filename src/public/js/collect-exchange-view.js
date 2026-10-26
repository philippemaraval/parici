const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rarities=['','Commune','Peu commune','Rare','Épique'];
const name=card=>card.family==='bus'?`Ligne ${card.name}`:card.name;

export function initExchangeSuggestions({api,send,content,showModal,modalAction,showOpportunities,showOffers,message}) {
  let page=1;
  const cardMarkup=(card,side)=>`<section><h4>${side==='give'?'Je donne':'Je reçois'}</h4><strong>${escape(name(card))}</strong><p>${escape(rarities[card.rarity])}</p><small>${side==='give'?'Doublon · un exemplaire conservé':'Nouvelle pour ma collection'}</small></section>`;
  const pairMarkup=row=>`<div class="collect-exchange-pair">${cardMarkup(row.give,'give')}${cardMarkup(row.receive,'receive')}</div>`;
  const albumMarkup=album=>album?`<p class="collect-exchange-album">${escape(album.name)}${album.targeted?' · Album ciblé':''} : ${album.before} → ${album.after}/${album.total}${album.after===album.total?' · Album terminé !':''}</p>`:'';

  async function propose(row){
    const requestId=crypto.randomUUID();
    showModal(`<h2>Vérifier l’échange avec ${escape(row.partner.username)}</h2>${pairMarkup(row)}${albumMarkup(row.album)}<p>Chacun conserve un exemplaire. L’autre joueur pourra accepter ou refuser.</p><button type="button" class="btn-primary" id="collect-quick-propose">Proposer l’échange</button>`);
    const button=document.getElementById('collect-quick-propose'),dialog=button.closest('dialog');
    button.onclick=modalAction(async()=>{
      await send('/offers',{simple:true,kind:'direct',receiverId:String(row.partner.id),offeredIds:[String(row.give.copyId)],requestedIds:[String(row.receive.copyId)],requestId});
      dialog.close();
      await showOffers();message('Proposition envoyée. Retrouve-la dans Mes propositions.');
    });
  }

  async function render(mode,cardId,isCurrent,reset=true){
    if(reset)page=1;
    const params=new URLSearchParams({page:String(page)});if(cardId)params.set('cardId',cardId);
    const payload=await api(`/${mode==='duplicates'?'duplicates':'opportunities'}?${params}`);
    if(!isCurrent())return;
    const rows=mode==='duplicates'?(payload.cards||[]):(payload.opportunities||[]);
    content.innerHTML=`<h3>${mode==='duplicates'?'Mes doublons':'Échanges possibles'}</h3><p>Une carte contre une carte de même rareté, hors légendaires. Chacun conserve un exemplaire.</p>${cardId?'<button type="button" class="btn-tertiary" data-clear-exchange-filter>Voir tous mes échanges possibles</button>':''}<div class="collect-social-list collect-opportunities">${rows.map((row,i)=>mode==='duplicates'?`<article><h4>${escape(name(row))}</h4><p>${escape(rarities[row.rarity])} · ${row.count} exemplaires · ${row.spare} disponible${row.spare>1?'s':''}</p><button type="button" class="btn-primary" data-duplicate="${escape(row.id)}">Voir les échanges possibles</button></article>`:`<article><h4>Avec ${escape(row.partner.username)}</h4>${pairMarkup(row)}${albumMarkup(row.album)}<button type="button" class="btn-primary" data-opportunity="${i}">Choisir cet échange</button></article>`).join('')||`<p>${mode==='duplicates'?'Aucun doublon disponible. Les cartes protégées, masquées ou légendaires sont exclues.':'Aucun échange réciproque disponible pour le moment. Les disponibilités et réglages des joueurs peuvent évoluer.'}</p>`}</div><div class="collect-social-actions"><button type="button" class="btn-secondary" data-exchange-prev ${page<=1?'disabled':''}>Précédent</button><span>Page ${page}</span><button type="button" class="btn-secondary" data-exchange-next ${mode==='duplicates'?page*20>=payload.total?'disabled':'':!payload.hasMore?'disabled':''}>Suivant</button></div>`;
    const navigate=async(button,cardId)=>{button.disabled=true;try{await showOpportunities(cardId);}catch(error){message(error.message);}finally{if(button.isConnected)button.disabled=false;}};
    content.querySelectorAll('[data-duplicate]').forEach(b=>b.onclick=()=>navigate(b,b.dataset.duplicate));
    content.querySelectorAll('[data-opportunity]').forEach(b=>b.onclick=()=>propose(rows[Number(b.dataset.opportunity)]));
    content.querySelector('[data-clear-exchange-filter]')?.addEventListener('click',event=>navigate(event.currentTarget,null));
    for(const [key,delta] of [['prev',-1],['next',1]])content.querySelector(`[data-exchange-${key}]`).onclick=async event=>{
      event.target.disabled=true;
      try{page+=delta;await render(mode,cardId,isCurrent,false);}catch(error){page-=delta;message(error.message);event.target.disabled=false;}
    };
  }
  return {render};
}
