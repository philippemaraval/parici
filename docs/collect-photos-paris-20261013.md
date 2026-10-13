# Photographies Collect Paris — 13 octobre 2026

## Couverture livrée

| Famille | Cartes avec photographie | Total | Couverture |
| --- | ---: | ---: | ---: |
| Rues | 4 650 | 5 711 | 81,42 % |
| Quartiers | 71 | 80 | 88,75 % |
| Monuments | 37 | 107 | 34,58 % |
| Transports | 0 | 45 | 0 % |

Le catalogue précédent contenait 301 photographies, toutes pour des rues (5,27 % des rues). Cette livraison ajoute 4 457 photographies : 4 349 rues, 71 quartiers et 37 monuments. Les 1 061 rues restantes conservent leur illustration cartographique. Le seuil de 80 % porte sur les 5 711 cartes de rues, sans retirer les lieux difficiles du dénominateur.

## Sélection et traçabilité

Les images sont des photographies Street View réelles. Les panoramas sont demandés par coordonnées puis épinglés par identifiant de panorama. Les prises de vue des rues suivent la tangente locale de leur géométrie de jeu, avec deux sens opposés disponibles au contrôle. Le panorama retenu est à 18 mètres au plus de cette géométrie. Les quartiers sont contrôlés dans leur polygone administratif et à 25 mètres au plus d'une voie ; les monuments sont contrôlés à 150 mètres au plus de leur repère.

Le contrôle visuel a porté sur les cadrages des 477 premiers ajouts, puis sur les 4 317 candidates supplémentaires de rues : 3 980 ont été retenues, 337 écartées (murs, intérieurs sans rapport avec le lieu, tunnels parasites, obstacles, flou ou voie insuffisamment visible). Les monuments masqués ou mal cadrés conservent leur illustration cartographique. La présence d'un panorama proche et une réponse HTTP réussie ne valent pas validation du sujet photographié.

`data/collect_photos_paris.json` conserve pour chaque nouvelle photo la source, l'identifiant du panorama, les coordonnées, la distance géométrique, la date de prise de vue, le copyright du fournisseur, l'orientation, la décision visuelle et le SHA-256 du fichier. Les clés d'API et les candidates rejetées ne sont pas livrées. Les photos nouvelles datent de 2016 ou après ; leur disponibilité ne garantit pas un état actuel de la rue.

Le crédit Google Street View reste visible dans l'art de la carte et la fiche renvoie au panorama source. Les photographies de monuments sont affichées intégralement dans un cadre adapté à leur silhouette.

## Reproduire ou poursuivre l'enrichissement

```sh
node scripts/enrich_collect_paris_photos.js --output /tmp/parici-photos --env-file /chemin/prive/credentials
node scripts/enrich_collect_paris_photos.js --all-streets --output /tmp/parici-photos --env-file /chemin/prive/credentials
node scripts/enrich_collect_paris_photos.js --apply --output /tmp/parici-photos --review /tmp/approvals.json
node scripts/build_collect_paris_catalog.js
```

Le fichier d'approbation est un tableau d'objets `{ "key": "street:Nom exact", "choice": 0, "evidence": "Constat du contrôle visuel" }`. `choice` vaut 0 ou 1. Ne pas approuver une candidate sans examiner son cadrage. `--only` accepte un fichier JSON contenant les identités à traiter ; `--refresh` essaie d'autres positions. Ne pas enregistrer de fichier de credentials dans le dépôt.

## Application et protections

Le catalogue neuf utilise les photographies dès son initialisation. Sur une base existante, la synchronisation s'exécute dans la transaction de mise à niveau déjà protégée par un verrou. Elle ne modifie que les références d'images, préserve les corrections manuelles et leurs crédits, puis mémorise la révision appliquée. Elle ne modifie ni les cartes obtenues, ni les raretés, ni les tentatives Daily.

Collect et Explorer restent sans bouton d'accès public. L'attribution de cartes au Daily reste conditionnée à la publication de Collect.

Les tests contrôlent les empreintes et sources de toutes les photos ajoutées, la couverture minimale de 80 % des rues, les géométries, l'idempotence et la préservation des corrections et collections sur PostgreSQL isolé. Le contrôle Chrome couvre des cartes de rue, quartier et monument aux largeurs 390 et 1 440 pixels, ainsi que les parcours Collect existants. La validation locale et le push ne constituent pas une preuve de déploiement public.
