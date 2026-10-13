# Lots 22 et 23 : Explorer Paris

Le mode est accessible directement par `/explorer.html`, l’éditeur par
`/admin/explorer/`. Aucun bouton ou lien vers Explorer ou Collect n’est ajouté à
l’accueil, à la navigation, au menu ou à l’administration existante. La page de jeu
est exclue de l’indexation ; elle reste accessible pour les essais avant lancement.

Le catalogue comporte douze énigmes : huit dans le Marais et quatre sur la rive gauche. Les voies et coordonnées
proviennent du catalogue OSM parisien réel. Les photos sont des vues parisiennes
existantes du Daily, reprises avec leur attribution visible ; elles sont présentées
comme des photos indices, pas comme des archives historiques. Le fichier
`data/explorer_paris.json` conserve les sources des explications et des images.

Le joueur utilise sa localisation et photographie une plaque, lue par Tesseract.
Les étapes sont démarrées côté serveur. La synchronisation vérifie le nom de rue,
la proximité à sa géométrie (100 m), le temps écoulé et l’utilisation d’un indice.
Les points fournis par le navigateur sont ignorés. Les doublons sont idempotents,
la progression est isolée par compte et restaurée depuis le serveur. Les envois en
attente restent stockés localement pour être repris à la reconnexion.

L’éditeur réutilise les comptes et autorisations Parici existants : recherche des
rues, image, textes, coordonnées, carte, aperçu et simulation sans score.
Une révision protège les modifications concurrentes. L’archivage conserve les
résultats et les étapes déjà commencées, avec leur contenu d’origine ; la
réactivation est possible. Les images téléversées sont stockées dans PostgreSQL.

La migration additive est exécutée au démarrage, sous le verrou existant. Les
huit énigmes initiales sont insérées une seule fois par leur clé stable : un
redémarrage ne réécrit ni les éditions ni les archives. Aucune réinitialisation des
comptes, scores ou parties existantes n’est incluse.

Les liens RGPD et Mail sont retirés des pieds de page concernés. Confidentialité
et contact restent accessibles dans le menu latéral.

Validation : tests unitaires OCR/score, intégration contre PostgreSQL isolé
(autorisations, reprises, concurrence, archives, simulations, téléversement),
build, lint, types et budgets de performance. Les essais navigateur emploient une
position simulée et une plaque de test ; ils ne remplacent pas un parcours à pied.
Chrome a validé la lecture OCR réelle d’une plaque de test, la confirmation
serveur, la reprise après rechargement et l’éditeur entre 320 et 1440 px.
La cible introuvable Tunnel Grand-Maillot du 30 janvier 2027 a été remplacée par la rue de Sablonville et une photo existante correspondante. Les énigmes ajoutées sont documentées par la Ville de Paris et le Centre des monuments nationaux ; elles restent à valider lors d’un parcours à pied.
