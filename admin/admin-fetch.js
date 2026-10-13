(function () {
  "use strict";
  let pending;
  async function challenge(api, authorization) {
    const dialog = document.createElement("dialog");
    dialog.className = "admin-detail-dialog";
    const form = document.createElement("form"),
      heading = document.createElement("h2"),
      label = document.createElement("label"),
      input = document.createElement("input"),
      feedback = document.createElement("p"),
      submit = document.createElement("button"),
      cancel = document.createElement("button");
    heading.textContent = "Double authentification";
    label.textContent = "Code de l’application ou code de récupération";
    input.autocomplete = "one-time-code";
    input.required = true;
    input.maxLength = 32;
    label.append(input);
    feedback.setAttribute("role", "status");
    submit.textContent = "Vérifier";
    submit.className = "btn btn-primary";
    cancel.textContent = "Annuler";
    cancel.className = "btn";
    cancel.type = "button";
    form.append(heading, label, feedback, submit, cancel);
    dialog.append(form);
    document.body.append(dialog);
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        input.value = "";
        dialog.close();
        dialog.remove();
        error ? reject(error) : resolve(value);
      };
      cancel.onclick = () => finish(new Error("Vérification annulée."));
      dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        finish(new Error("Vérification annulée."));
      });
      form.onsubmit = async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          const r = await fetch(api + "/api/editor/studio/mfa/challenge", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Authorization: authorization,
            },
            body: JSON.stringify({ code: input.value }),
            signal: AbortSignal.timeout(30000),
          });
          input.value = "";
          const p = await r.json();
          if (!r.ok) throw Error(p.error);
          sessionStorage.setItem("camino_admin_mfa", p.proof);
          finish(null, p.proof);
        } catch (error) {
          feedback.textContent = error.message;
          submit.disabled = false;
        }
      };
      dialog.showModal();
      input.focus();
    });
  }
  window.PariciAdminFetch = async function (url, options = {}) {
    const headers = new Headers(options.headers);
    const proof = sessionStorage.getItem("camino_admin_mfa");
    if (proof) headers.set("X-Admin-MFA", proof);
    const response = await fetch(url, { ...options, headers });
    if (response.status !== 403) return response;
    const p = await response
      .clone()
      .json()
      .catch(() => ({}));
    if (p.code !== "ADMIN_MFA_REQUIRED") return response;
    if (!pending)
      pending = challenge(
        new URL(url, location.href).origin,
        headers.get("Authorization") || "",
      ).finally(() => {
        pending = null;
      });
    headers.set("X-Admin-MFA", await pending);
    return fetch(url, { ...options, headers });
  };
})();
