# Tests et livraison

## Couverture automatisée

La livraison est protégée par trois niveaux complémentaires :

1. `npm test` couvre les modules, les régressions de sécurité, le service worker
   et les migrations depuis d’anciennes versions ;
2. `npm run test:integration` démarre l’application sur une vraie base PostgreSQL
   éphémère et vérifie inscription, connexion, score, validation des avatars et
   permissions ;
3. `npm run test:e2e` exécute avec Playwright les parcours inscription,
   connexion, profil, Camino, Daily et administration, contrôle les
   débordements et panneaux critiques en mobile et desktop, puis joint les
   captures au rapport.

La CI `Code quality` s’exécute sur chaque pull request et chaque push vers `main`.
Elle bloque en cas d’échec du lint, du formatage, du typage, du contrôle des
dépendances, de la validation des données OSM, de l’audit critique npm, des tests,
du build, des budgets de performance, de PostgreSQL ou de Playwright.

Dans les règles de protection GitHub de `main`, marquez les trois jobs
`quality`, `integration` et `e2e` comme obligatoires. Dans Render, choisissez
**After CI Checks Pass** si vous conservez l’autodéploiement.

## Préproduction éphémère

La préproduction permanente a été supprimée. Le job `integration` crée une base
PostgreSQL 17 isolée pour chaque exécution de la CI, y lance les tests, puis la
détruit avec le runner GitHub. Il n’utilise jamais la base ni les données de
production.

Les parcours navigateur s’exécutent également dans le job `e2e`. Ensemble, ces
jobs constituent la validation technique qui précède directement la livraison.

## Livraison atomique et retour arrière

Le workflow `Delivery` ne s’active que lorsque la variable de dépôt
`CAMINO_DELIVERY_ENABLED` vaut `true` et que la CI du commit `main` a entièrement
réussi. Il attend l’approbation éventuelle de l’environnement GitHub `production`,
déploie le SHA exact validé par la CI, puis vérifie `/api/ready`.

Chaque étape :

1. mémorise le dernier déploiement Render `live` ;
2. déploie le SHA Git validé par la CI ;
3. attend le statut `live` et interroge le contrôle de santé ;
4. déclenche l’API de rollback Render vers le déploiement précédent si la santé
   n’est pas confirmée.

Render conserve l’ancienne instance pendant la construction et le démarrage de la
nouvelle : sans disque persistant attaché au service, le basculement est sans
interruption. Désactivez l’autodéploiement Render lorsque ce workflow pilote la
livraison, afin qu’un autodéploiement ne puisse pas annuler un rollback.

Secrets de l’environnement GitHub `production` :

- `RENDER_API_KEY`
- `RENDER_PRODUCTION_SERVICE_ID`

Variable de l’environnement `production` :

- `PRODUCTION_HEALTHCHECK_URL`, par exemple
  `https://camino-paris.onrender.com/api/ready`

La variable de dépôt `CAMINO_DELIVERY_ENABLED` doit rester à `false` pendant la
configuration, puis passer à `true` une fois les secrets vérifiés.

Protégez l’environnement `production` avec une approbation obligatoire lorsqu’elle
est disponible avec le forfait et la visibilité du dépôt. Render doit utiliser
`backend/` comme répertoire racine, `npm install` pour le build, `npm start` pour
le démarrage et `/api/ready` comme chemin de santé.
