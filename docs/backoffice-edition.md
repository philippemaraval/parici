# Back-office d'edition Parici

Le back-office est disponible sur `/admin`.

## 1) Donner l'acces editeur

Option A (simple): variable d'environnement

- Ajouter `EDITOR_USERNAMES` sur le backend (liste separee par des virgules).
- Exemple: `EDITOR_USERNAMES=ami,pierre`

Option B (pilotage par role en base)

- Activer temporairement les routes admin:
  - `ENABLE_ADMIN_ROUTES=true`
  - `ADMIN_API_KEY=<cle-longue-secrete>`
- Promouvoir un utilisateur:

```bash
curl -X POST "https://parici.onrender.com/api/admin/users/role" \
  -H "Content-Type: application/json" \
  -H "x-admin-key: <ADMIN_API_KEY>" \
  -d '{"username":"ami","role":"editor"}'
```

Roles possibles: `player`, `editor`, `admin`.

## 2) Utiliser le back-office

- Ouvrir: `https://<votre-domaine>/admin`
- Se connecter avec un compte autorise.
- Gerer:
  - fiches `famous` (rues celebres)
  - fiches `main` (rues principales)
  - listes de jeu (rues celebres, rues principales, monuments)

## 3) Impact dans le jeu

Le front charge maintenant le contenu dynamique via:

- `GET /api/content/public`

Les changements editoriaux sont pris en compte apres rechargement de la page du jeu.
