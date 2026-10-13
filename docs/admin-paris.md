# Administration Parici — lots 24 à 33

Les interfaces sont accessibles aux équipes autorisées dans `/admin/`, `/admin/studio.html` et `/admin/operations.html`.

- Annuaire paginé, recherche et dossiers avec activité des différents modes.
- Calendrier Daily, coordonnées parisiennes, photos persistantes et statistiques de participation.
- Brouillons, aperçu, programmation, publication avec contrôle des conflits, historique et restauration.
- Assistance aux joueurs avec aperçu, motif obligatoire et protection contre les doubles interventions.
- Signalements, affectation, résolution et contrôles de qualité.
- Permissions, double authentification facultative, gestion des sessions et confirmation des opérations sensibles.
- Statistiques par période, cohortes et campagnes dans la cloche de notifications, avec choix de réception.
- Contrôles de livraison, sauvegardes chiffrées, historique des exécutions et restauration dans une base isolée.

Les migrations additives sont exécutées au démarrage sous verrou PostgreSQL. Elles conservent les données existantes. Les cibles Daily déjà commencées sont protégées contre la republication éditoriale.

Collect et Explorer restent sans bouton d'accès public. La date de lancement Collect reste `infinity` : les récompenses Daily ne sont pas activées et aucun rattrapage rétroactif n'est introduit.

Le workflow de sauvegarde utilise les secrets existants `PRODUCTION_DATABASE_URL` et `BACKUP_ENCRYPTION_PASSPHRASE`. La restauration impose une base locale distincte, `CAMINO_RESTORE_ISOLATED=1` et la vérification du checksum. Voir `/admin/restore-guide.html` pour la procédure.

Les tests d'intégration utilisent une base PostgreSQL jetable (`TEST_DATABASE_URL`). `CAMINO_REAL_BROWSER=1` active Chrome sur les interfaces réelles ; `TEST_BACKUP_TOOLS=1` active le test de sauvegarde/restauration avec les outils PostgreSQL installés. Ces contrôles locaux ne constituent pas une preuve de déploiement en production.
