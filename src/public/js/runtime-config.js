(() => {
  "use strict";

  const localHostnames = new Set(["localhost", "127.0.0.1"]);
  const isLocal =
    localHostnames.has(window.location.hostname) || window.location.protocol === "file:";

  window.CaminoRuntimeConfig = Object.freeze({
    apiUrl: isLocal ? "http://localhost:3000" : "https://camino-paris.onrender.com",
  });
})();
