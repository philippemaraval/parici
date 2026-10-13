window.installPariciCollectAdmin = function ({ apiRequest }) {
// Collect uses the existing editor session; catalogue mutations require an admin role.
let collectAdminPage = 1;
let collectAdminRequest = 0;
let collectAdminSort = 'number';
let collectAdminOrder = 'asc';
async function loadCollectAdmin() {
  const requestId = ++collectAdminRequest;
  const message = document.getElementById('collect-admin-message');
  const rows = document.getElementById('collect-admin-rows');
  const previousButton = document.getElementById('collect-admin-prev');
  const nextButton = document.getElementById('collect-admin-next');
  const selectedRarity = document.getElementById('collect-admin-rarity').value;
  const params = new URLSearchParams({ search: document.getElementById('collect-admin-search').value.trim(),
    family: document.getElementById('collect-admin-family').value,
    quality: document.getElementById('collect-admin-quality').value,
    status: document.getElementById('collect-admin-status').value,
    rarity: document.getElementById('collect-admin-rarity').value, page: String(collectAdminPage),
    sort: collectAdminSort, order: collectAdminOrder });
  message.textContent = 'Chargement du catalogue…';
  previousButton.disabled = true;
  nextButton.disabled = true;
  rows.replaceChildren();
  const loadingRow=document.createElement('tr');const loadingCell=document.createElement('td');loadingCell.colSpan=7;loadingCell.textContent='Chargement…';loadingRow.append(loadingCell);rows.append(loadingRow);
  try {
    const payload = await apiRequest(`/api/editor/collect/cards?${params}`);
    if (requestId !== collectAdminRequest) return;
    if (!payload || !Array.isArray(payload.cards)) throw new Error('Réponse du catalogue invalide.');
    const effectiveRarity=card=>card.fragments_enabled?5:Number(card.effective_rarity||card.current_rarity||1);
    const serverFiltered=String(payload.filters?.rarity??'')===selectedRarity;
    const cards=payload.cards.filter(card=>serverFiltered||!selectedRarity||effectiveRarity(card)===Number(selectedRarity));
    document.querySelectorAll('.collect-admin-sort').forEach(button=>{
      const active=button.dataset.sort===collectAdminSort;
      button.classList.toggle('is-active',active);
      button.closest('th').setAttribute('aria-sort',active?(collectAdminOrder==='asc'?'ascending':'descending'):'none');
      button.dataset.direction=active?collectAdminOrder:'';
    });
    document.getElementById('collect-admin-mobile-sort').value=collectAdminSort;
    document.getElementById('collect-admin-mobile-order').value=collectAdminOrder;
    rows.replaceChildren();
    if (!cards.length) {
      const emptyRow=document.createElement('tr');const emptyCell=document.createElement('td');emptyCell.colSpan=7;emptyCell.textContent='Aucune carte ne correspond aux filtres.';emptyRow.append(emptyCell);rows.append(emptyRow);
    }
    for (const card of cards) {
      const row = document.createElement('tr');
      const prefix = {street:'R', district:'Q', monument:'M', bus:'B'}[card.family];
      for (const [index,value] of [`${prefix}-${String(card.collection_number).padStart(card.family === 'street' ? 4 : 3, '0')}`,
        card.name, card.status === 'archived' ? 'Archivée' : 'Active', card.copy_count].entries()) {
        const cell = document.createElement('td'); cell.textContent = value;
        if(index===1 && card.family==='street'){
          const parts=String(card.name).match(/^(.*?)\s+-\s+([A-ZÀ-ÖØ-ÞŒ0-9'’ -]+?)(?:\s+-\s+(\d+\s*m))?$/u);
          if(parts){cell.textContent=parts[1];const district=document.createElement('small');district.className='collect-name-district';district.textContent=parts[2]+(parts[3]?' · '+parts[3]:'');const name=document.createElement('span');name.append(...cell.childNodes,district);cell.append(name);}
        }
        row.append(cell);
      }
      const rarityCell=document.createElement('td');
      rarityCell.className='collect-rarity-settings';
      const labels={1:'Commune',2:'Peu commune',3:'Rare',4:'Épique'};
      const current=document.createElement('strong');
      current.textContent=`Actuelle : ${card.fragments_enabled?'Légendaire':labels[card.current_rarity]||'inconnue'}`;
      const initialLabel=document.createElement('label');initialLabel.textContent='Rareté initiale';
      const raritySelect=document.createElement('select');
      raritySelect.setAttribute('aria-label',`Rareté initiale de ${card.name}`);
      for(const [value,label] of Object.entries(labels)){const option=document.createElement('option');option.value=value;option.textContent=label;raritySelect.append(option);}
      raritySelect.value=String(card.base_rarity_override??card.base_rarity);
      initialLabel.append(raritySelect);
      const automaticLabel=document.createElement('label');automaticLabel.className='collect-rarity-automatic';
      const automatic=document.createElement('input');automatic.type='checkbox';automatic.checked=card.rarity_override==null;
      automatic.setAttribute('aria-label',`Évolution automatique mensuelle de ${card.name}`);
      automaticLabel.append(automatic,document.createTextNode('Automatique · mensuelle'));
      const note=document.createElement('small');
      note.textContent=card.fragments_enabled?'Fragments activés : légendaire.':'Initiale jusqu’au premier recalcul (20 placements par défaut).';
      note.title='Enregistrer conserve la rareté déjà recalculée. Appliquer maintenant remplace immédiatement la rareté actuelle par la rareté initiale.';
      const save=document.createElement('button');save.type='button';save.className='btn';save.textContent='Enregistrer';
      const apply=document.createElement('button');apply.type='button';apply.className='btn';apply.textContent='Appliquer';
      apply.title='Appliquer la rareté initiale comme rareté actuelle, en conservant le réglage d’évolution automatique.';
      const feedback=document.createElement('small');feedback.setAttribute('role','status');
      const persist=async applyRarityNow=>{
        [raritySelect,automatic,save,apply].forEach(control=>control.disabled=true);
        try{
          await apiRequest(`/api/editor/collect/cards/${card.id}/rarity`,{method:'PUT',body:{initialRarity:Number(raritySelect.value),automaticRarity:automatic.checked,applyRarityNow}});
          await loadCollectAdmin();
          message.textContent=`${card.name} : rareté initiale enregistrée${applyRarityNow?' et appliquée immédiatement':''}. Évolution automatique ${automatic.checked?'activée':'désactivée'}.`;
        }catch(error){feedback.textContent=error.message;[raritySelect,automatic,save,apply].forEach(control=>control.disabled=false);}
      };
      if(payload.rarityEditingVersion!==2){
        [raritySelect,automatic,save,apply].forEach(control=>control.disabled=true);
        feedback.textContent='Le serveur utilise encore l’ancienne version. La modification sera disponible après son déploiement.';
      }
      save.addEventListener('click',()=>persist(false));apply.addEventListener('click',()=>persist(true));
      const rarityActions=document.createElement('div');rarityActions.className='collect-rarity-actions';rarityActions.append(save,apply);rarityCell.append(current,initialLabel,automaticLabel,note,rarityActions,feedback);row.append(rarityCell);
      const fragmentsCell=document.createElement('td');fragmentsCell.textContent=`${card.fragments_enabled ? ({2:'Notable',3:'Majeure',4:'Iconique'}[card.fragments_required] + ' · ' + card.fragments_required + ' fragments') : 'Directe · 0 fragment'} · ${card.question_count || 0} questions`;row.append(fragmentsCell);
      const action = document.createElement('td');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn';
      button.textContent = card.status === 'active' ? 'Archiver' : card.catalog_present === false ? 'Hors référentiel' : 'Réactiver';
      button.disabled = card.status === 'archived' && card.catalog_present === false;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await apiRequest(`/api/editor/collect/cards/${card.id}`, { method: 'PATCH', body: {status: card.status === 'active' ? 'archived' : 'active'} });
          await loadCollectAdmin();
          message.textContent = `${card.name} : ${card.status === 'active' ? 'carte archivée, exemplaires conservés' : 'carte réactivée'}.`;
        } catch (error) { message.textContent = error.message; button.disabled = false; }
      });
      const configure=document.createElement('button'); configure.type='button'; configure.className='btn'; configure.textContent='Configurer les fragments'; configure.addEventListener('click',()=>openFragments(card));
      const edit=document.createElement('button');edit.type='button';edit.className='btn';edit.textContent='Modifier illustration / description';edit.addEventListener('click',()=>openContent(card));
      action.append(button,configure,edit); row.append(action); rows.append(row);
    }
    const displayedTotal=serverFiltered?Number(payload.total||0):cards.length;
    message.textContent = displayedTotal ? `${displayedTotal} carte${displayedTotal > 1 ? 's' : ''} correspondant aux filtres.` : 'Aucune carte.';
    const pageSize=Math.max(1,Number(payload.pageSize)||50);
    const totalPages=Math.max(1,Math.ceil(displayedTotal/pageSize));
    collectAdminPage=Math.min(Math.max(1,Number(payload.page)||collectAdminPage),totalPages);
    document.getElementById('collect-admin-page').textContent = `Page ${collectAdminPage} / ${totalPages}`;
    previousButton.disabled = collectAdminPage <= 1;
    nextButton.disabled = collectAdminPage >= totalPages;
  } catch (error) { if (requestId === collectAdminRequest) {rows.replaceChildren();const errorRow=document.createElement('tr');const errorCell=document.createElement('td');errorCell.colSpan=7;errorCell.textContent='Impossible de charger le catalogue.';errorRow.append(errorCell);rows.append(errorRow);message.textContent = `Catalogue indisponible : ${error.message}`;} }
}
document.getElementById('collect-health-refresh')?.addEventListener('click',async()=>{
  const node=document.getElementById('collect-health');node.textContent='Chargement…';
  try{const health=await apiRequest('/api/editor/collect/health');node.replaceChildren();
    for(const card of health.catalog){const p=document.createElement('p');p.textContent=`${card.family} · ${card.active} actives · ${card.fallback_images} logos · ${card.missing_questions} banques manquantes · ${card.absent} hors référentiel`;node.append(p);}
    for(const geometry of health.geometry||[]){const p=document.createElement('p');p.textContent=geometry.status==='loaded'?`${geometry.family} · ${geometry.missing} cartes actives sans géométrie · ${Math.round(geometry.bytes/1024)} Ko décodés · ${Math.round(geometry.compressedBytes/1024)} Ko compressés`:`${geometry.family} · couverture à mesurer après chargement de la carte`;node.append(p);}
    if(health.distribution){
      const title=document.createElement('h3');title.textContent='Tirages · 30 derniers jours';node.append(title);
      for(const row of health.distribution.categories){const p=document.createElement('p');p.textContent=`${row.category} · ${row.cards} cartes · attendu ${row.expectedPercent.toFixed(1)} % · observé ${row.observed} / ${health.distribution.samples} parties`;node.append(p);}
      const p=document.createElement('p');p.textContent='Probabilités actuelles par rareté : '+health.distribution.rarityPercent.map((v,i)=>`${i+1} ★ ${v.toFixed(1)} %`).join(' · ');node.append(p);
      const note=document.createElement('small');note.textContent=health.distribution.note;node.append(note);
    }
    const funnel=document.createElement('p');funnel.textContent='7 derniers jours : '+health.funnel.map(s=>`${s.step} ${s.count}`).join(' · ');node.append(funnel);
    const notifications=document.createElement('p');notifications.textContent=`Notifications : ${health.notifications.pending} en attente · dernier envoi ${health.notifications.last_sent?new Date(health.notifications.last_sent).toLocaleString('fr-FR'):'aucun'}`;node.append(notifications);
    for(const setting of health.settings){const p=document.createElement('p');p.textContent=`${setting.key} · ${setting.value_text} · ${new Date(setting.updated_at).toLocaleString('fr-FR')}`;node.append(p);}
  }catch(error){node.textContent=error.message;}
});
async function loadSocialReports(){
  const host=document.getElementById('collect-report-admin-card');if(!host)return;
  try{const config=await apiRequest('/api/collect/v2/config');if(!config.enabled)return;
    let node=document.getElementById('collect-social-admin-reports');if(!node){node=document.createElement('section');node.id='collect-social-admin-reports';host.append(node);}
    const reports=await apiRequest('/api/collect/v2/admin/reports');node.replaceChildren();const title=document.createElement('h3');title.textContent='Comportements signalés';node.append(title);
    for(const report of reports){const row=document.createElement('p');row.textContent=`${report.reported_name||'Compte supprimé'} · ${({spam:'Spam',harassment:'Harcèlement',circumvention:'Contournement',content:'Contenu'})[report.reason]} · ${new Date(report.created_at).toLocaleString('fr-FR')} `;const button=document.createElement('button');button.className='btn';button.textContent='Marquer traité';button.onclick=async()=>{button.disabled=true;try{await apiRequest(`/api/collect/v2/admin/reports/${report.id}/resolve`,{method:'POST',body:{}});await loadSocialReports();}catch(e){row.append(document.createTextNode(e.message));button.disabled=false;}};row.append(button);node.append(row);}if(!reports.length){const p=document.createElement('p');p.textContent='Aucun signalement social en attente.';node.append(p);}
  }catch{/* The V2 remains entirely hidden when disabled or unauthorized. */}
}
let collectReportsRequest=0;
async function loadCollectReports(){
  loadSocialReports();
  const requestId=++collectReportsRequest;
  const rows=document.getElementById('collect-report-rows');
  const message=document.getElementById('collect-report-message');
  if(!rows||!message)return;
  rows.replaceChildren();message.textContent='Chargement des signalements…';
  try{
    const payload=await apiRequest('/api/editor/collect/reports');
    if(requestId!==collectReportsRequest)return;
    const reports=Array.isArray(payload.reports)?payload.reports:[];
    if(!reports.length){const row=document.createElement('tr');const cell=document.createElement('td');cell.colSpan=5;cell.textContent='Aucun signalement en attente.';row.append(cell);rows.append(row);message.textContent='';return;}
    for(const report of reports){
      const row=document.createElement('tr');
      const prefix={street:'R',district:'Q',monument:'M',bus:'B'}[report.family]||'';
      const number=`${prefix}-${String(report.collection_number).padStart(report.family==='street'?4:3,'0')}`;
      const values=[`${number} · ${report.name}`,({image:'Image',description:'Description',question:'Question / réponses'})[report.content_type],String(report.report_count),new Date(report.last_reported_at).toLocaleString('fr-FR')];
      for(const value of values){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
      const action=document.createElement('td');
      const open=document.createElement('button');open.type='button';open.className='btn';open.textContent='Voir la carte';
      open.addEventListener('click',()=>{document.getElementById('collect-admin-search').value=report.name;document.getElementById('collect-admin-family').value=report.family;document.getElementById('collect-admin-status').value='';document.getElementById('collect-admin-rarity').value='';collectAdminPage=1;loadCollectAdmin();document.getElementById('collect-admin-card').scrollIntoView({behavior:'smooth',block:'start'});});
      const resolve=document.createElement('button');resolve.type='button';resolve.className='btn';resolve.textContent='Marquer traité';
      resolve.addEventListener('click',async()=>{resolve.disabled=true;try{await apiRequest(`/api/editor/collect/reports/${report.card_id}/${report.content_type}/resolve`,{method:'PATCH'});await loadCollectReports();}catch(error){message.textContent=error.message;resolve.disabled=false;}});
      const edit=document.createElement('button');edit.type='button';edit.className='btn';edit.textContent=report.content_type==='question'?'Vérifier les questions':'Corriger le contenu';edit.addEventListener('click',async()=>{try{const payload=await apiRequest(`/api/editor/collect/cards?search=${encodeURIComponent(report.name)}&family=${report.family}`);const card=payload.cards.find(c=>Number(c.id)===Number(report.card_id));if(!card)throw Error('Carte introuvable');if(report.content_type==='question')openFragments(card);else openContent(card,report.content_type);}catch(error){message.textContent=error.message;}});
      action.append(open,edit,resolve);row.append(action);rows.append(row);
    }
    message.textContent=`${reports.length} signalement${reports.length>1?'s':''} à vérifier.`;
  }catch(error){if(requestId===collectReportsRequest){rows.replaceChildren();message.textContent=`Impossible de charger les signalements : ${error.message}`;}}
}
document.getElementById('collect-report-refresh')?.addEventListener('click',loadCollectReports);
document.getElementById('collect-admin-quality').addEventListener('change',()=>{collectAdminPage=1;loadCollectAdmin();});
document.getElementById('collect-admin-refresh').addEventListener('click', () => { collectAdminPage = 1; loadCollectAdmin(); });
for (const id of ['collect-admin-family', 'collect-admin-status', 'collect-admin-rarity']) document.getElementById(id).addEventListener('change', () => { collectAdminPage = 1; loadCollectAdmin(); });
document.getElementById('collect-admin-search').addEventListener('keydown', event => { if (event.key === 'Enter') { collectAdminPage = 1; loadCollectAdmin(); } });
document.getElementById('collect-admin-prev').addEventListener('click', () => { collectAdminPage = Math.max(1, collectAdminPage - 1); loadCollectAdmin(); });
document.getElementById('collect-admin-next').addEventListener('click', () => { collectAdminPage += 1; loadCollectAdmin(); });
document.querySelectorAll('.collect-admin-sort').forEach(button=>button.addEventListener('click',()=>{
  if(collectAdminSort===button.dataset.sort)collectAdminOrder=collectAdminOrder==='asc'?'desc':'asc';
  else{collectAdminSort=button.dataset.sort;collectAdminOrder='asc';}
  collectAdminPage=1;loadCollectAdmin();
}));
for(const id of ['collect-admin-mobile-sort','collect-admin-mobile-order']) document.getElementById(id).addEventListener('change',()=>{
  collectAdminSort=document.getElementById('collect-admin-mobile-sort').value;
  collectAdminOrder=document.getElementById('collect-admin-mobile-order').value;
  collectAdminPage=1;loadCollectAdmin();
});

let contentReportType=null;
let contentCard=null;
const contentEditor=document.getElementById('collect-content-editor');
const contentMessage=document.getElementById('collect-content-message');
function previewContent(){
  const value=document.getElementById('collect-content-image').value.trim();
  const image=document.getElementById('collect-content-preview');
  contentMessage.textContent='';
  if(/^https?:\/\//.test(value)||/^\/(?!\/)/.test(value)){image.src=value;image.hidden=false;}else{image.hidden=true;image.removeAttribute('src');}
}
function openContent(card,reportType=null){
  contentReportType=reportType;
  document.getElementById("collect-content-resolve").checked=Boolean(reportType);
  document.getElementById("collect-content-resolve").disabled=!reportType;
  document.getElementById("collect-content-verified").value="";
  document.getElementById("collect-content-verification-source").value="";
  const history=document.getElementById("collect-content-history");history.textContent="Chargement…";
  apiRequest(`/api/editor/collect/cards/${card.id}/corrections`).then(payload=>{if(Number(contentCard?.id)!==Number(card.id))return;history.replaceChildren();for(const row of payload.corrections){const p=document.createElement("p");p.textContent=`${new Date(row.corrected_at).toLocaleString("fr-FR")} · ${row.verified_entity||"correction de contenu"}${row.verification_source?" · "+row.verification_source:""}`;history.append(p);const changes=document.createElement("details");const label=document.createElement("summary");label.textContent="Voir le contenu avant et après";changes.append(label);for(const [title,value] of [["Avant",row.before_json],["Après",row.after_json]]){const text=document.createElement("pre");text.textContent=title+"\n"+JSON.stringify(value,null,2);changes.append(text);}history.append(changes);}if(!payload.corrections.length)history.textContent="Aucune correction enregistrée.";}).catch(()=>{history.textContent="Historique indisponible.";});
  if(!contentEditor)return;
  contentCard=card;
  document.getElementById('collect-content-title').textContent=`Illustration et description · ${card.name}`;
  document.getElementById('collect-content-image').value=card.image_reference||'';
  document.getElementById('collect-content-credit').value=card.image_credit_override||'';
  document.getElementById('collect-content-description').value=card.description||'';
  document.getElementById('collect-content-description-full').value=card.description_full_override??card.description_full??'';
  contentMessage.textContent='';previewContent();contentEditor.classList.remove('hidden');contentEditor.scrollIntoView({behavior:'smooth',block:'start'});
}
async function saveContent(reset=false){
  const button=document.querySelector('#collect-content-form button[type="submit"]'),resetButton=document.getElementById('collect-content-reset');
  button.disabled=true;resetButton.disabled=true;
  try{
    const body=reset?{image:null,description:null,descriptionFull:null,credit:null}:{image:document.getElementById('collect-content-image').value===contentCard.image_reference?(contentCard.image_override??null):document.getElementById('collect-content-image').value,description:document.getElementById('collect-content-description').value===contentCard.description?(contentCard.description_override??null):document.getElementById('collect-content-description').value,descriptionFull:document.getElementById('collect-content-description-full').value===(contentCard.description_full_override??contentCard.description_full??'')?(contentCard.description_full_override??null):document.getElementById('collect-content-description-full').value,credit:document.getElementById('collect-content-credit').value};
    if(!reset){body.verifiedEntity=document.getElementById('collect-content-verified').value.trim()||null;body.verificationSource=document.getElementById('collect-content-verification-source').value.trim()||null;body.resolveType=document.getElementById('collect-content-resolve').checked?contentReportType:null;}
    const {card}=await apiRequest(`/api/editor/collect/cards/${contentCard.id}/content`,{method:'PUT',body});
    await loadCollectReports();
    openContent(card);contentMessage.textContent=reset?'Contenu automatique rétabli.':'Illustration et description enregistrées.';await loadCollectAdmin();
  }catch(error){contentMessage.textContent=error.message;}finally{button.disabled=false;resetButton.disabled=false;}
}
if(contentEditor){
  document.getElementById('collect-content-form').addEventListener('submit',event=>{event.preventDefault();saveContent();});
  document.getElementById('collect-content-image').addEventListener('input',previewContent);
  document.getElementById('collect-content-preview').addEventListener('error',()=>{contentMessage.textContent='L’image ne peut pas être affichée. Vérifie son adresse.';});
  document.getElementById('collect-content-reset').addEventListener('click',()=>saveContent(true));
  document.getElementById('collect-content-close').addEventListener('click',()=>contentEditor.classList.add('hidden'));
}

let fragmentCard = null;
let questions = [];
const editor=document.getElementById('collect-fragment-editor');
const fragmentMessage=document.getElementById('collect-fragment-message');
async function openFragments(card) {
  if (!editor) return;
  try {
    const payload=await apiRequest(`/api/editor/collect/cards/${card.id}/fragments`);
    fragmentCard=card; questions=payload.questions;
    document.getElementById('collect-fragment-title').textContent=`Fragments · ${card.name}`;
    document.getElementById('collect-fragment-enabled').checked=payload.fragments_enabled;
    document.getElementById('collect-fragment-required').value=payload.fragments_enabled ? payload.fragments_required : 2;
    document.getElementById('collect-fragment-required').disabled=!payload.fragments_enabled;
    fragmentMessage.textContent=''; renderQuestions(); editor.classList.remove('hidden');
    editor.scrollIntoView({behavior:'smooth',block:'start'});
  } catch(error) {document.getElementById('collect-admin-message').textContent=error.message;}
}
function readQuestions() {
  return [...document.querySelectorAll('.collect-question-editor')].map((section,index)=>({
    ...questions[index], theme:section.querySelector('[data-field="theme"]').value,
    text:section.querySelector('[data-field="text"]').value,
    answers:[...section.querySelectorAll('[data-answer]')].map(input=>input.value),
    correct_index:Number(section.querySelector('[data-field="correct_index"]').value),
    explanation:section.querySelector('[data-field="explanation"]').value,
    sources:section.querySelector('[data-field="sources"]').value.split(/\n/).map(s=>s.trim()).filter(Boolean),
  }));
}
function renderQuestions() {
  const container=document.getElementById('collect-fragment-questions'); container.replaceChildren();
  questions.forEach((q,index)=>{
    const section=document.createElement('fieldset'); section.className='collect-question-editor';
    const legend=document.createElement('legend'); legend.textContent=`Question ${index+1}`; section.append(legend);
    function field(labelText,fieldName,value,limit,textarea=false) {
      const label=document.createElement('label'); label.textContent=labelText;
      const input=document.createElement(textarea?'textarea':'input'); input.dataset.field=fieldName; input.value=value || ''; input.required=true; input.maxLength=limit;
      label.append(input); section.append(label); return input;
    }
    const theme=field('Thème','theme',q.theme,100); theme.setAttribute('list','collect-question-themes');
    field('Question : laquelle de ces affirmations est vraie ?','text',q.text,1000,true);
    for(let answer=0;answer<4;answer++) {const input=field(`Réponse ${answer+1}`,`answer${answer}`,q.answers[answer],500); input.dataset.answer=answer;}
    const label=document.createElement('label'); label.textContent='Bonne réponse';
    const select=document.createElement('select'); select.dataset.field='correct_index';
    for(let answer=0;answer<4;answer++){const option=document.createElement('option'); option.value=answer; option.textContent=`Réponse ${answer+1}`; select.append(option);}
    select.value=q.correct_index; label.append(select);section.append(label);
    field('Courte explication après réponse','explanation',q.explanation,2000,true);
    field('Sources HTTPS, une par ligne','sources',(q.sources||[]).join('\n'),12000,true).required=false;
    const actions=document.createElement('div');actions.className='button-row';
    for(const [text,move] of [['Monter',-1],['Descendre',1],['Supprimer',0]]) {
      const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=text;
      button.disabled=move===-1 && index===0 || move===1 && index===questions.length-1;
      button.addEventListener('click',()=>{questions=readQuestions();if(move){[questions[index],questions[index+move]]=[questions[index+move],questions[index]];}else questions.splice(index,1); renderQuestions();});
      actions.append(button);
    }
    section.append(actions);container.append(section);
  });
}
if(editor) {
  document.getElementById('collect-fragment-enabled').addEventListener('change',event=>{document.getElementById('collect-fragment-required').disabled=!event.target.checked;});
  const themes=document.createElement('datalist'); themes.id='collect-question-themes';
  for(const theme of ['Origine / nom','Histoire','Patrimoine','Culture / anecdote']){const option=document.createElement('option'); option.value=theme; themes.append(option);} editor.append(themes);
  document.getElementById('collect-fragment-add').addEventListener('click',()=>{questions=readQuestions();questions.push({theme:'Origine / nom',text:'Laquelle de ces affirmations est vraie ?',answers:['','','',''],correct_index:0,explanation:''});renderQuestions();});
  document.getElementById('collect-fragment-close').addEventListener('click',()=>editor.classList.add('hidden'));
  document.getElementById('collect-fragment-form').addEventListener('submit',async event=>{
    event.preventDefault(); const button=event.submitter; button.disabled=true;
    try {
      const payload=await apiRequest(`/api/editor/collect/cards/${fragmentCard.id}/fragments`,{method:'PUT',body:{enabled:document.getElementById('collect-fragment-enabled').checked,required:document.getElementById('collect-fragment-enabled').checked ? Number(document.getElementById('collect-fragment-required').value) : 0,questions:readQuestions()}});
      questions=payload.questions;renderQuestions();fragmentMessage.textContent='Configuration enregistrée.';await loadCollectAdmin();
    }catch(error){fragmentMessage.textContent=error.message;}finally{button.disabled=false;}
  });
}

return { loadCollectAdmin, loadCollectReports };
};
