# Déploiement de Camino Paris

## 1. Créer le serveur et PostgreSQL sur Render

Le fichier `render.yaml` décrit les deux ressources nécessaires :

- le service web Node `camino-paris`, démarré depuis `backend/` ;
- la base PostgreSQL `camino-paris-db`, reliée automatiquement au serveur par `DATABASE_URL`.

Dans Render :

1. Ouvrir **New > Blueprint**.
2. Connecter le dépôt GitHub `philippemaraval/parici`.
3. Sélectionner la branche `main` et le fichier `render.yaml`.
4. Appliquer le Blueprint.
5. Attendre que PostgreSQL soit disponible puis que le service web soit déployé.
6. Vérifier `https://camino-paris.onrender.com/api/health`.

La réponse attendue contient :

```json
{"ok":true,"database":"ok"}
```

Cette route vérifie réellement PostgreSQL avec une requête avant de répondre.

Si Render attribue une URL différente de `https://camino-paris.onrender.com`,
remplacer cette URL dans :

- `src/config.js` ;
- `src/public/js/site-shell.js` ;
- `admin/admin.js` ;
- `index.html` ;
- `reset-password.html`.

Puis exécuter `npm run build`, committer et pousser.

## 2. Régler les variables Render

Le Blueprint crée `DATABASE_URL`, `SECRET_KEY` et `ADMIN_API_KEY`. Dans le
Dashboard Render, contrôler aussi :

- `FRONTEND_URL` : URL publique exacte du site Netlify ;
- `PASSWORD_RESET_FRONTEND_URL` : la même URL Netlify ;
- `CORS_ALLOWED_ORIGINS` : éventuels domaines personnalisés ou previews,
  séparés par des virgules ;
- `EDITOR_USERNAMES` : pseudos autorisés à modifier le contenu ;
- `ENABLE_ADMIN_ROUTES=true` uniquement pendant une opération
  d’administration qui nécessite ces routes.

Ne jamais placer `DATABASE_URL`, `SECRET_KEY` ou `ADMIN_API_KEY` dans Git.

## 3. Régler Netlify

Dans **Site configuration > Build & deploy** :

- dépôt : `philippemaraval/parici` ;
- branche : `main` ;
- commande de build : `npm ci && npm run build` ;
- dossier publié : `dist`.

Après le déploiement, renseigner l’URL Netlify exacte dans `FRONTEND_URL` et
`PASSWORD_RESET_FRONTEND_URL` sur Render, puis redéployer le service Render.

## 4. Vérifications finales

1. Ouvrir `/api/health` sur Render : `ok=true` et `database=ok`.
2. Ouvrir Camino Paris, créer un compte puis se reconnecter.
3. Actualiser la page et vérifier que le compte et les scores sont conservés.
4. Installer la webapp et vérifier que son icône correspond au favicon
   « CAMINO PARIS ».
5. Dans DevTools, vérifier qu’aucune requête vers `/api/*` n’est bloquée par
   CORS.
