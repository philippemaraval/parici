const USER_STORAGE_KEY = "camino_paris_user";
const SESSION_TOKEN_STORAGE_KEY = "camino_paris_session_token";
const PERSISTENT_TOKEN_STORAGE_KEY = "camino_auth_token";
const COOKIE_SESSION_MARKER = "__cookie_session__";
let credentialedFetchInstalled = false;

export function saveCurrentUserToStorage(user) {
  if (!user) {
    return;
  }

  try {
    const { token, ...publicUser } = user;
    window.localStorage.setItem(
      USER_STORAGE_KEY,
      JSON.stringify({ ...publicUser, authenticated: true }),
    );
    if (token && token !== COOKIE_SESSION_MARKER) {
      window.localStorage.setItem(PERSISTENT_TOKEN_STORAGE_KEY, token);
      window.sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    }
  } catch (error) {
    console.warn("Impossible de sauvegarder l’utilisateur.", error);
  }
}

export function loadCurrentUserFromStorage() {
  const serializedUser = window.localStorage.getItem(USER_STORAGE_KEY);
  if (!serializedUser) {
    return null;
  }

  try {
    const storedUser = JSON.parse(serializedUser);
    const legacyToken = storedUser?.token;
    const sessionToken =
      window.localStorage.getItem(PERSISTENT_TOKEN_STORAGE_KEY) ||
      window.sessionStorage.getItem(SESSION_TOKEN_STORAGE_KEY) ||
      legacyToken;
    if (legacyToken) {
      delete storedUser.token;
      window.localStorage.setItem(
        USER_STORAGE_KEY,
        JSON.stringify({ ...storedUser, authenticated: true }),
      );
      window.localStorage.setItem(PERSISTENT_TOKEN_STORAGE_KEY, legacyToken);
      window.sessionStorage.setItem(SESSION_TOKEN_STORAGE_KEY, legacyToken);
    }
    return {
      ...storedUser,
      token: sessionToken || COOKIE_SESSION_MARKER,
      authenticated: true,
    };
  } catch (error) {
    console.error("Erreur parsing user storage", error);
    return null;
  }
}

export function clearCurrentUserFromStorage() {
  try {
    window.localStorage.removeItem(USER_STORAGE_KEY);
    window.localStorage.removeItem(PERSISTENT_TOKEN_STORAGE_KEY);
    window.sessionStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  } catch (error) {
    console.warn("Impossible de supprimer l’utilisateur stocké.", error);
  }
}

export function enableCredentialedApiRequests(apiUrl) {
  if (credentialedFetchInstalled || typeof window.fetch !== "function") {
    return;
  }
  const apiOrigin = new URL(apiUrl, window.location.href).origin;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const rawUrl = typeof input === "string" || input instanceof URL ? input : input?.url;
    let isApiRequest = false;
    try {
      isApiRequest = new URL(rawUrl, window.location.href).origin === apiOrigin;
    } catch (error) {
      isApiRequest = false;
    }
    if (!isApiRequest) {
      return originalFetch(input, init);
    }
    return originalFetch(input, {
      ...init,
      credentials: "include",
    });
  };
  credentialedFetchInstalled = true;
}
