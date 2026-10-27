const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initCollectReviews(request,start) {
  let counts=null,generation=0;
  const stats=scope=>scope?(counts?counts.albums?.[scope]||{revision:0,errors:0}:null):counts;
  function buttons(scope='',compact=false) {
    const c=stats(scope);
    return `<div class="collect-review-actions" data-review-scope="${escape(scope)}" data-review-compact="${compact}"><button type="button" class="btn-primary" data-review-mode="revision" aria-label="Réviser mes cartes" ${!c?.revision?'disabled':''}>${compact?'Réviser':'Réviser mes cartes'}</button><button type="button" class="btn-primary" data-review-mode="errors" aria-label="${c&&!c.errors?'Aucune erreur à revoir':'Revoir mes erreurs'}" ${!c?.errors?'disabled':''}>${c&&!c.errors?(compact?'Aucune erreur':'Aucune erreur à revoir'):(compact?'Revoir les erreurs':'Revoir mes erreurs')}</button></div>`;
  }
  function render() {
    document.querySelectorAll('[data-review-scope]').forEach(node=>{
      const c=stats(node.dataset.reviewScope);
      node.querySelector('[data-review-mode="revision"]').disabled=!c?.revision;
      const errors=node.querySelector('[data-review-mode="errors"]');
      const compact=node.dataset.reviewCompact==='true';
      errors.disabled=!c?.errors;errors.textContent=c&&!c.errors?(compact?'Aucune erreur':'Aucune erreur à revoir'):(compact?'Revoir les erreurs':'Revoir mes erreurs');
      errors.setAttribute('aria-label',c&&!c.errors?'Aucune erreur à revoir':'Revoir mes erreurs');
    });
  }
  async function refresh() {
    const current=++generation;
    try {const payload=await request('/api/collect/reviews/counts');if(current===generation){counts=payload;render();}}
    catch { /* Keep confirmed counts when offline; the server rechecks ownership. */ }
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-review-mode]');if(!button||button.disabled)return;
    void start({mode:button.dataset.reviewMode,scope:button.closest('[data-review-scope]').dataset.reviewScope});
  });
  return {buttons,refresh};
}
