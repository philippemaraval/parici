const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function initPersonalAlbums(request, renderCard, targetButton = () => "", refreshGoal = async () => {}) {
  const root = document.getElementById("collect-personal-albums");
  if (!root) return { load: async () => {} };
  root.innerHTML = `<h2>Mes albums personnels</h2><p>Rassemble les lieux que tu veux collectionner. Ces albums sont privés.</p><form id="personal-album-create" class="personal-album-create"><label>Nom de l’album <input name="name" maxlength="60" required placeholder="Mes lieux préférés"></label><button class="btn-primary" type="submit">Créer un album</button></form><p id="personal-album-status" role="status"></p><div id="personal-album-list" class="collect-album-grid"></div><section id="personal-album-view" hidden><div class="personal-album-heading"><h3 id="personal-album-title"></h3><button id="personal-album-close" class="btn-secondary" type="button">Fermer</button></div><div class="personal-album-actions"><button id="personal-album-add" class="btn-primary" type="button">Ajouter des cartes</button><button id="personal-album-delete" class="btn-tertiary" type="button">Supprimer l’album</button></div><div id="personal-album-target" class="collect-album-target-actions"></div><section id="personal-album-picker" hidden><form id="personal-album-search"><label>Rechercher <input name="search" maxlength="100" placeholder="Nom d’un lieu"></label><label>Famille <select name="family"><option value="">Toutes</option><option value="street">Rues</option><option value="district">Quartiers</option><option value="monument">Monuments</option><option value="bus">Bus</option></select></label><button class="btn-secondary" type="submit">Rechercher</button></form><div id="personal-album-options"></div><button id="personal-album-save" class="btn-primary" type="button" disabled>Ajouter les cartes sélectionnées</button><button id="personal-album-cancel" class="btn-secondary" type="button">Annuler</button></section><div id="personal-album-cards" class="collect-grid"></div><div class="collect-pagination"><button id="personal-album-prev" class="btn-secondary" type="button">Précédent</button><span id="personal-album-page"></span><button id="personal-album-next" class="btn-secondary" type="button">Suivant</button></div></section>`;
  const node = id => document.getElementById("personal-album-" + id);
  let active = null, page = 1, total = 0, picking = false, generation = 0;
  const selection = new Set();
  const status = message => { node("status").textContent = message; };
  const action = callback => async event => { event?.preventDefault(); try { await callback(event); } catch (error) { status(error.message); } };
  async function load() {
    try {
      await refreshGoal();
      const { albums } = await request("/api/collect/personal-albums");
      node("list").innerHTML = albums.length ? albums.map(a => `<article class="collect-album"><button type="button" class="collect-album-open" data-personal-album="${escape(a.id)}"><strong>${escape(a.name)}</strong><span>${a.owned}/${a.total} cartes possédées</span>${a.earned!==undefined?`<small>${a.earned}/${a.total} gagnées personnellement</small>`:""}<small>Ouvrir mon album →</small></button></article>`).join("") : '<p class="personal-album-empty">Crée ton premier album pour choisir les lieux que tu veux réunir.</p>';
    } catch (error) { status(error.message); }
  }
  async function render() {
    const current = ++generation;
    const query = new URLSearchParams({ page: String(page) });
    if (picking) for (const [key, value] of new FormData(node("search"))) query.set(key, value);
    const payload = await request(`/api/collect/personal-albums/${active}/${picking ? "catalog" : "cards"}?${query}`);
    if (current !== generation) return;
    total = payload.total;
    const albums = await request("/api/collect/personal-albums");
    if (current !== generation) return;
    const album = albums.albums.find(a => String(a.id) === String(active));
    node("target").innerHTML = album ? targetButton(album) : "";
    node("title").textContent = payload.album.name;
    node("picker").hidden = !picking;
    node("cards").hidden = picking;
    if (picking) {
      node("options").innerHTML = payload.cards.map(card => `<label class="personal-album-option"><input type="checkbox" value="${card.id}" ${card.selected ? "disabled checked" : selection.has(String(card.id)) ? "checked" : ""}><span><strong>${escape(card.family === "bus" ? "Ligne " + card.name : card.name)}</strong><small>${card.selected ? "Déjà dans l’album" : card.owned ? "Carte obtenue" : "À collectionner"}</small></span></label>`).join("") || "<p>Aucun lieu trouvé.</p>";
    } else {
      node("cards").innerHTML = payload.cards.map(card => `<div class="personal-album-card">${renderCard({ ...card, copy_count: card.copy_count ?? (card.owned ? 1 : 0) })}<p>${card.owned ? "" : escape(card.family === "bus" ? "Ligne " + card.name : card.name)}</p><button class="btn-tertiary personal-album-remove" type="button" data-personal-remove="${card.id}" aria-label="Retirer ${escape(card.name)} de l’album">Retirer de l’album</button></div>`).join("") || "<p>Cet album est vide. Ajoute les cartes que tu veux collectionner.</p>";
    }
    node("page").textContent = `${total} cartes · ${page}/${Math.max(1, Math.ceil(total / 50))}`;
    node("prev").disabled = page <= 1;
    node("next").disabled = page * 50 >= total;
    node("view").hidden = false;
  }
  node("create").addEventListener("submit", action(async event => {
    const submit = event.submitter; submit.disabled = true;
    try {
      const album = await request("/api/collect/personal-albums", { method: "POST", body: JSON.stringify({ name: new FormData(event.target).get("name") }) });
      event.target.reset(); active = album.id; picking = false; page = 1; await load(); await render(); status("Album créé. Ajoute les cartes que tu veux réunir.");
    } finally { submit.disabled = false; }
  }));
  node("list").addEventListener("click", action(async event => {
    const button = event.target.closest("[data-personal-album]"); if (!button) return;
    active = button.dataset.personalAlbum; picking = false; page = 1; selection.clear(); await render();
  }));
  node("close").addEventListener("click", () => { generation++; node("view").hidden = true; });
  node("add").addEventListener("click", action(async () => { selection.clear(); picking = true; page = 1; node("save").disabled = true; await render(); }));
  node("cancel").addEventListener("click", action(async () => { picking = false; page = 1; await render(); }));
  node("search").addEventListener("submit", action(async () => { page = 1; await render(); }));
  node("options").addEventListener("change", event => { const input = event.target; if (input.checked) selection.add(input.value); else selection.delete(input.value); node("save").disabled = !selection.size || selection.size > 50; node("save").textContent = `Ajouter ${selection.size} carte${selection.size > 1 ? "s" : ""}`; if (selection.size > 50) status("Ajoute au maximum 50 cartes à la fois."); });
  node("save").addEventListener("click", action(async () => {
    node("save").disabled = true;
    try { await request(`/api/collect/personal-albums/${active}/cards`, { method: "POST", body: JSON.stringify({ cardIds: [...selection] }) }); selection.clear(); picking = false; page = 1; await load(); await render(); status("Cartes ajoutées à ton album."); } finally { node("save").disabled = !selection.size; }
  }));
  node("cards").addEventListener("click", action(async event => { const button = event.target.closest("[data-personal-remove]"); if (!button) return; await request(`/api/collect/personal-albums/${active}/cards/${button.dataset.personalRemove}`, { method: "DELETE" }); page = 1; await load(); await render(); }));
  node("delete").addEventListener("click", action(async () => { if (!confirm("Supprimer cet album personnel ? Tes cartes restent dans ta collection.")) return; await request(`/api/collect/personal-albums/${active}`, { method: "DELETE" }); generation++; node("view").hidden = true; await load(); status("Album supprimé."); }));
  node("prev").addEventListener("click", action(async () => { page = Math.max(1, page - 1); await render(); }));
  node("next").addEventListener("click", action(async () => { page++; await render(); }));
  return { load };
}
