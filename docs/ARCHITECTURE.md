# Architecture de Parici

## Principes

- `src/` contient la source du navigateur ; `backend/` contient l’API Node.
- `dist/` est un artefact éphémère produit par `npm run build`, jamais une source.
- Chaque domaine backend possède ses routes, son contrôleur HTTP, son service métier,
  sa validation et son accès aux données. Profils applique déjà toutes
  ces couches ; le registre `backend/domains/registry.js` fixe les propriétaires des
  routes encore en cours d’extraction du serveur historique.
- `openapi/openapi.json` est le contrat public. Les requêtes documentées sont validées
  à l’exécution par le serveur.
- `src/public/js/runtime-config.js` est l’unique source de l’URL d’API du navigateur.
- `backend/package.json` ne déclare aucune dépendance : c’est un adaptateur de
  déploiement pour les services Render configurés avec `backend/` comme racine.

## Domaines

| Domaine          | Préfixes                                                       | État                 |
| ---------------- | -------------------------------------------------------------- | -------------------- |
| Authentification | `/api/register`, `/api/login`, `/api/session`, `/api/password` | propriétaire déclaré |
| Scores           | `/api/scores`, `/api/leaderboards`, `/api/friend-challenges`   | propriétaire déclaré |
| Daily            | `/api/daily`                                                   | propriétaire déclaré |
| Profils          | `/api/profile`, `/api/referrals`                               | couches séparées     |
| Notifications    | `/api/notifications`                                           | propriétaire déclaré |
| Administration   | `/api/admin`, `/api/analytics`                                 | propriétaire déclaré |

Un nouveau endpoint doit être ajouté dans le dossier de son domaine, déclaré dans
OpenAPI et couvert par un test. Il ne doit pas être ajouté directement à
`backend/server.js`.

## Flux de dépendances

`routes → controller → service → repository → database`

La validation intervient à l’entrée du contrôleur. Un repository ne connaît ni
Express ni les réponses HTTP. Un service ne lit pas directement les variables
d’environnement : il reçoit une configuration ou une dépendance.

## Build et déploiement

Le build génère les morceaux cartographiques, produit des
ressources minifiées et fingerprintées dans `dist/`, puis vérifie qu’aucune source
map n’est publiée. Le dossier peut être supprimé et reconstruit à tout moment.
