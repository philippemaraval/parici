export async function confirmSensitiveAction(apiBase, token, path, method) {
  const dialog = document.createElement("dialog");
  dialog.className = "admin-detail-dialog";
  const form = document.createElement("form");
  const heading = document.createElement("h2"); heading.textContent = "Confirmer votre identité";
  const label = document.createElement("label"); label.textContent = "Votre mot de passe administrateur";
  const input = document.createElement("input"); input.type = "password"; input.autocomplete = "current-password"; input.required = true; label.append(input);
  const feedback = document.createElement("p"); feedback.setAttribute("role", "status");
  const submit = document.createElement("button"); submit.type = "submit"; submit.className = "btn btn-primary"; submit.textContent = "Confirmer";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "btn"; cancel.textContent = "Annuler";
  const actions = document.createElement("div"); actions.className = "button-row"; actions.append(submit, cancel);
  form.append(heading, label, feedback, actions); dialog.append(form); document.body.append(dialog);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => { if (done) return; done = true; input.value = ""; dialog.close(); dialog.remove(); error ? reject(error) : resolve(value); };
    cancel.addEventListener("click", () => finish(new Error("Action annulée.")));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(new Error("Action annulée.")); });
    form.addEventListener("submit", async event => {
      event.preventDefault(); submit.disabled = true;
      try {
        const response = await window.PariciAdminFetch(`${apiBase}/api/editor/confirm-action`, { method: "POST", credentials: "include", signal: AbortSignal.timeout(45000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ password: input.value, path, method }) });
        input.value = "";
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Confirmation impossible");
        finish(null, payload.confirmationToken);
      } catch (error) { feedback.textContent = error.message; submit.disabled = false; input.focus(); }
    });
    dialog.showModal(); input.focus();
  });
}
