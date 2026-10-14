# Collect Paris : enrichissement Google et contrôle des cadrages

## Résultat

Le catalogue conserve ses 5 943 cartes et leurs identités. Par rapport au commit
`b1407205`, 320 cartes de voies auparavant au logo ont une photo Google Street View.
66 photos de voies existantes ont été remplacées, ainsi que 10 photos de monuments
(une Google et neuf Wikimedia). 69 vues de voies sans remplacement fiable reviennent
au logo Parici. Le gain net est donc de 251 cartes photographiées.

| Famille | Photos | Total | Couverture |
| --- | ---: | ---: | ---: |
| Voies | 5 327 | 5 711 | 93,28 % |
| Quartiers | 80 | 80 | 100 % |
| Monuments | 107 | 107 | 100 % |
| Transports | 45 | 45 | 100 % |
| Ensemble | 5 559 | 5 943 | 93,54 % |

384 voies restent au logo. Il faut encore 99 photos de voies pour atteindre 95 %.
Les autres propriétés des cartes, leurs questions et les identités restent intactes.

## Recherche et sélection

L'outil utilise les mêmes API Google Street View Static et Metadata que le Daily,
avec photographie verticale 430 × 640, champ de vision 85°, panorama explicitement
identifié et crédit Google conservé. La recherche étendue échantillonne jusqu'à
quatre segments par voie, à plusieurs fractions de leur longueur, au lieu de trois
points sur le seul segment principal. Les places et esplanades décrites par des
polygones peuvent maintenant être photographiées : la caméra vise leur surface,
sans inventer un axe de rue à partir de leur contour.

La première recherche sur les 635 voies manquantes a fourni 362 panoramas candidats.
301 ont été retenus après comparaison des deux orientations. Une seconde recherche
sur les 61 refus a fourni 39 autres panoramas, dont 19 retenus. Les recherches
excluent les identifiants de panoramas déjà rejetés. Les contrôles de copyright
Google, date, distance à la géométrie et signatures des fichiers restent actifs.

La sélection privilégie une perspective dans la longueur de la voie et des repères
permettant de reconnaître le lieu. Un accès caractéristique est accepté lorsque
la voie privée ou couverte ne peut être photographiée de l'intérieur. Pour une
place, le sujet est l'espace public identifiable. Les photos de monuments montrent
leur sujet ou une architecture caractéristique ; les transports gardent leur
matériel roulant entier.

## Audit de l'existant

Les 5 308 photographies présentes avant ce travail (5 076 voies et 232 autres cartes)
ont fait l'objet d'une revue visuelle par planches de contrôle. Les nouvelles vues
ont également été comparées dans les deux sens, puis le rendu des cartes a été
contrôlé sur mobile et bureau. Les cas signalés ont été réexaminés avec leurs
alternatives ; cinq signalements ont été levés après confirmation en plus grand.

Parmi les défauts corrigés : panoramas sphériques affichés à plat, façades isolées,
obstacles masquant le sujet, vues prises à un autre niveau que la rue et rues
parallèles extérieures à un cimetière. La proximité GPS et le paramètre Google
`source=outdoor` ne suffisent donc pas à accepter une image.

`data/collect_images/view-audit-20261014.json` attache la revue visuelle au fichier
exact de chaque photographie affichée par son SHA-256. La distance et l'orientation
sont vérifiables avec les métadonnées de capture lorsqu'elles existent. Les anciennes
références Daily/Explorer sans ces métadonnées sont explicitement identifiées comme
références héritées contrôlées visuellement ; elles ne deviennent pas artificiellement
des captures géolocalisées vérifiées.

`data/collect_photo_exclusions_paris.json` bloque les anciennes vues écartées, y compris
leur retour par un repli Daily ou Explorer. Une nouvelle photographie explicitement
revue peut les remplacer. Les fichiers source partagés avec le Daily sont conservés.
La révision de synchronisation en base tient compte des exclusions ; les cartes sans
photo reprennent le logo et les dérogations manuelles restent prioritaires.

Les neuf photographies Wikimedia de monuments conservent auteur, licence, article,
page du fichier et empreinte du téléchargement. Les logos d'articles ont été écartés
au profit de véritables photographies de leurs bâtiments.

## Validation

- 192 tests unitaires réussis, puis tests ciblés du catalogue, des images et de la
  géométrie après les derniers retraits.
- Vérification des 5 943 identités et des fichiers, des SHA-256 et du blocage des vues
  exclues ; seuil de couverture des voies porté à 93 % dans les tests.
- Compilation, contenu joueur, types, formatage, lint ciblé et budgets de performance.
- PostgreSQL local et navigateur Chrome : synchronisation, conservation des dérogations,
  jeu, quotas, collection, crédits et cadrage à 390 et 1 440 px, avec une place et une
  voie piétonne nouvelles, les monuments corrigés et une carte remise au logo.

Collect et Explorer restent sans bouton d'accès public. La récompense Collect du
Daily reste conditionnée à la publication de Collect. Le push ne constitue pas une
vérification du déploiement public.
