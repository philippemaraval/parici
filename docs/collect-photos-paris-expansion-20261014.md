# Collect Paris : recherche approfondie des voies encore sans photographie

## Résultat

Par rapport à `b5b6ec65`, 128 cartes de voies supplémentaires disposent d'une
photographie : 68 Google Street View et 60 Wikimedia. Les autres photographies
du catalogue sont conservées. Les 5 943 identités et les données non photographiques
des cartes restent inchangées.

| Famille | Photos | Total | Couverture |
| --- | ---: | ---: | ---: |
| Voies | 5 455 | 5 711 | 95,52 % |
| Quartiers | 80 | 80 | 100 % |
| Monuments | 107 | 107 | 100 % |
| Transports | 45 | 45 | 100 % |
| Ensemble | 5 687 | 5 943 | 95,69 % |

Les voies au logo passent de 384 à 256, soit une diminution d'un tiers. Le seuil
de 95 % demandé est dépassé et devient le minimum vérifié par les tests.

## Recherche Google

Le nouvel échantillonnage exhaustif visite toutes les portions de la voie, leurs
entrées et des points espacés d'au plus 15 mètres. Il ne s'arrête plus aux quatre
portions les plus longues. Pour les places représentées par des surfaces, le
contour est échantillonné plus finement. Trois recherches ont utilisé des rayons
de 8, 20 puis 5 mètres, en excluant les panoramas déjà examinés et refusés.

Les trois recherches ont fourni respectivement 129, 104 et 13 panoramas candidats,
avec deux orientations par panorama. 72 vues Google ont été retenues au cours de
la revue ; quatre ont ensuite été améliorées par une photographie Wikimedia plus
claire, ce qui laisse 68 vues Google dans le lot final.

Le copyright Google, les coordonnées, la distance à la voie (18 mètres maximum),
le panorama exact, le cap, la date et le SHA-256 restent enregistrés. Le rayon de
recherche est indépendant du contrôle de distance à la géométrie. Les captures
anciennes peuvent être recherchées explicitement avec `--oldest-year`, sans
modifier la limite de dix ans par défaut. Sept vues retenues datent de 2008 à
2015 ; leur date réelle est conservée et elles ne sont pas présentées comme récentes.

## Revue visuelle et compléments Wikimedia

Chaque nouvelle vue a été examinée visuellement. Les perspectives longitudinales
et les repères identifiables sont privilégiés ; les places et les esplanades doivent
montrer leur espace public. Les portes isolées, les vues à un autre niveau que la
voie, les façades sans perspective et les rues parallèles extérieures aux cimetières
ont été écartées. Un téléchargement réussi ou une courte distance GPS ne vaut pas
validation du sujet.

Les variantes orthographiques et les traits d'union des titres Wikipédia ont été
recherchés pour débloquer les allées récentes et les passages piétons. Les images
principales, puis des images alternatives des articles ont été contrôlées. Les
photographies historiques de bâtiments disparus, les plaques, les portes seules
et les vues de chantier ne permettant pas de reconnaître la voie ont été refusées.

Les 60 photographies Wikimedia finales conservent auteur, licence, article,
coordonnées de l'article à moins de 350 mètres du centre de la carte, page Commons
du fichier et empreinte des octets téléchargés. Le contrôle visuel de la perspective
complète cette association géographique. L'audit des images existant est conservé
et enrichi avec les 128 nouvelles références exactes.

## Validation et publication

- Tests du catalogue, des fichiers, des crédits, de l'audit SHA-256 et des exclusions.
- Test de l'échantillonnage exhaustif : toutes les portions, entrées et espacement.
- Compilation, tests unitaires, lint ciblé, types, contenu et budgets de performance.
- PostgreSQL et Chrome : synchronisation et conservation des dérogations ; rendu des
  nouvelles photographies Google et Wikimedia à 390 et 1 440 pixels ; repli au logo.

Collect et Explorer restent sans bouton d'accès public. La récompense Collect du
Daily reste conditionnée à la publication de Collect. Le push ne prouve pas le
déploiement public.
