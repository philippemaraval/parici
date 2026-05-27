const USER_STORAGE_KEY = "parici_user";

export function saveCurrentUserToStorage(user) {
  if (!user) {
    return;
  }

  try {
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
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
    return JSON.parse(serializedUser);
  } catch (error) {
    console.error("Erreur parsing user storage", error);
    return null;
  }
}

export function clearCurrentUserFromStorage() {
  try {
    window.localStorage.removeItem(USER_STORAGE_KEY);
  } catch (error) {
    console.warn("Impossible de supprimer l’utilisateur stocké.", error);
  }
}
