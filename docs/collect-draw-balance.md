# Équilibrage Collect : fréquence par carte

Correction du 27 octobre 2026, commune → peu commune → rare → épique.

Le poids peu commun passe de 0,75 à 1,5 : les poids par carte sont désormais
**2 / 1,5 / 1 / 0,8 / 0,8**. Le tirage choisit toujours un groupe (voies célèbres
8 %, principales 18 %, autres 44 %, quartiers/monuments/transports 10 % chacun),
puis une carte avec une probabilité proportionnelle à son poids.

Pour une carte de rareté r dans le groupe g :

`P(carte) = P(groupe g) × poids[r] / somme(effectif[g,s] × poids[s])`.

Le dénominateur tient déjà compte des effectifs par groupe et rareté. Diviser
encore par les effectifs de la rareté ferait remonter artificiellement la
fréquence individuelle des cartes des petites classes. Dans un même groupe,
une peu commune vaut désormais 75 % de la fréquence d'une commune, une rare
50 %, une épique 40 %, quels que soient les effectifs.

## Vérification des catalogues publics

Effectifs actifs lus le 27 octobre 2026 via
`/api/collect/profiles/MPhil/collection/page?family=...&rarity=...`, champ
`summary.active`, sur https://camino2.onrender.com et https://parici.onrender.com.
Les groupes célèbres et principaux correspondent aux albums de ces groupes ;
« autres voies » est le total des voies moins ces deux groupes.
Hypothèses : poids des types par défaut, aucun objectif d'album.

### Camino

| Groupe | Commune | Peu commune | Rare | Épique | Légendaire |
|---|---:|---:|---:|---:|---:|
| famous | 40 | 0 | 0 | 0 | 38 |
| main | 53 | 227 | 1 | 0 | 2 |
| other | 385 | 691 | 978 | 2786 | 14 |
| district | 35 | 24 | 17 | 7 | 28 |
| monument | 17 | 27 | 33 | 10 | 26 |
| bus | 7 | 24 | 56 | 9 | 9 |

Probabilité moyenne par carte précise et par tirage :

| Rareté | Avant | Après |
|---|---:|---:|
| Commune | 0.05534 % | 0.04671 % |
| Peu commune | 0.02105 % | 0.03129 % |
| Rare | 0.01770 % | 0.01549 % |
| Épique | 0.00838 % | 0.00749 % |

### Parici

| Groupe | Commune | Peu commune | Rare | Épique | Légendaire |
|---|---:|---:|---:|---:|---:|
| famous | 45 | 13 | 6 | 3 | 39 |
| main | 271 | 33 | 2 | 0 | 0 |
| other | 369 | 915 | 1022 | 2981 | 12 |
| district | 30 | 13 | 11 | 14 | 12 |
| monument | 28 | 16 | 16 | 13 | 34 |
| bus | 5 | 7 | 26 | 2 | 5 |

Probabilité moyenne par carte précise et par tirage :

| Rareté | Avant | Après |
|---|---:|---:|
| Commune | 0.05572 % | 0.05166 % |
| Peu commune | 0.01068 % | 0.01910 % |
| Rare | 0.01629 % | 0.01449 % |
| Épique | 0.00800 % | 0.00704 % |

## Limites de la garantie

L'ordre est garanti pour le tirage individuel dans un même groupe, avec les
poids corrigés. Il est également vérifié en moyenne par carte sur ces deux
catalogues. Les cartes de groupes différents ne sont pas nécessairement
ordonnées entre elles. Les totaux de cartes par rareté peuvent rester différents
de cet ordre, car ils additionnent des effectifs différents.

Le nombre de copies créées dépend aussi de la réussite, des quotas, des récompenses
Daily/hebdomadaires et des échanges. Il ne suffit pas de connaître les limites
d'essais pour déduire les taux de réussite réels. L'objectif d'album peut modifier
les fréquences individuelles ; il conserve seulement la rareté du tirage initial.
Les légendaires et leurs fragments ne sont pas rééquilibrés dans cette correction.

## Application

La migration est exécutée au démarrage, y compris pour un schéma déjà à jour.
Elle remplace une seule fois l'ancien poids peu commun 0,75 par 1,5, préserve
les autres poids et les réglages explicites différents, puis inscrit un marqueur.
Un redémarrage ultérieur ne réécrit pas les modifications de l'administrateur.
Les exemplaires et les parties existants ne sont pas modifiés.
