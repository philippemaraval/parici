# Parici — audit, points 1 à 5

Le périmètre porte sur les cibles Daily, les canaux push indépendants, les indices géographiques, la CI et la synchronisation OSM. Les autres points de l’audit restent hors de cette livraison.

## Daily

La sélection automatique crée une date avec `ON CONFLICT DO NOTHING`. Une cible existante est conservée, même après un nouveau manifeste, un changement du filtre ou une synchronisation OSM. Une lecture du résultat ne réécrit plus la cible. La géométrie disponible est enregistrée lors de la création des nouveaux Dailies ; les données historiques existantes et les interventions éditoriales explicites sont conservées.

L’API renvoie séparément l’arrondissement et le quartier, à partir du référentiel parisien et de l’identité de rue existante. Les deux conventions historiques du champ `arrondissement` restent acceptées. Le second indice est correctement nommé « Quartier ». Aucune migration des anciennes tentatives, cibles ou distances n’est effectuée.

La désactivation du rappel Daily respecte `keepSubscription` : le navigateur conserve son abonnement lorsque Collect en a encore besoin.

## Validation et publication

Les assertions de navigation suivent Collect public et Explorer différé. Les tests de version suivent l’état de publication hebdomadaire. Les captures E2E utilisent le répertoire d’artefacts Playwright au lieu d’un chemin macOS. La navigation fonctionnelle est indépendante du CDN de polices et les parcours complets disposent de délais adaptés à leurs vérifications sur cinq largeurs d’écran.

Le contrôle éditorial vérifie les variantes d’image et leurs fichiers sans relire toutes les photos pour en calculer les empreintes. Les URL publiques des joueurs restent versionnées.

Sur les builds hébergés de Render et Cloudflare Pages, `scripts/check_deploy_quality.js` exige que les workflows `Code quality` et `Performance budgets` aient réussi pour le même SHA sur `main`, par événement `push` ou `workflow_dispatch`. Une vérification manquante ou en cours attend au maximum quinze minutes. Un échec, une réponse API invalide, une impossibilité de vérifier ou un délai dépassé font échouer le nouveau build ; la version déjà publiée continue de fonctionner. Les builds locaux et les contrôles GitHub Actions peuvent se construire pour effectuer ces vérifications.

Ce contrôle utilise les variables de build documentées [par Render](https://render.com/docs/environment-variables) et [par Cloudflare](https://developers.cloudflare.com/pages/configuration/build-configuration/). Il ne nécessite pas de déplacer les secrets de déploiement ni de modifier les réglages des hébergeurs. Les deux noms de workflow font partie du contrat du contrôle.

## Synchronisation OSM et fiches en attente

Une nouvelle identité OSM sans fiche sourcée peut être ajoutée au catalogue interne avec `editorial_status: pending`. Son numéro est réservé durablement. Elle ne crée pas de carte publique, n’entre pas dans les tirages, albums ou exemplaires, et apparaît dans les points de qualité éditoriale de l’administration. Les géométries de carte peuvent ainsi être actualisées sans annoncer une fiche achevée.

La suppression accidentelle d’une fiche déjà vérifiée reste bloquante. Les fiches publiées gardent les contrôles de contenu et de sources existants. Pour publier une carte en attente, ajouter sa fiche vérifiée dans `data/collect_descriptions.json`, régénérer le catalogue et passer les contrôles ; la synchronisation suivante reprend le numéro réservé. Les exemplaires, corrections manuelles, numéros historiques et cartes retirées restent préservés.

Le workflow OSM déclenche explicitement les deux workflows de validation après publication du commit de données, car une poussée effectuée avec `GITHUB_TOKEN` ne déclenche pas les workflows `push`. Il ne lance plus un hook Render en dehors des contrôles de qualité. L’instance publique Private.coffee est ajoutée aux sources de secours ; chaque requête possède une limite de temps.

## Preuves de validation

Les tests couvrent les deux anciens formats géographiques, tous les quartiers et rues du référentiel et les dates planifiées, la concurrence PostgreSQL, la conservation d’un abonnement partagé, l’exclusion des nouvelles cartes en attente et les refus du contrôle de publication. Les parcours navigateur vérifient les deux indices et conservent les accès publics actuels.

Les lectures Overpass locales ont rencontré des serveurs saturés ou sans réponse. Une absence de réponse externe n’est pas présentée comme une mise à jour effective des données ; la synchronisation complète est revérifiée dans GitHub Actions après le push.
