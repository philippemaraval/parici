# Performance

Le build de production applique automatiquement les optimisations suivantes :

- bundle principal minifié et ressources statiques fingerprintées ;
- absence de source maps dans `dist/` ;
- carte des rues simplifiée, fingerprintée et découpée par quartier ;
- contrôle des tailles avec `npm run performance:check`.

Les seuils sont centralisés dans `performance-budgets.json`. La CI exécute également
Lighthouse sur trois passes et bloque si LCP, CLS ou le budget de réactivité sont
dépassés. TBT sert de proxy de laboratoire pour l’INP, qui reste une métrique de
terrain.


## Fluidité des cartes et de Collect

Les cartes partagent `src/map-rendering.js` : lots de 100 tracés au maximum,
budget de 4 ms par lot et une seule demande de dessin du canevas en fin de
construction. Une erreur ou une annulation retire la couche partielle et rétablit
le dessin. Le préchauffage Collect est annulable dès le lancement d'une partie ;
les téléchargements déjà partagés restent réutilisables.

Collect indexe les segments par réponse et ne restyle que les sélections et essais
concernés. La tolérance tactile du canevas remplace les doubles tracés invisibles
des rues. Le scénario `collect-fluidity.spec.js` conserve 3 000 rues, vérifie un
vrai clic tactile à 10 px du trait et mesure 2 mises à jour de style au changement
de sélection, contre 3 000 avec l'ancien code Camino. Sur mobile, le nombre de
tracés passe de 6 000 à 3 000. Ces mesures utilisent des données synthétiques et
une API simulée ; elles ne mesurent pas le temps de réponse du serveur public.

Les bundles ciblent ES2020, conservant notamment les syntaxes `?.` et `??` déjà
utilisées par les scripts non transpilés. Cela réduit le code téléchargé et analysé.
Les budgets existants restent inchangés.
