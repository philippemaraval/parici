# Collect Paris : panoramas de contributeurs et voies de cimetières

## Résultat

Par rapport à `08d7f70d`, 150 cartes de voies supplémentaires ont une photographie :
67 vues Google Street View de contributeurs et 83 photographies Wikimedia Commons.
Les photographies précédentes, les 5 943 identités et toutes les données non
photographiques des cartes sont conservées.

| Famille | Photos | Total | Couverture |
| --- | ---: | ---: | ---: |
| Voies | 5 605 | 5 711 | 98,14 % |
| Quartiers | 80 | 80 | 100 % |
| Monuments | 107 | 107 | 100 % |
| Transports | 45 | 45 | 100 % |
| Ensemble | 5 837 | 5 943 | 98,22 % |

Il reste 106 voies au logo, contre 256 avant cette reprise : 58,59 % de moins.
La couverture minimale vérifiée par les tests passe de 95 % à 98 % des voies.

## Google Street View

L'outil peut maintenant chercher explicitement les panoramas de contributeurs
diffusés par Google, avec `--include-contributors`. La restriction aux captures
dont le copyright mentionne Google reste le comportement par défaut. Le fournisseur
de l'API et l'auteur de la photographie sont enregistrés séparément : un panorama
de contributeur n'est pas présenté comme une photographie prise par Google.

La première recherche sur les 256 voies manquantes a fourni 123 panoramas candidats,
avec deux orientations par panorama ; 64 ont été retenus. Une seconde recherche sur
les 192 voies restantes, avec échantillonnage tous les cinq mètres, a fourni 38
autres panoramas ; 12 ont été retenus. Les rayons de recherche étaient de 20 puis
12 mètres. Les panoramas déjà examinés et refusés étaient exclus de la recherche.
Le contrôle final du cadrage a conduit à sept remplacements par des photos Commons,
un remplacement par un autre panorama Google et deux retours au logo. Les 67 vues
Google du lot final montrent une perspective plus lisible dans le format des cartes.

Les coordonnées de capture, l'identifiant du panorama, le cap, la date réelle,
le copyright original et le SHA-256 sont conservés. La distance à la géométrie
reste limitée à 18 mètres. Les captures anciennes restent une option explicite,
avec une limite de dix ans par défaut. Les salles de commerces, vues intérieures
étrangères à la voie et panoramas manifestement mal localisés ont été refusés.

Le crédit de la carte affiche désormais « Google Street View · auteur » pour les
contributeurs. Le nom est échappé en HTML, conservé dans le titre du crédit et
transmis par les réponses de l'API de collection. Les anciens crédits Google,
Wikimedia et Panoramax restent compatibles.

La [documentation des métadonnées Google](https://developers.google.com/maps/documentation/streetview/metadata)
décrit les coordonnées, la date, l'identifiant de panorama et le copyright renvoyés
par le service.

## Wikimedia Commons

Les 180 voies encore sans photo après les recherches Google ont été recherchées
sur Commons. Les noms sont rapprochés en tenant compte des accents, des traits
d'union et des articles. Les requêtes ont été espacées ; les réponses 429 ont été
réessayées après attente.

182 photographies candidates initiales et 16 candidates complémentaires pour les
corrections de cadrage ont été téléchargées. Chacune nomme la voie dans le
nom de son fichier et possède des coordonnées originales à moins de 18 mètres
de sa géométrie. La revue visuelle a retenu 83 fichiers montrant la voie dans sa
longueur, son accès caractéristique ou sa galerie lorsqu'il s'agit réellement
d'un passage couvert. Les portes seules, plaques, photographies historiques de
bâtiments disparus et vues à un autre niveau ont été écartées.

L'importateur distingue ces fichiers géolocalisés des illustrations associées
à un article Wikipédia. Il contrôle le nom du fichier, l'identité de sa page Commons,
sa proximité avec la voie et sa licence. Les coordonnées d'un article ou d'un
cimetière ne remplacent pas artificiellement celles du fichier. Auteur, licence,
page d'origine, date disponible et empreinte du fichier sont conservés.

Les 14 dernières voies ayant d'anciennes pistes Panoramax ont aussi été réexaminées.
Les trois pistes les plus plausibles ont été téléchargées en plus grand ; aucune
n'a été ajoutée, faute de cadrage suffisamment fiable pour cette carte.

## Validation

- 194 tests unitaires, dont crédits Google des contributeurs, géométrie Commons,
  couverture, fichiers et audit SHA-256.
- Compilation, lint ciblé, types, formatage, contenu joueur et budgets de performance.
- Contrôle des 5 943 identités et données non photographiques inchangées.
- PostgreSQL local et Chrome : synchronisation des photos, conservation des dérogations,
  jeu, quotas, collection et crédits réels à 390 et 1 440 pixels ; une allée de
  cimetière, une galerie couverte et une carte restant au logo sont incluses.
- Revue des nouvelles photographies dans le cadrage des cartes.

Collect et Explorer restent sans bouton d'accès public. La récompense Collect du
Daily reste conditionnée à la publication de Collect. Le push ne constitue pas
une vérification du déploiement public.
