# Parici — points 18 à 22

## Images (18)

`npm run images:optimize` génère les variantes depuis les photographies locales
référencées dans les manifestes, avec Sharp et son lockfile. Le cadre entier est
conservé, y compris les crédits incrustés ; aucune image n’est agrandie.
Les miniatures visent 320 px, les grandes images 960 px. Une petite source Collect déjà
dimensionnée reste l’image de détail ; une variante plus lourde est rejetée.
Les chemins incluent l’empreinte de la source et les URL Collect sont en plus
versionnées selon les octets effectivement servis.

Le relevé reproductible figure dans [image-variants.json](image-variants.json).
Les registres couvrent 5 836 photos uniques, dont les 12 photos Explorer.
Sur ce corpus : 504 546 456 octets d’originaux, 141 441 474 pour les miniatures
(-72 %), 406 703 509 pour les détails (-19 %). Ce sont des totaux de fichiers,
pas la mesure d’une session joueur. Le build reste contrôlé sous 20 000 fichiers.
Les photos Explorer passent toujours par leur route d’image ; les images
éditoriales absentes des variantes continuent de fonctionner.

## Photos manquantes (19)

L’état courant comporte 115 rues au logo (113 à l’audit, plus deux nouvelles
entrées du catalogue). Une recherche Panoramax a été faite pour chaque rue,
avec licence, date, proximité à 18 m et cohérence de l’orientation. Treize rues
avaient des candidats à examiner. Quatre photos ont été retenues après contrôle
visuel : Chemin des Israélites, Cité Beaurepaire, Passage Commun P/12 et Passage
Lucien Lambeau. Les panoramas sans cadrage validé, les rues voisines et les
niveaux en tunnel ont été écartés.

Les **111 rues restantes conservent explicitement le logo** ; elles ne sont pas
comptées comme photographiées. Le catalogue atteint 5 834 / 5 945 photos.
Le bilan complet est dans [le CSV](collect-missing-photo-review.csv) et les
candidats, recherches et décisions dans [le JSON](collect-missing-photo-review.json).
`npm run photos:research -- /tmp/parici-research` renouvelle la recherche sans
publier ni importer automatiquement ses résultats.

## Calendrier (20)

187 dates ajoutées du 28 juin au 31 décembre 2027, sans doublon de rue avec les
365 dates initiales. Chaque arrondissement reçoit 9 ou 10 dates. Les photos
proviennent du stock Collect déjà contrôlé : identité canonique, panorama,
position, orientation, empreinte, crédits et revue antérieure sont attachés à
chaque nouvelle date dans le registre géographique Daily. Les octets des photos
sont conservés. Les deux manifestes restent identiques et leur préfixe antérieur
est inchangé. [Relevé d’extension](daily-calendar-extension.json).

`npm run daily:extend -- 2027-12-31` est idempotent. Il refuse une date invalide
ou un calendrier existant discontinu, n’utilise que les photos vérifiées et
échoue si le stock vérifié ne suffit pas. L’extension doit être suivie de
`npm run daily:geography` et `npm run daily:audit -- --strict`.

## Métriques (21)

`/api/metrics` utilise l’authentification dédiée du module d’observabilité.
Le workflow Delivery prépare uniquement `METRICS_TOKEN` sur Render s’il manque,
puis déploie pour appliquer la variable. Une valeur existante est conservée.
Le moniteur lit cette valeur avec les accès Render déjà configurés et la masque ;
un secret GitHub explicite reste possible. La collecte est obligatoire et son
URL est déduite de l’origine de santé si aucune URL explicite n’est donnée.

Les tests isolés contrôlent 401 sans jeton, 503 sans configuration, export
Prometheus, compteurs et latence. Une réponse 503 simulée fait passer le moniteur
en échec au seuil 0 ; le seuil 1 accepte le même compteur. Aucun incident ni
message d’alerte n’est provoqué en production pour ces tests. L’alerte existante
Operations monitor utilise ce résultat ; son fonctionnement en production reste
à confirmer après livraison. Voir [les opérations](../repository-operations.md).
Les accès Render utilisent l’API officielle de [lecture d’une variable](https://api-docs.render.com/reference/retrieve-env-var)
et de [mise à jour d’une seule variable](https://api-docs.render.com/reference/update-env-var).

## Contrats (22)

`src/types/api.ts` décrit les sessions Paris, les réponses, cartes, quotas,
albums, profils, copies, paramètres sociaux, échanges, annonces, signalements et
la progression Explorer. Les scores classés exigent la session vérifiée ; Lecture
ne peut pas devenir une session classée. Les identifiants de carte/exemplaire
sont décrits selon leur forme réelle, avec les clés textuelles de placement
et les UUID de session/offre.

`api.contracts.ts` contrôle les exemples acceptés et les incohérences attendues
à la compilation. `api-boundaries.js`, vérifié avec `checkJs`, valide les réponses
réellement consommées à trois frontières : création/reprise Collect, démarrage
d’une session et synchronisation Explorer. Les tests PostgreSQL utilisent les
réponses HTTP réelles. Ce périmètre ne constitue pas une migration TypeScript
des gros modules historiques.
