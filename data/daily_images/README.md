# Images du Daily Camino Paris

`manifest_next_30.csv` planifie une année de rues du Daily. Il est généré avec :

```bash
npm run daily:manifest -- --from YYYY-MM-DD --days 365
```

Le serveur utilise immédiatement ces rues avec PostgreSQL, même sans photo.

Pour ajouter les indices Street View, configurer `GOOGLE_STREET_VIEW_API_KEY`
dans `.env.local`, puis lancer :

```bash
npm run daily:streetview -- --from YYYY-MM-DD --only-missing
```

Les images attendues suivent le format `YYYY-MM-DD__nom-de-rue.jpg`.

Contrôler régulièrement les images absentes ou remplacées :

```bash
npm run daily:audit
```

L’option `--strict` renvoie un code d’erreur tant que la réserve n’est pas complète.
