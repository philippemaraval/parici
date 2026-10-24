(async () => {
  const sections=document.querySelectorAll('[data-public-mode]');
  if(!sections.length)return;
  try {
    const api=window.CaminoRuntimeConfig?.apiUrl||'http://localhost:3000';
    const response=await fetch(api+'/api/site/modes',{signal:AbortSignal.timeout(10000),cache:'no-store'});
    if(!response.ok)throw new Error('Modes indisponibles');
    const modes=await response.json();
    const quota=modes.collectRules?.quota;
    const quotaLabel=document.getElementById('collect-rules-quota');
    if(quotaLabel&&Number(quota?.copies)>0&&Number(quota?.windowMinutes)>0)
      quotaLabel.textContent=`${Number(quota.copies)} cartes sur une période glissante de ${Number(quota.windowMinutes)} minutes`;
    for(const element of sections)element.hidden=modes[element.dataset.publicMode]!==true;
    // A direct anchor may have been reached while its section was still hidden.
    const anchor=document.getElementById(location.hash.slice(1));
    if(anchor?.matches('[data-public-mode]:not([hidden])'))anchor.scrollIntoView();
  } catch {
    // Keep unpublished modes and unverifiable rules out of the public page.
  }
})();
