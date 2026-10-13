// Collect preferences live on the direct-access page while the public menu stays unchanged.
const API=window.CaminoRuntimeConfig?.apiUrl||'http://localhost:3000';
function token(){return localStorage.getItem('camino_auth_token')||sessionStorage.getItem('camino_paris_session_token')||(JSON.parse(localStorage.getItem('camino_paris_user')||'null')?.authenticated?'__cookie_session__':'');}
async function request(path,body,method=body?'POST':'GET'){
 const response=await fetch(API+path,{method,credentials:'include',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token()},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Connexion indisponible');return data;
}
async function refresh(){if(!token())return;try{const state=await request('/api/collect/notifications');if(state.badge){document.getElementById('collect-push-feedback').textContent='Tu peux de nouveau gagner une carte Collect.';await request('/api/collect/notifications/open',{});}return state;}catch{}}
window.CaminoCollectNotifications={refresh};
async function enablePush(){
 if(!('Notification'in window)||!navigator.serviceWorker||!('PushManager'in window))throw new Error('Les alertes push ne sont pas disponibles sur cet appareil.');
 if(await Notification.requestPermission()!=='granted')throw new Error('Autorise les notifications dans le navigateur pour recevoir ces alertes.');
 const config=await request('/api/notifications/public-key');if(!config.enabled||!config.publicKey)throw new Error('Les alertes push sont momentanément indisponibles.');
 const worker=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;let subscription=await worker.pushManager.getSubscription();
 if(!subscription){const key=config.publicKey.replace(/-/g,'+').replace(/_/g,'/');subscription=await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(atob(key+'='.repeat((4-key.length%4)%4)),c=>c.charCodeAt(0))});}
 await request('/api/collect/push/subscribe',{subscription});
}
async function init(){
 const form=document.getElementById('collect-settings-form'),status=document.getElementById('collect-settings-status');if(!form||!token())return;
 try{const [me,quota]=await Promise.all([request('/api/collect/v2/me'),refresh()]);form.elements.visibility.value=me.settings.visibility;form.elements.exchanges.value=me.settings.exchanges;form.elements.push.checked=me.settings.push;form.elements.quota.checked=quota?.pushEnabled||false;}catch(error){status.textContent=error.message;}
 form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{
 const push=form.elements.push.checked,quota=form.elements.quota.checked;
 if(push||quota)await enablePush();else{let subscription;try{subscription=await(await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();}catch{}const result=await request('/api/collect/push/unsubscribe',{endpoint:subscription?.endpoint||''});if(subscription&&!result.keepSubscription)await subscription.unsubscribe();}
 await request('/api/collect/notifications/preference',{enabled:quota},'PUT');await request('/api/collect/v2/settings',{visibility:form.elements.visibility.value,exchanges:form.elements.exchanges.value,push},'PUT');status.textContent='Réglages enregistrés.';
 }catch(error){status.textContent=error.message;}finally{button.disabled=false;}});
 await refresh();setInterval(refresh,30000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else void init();
