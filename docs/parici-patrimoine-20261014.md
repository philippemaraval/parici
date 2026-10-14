# Fiches patrimoniales de Collect — point 10

Le périmètre demandé est intégralement couvert, avec des textes courts et factuels dans le format des fiches de Camino : un résumé, une notice de quelques phrases et une source documentaire propre au lieu.

| Cartes | Fiches enrichies | Couverture |
| --- | ---: | ---: |
| Voies célèbres | 106 | 100 % |
| Voies principales | 306 | 100 % |
| Monuments | 107 | 100 % |
| Quartiers | 80 | 100 % |
| Lignes de transport | 45 | 100 % |
| **Total du périmètre** | **644** | **100 %** |

Huit autres notices historiques, déjà présentes pour des voies d’Explorer hors de ces albums, sont conservées. Le catalogue compte donc 652 cartes avec une source patrimoniale distincte du simple référentiel OpenStreetMap. Ce total ne signifie pas que les 5 711 voies ont toutes une fiche patrimoniale.

## Sources et rédaction

Les voies s’appuient sur la [nomenclature officielle de la Ville de Paris](https://opendata.paris.fr/explore/dataset/denominations-emprises-voies-actuelles/). Le relevé utilisé contient 6 625 dénominations et a été mis à jour le 8 octobre 2026. Chaque fiche conserve son identifiant de notice et un lien filtré vers la source. Le producteur et la licence ODbL sont indiqués ; l’interface crédite la Ville de Paris.

Les autres familles utilisent les articles propres aux lieux, avec identifiant de révision lorsqu’il s’agit de Wikipédia, ainsi que des références institutionnelles. Les textes sont reformulés, avec des faits stables : origine des noms, anciennes fonctions, personnages, dates de construction ou étapes de développement. Les statistiques de fréquentation et les prévisions de prolongement ne sont pas reprises comme des faits établis.

La résolution des identités écarte les pages d’homonymie : Conciergerie, École militaire, Grand Palais, Palais-Royal, église Saint-Gervais, Vivienne, Monnaie, Saint-Georges et quartier Notre-Dame. « Les Îles » est rattaché à la bonne subdivision parisienne, sans renommer la carte.

Des contre-sources corrigent des erreurs de notices anciennes : [Oradour, 10 juin 1944](https://www.oradour.org/recit-du-massacre), [Christophe-Philippe Oberkampf](https://www.museedelatoiledejouy.fr/histoire/lhistoire-de-la-manufacture-oberkampf/) et [le nom de l’île Saint-Louis](https://www.paris.fr/pages/8-anecdotes-etonnantes-sur-les-iles-parisiennes-16403). Les étapes du [T14](https://www.iledefrance-mobilites.fr/actualites/ligne-p-devient-ligne-t14) et de la [ligne V](https://www.transilien.com/fr/page-presse/communiques-de-presse) sont vérifiées auprès des réseaux.

## Intégration

`data/collect_descriptions.json` porte les 644 notices. Le générateur les utilise pour le résumé, la description complète et le lien documentaire. Les corrections manuelles enregistrées en base conservent leur priorité. La santé éditoriale compte les cartes réellement documentées, sans additionner deux fois une même carte.

Le contrôle de contenu refuse une fiche manquante, une source seulement cartographique ou un catalogue qui n’a pas été régénéré. Les données éditoriales brutes sont exclues du site statique ; les fiches passent par l’API habituelle de Collect.

Les 644 cartes ne changent que leurs champs descriptifs : identités, géométries, numéros, photographies, raretés, questions et fragments sont préservés. Les 31 reclassements locaux de rareté restent à part. Collect et Explorer restent sans bouton d’accès public ; la récompense Daily reste désactivée jusqu’au lancement public de Collect.

## Vérifications

La couverture est contrôlée carte par carte et les champs de jeu sont comparés au catalogue publié avant ce changement. Les tests de données vérifient les homonymies et les corrections factuelles citées ci-dessus. Les parcours PostgreSQL et Chrome contrôlent l’API, la priorité du contenu manuel et l’affichage de fiches des quatre familles à 390 et 1 440 pixels.

Le push Git ne vaut pas confirmation du déploiement Render, dont les accès restent différés à la demande de l’utilisateur.
