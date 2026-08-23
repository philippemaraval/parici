# Dépôt et exploitation

## Nettoyage local

`node scripts/repository_inventory.js` inventorie les copies numérotées, compare
leur SHA-256 avec le fichier canonique et signale les gros fichiers. La commande
suivante supprime uniquement les copies strictement identiques :

```sh
node scripts/repository_inventory.js --delete-identical
```

`dist/`, les bases SQLite, les fichiers iCloud, les caches Python, les rapports
temporaires et les copies numérotées ne sont jamais versionnés. `npm run build`
recrée `dist/` à partir des sources.

Le contrôle reproductible exécute deux builds propres et compare une empreinte
triée de tous les fichiers :

```sh
node scripts/verify_reproducible_build.js
```

## Sauvegarde PostgreSQL

Le workflow `PostgreSQL backup` produit chaque nuit un dump PostgreSQL complet au
format custom, le valide, le chiffre en AES-256, puis restaure le schéma
applicatif `public` dans une base PostgreSQL éphémère avant de conserver
l'artefact chiffré 30 jours. Le test cible `public`, car les extensions gérées par
Supabase (par exemple `supabase_vault`) ne sont pas installables dans une image
PostgreSQL standard.

Secrets GitHub requis :

- `PRODUCTION_DATABASE_URL`
- `BACKUP_ENCRYPTION_PASSPHRASE`

Une restauration manuelle se teste avec :

```sh
RESTORE_DATABASE_URL=postgresql://... \
BACKUP_ENCRYPTION_PASSPHRASE=... \
bash scripts/postgres_restore_test.sh backups/camino-....dump.enc
```

## Métriques, logs et alertes

L'API émet une ligne JSON par requête avec `request_id`, route normalisée,
statut et latence, sans corps, adresse IP, email, jeton ni nom d'utilisateur.
`/api/metrics` expose les compteurs d'erreurs API, connexions, push,
synchronisation OSM et Daily, ainsi que les histogrammes de latence. Définir
`METRICS_TOKEN` en production et utiliser `Authorization: Bearer ...`.

Le workflow `Operations monitor` contrôle la santé et la latence toutes les dix
minutes et ouvre une issue `operations` en cas d'échec de production, de
synchronisation OSM ou de sauvegarde. Variable GitHub requise :
`PRODUCTION_HEALTHCHECK_URL`. Pour contrôler aussi les seuils d'erreurs API,
connexion, push, OSM et Daily, définir `PRODUCTION_METRICS_URL` et le secret
`METRICS_TOKEN`. Les variables `MAX_HEALTH_LATENCY_MS`, `MAX_API_ERRORS`,
`MAX_CONNECTION_FAILURES`, `MAX_PUSH_FAILURES`, `MAX_OSM_SYNC_FAILURES` et
`MAX_DAILY_FAILURES` permettent d'ajuster les seuils.

## Migration des gros fichiers historiques

La réécriture de `main` exige une fenêtre de maintenance : elle remplace tous les
SHA Git, invalide les clones et requiert un push forcé. Ne jamais la lancer
pendant un déploiement ou une partie active.

Procédure préparée pour cette fenêtre :

1. sauvegarder le dépôt distant et suspendre les workflows de déploiement ;
2. choisir soit Git LFS (`git lfs migrate import --include="*.geojson,*.jpg,*.jpeg,*.png" --everything`),
   soit un stockage objet/CDN pour les images ;
3. vérifier un clone neuf, le build et le téléchargement des objets LFS ;
4. pousser l'historique réécrit avec `--force-with-lease` ;
5. demander à tous les contributeurs de refaire leur clone, puis réactiver les
   déploiements.

Cette opération destructive est volontairement séparée du déploiement courant.
