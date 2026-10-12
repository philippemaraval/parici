# Rattrapage Parici — lots 1 à 12

Livraison demandée sur `main`, à partir de Parici `03c98af` et du référentiel Camino `4166619`. Le checkout local de travail de l’utilisateur est conservé ; la livraison est préparée dans une copie propre du dépôt Parici.

## Périmètre livré

| Lot | Comportement |
| --- | --- |
| 1 | Cibles et scores des parties connectées calculés côté serveur, réponses ordonnées et rejouables sans doublon, pauses et défis amis vérifiés. |
| 2 | Daily : réussite, distance et nombre d’essais calculés côté serveur ; les requêtes simultanées et répétées sont dédupliquées. |
| 3 | Un clic sur un essai Daily permet de revoir la rue sur la carte. |
| 4 | Les photos indices acceptent le pincement pour zoomer. |
| 5 | Les tronçons de transports superposés proposent un choix explicite par couleur. |
| 6 | Le résultat de la dernière réponse reste visible avant le bilan ; les doubles réponses sont bloquées. |
| 7 | Le zoom involontaire de la page est bloqué en conservant les gestes des cartes et photos. |
| 8 | Navigation et menu communs, réglages de confort et accès au profil. |
| 9 | Cloche de notifications Daily et lecture enregistrée séparément pour chaque compte. |
| 10 | Remarques, contact par courriel et signalements enregistrés ; consultation des signalements réservée aux administrateurs via API. |
| 11 | Page Versions et publication automatique le lundi à partir des notes de commit, sans modifier manuellement les badges. |
| 12 | Ajustements des pages et du profil sur mobile, clarification de l’évolution du score moyen et des périodes de quatre semaines. |

Collect et Explorer sont approuvés pour une livraison ultérieure. Aucun bouton ni lien vers leurs pages n’est ajouté ici. Les données, noms et repères géographiques restent ceux de Paris, ainsi que l’identité visuelle Parici.

## Validation

- Deux suites PostgreSQL réussies sur une base locale isolée : démarrage initial et migration additive sur base déjà initialisée ; sessions, scores, autorisations, concurrence Daily, notifications et signalements.
- Chrome : partie connectée complète avec enregistrement du score ; revue de la navigation et des pages à 320, 390, 430, 768 et 1440 pixels.
- Parcours de non-régression : authentification, profil, ouverture Daily, récupération réseau, classements et réglages de sons.
- Tests des interactions carte/Daily, sélection des transports et pincement des photos : 8 réussites, 2 cas réservés au mobile ignorés sur desktop.
- Suite Node : 160 réussites sur 161 (défaut antérieur documenté ci-dessous). Construction, lint (aucune erreur), formatage, types, dépendances, données OSM et budgets de performance validés.
- Mise à jour compatible du verrou de dépendances pour retirer les alertes critiques ; aucune migration majeure de Nodemailer.

## Limite connue indépendante du rattrapage

Le test du manifeste Daily signale `2027-01-30: Tunnel Grand-Maillot (Quartier des Ternes)`, absent de `streets_index.json`. Le même échec est reproduit sur une archive exacte de `03c98af`, avant ces changements. Cette livraison ne remplace pas cette cible ni sa photo : une correction géographique contrôlée reste nécessaire. En conséquence la suite globale et le contrôle CI correspondant restent rouges sur ce défaut antérieur.

Le push n’atteste pas du déploiement public. Aucune donnée de production n’a été modifiée pour les validations.
