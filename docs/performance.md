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
