import { iconMarkup } from './camino-art.js';

export function reminderBlockReason({authenticated, needsInstallation=false, supported=true, permission, appName='Parici'}) {
  if (!authenticated) return 'Connectez-vous pour gérer les rappels.';
  if (needsInstallation) return `Sur iPhone/iPad, installez ${appName} via « Ajouter à l’écran d’accueil » pour activer les notifications.`;
  if (!supported) return 'Notifications push non disponibles sur ce navigateur.';
  if (permission === 'denied') return 'Notifications refusées. Autorisez-les dans les réglages du navigateur pour activer les rappels.';
  return '';
}

export function setReminderStatus({statusElement, container, message, type='neutral', label='Rappel'}) {
  if (!statusElement) return;
  statusElement.textContent=message;
  statusElement.classList.toggle('is-error',type==='error');
  statusElement.classList.toggle('is-success',type==='success');
  if (container) {
    container.title=message;
    container.setAttribute('aria-label',`${label} : ${message}`);
  }
}

export function renderReminderControl({enableButton,disableButton,icon,toggle,enabled=false,canEnable=false,canDisable=false,loading=false,statusElement,container,label='le rappel'}) {
  const message=statusElement?.textContent || '';
  for (const [button,visible,action] of [[enableButton,canEnable&&!canDisable,'Activer'],[disableButton,canDisable,'Désactiver']]) {
    if (!button) continue;
    button.hidden=!visible;
    button.classList.toggle('hidden',!visible);
    button.disabled=loading;
    button.title=message;
    button.setAttribute('aria-label',`${action} ${label}`);
    if(statusElement?.id)button.setAttribute('aria-describedby',statusElement.id);
  }
  if(toggle) {
    toggle.checked=enabled;
    toggle.disabled=loading||(!enabled&&!canEnable);
    toggle.title=message;
    if(statusElement?.id)toggle.setAttribute('aria-describedby',statusElement.id);
  }
  if (icon) icon.innerHTML=iconMarkup(canDisable?'bellCheck':'bell');
  container?.setAttribute('aria-busy',String(loading));
}
