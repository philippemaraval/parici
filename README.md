# Parici

Parici est un jeu web consacré aux rues de Paris. Le dépôt contient le client
statique, l’API Express/PostgreSQL, les scripts de synchronisation cartographique et
la chaîne de build de production.

## Prérequis et installation

- Node.js 22
- npm 10 ou supérieur
- PostgreSQL pour exécuter l’API complète

```bash
npm ci
cp backend/.env.example backend/.env
npm start
```

Dans un second terminal, servez les fichiers statiques depuis la racine (ou
`dist/` après un build). En local, le client utilise automatiquement
`http://localhost:3000`.

Toutes les dépendances et leurs versions sont déclarées dans le `package.json` et
le lockfile racine. `backend/package.json` est uniquement un lanceur de compatibilité
pour le service Render historique dont le répertoire racine est `backend/`.

## Commandes

```bash
npm test                 # génère les morceaux de carte puis lance les tests
npm run lint             # analyse statique ESLint
npm run format:check     # contrôle Prettier
npm run typecheck        # frontière TypeScript progressive
npm run deps:check       # manifeste, imports et artefacts générés
npm run data:check       # cohérence des sorties OpenStreetMap
npm run audit:production # vulnérabilités critiques des dépendances livrées
npm run build            # produit dist/
npm run performance:check
npm run test:integration # API sur PostgreSQL éphémère (TEST_DATABASE_URL)
npm run test:e2e         # parcours et captures visuelles Playwright
npm run quality          # chaîne locale complète
```

## Architecture

Le détail et les règles de dépendance sont dans
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Les principaux emplacements sont :

- `src/` : modules et ressources source du navigateur ;
- `backend/domains/` : domaines de l’API ;
- `backend/config/` : configuration serveur validée et centralisée ;
- `openapi/openapi.json` : contrat et validation des requêtes ;
- `scripts/` : génération des données et contrôles ;
- `tests/` : tests Node ;
- `dist/` : résultat reproductible du build, ignoré par Git.

## Variables d’environnement

Copiez `backend/.env.example`. Les variables essentielles sont `DATABASE_URL`,
`SECRET_KEY`, `FRONTEND_URL` et `CORS_ALLOWED_ORIGINS`. Les routes d’administration
exigent `ENABLE_ADMIN_ROUTES=true` et `ADMIN_API_KEY`. Les notifications utilisent
les clés VAPID décrites dans le fichier d’exemple.

Ne placez jamais de secret dans le code, le manifeste OpenAPI ou le dépôt Git.

## Base de données et migrations

Au démarrage, `backend/database.js` applique les migrations idempotentes nécessaires
avant de déclarer l’API prête. Sauvegardez la base avant toute modification de
schéma et testez la migration sur une copie.

Pour restaurer :

1. arrêtez les écritures applicatives ;
2. restaurez le dump PostgreSQL dans une base vide ;
3. renseignez `DATABASE_URL` vers cette base ;
4. démarrez l’API et vérifiez `/api/health` ;
5. réactivez le trafic après contrôle des journaux et des parcours login/Daily.

## Build et déploiement

`npm run build` reconstruit `dist/` à partir des sources, sans source maps de
production. Déployez uniquement ce dossier pour le frontend et lancez
`node backend/server.js` pour l’API. L’URL publique de l’API se règle à un seul
endroit, `src/public/js/runtime-config.js`.

Sur Render, le service backend peut conserver `backend/` comme **Root Directory**,
`npm install` comme **Build Command** et `npm start` comme **Start Command**. Le
lanceur installe alors, de façon déterministe, les dépendances de production du
manifeste racine.

La CI installe avec `npm ci`, contrôle style, types et dépendances, lance les tests,
reconstruit le site et vérifie les budgets de performance. Dependabot regroupe les
mises à jour npm chaque semaine.

Les tests avec PostgreSQL éphémère et la livraison Render avec retour arrière sont
détaillés dans [`docs/TESTS_ET_LIVRAISON.md`](docs/TESTS_ET_LIVRAISON.md).
