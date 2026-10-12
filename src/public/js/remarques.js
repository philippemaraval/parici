"use strict";

const remarksForm = document.getElementById("remarks-form");
const remarksMessage = document.getElementById("message");

remarksMessage.addEventListener("input", () => remarksMessage.setCustomValidity(""));
remarksForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = remarksMessage.value.trim();
  if (!message) {
    remarksMessage.setCustomValidity("Écris ta remarque avant de préparer le mail.");
    remarksMessage.reportValidity();
    return;
  }
  const subject = encodeURIComponent("Parici — Remarque ou recommandation");
  window.location.href = `mailto:camino.sunmedia@gmail.com?subject=${subject}&body=${encodeURIComponent(message)}`;
});
