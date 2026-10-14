const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const rarity = ["", "Commune", "Peu commune", "Rare", "Épique", "Légendaire"];
const date = (v) => new Date(v).toLocaleString("fr-FR");
const label = (c) => (c.family === "bus" ? `Ligne ${c.name}` : c.name);
const origin = (c) =>
  `${c.source === "daily" ? "Daily " + (c.dailyAttemptCount ?? c.daily_attempt_count ?? c.dailyAttempts) + "/7 · " + (c.dailyDate ?? c.daily_date) : c.source === "weekly" ? "Collect · Défi hebdomadaire" : "Collect"} · #${c.id ?? c.copyId}`;
const states = {
  active: "Active",
  accepted: "Acceptée",
  refused: "Refusée",
  withdrawn: "Retirée",
  expired: "Expirée",
  invalid: "Plus disponible",
  countered: "Contre-proposée",
};
export async function initSocial({ request, refresh }) {
  const prefix = "/api/collect/v2";
  let config;
  try {
    config = await request(prefix + "/config");
  } catch {
    return null;
  }
  if (!config.enabled) return null;
  const me = await request(prefix + "/me"),
    user = String(me.userId);
  const panel = document.getElementById("collect-social-space");
  document.querySelector('[data-community-tab="social"]').hidden = false;
  const api = (path, options) => request(prefix + path, options);
  const send = (path, body, method = "POST") =>
    api(path, { method, body: JSON.stringify(body) });
  const dialog = document.createElement("dialog");
  dialog.className = "collect-social-dialog";
  document.body.append(dialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  let generation = 0,
    tab = ["friends", "offers", "market", "manage", "history"].includes(
      new URLSearchParams(location.search).get("tab"),
    )
      ? new URLSearchParams(location.search).get("tab")
      : "friends",
    marketPage = 1,
    managerPage = 1,
    managerFilter = "all";
  const status = document.createElement("p");
  status.className = "collect-social-status";
  status.setAttribute("role", "status");
  panel.innerHTML = `<h3>Amis et échanges</h3><p>Choisis un ami, sélectionne les cartes, puis envoie ta proposition.</p><nav class="collect-social-tabs" aria-label="Amis et échanges">${[
    ["friends", "Amis"],
    ["offers", "Propositions"],
    ["market", "Marché"],
    ["manage", "Mes exemplaires"],
    ["history", "Historique"],
  ]
    .map(
      ([v, n]) =>
        `<button class="btn-secondary" type="button" data-social-tab="${v}">${n}</button>`,
    )
    .join("")}</nav><div id="collect-social-content"></div>`;
  panel.insertBefore(status, panel.querySelector("#collect-social-content"));
  const content = panel.querySelector("#collect-social-content");
  function message(text) {
    status.textContent = text;
  }
  function action(fn) {
    return async (event) => {
      event?.preventDefault();
      const button = event?.target?.closest("button");
      if (button?.disabled) return;
      if (button) button.disabled = true;
      try {
        message("");
        await fn(event);
      } catch (e) {
        message(e.message);
      } finally {
        if (button?.isConnected) button.disabled = false;
      }
    };
  }
  function showModal(html) {
    dialog.innerHTML = `<button class="btn-secondary" type="button" data-social-close>Fermer</button><div role="status" class="collect-modal-status"></div>${html}`;
    dialog.querySelector("[data-social-close]").onclick = () => dialog.close();
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  }
  function modalAction(fn) {
    return async (event) => {
      event.preventDefault();
      const b = event.target.closest("button");
      if (b?.disabled) return;
      if (b) b.disabled = true;
      try {
        dialog.querySelector(".collect-modal-status").textContent = "";
        await fn(event);
      } catch (e) {
        dialog.querySelector(".collect-modal-status").textContent = e.message;
      } finally {
        if (b?.isConnected) b.disabled = false;
      }
    };
  }
  function profileLink(person) {
    if (person.visible === false) return `<span>${esc(person.username)}</span>`;
    return `<a href="/collect.html?profile=${encodeURIComponent(person.username)}">${esc(person.username)}</a>`;
  }
  async function friendView() {
    const [friends, activity, blocks] = await Promise.all([
      api("/friends"),
      api("/activity"),
      api("/blocks"),
    ]);
    content.innerHTML = `<form id="social-find"><label>Rechercher un joueur<input name="search" type="search" minlength="2" maxlength="100" required></label><button class="btn-primary">Rechercher</button></form><div id="social-results"></div><h3>Mes amis et demandes</h3><div class="collect-social-list">${friends.map((p) => `<article>${profileLink(p)}<p>${p.state === "accepted" ? "Amis" : p.outgoing ? "Demande envoyée" : "Demande reçue"}</p><div class="collect-social-actions">${p.state === "pending" && !p.outgoing ? `<button data-friend-accept="${p.id}" class="btn-primary">Accepter</button>` : ""}${p.state === "accepted" && p.visible ? `<button data-compose-person="${p.id}" data-person-name="${esc(p.username)}" class="btn-primary">Échanger</button><button data-person="${p.id}" data-person-name="${esc(p.username)}" class="btn-secondary">Collection</button>` : ""}<button data-friend-remove="${p.id}" class="btn-tertiary">${p.state === "accepted" ? "Retirer des amis" : p.outgoing ? "Annuler" : "Refuser"}</button><button data-block="${p.id}" class="btn-tertiary">Bloquer</button></div></article>`).join("") || "<p>Aucun ami pour le moment.</p>"}</div><h3>Activité des amis</h3><ul class="collect-social-activity">${activity.map((a) => `<li><a href="/collect.html?profile=${encodeURIComponent(a.username)}${a.kind === "legendary" ? "&card=" + encodeURIComponent(a.payload.cardId) : a.kind === "album" ? "&album=" + encodeURIComponent(a.albumSlug || "") : ""}">${esc(a.username)} · ${a.kind === "legendary" ? "Carte légendaire : " + esc(a.label) : a.kind === "album" ? "Album complété : " + esc(a.label) : a.kind === "badge" ? "Badge : " + esc(a.label) : a.payload.count + " cartes uniques"}</a><small>${date(a.created_at)}</small></li>`).join("") || "<li>Aucune nouvelle activité.</li>"}</ul>${blocks.length ? `<details><summary>Joueurs bloqués · ${blocks.length}</summary>${blocks.map((p) => `<p>${esc(p.username)} <button class="btn-tertiary" data-unblock="${p.id}">Débloquer</button></p>`).join("")}</details>` : ""}`;
    content.querySelector("#social-find").onsubmit = action(async (event) => {
      const q = new FormData(event.target).get("search");
      const results = await api("/users?search=" + encodeURIComponent(q));
      document.getElementById("social-results").innerHTML =
        results
          .map(
            (p) =>
              `<article>${profileLink(p)}<div class="collect-social-actions"><button data-friend-request="${p.id}" class="btn-secondary">Demander en ami</button><button data-person="${p.id}" data-person-name="${esc(p.username)}" class="btn-secondary">Voir la collection</button><button data-block="${p.id}" class="btn-tertiary">Bloquer</button><button data-report-player="${p.id}" class="btn-tertiary">Signaler</button></div></article>`,
          )
          .join("") || "<p>Aucun joueur trouvé.</p>";
    });
  }
  async function personView(target, name) {
    const person = await api("/players/" + encodeURIComponent(name));
    const [inventory, albums] = await Promise.all([
      api(`/inventory/${target}?filter=available`),
      api(`/albums/${target}`),
    ]);
    let match = { give: [], receive: [] };
    try {
      match = await api("/matching/" + target);
    } catch {
      /* Collection can remain readable when proposals are disabled. */
    }
    showModal(
      `<h2>${esc(name)}</h2><a href="/collect.html?profile=${encodeURIComponent(name)}">Ouvrir le profil</a><h3>Cartes disponibles</h3><button class="btn-secondary" id="social-person-wanted">Voir les cartes recherchées</button><div id="social-person-wanted-cards"></div><p>${inventory.total} cartes · ${inventory.cards.map((c) => esc(label(c))).join(", ") || "Aucune"}</p><h3>Cartes compatibles</h3><div class="collect-match"><section><h4>Tu pourrais proposer</h4>${match.give.map((c) => `<p>${esc(label(c))} ×${c.count}</p>`).join("") || "<p>Aucune correspondance.</p>"}</section><section><h4>Tu pourrais recevoir</h4>${match.receive.map((c) => `<p>${esc(label(c))} ×${c.count}</p>`).join("") || "<p>Aucune correspondance.</p>"}</section></div>${person.canPropose ? '<button class="btn-primary" id="social-person-compose">Composer un échange</button>' : "<p>Ce joueur ne reçoit pas tes propositions.</p>"}<h3>Albums</h3>${albums.map((a) => `<p>${esc(a.name)} : ${a.owned}/${a.total} possédées · ${a.earned}/${a.total} gagnées personnellement</p>`).join("")}<button class="btn-tertiary" data-report-player="${target}">Signaler le joueur</button>`,
    );
    let wantedPage = 1;
    const showWanted = async () => {
      const payload = await api(
        `/inventory/${target}?filter=wanted&page=${wantedPage}`,
      );
      const node = dialog.querySelector("#social-person-wanted-cards");
      node.innerHTML = `<h4>Priorités recherchées</h4>${payload.cards.map((c) => `<p>${esc(label(c))} · ${c.count ? "Déjà possédée" : "Manquante"}</p>`).join("") || "<p>Aucune priorité.</p>"}<div class="collect-social-actions"><button class="btn-secondary" data-wanted-prev>Précédent</button><span>Page ${wantedPage}</span><button class="btn-secondary" data-wanted-next>Suivant</button></div>`;
      node.querySelector("[data-wanted-prev]").disabled = wantedPage === 1;
      node.querySelector("[data-wanted-next]").disabled =
        wantedPage * 50 >= payload.total;
      node.querySelector("[data-wanted-prev]").onclick = action(async () => {
        wantedPage--;
        await showWanted();
      });
      node.querySelector("[data-wanted-next]").onclick = action(async () => {
        wantedPage++;
        await showWanted();
      });
    };
    dialog.querySelector("#social-person-wanted").onclick = action(showWanted);
    if (person.canPropose)
      dialog.querySelector("#social-person-compose").onclick = modalAction(() =>
        compose(target, name),
      );
  }
  async function offerView(market = false) {
    const filters = market
      ? new URLSearchParams(
          new FormData(
            content.querySelector("#social-market-search") ||
              document.createElement("form"),
          ),
        )
      : new URLSearchParams();
    filters.set("page", market ? marketPage : 1);
    const payload = await api((market ? "/market" : "/offers") + "?" + filters);
    const markup =
      payload.offers
        .map((o) => {
          const mine = String(o.maker_id) === user,
            other = mine ? o.receiver_name : o.maker_name;
          const side = (items) =>
            items
              .map((v) => {
                const c = o.cards.find(
                  (c) => String(c.id) === String(v.cardId),
                );
                return `${esc(c ? label(c) : "Carte #" + v.cardId)} ×${v.quantity}${c ? " · " + rarity[c.rarity] + (c.status === "archived" ? " · Archivée" : "") : ""}`;
              })
              .join("<br>");
          return `<article class="collect-offer" data-offer="${o.id}"><h3>${market ? esc(o.maker_name) : mine ? "À " + esc(other) : "De " + esc(other)}</h3><p>${states[o.state]} · expire le ${date(o.expires_at)}</p><div class="collect-match"><section><h4>${market ? "Proposées" : "L’auteur donne"}</h4><p>${side(o.offered_cards)}</p></section><section><h4>${market ? "Recherchées" : "L’auteur reçoit"}</h4><p>${
            market
              ? side(o.wanted_cards) || "Offre ouverte"
              : o.requested_ids
                  .map((v) => {
                    const c = o.copies.find((c) => String(c.id) === String(v));
                    return c
                      ? esc(label(c)) + " · " + esc(origin(c))
                      : "Exemplaire indisponible";
                  })
                  .join("<br>")
          }</p></section></div>${o.kind === "direct" ? `<details><summary>Exemplaires précis</summary>${o.copies.map((c) => `<p>${esc(label(c))} · ${esc(origin(c))}</p>`).join("")}</details>` : ""}${o.lastCopies?.length ? `<p class="collect-last-copy-warning">Dernier exemplaire : ${o.lastCopies.map((c) => esc(label(c))).join(", ")}. La carte disparaîtra de la collection du joueur qui la cède et son classement pourra baisser.</p>` : ""}<div class="collect-social-actions">${o.state === "active" ? (mine ? `<button class="btn-tertiary" data-offer-withdraw="${o.id}">Retirer</button>` : market ? `<button class="btn-primary" data-market-respond="${o.id}" data-exact="true">${o.wanted_cards.length ? "Accepter l’offre précise" : "Faire une offre"}</button>${o.wanted_cards.length ? `<button class="btn-secondary" data-market-respond="${o.id}">Contre-proposer</button>` : ""}` : `<button class="btn-primary" data-offer-accept="${o.id}">Examiner et accepter</button><button class="btn-secondary" data-offer-counter="${o.id}">Contre-proposer</button><button class="btn-tertiary" data-offer-refuse="${o.id}">Refuser</button>`) : ""}${!mine ? `<button class="btn-tertiary" data-report-player="${o.maker_id}" data-report-offer="${o.id}">Signaler</button>` : ""}</div></article>`;
        })
        .join("") || "<p>Aucune offre.</p>";
    if (!market) {
      content.innerHTML = `<h3>Propositions directes</h3><p>25 propositions actives maximum · expiration après 7 jours.</p><div class="collect-social-list">${markup}</div>`;
    } else {
      if (!content.querySelector("#social-market-search"))
        content.innerHTML = `<h3>Marché de troc</h3><p>25 annonces actives maximum, indépendantes des propositions directes.</p><button class="btn-primary" id="social-create-listing">Publier une annonce</button><form id="social-market-search" class="collect-social-filters"><label>Carte proposée<input name="offered" type="search" maxlength="100"></label><label>Carte recherchée<input name="wanted" type="search" maxlength="100"></label><label>Famille<select name="family"><option value="">Toutes</option><option value="street">Rues</option><option value="district">Quartiers</option><option value="monument">Monuments</option><option value="bus">Bus</option></select></label><label>Rareté<select name="rarity"><option value="0">Toutes</option>${rarity
          .slice(1)
          .map((n, i) => `<option value="${i + 1}">${n}</option>`)
          .join(
            "",
          )}</select></label><button class="btn-secondary">Rechercher</button></form><div id="social-market-list"></div><div class="collect-social-actions"><button class="btn-secondary" id="social-market-prev">Précédent</button><span id="social-market-page"></span><button class="btn-secondary" id="social-market-next">Suivant</button></div>`;
      content.querySelector("#social-market-list").innerHTML = markup;
      content.querySelector("#social-market-page").textContent =
        `Page ${marketPage}`;
      content.querySelector("#social-market-prev").disabled = marketPage <= 1;
      content.querySelector("#social-market-next").disabled =
        payload.offers.length < 50;
      content.querySelector("#social-market-search").onsubmit = action(
        async () => {
          marketPage = 1;
          await offerView(true);
        },
      );
      content.querySelector("#social-create-listing").onclick = action(() =>
        compose(null, ""),
      );
      content.querySelector("#social-market-prev").onclick = action(
        async () => {
          marketPage--;
          await offerView(true);
        },
      );
      content.querySelector("#social-market-next").onclick = action(
        async () => {
          marketPage++;
          await offerView(true);
        },
      );
    }
    content._offers = payload.offers;
  }
  async function confirmation(offerId) {
    const payload = await api("/offers"),
      o = payload.offers.find((o) => o.id === offerId);
    if (!o || o.state !== "active")
      throw new Error("Cette offre n’est plus disponible.");
    const list = (copyIds) =>
      copyIds
        .map((id) => {
          const c = o.copies.find((c) => String(c.id) === String(id));
          return `<li>${esc(c ? label(c) : "Exemplaire indisponible")} · ${esc(origin(c || { id }))}</li>`;
        })
        .join("");
    showModal(
      `<h2>Confirmer l’échange</h2><div class="collect-match"><section><h3>Tu donnes</h3><ul>${list(o.requested_ids)}</ul></section><section><h3>Tu reçois</h3><ul>${list(o.offered_ids)}</ul></section></div>${o.lastCopies?.length ? `<p class="collect-last-copy-warning">Dernier exemplaire : ${o.lastCopies.map((c) => esc(label(c))).join(", ")}. Ces cartes disparaîtront de la collection du joueur qui les cède ; son classement peut baisser.</p>` : ""}<p>L’échange confirmé est définitif et irréversible.</p><button class="btn-primary" id="social-confirm-trade">Confirmer définitivement l’échange</button>`,
    );
    dialog.querySelector("#social-confirm-trade").onclick = modalAction(
      async () => {
        await send(`/offers/${offerId}/accept`, { confirmed: true });
        dialog.close();
        await refresh();
        await render();
        message("Échange effectué.");
      },
    );
  }
  async function compose(
    target,
    name,
    parent = null,
    exact = false,
    cardId = null,
  ) {
    const market = !target,
      selected = { give: new Map(), receive: new Map() },
      pages = { give: 1, receive: 1 },
      wanted = new Map(),
      requestId = crypto.randomUUID();
    showModal(
      `<h2>${market ? "Créer une annonce" : parent ? "Composer une réponse" : "Proposer un échange à " + esc(name)}</h2><p>1. Choisis les cartes de chaque côté. 2. Vérifie le récapitulatif. 3. Envoie la proposition.</p>${parent?.wanted_cards?.length ? `<p>${exact ? "Offre précise : respecte les cartes et quantités recherchées." : "Contre-proposition : les quantités sont libres."}</p>` : ""}<nav class="collect-composer-sides" aria-label="Étapes de l’échange"><button type="button" class="btn-secondary" data-compose-side="give" aria-pressed="true">1 · Je donne</button><button type="button" class="btn-secondary" data-compose-side="receive" aria-pressed="false">2 · ${market?"Je recherche":"Je reçois"}</button></nav><div class="collect-match collect-composer" data-side="give">${[
        ["give", "Tu proposes"],
        [
          "receive",
          market ? "Cartes recherchées (facultatif)" : "Tu souhaites recevoir",
        ],
      ]
        .map(
          ([side, title]) =>
            `<section data-compose-section="${side}"><h3>${title}</h3><form data-picker-search="${side}"><label>Rechercher une carte<input name="search" type="search" maxlength="100"></label><button class="btn-secondary">Rechercher</button></form><div data-picker-list="${side}"></div><div class="collect-social-actions"><button class="btn-secondary" data-picker-prev="${side}">Précédent</button><span data-picker-page="${side}"></span><button class="btn-secondary" data-picker-next="${side}">Suivant</button></div></section>`,
        )
        .join(
          "",
        )}</div><div class="collect-composer-footer"><div id="social-composer-summary" aria-live="polite"></div><button class="btn-primary" id="social-send-offer">Examiner la proposition</button></div><div id="social-offer-review"></div>`,
    );
    dialog.querySelectorAll('[data-compose-side]').forEach(button => {
      button.onclick = () => {
        dialog.querySelector('.collect-composer').dataset.side = button.dataset.composeSide;
        dialog.querySelectorAll('[data-compose-side]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
      };
    });
    async function picker(side) {
      const owner = side === "give" || market ? user : target;
      const form = dialog.querySelector(`[data-picker-search="${side}"]`),
        query = new URLSearchParams(new FormData(form));
      query.set("page", pages[side]);
      if (!market || side === "give") query.set("filter", "owned");
      if (cardId && side === "receive") query.set("cardId", cardId);
      const payload = await api(`/inventory/${owner}?${query}`),
        node = dialog.querySelector(`[data-picker-list="${side}"]`);
      node.innerHTML =
        payload.cards
          .filter((c) => (market && side === "receive") || c.count > 0)
          .map(
            (c) =>
              `<fieldset class="collect-copy-picker"><legend>${esc(label(c))} · ${rarity[c.rarity]}${c.status === "archived" ? " · Archivée" : ""}</legend>${market && side === "receive" ? `<label>Quantité souhaitée<input type="number" min="0" max="10000" value="${wanted.get(String(c.id))?.quantity || 0}" data-wanted-card="${c.id}" data-wanted-name="${esc(label(c))}"></label>` : `<label class="collect-pick-quantity">Quantité à échanger<input type="number" min="0" max="${c.copies.filter(cp=>!cp.locked && !c.locked).length}" value="${c.copies.filter(cp=>selected[side].has(String(cp.id))).length}" data-pick-card="${c.id}" aria-label="Quantité : ${esc(label(c))}"></label><details><summary>Choisir les exemplaires précis</summary>${c.copies.map((copy) => `<label><input type="checkbox" data-pick-side="${side}" data-copy="${copy.id}" ${selected[side].has(String(copy.id)) ? "checked" : ""} ${copy.locked || c.locked ? "disabled" : ""}><span>${esc(origin(copy))}${copy.locked || c.locked ? " · Verrouillé" : ""}</span></label>`).join("")}</details>`}</fieldset>`,
          )
          .join("") || "<p>Aucun exemplaire sur cette page.</p>";
      node._cards = payload.cards;
      dialog.querySelector(`[data-picker-page="${side}"]`).textContent =
        `${pages[side]} / ${Math.max(1, Math.ceil(payload.total / 50))}`;
      dialog.querySelector(`[data-picker-prev="${side}"]`).disabled =
        pages[side] <= 1;
      dialog.querySelector(`[data-picker-next="${side}"]`).disabled =
        pages[side] * 50 >= payload.total;
    }
    function selectionLabel(items) {
      const counts = new Map();
      for (const c of items.values()) counts.set(c.name, (counts.get(c.name) || 0) + 1);
      const names = [...counts].slice(0, 4).map(([name, count]) => `${name} ×${count}`);
      if (counts.size > 4) names.push(`et ${counts.size - 4} autres cartes`);
      return names.join(", ") || "aucune carte";
    }
    function summary() {
      dialog.querySelector("#social-send-offer").disabled = !selected.give.size || (!market && !selected.receive.size);
      dialog.querySelector("#social-composer-summary").textContent =
        `${selected.give.size} proposés : ${selectionLabel(selected.give)} · ${market ? [...wanted.values()].reduce((n, v) => n + v.quantity, 0) + " recherchés" : selected.receive.size + " à recevoir : " + selectionLabel(selected.receive)}`;
      dialog.querySelector("#social-offer-review").innerHTML = "";
    }
    for (const side of ["give", "receive"]) {
      dialog.querySelector(`[data-picker-search="${side}"]`).onsubmit =
        modalAction(async () => {
          pages[side] = 1;
          await picker(side);
        });
      dialog.querySelector(`[data-picker-prev="${side}"]`).onclick =
        modalAction(async () => {
          pages[side]--;
          await picker(side);
        });
      dialog.querySelector(`[data-picker-next="${side}"]`).onclick =
        modalAction(async () => {
          pages[side]++;
          await picker(side);
        });
      dialog.querySelector(`[data-picker-list="${side}"]`).onchange = (
        event,
      ) => {
        const input = event.target,
          cards = event.currentTarget._cards;
        if (input.dataset.pickCard) {
          const card = cards.find(c=>String(c.id) === input.dataset.pickCard);
          const available = card.copies.filter(cp=>!cp.locked && !card.locked);
          const quantity = Math.max(0, Math.min(available.length, Math.floor(Number(input.value)||0)));
          card.copies.forEach(cp=>selected[side].delete(String(cp.id)));
          available.slice(0,quantity).forEach(cp=>selected[side].set(String(cp.id), {...cp,name:label(card),cardId:String(card.id),owned:card.count}));
          input.value = quantity;
          event.currentTarget.querySelectorAll("[data-copy]").forEach(box=>box.checked=selected[side].has(box.dataset.copy));
        }
        if (input.dataset.wantedCard) {
          const value = Number(input.value);
          if (value > 0 && value <= 10000) {
            wanted.set(input.dataset.wantedCard, {
              cardId: input.dataset.wantedCard,
              quantity: value,
              name: input.dataset.wantedName,
            });
          } else wanted.delete(input.dataset.wantedCard);
        }
        if (input.dataset.copy) {
          const card = cards.find((c) =>
              c.copies.some((cp) => String(cp.id) === input.dataset.copy),
            ),
            copy = card.copies.find(
              (cp) => String(cp.id) === input.dataset.copy,
            );
          if (input.checked)
            selected[side].set(input.dataset.copy, {
              ...copy,
              name: label(card),
              cardId: String(card.id),
              owned: card.count,
            });
          else selected[side].delete(input.dataset.copy);
        }
        if(input.dataset.copy) {
          const card = cards.find(c=>c.copies.some(cp=>String(cp.id)===input.dataset.copy));
          const quantity = event.currentTarget.querySelector(`[data-pick-card="${card.id}"]`);
          quantity.value = card.copies.filter(cp=>selected[side].has(String(cp.id))).length;
        }
        summary();
      };
    }
    dialog.querySelector("#social-send-offer").onclick = modalAction(
      async () => {
        if (!selected.give.size || (!market && !selected.receive.size))
          throw new Error("Chaque joueur doit donner au moins un exemplaire.");
        const rows = (map) =>
          [...map.values()]
            .map((c) => `<li>${esc(label(c))} · ${esc(origin(c))}</li>`)
            .join("");
        const last = [];
        for (const side of ["give", "receive"]) {
          const counts = new Map();
          for (const c of selected[side].values()) {
            const x = counts.get(c.cardId) || {
              name: c.name,
              owned: c.owned,
              given: 0,
            };
            x.given++;
            counts.set(c.cardId, x);
          }
          last.push(...[...counts.values()].filter((x) => x.given === x.owned));
        }
        dialog.querySelector("#social-offer-review").innerHTML =
          `<h3>Récapitulatif</h3><div class="collect-match"><section><h4>Tu proposes</h4><ul>${rows(selected.give)}</ul></section><section><h4>${market ? "Tu recherches" : "Tu reçois"}</h4><ul>${market ? [...wanted.values()].map((c) => `<li>${esc(label(c))} ×${c.quantity}</li>`).join("") || "<li>Offre ouverte</li>" : rows(selected.receive)}</ul></section></div>${last.length ? `<p class="collect-last-copy-warning">Dernier exemplaire : ${last.map((c) => esc(label(c))).join(", ")}. La carte disparaîtra de la collection du joueur qui la cède et pourra faire baisser son classement.</p>` : ""}<p>${parent?.kind === "market" ? "L’auteur de l’annonce devra confirmer ces exemplaires précis avant le transfert." : "Aucun exemplaire n’est réservé avant acceptation."}</p><button class="btn-primary" id="social-send-confirmed">${market ? "Confirmer l’annonce" : "Envoyer la proposition"}</button>`;
        dialog.querySelector("#social-send-confirmed").onclick = modalAction(
          async () => {
            await send("/offers", {
              kind: market ? "market" : "direct",
              receiverId: target,
              offeredIds: [...selected.give.keys()],
              requestedIds: [...selected.receive.keys()],
              wanted: [...wanted.values()].map(({ name: _name, ...v }) => v),
              requestId,
              parentId: parent?.id,
              exact,
            });
            dialog.close();
            await render();
            message(market ? "Annonce créée." : "Proposition envoyée.");
          },
        );
      },
    );
    await Promise.all(["give", "receive"].map(picker));
    summary();
  }
  async function manager() {
    content.innerHTML = `<h3>Mes exemplaires et mes recherches</h3><form id="social-manager-search" class="collect-social-filters"><label>Rechercher une carte<input name="search" type="search" maxlength="100"></label><label>Afficher<select name="filter">${[
      ["all", "Toutes les cartes"],
      ["available", "Disponibles"],
      ["wanted", "Recherchées"],
      ["missing", "Manquantes"],
      ["earned", "Gagnées personnellement"],
      ["trade", "Obtenues par échange"],
    ]
      .map(
        ([v, n]) =>
          `<option value="${v}" ${managerFilter === v ? "selected" : ""}>${n}</option>`,
      )
      .join(
        "",
      )}</select></label><button class="btn-secondary">Rechercher</button></form><div id="social-manager-cards"></div><div class="collect-social-actions"><button class="btn-secondary" id="social-manager-prev">Précédent</button><span id="social-manager-page"></span><button class="btn-secondary" id="social-manager-next">Suivant</button></div>`;
    async function load() {
      const q = new URLSearchParams(
        new FormData(content.querySelector("#social-manager-search")),
      );
      q.set("page", managerPage);
      const payload = await api(`/inventory/${user}?${q}`);
      content.querySelector("#social-manager-cards").innerHTML = payload.cards
        .map(
          (c) =>
            `<article><h4>${esc(label(c))} · ${rarity[c.rarity]}</h4><p>${c.count} possédés · ${c.earned} gagnés personnellement${c.available ? " · Disponible aux offres" : ""}</p><button class="btn-secondary" data-manage-card="${c.id}" data-card-name="${esc(label(c))}">Rechercher, verrouiller ou gérer</button></article>`,
        )
        .join("");
      content.querySelector("#social-manager-page").textContent =
        `${managerPage}/${Math.max(1, Math.ceil(payload.total / 50))}`;
      content.querySelector("#social-manager-prev").disabled = managerPage <= 1;
      content.querySelector("#social-manager-next").disabled =
        managerPage * 50 >= payload.total;
    }
    content.querySelector("#social-manager-search").onsubmit = action(
      async () => {
        managerPage = 1;
        managerFilter = content.querySelector('[name="filter"]').value;
        await load();
      },
    );
    content.querySelector("#social-manager-prev").onclick = action(async () => {
      managerPage--;
      await load();
    });
    content.querySelector("#social-manager-next").onclick = action(async () => {
      managerPage++;
      await load();
    });
    await load();
  }
  async function cardManager(cardId, name) {
    showModal(`<h2>${esc(name)}</h2><div id="social-own-card"></div>`);
    await mountCard(
      dialog.querySelector("#social-own-card"),
      { id: cardId, name },
      false,
    );
  }
  async function mountCard(node, card, publicView = false, targetName = null) {
    const stats = await api(`/cards/${card.id}/statistics`);
    const wrapper = document.createElement("section");
    wrapper.className = "collect-social-card";
    node.append(wrapper);
    wrapper.innerHTML = `<h3>Échanges et circulation</h3><p>${stats.trades} échanges · ${stats.activeoffers ?? stats.activeOffers} offres actives · ${stats.circulation} exemplaires · ${stats.owners} propriétaires</p><div class="collect-social-actions"><button class="btn-secondary" data-card-market="${esc(label(card))}">Voir les annonces</button><button class="btn-secondary" data-card-owners="${card.id}">Propriétaires disponibles</button></div><div class="collect-card-owner-list"></div>`;
    wrapper.querySelector("[data-card-market]").onclick = action(async () => {
      dialog.close();
      document.querySelector('[data-panel="community"]').click();
      document.querySelector('[data-community-tab="social"]').click();
      tab = "market";
      content.innerHTML = "";
      await render();
      const input = content.querySelector('[name="offered"]');
      input.value = card.name;
      await offerView(true);
    });
    wrapper.querySelector("[data-card-owners]").onclick = action(async () => {
      const owners = await api(`/cards/${card.id}/owners`);
      wrapper.querySelector(".collect-card-owner-list").innerHTML =
        owners
          .map(
            (p) =>
              `<p>${profileLink(p)} <button class="btn-secondary" data-owner-compose="${p.id}" data-person-name="${esc(p.username)}">Proposer un échange</button></p>`,
          )
          .join("") || "<p>Aucun propriétaire disponible.</p>";
    });
    wrapper.addEventListener("click", (e) => {
      const b = e.target.closest("[data-owner-compose]");
      if (b)
        action(() =>
          compose(
            b.dataset.ownerCompose,
            b.dataset.personName,
            null,
            false,
            String(card.id),
          ),
        )(e);
    });
    if (publicView) {
      if (targetName) {
        const person = await api("/players/" + encodeURIComponent(targetName));
        if (String(person.userId) !== user && person.canPropose) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn-primary";
          b.textContent = "Proposer un échange à " + person.username;
          b.onclick = action(() =>
            compose(
              person.userId,
              person.username,
              null,
              false,
              String(card.id),
            ),
          );
          wrapper.querySelector(".collect-social-actions").prepend(b);
        }
      }
      return;
    }
    const [prefs, payload] = await Promise.all([
        api(`/cards/${card.id}/settings`),
        api(`/inventory/${user}?cardId=${card.id}`),
      ]),
      item = payload.cards.find((c) => String(c.id) === String(card.id));
    const own = document.createElement("section");
    wrapper.append(own);
    own.className = "collect-card-management";
    own.innerHTML = `<h3>Gérer cette carte</h3><form class="collect-copy-settings"><fieldset><legend>Échanges et visibilité</legend>${[
      ["locked", "Protéger tous mes exemplaires", "Empêche leur échange et leur suppression."],
      ["hidden", "Masquer ma disponibilité", "Ne pas apparaître parmi les propriétaires disponibles."],
      ["open", "Accepter les propositions", "Même si je ne possède qu’un seul exemplaire."],
      ["wanted", "Rechercher cette carte en priorité", "Mettre cette carte en avant dans mes recherches."],
    ]
      .map(
        ([k, n, help]) =>
          `<label><input type="checkbox" name="${k}" ${prefs[k] ? "checked" : ""}><span><strong>${n}</strong><small>${help}</small></span></label>`,
      )
      .join(
        "",
      )}</fieldset><button class="btn-secondary">Enregistrer les préférences</button></form><fieldset class="collect-copy-picker"><legend>Mes exemplaires</legend><p class="collect-management-help">Sélectionne les exemplaires à supprimer. Tu peux protéger chacun séparément.</p>${(item?.copies || []).map((c) => `<div><label><input type="checkbox" name="destroy-copy" value="${c.id}" ${c.locked || prefs.locked ? "disabled" : ""}><span>${esc(origin(c))}<small>${c.acquisition === "trade" ? "Obtenu par échange" : "Gagné personnellement"} · acquisition le ${date(c.acquiredAt)}</small></span></label><button class="btn-tertiary" data-copy-lock="${c.id}" data-copy-locked="${c.locked}">${c.locked ? "Déverrouiller" : "Verrouiller"}</button></div>`).join("") || "<p>Aucun exemplaire possédé.</p>"}</fieldset><button class="btn-tertiary collect-copy-destroy" type="button">Supprimer les exemplaires sélectionnés</button><p>Chaque exemplaire supprimé sort définitivement de la circulation. Cette action ne libère pas le quota de jeu.</p>`;
    const reload = async () => {
      wrapper.remove();
      await mountCard(node, card, false);
      await refresh();
      if (tab === "manage") await manager();
    };
    own.querySelector("form").onsubmit = action(async (e) => {
      const f = new FormData(e.target);
      await send(
        `/cards/${card.id}/settings`,
        Object.fromEntries(
          ["locked", "hidden", "open", "wanted"].map((k) => [k, f.has(k)]),
        ),
        "PUT",
      );
      await reload();
    });
    own.querySelectorAll("[data-copy-lock]").forEach(
      (b) =>
        (b.onclick = action(async () => {
          await send(
            `/copies/${b.dataset.copyLock}/lock`,
            { locked: b.dataset.copyLocked !== "true" },
            "PUT",
          );
          await reload();
        })),
    );
    own.querySelector(".collect-copy-destroy").onclick = action(async () => {
      const chosen = [
        ...own.querySelectorAll('[name="destroy-copy"]:checked'),
      ].map((i) => i.value);
      if (!chosen.length)
        throw new Error("Choisis les exemplaires à supprimer.");
      const selected = (item?.copies || []).filter((c) =>
        chosen.includes(String(c.id)),
      );
      const confirmation = document.createElement("dialog");
      confirmation.className = "collect-social-dialog";
      document.body.append(confirmation);
      confirmation.innerHTML = `<h2>Supprimer définitivement ${chosen.length} exemplaire${chosen.length > 1 ? "s" : ""} ?</h2><p>${esc(label(card))}</p><ul>${selected.map((c) => `<li>${esc(origin(c))}</li>`).join("")}</ul>${chosen.length === item.count ? '<p class="collect-last-copy-warning">Tu supprimes ton dernier exemplaire : cette carte disparaîtra de ta collection et ton classement pourra baisser.</p>' : ""}<p>Ces exemplaires sortiront de la circulation. Cette action est irréversible.</p><button class="btn-secondary" data-cancel>Annuler</button><button class="btn-primary" data-confirm>Supprimer définitivement</button><p role="status"></p>`;
      confirmation.querySelector("[data-cancel]").onclick = () =>
        confirmation.close();
      confirmation.addEventListener("close", () => confirmation.remove());
      confirmation.addEventListener("cancel", (event) => {
        if (confirmation.querySelector("[data-confirm]").disabled)
          event.preventDefault();
      });
      confirmation.showModal();
      confirmation.querySelector("[data-confirm]").onclick = async () => {
        const b = confirmation.querySelector("[data-confirm]");
        b.disabled = true;
        confirmation.querySelector("[data-cancel]").disabled = true;
        try {
          await send("/copies", { copyIds: chosen, confirmed: true }, "DELETE");
          await reload();
          confirmation.close();
          node.closest("dialog.collect-card-dialog")?.close();
          message("Exemplaires supprimés de la circulation.");
        } catch (e) {
          confirmation.querySelector('[role="status"]').textContent = e.message;
          b.disabled = false;
          confirmation.querySelector("[data-cancel]").disabled = false;
        }
      };
    });
  }
  async function render() {
    const mine = ++generation;
    panel
      .querySelectorAll("[data-social-tab]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.socialTab === tab)),
      );
    content.innerHTML = "<p>Chargement…</p>";
    if (tab === "friends") return friendView();
    if (tab === "offers") return offerView();
    if (tab === "market") return offerView(true);
    if (tab === "manage") return manager();
    if (tab === "history") {
      const rows = await api("/history");
      if (mine !== generation) return;
      content.innerHTML =
        "<h3>Historique privé</h3>" +
        rows
          .map(
            (t) =>
              `<article><h4>${date(t.executed_at)} · ${esc(t.other_name || "Compte supprimé")}</h4><div class="collect-match"><section><h5>Donnés</h5>${(t.maker ? t.summary.given : t.summary.received).map((c) => `<p>${esc(label(c))} · ${esc(origin(c))}</p>`).join("")}</section><section><h5>Reçus</h5>${(t.maker ? t.summary.received : t.summary.given).map((c) => `<p>${esc(label(c))} · ${esc(origin(c))}</p>`).join("")}</section></div></article>`,
          )
          .join("");
    }
  }
  async function reportPlayer(target, offerId) {
    showModal(
      `<h2>Signaler un comportement</h2><p>Un échange déséquilibré n’est pas un motif de signalement.</p><form id="social-report"><label>Motif<select name="reason"><option value="spam">Spam</option><option value="harassment">Harcèlement</option><option value="circumvention">Contournement du système</option><option value="content">Contenu problématique</option></select></label><button class="btn-primary">Envoyer le signalement</button></form>`,
    );
    dialog.querySelector("form").onsubmit = modalAction(async (e) => {
      await send("/reports/" + target, {
        reason: new FormData(e.target).get("reason"),
        offerId,
      });
      dialog.close();
      message("Signalement transmis à l’administration.");
    });
  }
  async function click(event) {
    const b = event.target.closest("button");
    if (!b) return;
    if (b.dataset.socialTab) {
      tab = b.dataset.socialTab;
      await render();
    }
    for (const action of ["request", "accept", "remove"])
      if (b.dataset["friend" + action[0].toUpperCase() + action.slice(1)]) {
        await send(
          `/friends/${b.dataset["friend" + action[0].toUpperCase() + action.slice(1)]}/${action}`,
          {},
        );
        await render();
      }
    if (b.dataset.block) {
      if (!confirm("Bloquer ce joueur et clôturer vos propositions en cours ?"))
        return;
      await send("/blocks/" + b.dataset.block, {}, "PUT");
      await render();
    }
    if (b.dataset.unblock) {
      await send("/blocks/" + b.dataset.unblock, {}, "DELETE");
      await render();
    }
    if (b.dataset.composePerson) await compose(b.dataset.composePerson, b.dataset.personName);
    if (b.dataset.person)
      await personView(b.dataset.person, b.dataset.personName);
    if (b.dataset.reportPlayer)
      await reportPlayer(b.dataset.reportPlayer, b.dataset.reportOffer);
    if (b.dataset.manageCard)
      await cardManager(b.dataset.manageCard, b.dataset.cardName);
    if (b.dataset.offerAccept) await confirmation(b.dataset.offerAccept);
    if (b.dataset.offerWithdraw || b.dataset.offerRefuse) {
      await send(
        `/offers/${b.dataset.offerWithdraw || b.dataset.offerRefuse}/${b.dataset.offerWithdraw ? "withdraw" : "refuse"}`,
        {},
      );
      await render();
    }
    if (b.dataset.offerCounter) {
      const o = content._offers.find((o) => o.id === b.dataset.offerCounter);
      await compose(o.maker_id, o.maker_name, o);
    }
    if (b.dataset.marketRespond) {
      const o = content._offers.find((o) => o.id === b.dataset.marketRespond);
      await compose(o.maker_id, o.maker_name, o, b.dataset.exact === "true");
    }
  }
  const delegatedKeys = [
    "socialTab",
    "composePerson",
    "friendRequest",
    "friendAccept",
    "friendRemove",
    "block",
    "unblock",
    "person",
    "reportPlayer",
    "manageCard",
    "offerAccept",
    "offerWithdraw",
    "offerRefuse",
    "offerCounter",
    "marketRespond",
  ];
  const delegate =
    (modal = false) =>
    (event) => {
      const button = event.target.closest("button");
      if (
        button &&
        delegatedKeys.some((key) => button.dataset[key] !== undefined)
      )
        (modal ? modalAction(click) : action(click))(event);
    };
  panel.addEventListener("click", delegate());
  dialog.addEventListener("click", delegate(true));
  document
    .querySelector('[data-panel="community"]')
    .addEventListener("click", action(render));
  document.querySelector('[data-community-tab="social"]').addEventListener("click", action(render));
  async function attachProfile(node, name) {
    if (node.querySelector("[data-v2-profile]")) return;
    const person = await api("/players/" + encodeURIComponent(name));
    const found = { id: person.userId };
    if (String(found.id) === user) return;
    const box = document.createElement("div");
    box.dataset.v2Profile = "true";
    box.className = "collect-social-actions";
    box.innerHTML = `<button class="btn-secondary" data-person="${found.id}" data-person-name="${esc(name)}">Collection et échanges</button><button class="btn-secondary" data-friend-request="${found.id}">Demander en ami</button><button class="btn-tertiary" data-block="${found.id}">Bloquer</button><button class="btn-tertiary" data-report-player="${found.id}">Signaler</button>`;
    box.addEventListener("click", action(click));
    node.prepend(box);
  }
  async function progress() {
    const [albums, personal] = await Promise.all([
      api("/albums/" + user),
      api("/personal-albums"),
    ]);
    return { albums, personal };
  }
  return { render, mountCard, attachProfile, progress, user, compose };
}
