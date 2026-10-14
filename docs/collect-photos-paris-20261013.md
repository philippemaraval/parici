# Photographies Collect Paris — 13 et 14 octobre 2026

## Couverture livrée

| Famille | Cartes avec photographie | Total | Couverture |
| --- | ---: | ---: | ---: |
| Rues | 5 044 | 5 711 | 88,32 % |
| Quartiers | 80 | 80 | 100 % |
| Monuments | 107 | 107 | 100 % |
| Transports | 45 | 45 | 100 % |

Les quartiers, monuments et transports atteignent 100 % de photographies. L'objectif de 95 % des voies n'est pas encore atteint : il manque au minimum 382 photos de voies pour ce seuil. Les 667 voies encore sans photo affichent le logo Parici. Voir [l'enrichissement Wikimedia du 14 octobre](collect-photos-paris-20261014.md).

Le catalogue initial contenait 301 photographies, toutes pour des rues (5,27 % des rues). Le premier enrichissement ajoutait 4 457 photographies : 4 349 rues, 71 quartiers et 37 monuments. Un second contrôle a retenu 163 photographies Panoramax supplémentaires de rues. Le troisième enrichissement ajoute 355 photos Wikimedia : 231 voies, 9 quartiers, 70 monuments et 45 lignes de transport. Les 667 cartes restantes affichent le logo Parici, toutes des voies. Les pourcentages portent sur les 5 711 cartes de rues, sans retirer les lieux difficiles du dénominateur.

## Sélection et traçabilité

Les photographies proviennent de Google Street View, de Panoramax et de Wikimedia. Les panoramas Street View sont demandés par coordonnées puis épinglés par identifiant de panorama. Les prises de vue des rues suivent la tangente locale de leur géométrie de jeu, avec deux sens opposés disponibles au contrôle. Le panorama retenu est à 18 mètres au plus de cette géométrie. Les quartiers sont contrôlés dans leur polygone administratif et à 25 mètres au plus d'une voie ; les monuments sont contrôlés à 150 mètres au plus de leur repère.

Le contrôle visuel a porté sur les cadrages des 477 premiers ajouts, puis sur les 4 317 candidates supplémentaires de rues : 3 980 ont été retenues, 337 écartées (murs, intérieurs sans rapport avec le lieu, tunnels parasites, obstacles, flou ou voie insuffisamment visible). Panoramax a ensuite fourni des candidates géolocalisées sur 269 voies ; 163 vues distinctes montrant leur axe ont été retenues après inspection. Les monuments masqués ou mal cadrés affichent le logo Parici jusqu’à l’obtention d’une photographie vérifiée. La présence d'un panorama proche et une réponse HTTP réussie ne valent pas validation du sujet photographié.

`data/collect_photos_paris.json` conserve pour chaque nouvelle photo la source, l'identifiant de la prise de vue, les coordonnées, la distance géométrique, la date de prise de vue, les droits, l'orientation, la décision visuelle et le SHA-256 du fichier. Les clés d'API et les candidates rejetées ne sont pas livrées. Les photos Google Street View et Panoramax nouvelles datent de 2016 ou après. Les photographies Wikimedia peuvent être plus anciennes ; leurs dates sont conservées lorsqu’elles sont renseignées par la source. Leur disponibilité ne garantit pas un état actuel du lieu.

Le crédit Google Street View ou Panoramax et le nom du contributeur restent visibles dans l'art de la carte. La fiche renvoie à la source et indique la licence CC-BY-SA-4.0 pour Panoramax. Les photographies de monuments sont affichées intégralement dans un cadre adapté à leur silhouette.

## Reproduire ou poursuivre l'enrichissement

```sh
node scripts/enrich_collect_paris_photos.js --output /tmp/parici-photos --env-file /chemin/prive/credentials
node scripts/enrich_collect_paris_photos.js --all-streets --output /tmp/parici-photos --env-file /chemin/prive/credentials
node scripts/enrich_collect_paris_photos.js --apply --output /tmp/parici-photos --review /tmp/approvals.json
node scripts/import_collect_panoramax_photos.js /tmp/panoramax-approved.json /tmp/panoramax-images
node scripts/import_collect_wikimedia_photos.js /tmp/wikimedia-approved.json /tmp/wikimedia-images
node scripts/build_collect_paris_catalog.js
```

Le fichier d'approbation est un tableau d'objets `{ "key": "street:Nom exact", "choice": 0, "evidence": "Constat du contrôle visuel" }`. `choice` vaut 0 ou 1. Ne pas approuver une candidate sans examiner son cadrage. `--only` accepte un fichier JSON contenant les identités à traiter ; `--refresh` essaie d'autres positions. Ne pas enregistrer de fichier de credentials dans le dépôt.

## Application et protections

Le catalogue neuf utilise les photographies dès son initialisation. Sur une base existante, la synchronisation s'exécute dans la transaction de mise à niveau déjà protégée par un verrou. Elle ne modifie que les références d'images, préserve les corrections manuelles et leurs crédits, puis mémorise la révision appliquée. Elle ne modifie ni les cartes obtenues, ni les raretés, ni les tentatives Daily.

Collect et Explorer restent sans bouton d'accès public. L'attribution de cartes au Daily reste conditionnée à la publication de Collect.

Les tests contrôlent les empreintes et sources de toutes les photos ajoutées, la couverture minimale de 80 % des rues, les géométries, l'idempotence et la préservation des corrections et collections sur PostgreSQL isolé. Le contrôle Chrome couvre des cartes de rue, quartier et monument aux largeurs 390 et 1 440 pixels, ainsi que les parcours Collect existants. La validation locale et le push ne constituent pas une preuve de déploiement public.
