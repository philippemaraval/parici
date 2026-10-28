# Harmonisation de l’interface Parici

Adaptation des changements Camino du 28 octobre sur l’accueil, les modes
Classique/Chrono/Marathon/Lecture, Daily, Collect, le profil et les pages publiques.
Explorer reçoit les styles et compteurs à son URL directe ; ses liens publics
restent absents. Les règles, données, crédits photographiques et textes de Paris
sont conservés. L’accueil présente trois modes, avec trois colonnes sur ordinateur.

## Présentation

- Accueil et profil disposent d’une vue dédiée sur ordinateur.
- Introduction centrée, sans illustration entre le texte et les destinations.
- Surfaces et navigation communes, état courant et focus clavier visibles.
- Invitation de connexion Collect au format compact du Daily.
- Compteurs NumberFlow natifs, GSAP pour les entrées et effets discrets au pointeur
  inspirés de React Bits, sans ajouter React.
- Valeurs lisibles sans animation ; zéros des décomptes et ponctuation décimale
  conservés. Le masque NumberFlow utilise une longueur CSS valide `0em`.
- Modules facultatifs séparés, locaux et fingerprintés ; respect du réglage de
  réduction des animations. La carte reste indépendante de ces animations.
- Décodage asynchrone des images et chargement immédiat des cartes récompenses.
  Les variantes photographiques et leurs attributions Paris restent conservées.

Le traitement des images reprend les principes Squoosh sans ajouter ce service
aux dépendances ; les variantes WebP existantes restent la source des vignettes et
photos détaillées. Les principes de hiérarchie des parcours suivent la même
adaptation de Mobbin que dans Camino.

## Validation locale

Les treize destinations sont vérifiées à 320, 390 et 1440 pixels. Les contrôles
couvrent les quatre types de partie avec Leaflet et les géométries de Paris,
le retour des commandes, le profil connecté, les récompenses Daily/Collect,
les variantes photographiques et la position des chiffres dans le Shadow DOM.
Les décomptes, décimales, changements de valeur, parcours clavier et défaillances
des modules facultatifs sont vérifiés.

La copie de développement charge les neuf photos nécessaires au parcours de
vérification des variantes. Huit audits unitaires qui nécessitent la photothèque
complète sont exclus de la suite locale ; ils restent présents et actifs en CI.
Les fixtures de compte et API utilisées par le navigateur sont locales et ne
créent aucun compte en production. Les tests ne valident pas un déploiement public.

Résultats : 42 scénarios Chromium réussis sur ordinateur et mobile, deux scénarios
Explorer réservés au mobile ignorés sur ordinateur. 255 tests unitaires réussis
avec les huit audits photographiques exclus explicitement. Build, lint sans
erreur, formatage, typage, cohérence des dépendances et budgets de performance
validés. Le contrôle global de contenu reste limité par les photos Daily absentes
de cette copie de développement.

## Portabilité des contrôles GitHub Actions

Le refus Render du commit `8c0f6fe` provenait du job E2E. Les captures des nouveaux
parcours utilisaient `/private/tmp`, absent sous Linux ; elles utilisent désormais
`testInfo.outputPath`, distinct pour chaque scénario, terminal et tentative.
Les deux assertions de série Daily lisent le texte rendu au lieu de concaténer
les rouleaux décoratifs du Shadow DOM de NumberFlow. La valeur accessible et les
positions des chiffres restent vérifiées par les contrôles dédiés.
Le verrou de publication Render et ses contrôles du commit exact restent actifs.
