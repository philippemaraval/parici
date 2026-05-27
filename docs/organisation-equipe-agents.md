# Organisation de l'equipe d'agents Parici

Ce document decrit l'organisation des agents/sous-agents utilises pour maintenir Parici, leurs responsabilites, et les regles de collaboration.

## Organigramme

```text
Codex — Coordination generale
├── Marius — Directeur Produit Frontend
│   ├── Cesar — Manager Cartographie & Moteur SIG
│   │   └── Marcel — Responsable Profil/Auth & Social Front
│   └── Fanny — Manager Design System & Experience UI
├── Panisse — Directeur Plateforme Backend
│   └── Honorine — Manager Base de Donnees & Analytics
│       └── Olive — Responsable QA & Audit de Regression (mission transverse)
└── Escartefigue — Directeur Data & Release
    └── Fernand — Manager Release Engineering & PWA Ops
```

## Roles et perimetres

### 1) Pole Produit Frontend

- **Marius (Directeur Produit Frontend)**
  - Fichiers: `src/app.js`, `src/session.js`, `src/daily.js`, `src/daily-runtime.js`
  - Mission: logique de jeu client (modes, session, score, daily), arbitrages produit front, coherence fonctionnelle.

- **Cesar (Manager Cartographie & Moteur SIG)**
  - Fichiers: `src/map-runtime.js`, `src/map-session-core.js`, `src/map.js`, `data_rules.js`
  - Mission: moteur Leaflet, precision cartographique, performances map, selection rues/arrondissements.

- **Marcel (Responsable Profil/Auth & Social Front)**
  - Fichiers: `src/profile-runtime.js`, `src/leaderboard.js`, `src/auth.js`, `src/onboarding.js`, `src/session-share.js`, `src/audio.js`, `src/haptics.js`, `src/install-prompt.js`
  - Mission: auth front, profil/avatar, leaderboard, onboarding, partage, feedback audio/haptics.

- **Fanny (Manager Design System & Experience UI)**
  - Fichiers: `index.html`, `style.css`, `docs/ui/*`
  - Mission: qualite UI/UX, accessibilite, responsive, coherence visuelle Paris.

### 2) Pole Plateforme Backend

- **Panisse (Directeur Plateforme Backend)**
  - Fichiers: `backend/server.js`, `backend/mock-server.js`, `backend/.env.example`
  - Mission: API Express, securite JWT/CORS, validation payloads, push notifications, routes admin.

- **Honorine (Manager Base de Donnees & Analytics)**
  - Fichiers: `backend/database.js`, `backend/scripts/*`
  - Mission: schema PostgreSQL, migrations, requetes leaderboard/daily/profil/analytics, integrite et performance SQL.

- **Olive (Responsable QA & Audit de Regression)**
  - Perimetre: lecture transverse front/back/data (sans ownership d'edition par defaut)
  - Mission: audit de regressions, verification de coherence fonctionnelle/technique, identification des risques.

### 3) Pole Data & Release

- **Escartefigue (Directeur Data & Release)**
  - Fichiers: `scripts/sync_osm.js`, `data/*`, `backend/data/*`, `.github/workflows/sync-osm.yml`
  - Mission: pipeline OSM, qualite des datasets geospatiaux, automatisation de synchro hebdomadaire.

- **Fernand (Manager Release Engineering & PWA Ops)**
  - Fichiers: `scripts/build.js`, `sw.js`, `_headers`, `netlify.toml`, `package.json`
  - Mission: build/minification, PWA/offline cache, artefacts de release, fiabilite de livraison.

## Regles de fonctionnement

- Hierarchie appliquee: **Directeur > Manager > Responsable**.
- Chaque agent travaille d'abord dans son perimetre de fichiers.
- Un agent ne revert jamais le travail d'un autre agent.
- Les changements transverses sont arbitres par le Directeur du pole concerne.
- Le controle qualite transverse est assure par Olive avant finalisation si le scope est large.

## Limite technique actuelle

- La plateforme limite les sous-agents actifs simultanement.
- En pratique, certains agents peuvent etre "parques" (shutdown) puis re-actives a la demande.
- Cette limite ne change pas l'organigramme: elle impacte seulement le nombre de threads actifs en parallele.

## Mode operatoire recommande

1. Codex decoupe la demande par pole.
2. Le Directeur du pole alloue les taches aux Managers/Responsables.
3. Les Managers livrent les changements de leur perimetre.
4. Olive execute un audit de regression si la livraison est transverse ou sensible.
5. Codex integre, verifie, puis livre.
