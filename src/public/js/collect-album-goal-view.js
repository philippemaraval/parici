const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function initAlbumGoal(request) {
  let goal = null, generation = 0, busy = false;
  const status = document.getElementById("collect-goal-status");
  const explanation = "Les cartes manquantes de cet album sont favorisées dans 20 % des tirages, lorsqu’il en existe dans la rareté tirée.";
  function render() {
    const text = goal ? `Album ciblé : ${goal.name} · ${goal.owned_active_card_count}/${goal.active_card_count}` : "Aucun album ciblé";
    document.getElementById("collect-target-summary").hidden = !goal;
    document.getElementById("collect-target-name").textContent = text;
    document.getElementById("collect-target-explanation").textContent = explanation;
    document.getElementById("collect-target-remove").disabled = busy;
    for (const id of ["collect-album-goal", "collect-play-album-goal"]) {
      const node = document.getElementById(id);
      node.textContent = goal ? `${text} · encore ${goal.remaining} carte${goal.remaining > 1 ? "s" : ""}.` : "";
    }
    document.querySelectorAll("[data-target-album]").forEach((button) => {
      const selected = button.dataset.targetAlbum === goal?.slug;
      const complete = Number(button.dataset.targetTotal) <= Number(button.dataset.targetOwned);
      button.textContent = selected ? "Album ciblé" : complete ? "Album complet" : "Compléter cet album";
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = busy || complete;
    });
  }
  async function refresh() {
    if (busy) return;
    const current = ++generation;
    try {
      const payload = await request("/api/collect/goal");
      if (current !== generation) return;
      const previous = goal;
      goal = payload.goal;
      if (previous && !goal) status.textContent = "L’objectif a été retiré automatiquement : cet album est terminé ou n’est plus disponible.";
      render();
    } catch { /* A temporary refresh failure keeps the last confirmed target. */ }
  }
  async function select(slug) {
    if (busy) return;
    busy = true;
    ++generation;
    render();
    status.textContent = "Enregistrement de l’objectif…";
    try {
      const payload = await request("/api/collect/goal", { method: "PUT", body: JSON.stringify({ slug }) });
      goal = payload.goal;
      status.textContent = goal ? `${goal.name} est maintenant l’album ciblé. ${explanation}` : "Objectif retiré. Les tirages habituels reprennent.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      render();
    }
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-target-album]");
    if (button && !button.disabled) void select(button.dataset.targetAlbum === goal?.slug ? "" : button.dataset.targetAlbum);
  });
  document.getElementById("collect-target-remove").addEventListener("click", () => select(""));
  function buttonMarkup(album) {
    const slug = album.slug || `personal-${album.id}`;
    const total = Number(album.active_card_count ?? album.total);
    const owned = Number(album.owned_active_card_count ?? album.owned);
    const selected = slug === goal?.slug;
    return `<button type="button" class="btn-secondary collect-target-button" data-target-album="${escape(slug)}" data-target-total="${total}" data-target-owned="${owned}" aria-pressed="${selected}" ${busy || total <= owned ? "disabled" : ""}>${selected ? "Album ciblé" : total <= owned ? "Album complet" : "Compléter cet album"}</button>`;
  }
  return { refresh, render, buttonMarkup };
}
