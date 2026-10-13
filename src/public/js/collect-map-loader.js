(() => {
  'use strict';
  let pending;
  let busPending;
  window.loadCollectBusRuntime = async function () {
    await window.loadCollectMapRuntime();
    if(window.L.Polyline.prototype.setOffset) return;
    if(busPending) return busPending;
    busPending=new Promise((resolve,reject) => {
      const script=document.createElement('script');
      const fail=()=>{clearTimeout(timeout);script.remove();reject(new Error('Les lignes de bus n’ont pas pu charger. Réessaie.'));};
      const timeout=setTimeout(fail,15000);
      script.src='/src/public/js/leaflet.polylineoffset.js';
      script.onload=()=>{clearTimeout(timeout);if(window.L.Polyline.prototype.setOffset)resolve();else fail();};
      script.onerror=fail;document.head.append(script);
    }).catch(error=>{busPending=null;throw error;});
    return busPending;
  };
  window.loadCollectMapRuntime = function () {
    if (window.L?.map) return Promise.resolve(window.L);
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const fail = () => {
        clearTimeout(timeout);
        script.remove();
        reject(new Error('La carte n’a pas pu charger. Vérifie ta connexion puis réessaie.'));
      };
      const timeout = setTimeout(fail, 15000);
      script.src = '/src/public/js/leaflet-runtime.js';
      script.onload = () => {
        if (!window.L?.map) { fail(); return; }
        clearTimeout(timeout);
        resolve(window.L);
      };
      script.onerror = fail;
      document.head.append(script);
    }).catch(error => { pending = null; throw error; });
    return pending;
  };
})();
