# Corrections de l'audit Parici — 14 octobre 2026

Périmètre demandé : points 1 à 9 et 15 à 18. Les points 10 à 14 restent différés. Collect et Explorer restent sans bouton d'accès public ; le lancement Collect reste désactivé et aucun gain Daily rétroactif n'est ajouté.

## Fonctionnement

- Explorer ne publie plus les coordonnées, noms des solutions, indices ou explications avant validation. Le choix géographique et la validation se font côté serveur ; les réponses et images sont conservées dans les instantanés de session. Une réponse hors ligne reste en attente de confirmation.
- Les détails publics de Collect excluent désormais les réponses aux questionnaires.
- Les échanges utilisent la présentation compacte de Camino, avec quantités et récapitulatif explicite ; les cartes manquantes sont recherchables par leur nom.
- Une voie dont le nom indique le quartier donne deux essais. Le classement hebdomadaire exclut les participations hors période, même en cas de données incohérentes.
- Les ressources sociales sont intégrées aux fichiers versionnés par empreinte.
- La synchronisation OSM ajoute les cartes et archive les disparitions sans détruire les exemplaires, les ajustements éditoriaux ou les numéros historiques. Un registre interdit la réutilisation des numéros.

## Photographies et Daily

Les 257 Dailies planifiés du 14 octobre 2026 au 27 juin 2027 ont une photographie revue, des métadonnées de panorama et une empreinte vérifiable. La vérification automatique contrôle la proximité de la géométrie et l'axe de prise de vue.

Douze dates futures reçoivent une voie de remplacement reconnaissable dans le même arrondissement ; deux homonymes sont précisés. La migration ne modifie que les cibles futures portant exactement l'ancien nom, sans tentative ni modification humaine. Les résultats existants sont préservés.

Les photographies communes à Collect sont corrigées. Sept images incorrectes sans remplacement fiable reviennent au logo Parici. Couverture après correction : 5 598 voies photographiées sur 5 711 (98,02 %) et 5 830 cartes sur 5 943 ; les autres familles conservent 100 % de couverture.

## Chargement et exploitation

Le partage Daily et la carte de profil sont chargés à la demande. Les rues sont préparées par petits lots avec le Canvas de Leaflet ; ses dessins sont suspendus pendant cette préparation, puis un dessin complet est déclenché. Les observateurs des icônes et des photos ignorent les changements internes de Leaflet ; les polices ne bloquent plus le premier affichage. Les budgets incluent les dépendances statiques du point d'entrée.

Les tests de navigateur utilisent Chromium en CI et Chrome localement, avec les intégrations exécutées séquentiellement pour éviter les collisions de port. La vérification du démarrage ne dépend plus d'un nombre fixe de requêtes SQL.

La livraison compare les révisions publiques du frontend et du backend. En l'absence des accès Render, elle indique explicitement qu'elle est différée. Les sauvegardes échouent immédiatement si leurs secrets sont absents. Nodemailer est mis à jour et l'audit des dépendances de production ne signale plus de vulnérabilité.

## Limites de validation

Les tests de sauvegarde/restauration et d'envoi SMTP portent sur des services locaux isolés. La livraison Render, la sauvegarde de production et la délivrabilité des courriels externes attendent la configuration des accès, différée à la demande de l'utilisateur. Un push Git ne prouve pas leur activation en production.

Les préparations locales antérieures de rareté sont conservées à part et ne font pas partie de cette livraison.

## Vérifications locales

- 198 tests unitaires réussis ; lint sans erreur, format et TypeScript validés.
- Intégrations PostgreSQL, Explorer et Collect avec Chrome, restauration chiffrée et serveur SMTP local réussis. Un délai du parcours joueur dans la série complète a nécessité une relance isolée, réussie.
- 36 tests de navigateur réussis, 4 ignorés car réservés à l'autre type d'appareil ; captures contrôlées sur ordinateur et mobile. Deux tests supplémentaires valident les anciennes pages en cache après DOMContentLoaded. Le parcours authentifié sur les données réelles passe après la dernière optimisation du Canvas.
- Audit géographique : 257 dates vérifiées ; audit des dépendances de production : aucune vulnérabilité.
- Budgets de taille respectés : point d'entrée 210,4 Kio, JavaScript initial 235,2 Kio, carte compressée 435,1 Kio.

La mesure Lighthouse locale finale reste sous le seuil : 72/100 (seuil 85), LCP 1 291 ms, TBT 542 ms (seuil 200 ms). Le point 17 est donc partiellement corrigé : les tailles passent et les chargements à la demande sont en place, mais le budget de blocage reste ouvert. Les seuils ne sont pas abaissés. Les rapports sont conservés localement, sans nouvel upload public.
