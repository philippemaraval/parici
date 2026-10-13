# Corrections du rattrapage Parici

- Catégories normalisées : 106 rues célèbres et 306 principales hors célèbres. Les albums et filtres s’appuient sur ces catégories ; les raretés initiales reprennent l’échelle provisoire de Camino.
- Migration ciblée `parici_collect_catalog_revision=20261013-2` sous le verrou de démarrage : conserve les exemplaires, favoris, albums personnels, corrections manuelles et raretés déjà évaluées. Les exigences des huit cartes à fragments initiales restent stables.
- Les 142 illustrations de rues génériques ont retrouvé des tracés via la résolution cartographique du jeu. Les monuments ponctuels montrent leur repère avec les voies voisines réelles. Les illustrations restent explicitement cartographiques.
- Six monuments bénéficient de fiches et questions vérifiées auprès de sources institutionnelles (références dans `data/collect_paris_editorial.json`). Quatre énigmes rive gauche s’ajoutent à Explorer. Le catalogue compte 18 cartes à fragments et 54 questions.
- La cible Daily du 30 janvier 2027 utilise désormais la rue de Sablonville et une photo existante de cette rue. La correction d’une cible déjà enregistrée est limitée à cette ancienne cible, encore future et sans tentative ni photo éditoriale.
- Les photos Daily et les corrections Collect sont raccordées. Une publication Daily met à jour la photo de la carte correspondante dans la même transaction ; une correction photo Collect est ensuite reprise par le Daily. Une illustration SVG ne remplace pas une photo indice.
- Diagnostics de couverture géométrique et de distribution des tirages ; contrôles des effectifs des albums et affichage explicite de la couverture éditoriale.
- Réveil quota `health?collect=1` raccordé et déclaré dans OpenAPI, avec protection contre les traitements simultanés.
- Intégration cloche, réglages et résumé du profil préparée derrière les indicateurs de publication. Collect reste bloqué par `collect_launch_at=infinity`, Explorer par l’absence de `explorer_public=true`. Aucun bouton d’accès public n’est ajouté. Les gains Daily antérieurs au lancement restent inéligibles.
- Les contrôles de livraison comparent les identifiants frontend/backend au commit demandé ; `npm run content:check` contrôle les catégories et les cibles Daily futures dans la CI.

Les photos supplémentaires, la réception des push sur des appareils physiques et les parcours à pied restent à valider. Le contenu enrichi ne constitue pas une couverture patrimoniale exhaustive de Paris.
