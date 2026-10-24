import { renderReminderControl, setReminderStatus, reminderBlockReason } from './reminder-control.js';
const API=window.CaminoRuntimeConfig?.apiUrl||'http://localhost:3000';
function token(){return localStorage.getItem('camino_auth_token')||sessionStorage.getItem('camino_paris_session_token')||(JSON.parse(localStorage.getItem('camino_paris_user')||'null')?.authenticated?'__cookie_session__':'');}
async function request(path,body,method=body?'POST':'GET'){
  const response=await fetch(API+path,{method,credentials:'include',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token()},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Connexion indisponible');return data;
}
function blocked(){
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  return reminderBlockReason({authenticated:Boolean(token()),needsInstallation:ios&&!navigator.standalone&&!window.matchMedia('(display-mode: standalone)').matches,
    supported:window.isSecureContext&&'Notification'in window&&'PushManager'in window&&'serviceWorker'in navigator,permission:window.Notification?.permission});
}
async function refresh(){
  if(!token())return;
  try{const state=await request('/api/collect/notifications');if(state.badge){document.getElementById('collect-push-feedback').textContent='Tu peux de nouveau gagner une carte Collect.';await request('/api/collect/notifications/open',{});}return state;}catch{ /* A failed badge refresh must not reset edited preferences. */ }
}
window.CaminoCollectNotifications={refresh};
async function enablePush(){
  const reason=blocked();if(reason)throw new Error(reason);
  if(await Notification.requestPermission()!=='granted')throw new Error('Autorise les notifications dans le navigateur pour recevoir ces alertes.');
  const config=await request('/api/notifications/public-key');if(!config.enabled||!config.publicKey)throw new Error('Les alertes push sont momentanément indisponibles.');
  const worker=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;let subscription=await worker.pushManager.getSubscription();
  if(!subscription){const key=config.publicKey.replace(/-/g,'+').replace(/_/g,'/');subscription=await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(atob(key+'='.repeat((4-key.length%4)%4)),c=>c.charCodeAt(0))});}
  await request('/api/collect/push/subscribe',{subscription});
}
async function init(){
  const form=document.getElementById('collect-settings-form'),status=document.getElementById('collect-settings-status');if(!form)return;
  const container=document.getElementById('collect-settings'),button=form.querySelector('button');
  let settingsLoaded=false;
  const show=(message,type='neutral')=>setReminderStatus({statusElement:status,container,message,type,label:'Alertes Collect'});
  const controls=(loading=false)=>{
    for(const name of ['quota','push'])renderReminderControl({toggle:form.elements[name],enabled:form.elements[name].checked,canEnable:settingsLoaded&&!blocked(),loading,statusElement:status,container});
    button.disabled=loading||!token()||!settingsLoaded;
  };
  if(!token()){show(blocked());controls();return;}
  show('Chargement…');controls(true);
  try{
    const [me,quota]=await Promise.all([request('/api/collect/v2/me'),refresh()]);
    if(!me.settings)throw new Error('Réglages Collect indisponibles. Réessayez depuis le menu Réglages.');
    settingsLoaded=true;
    form.elements.visibility.value=me.settings.visibility;form.elements.exchanges.value=me.settings.exchanges;
    form.elements.push.checked=me.settings.push;form.elements.quota.checked=quota?.pushEnabled||false;
    show(blocked()||(form.elements.quota.checked||form.elements.push.checked?'Alertes Collect actives.':'Alertes Collect inactives.'));
  }catch(error){show(error.message,'error');}finally{controls();}
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!settingsLoaded)return;show('Enregistrement…');controls(true);
    try{
      const push=form.elements.push.checked,quota=form.elements.quota.checked;
      if(push||quota)await enablePush();else{
        let subscription;try{subscription=await(await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();}catch{ /* No local subscription. */ }
        const result=await request('/api/collect/push/unsubscribe',{endpoint:subscription?.endpoint||''});if(subscription&&!result.keepSubscription)await subscription.unsubscribe();
      }
      await request('/api/collect/notifications/preference',{enabled:quota},'PUT');
      await request('/api/collect/v2/settings',{visibility:form.elements.visibility.value,exchanges:form.elements.exchanges.value,push},'PUT');
      show(push||quota?'Réglages enregistrés. Alertes Collect actives.':'Réglages enregistrés. Alertes Collect inactives.','success');
    }catch(error){show(error.message,'error');}finally{controls();}
  });
  await refresh();setInterval(refresh,30000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else void init();
