# Articles Wikipédia des fiches Collect

Le registre `data/collect_wikipedia.json` relie 80 quartiers administratifs et 107 monuments par leur identité de catalogue (`family:source_entity_id`). Il alimente le bouton Wikipédia déjà présent dans les fiches privées et publiques, ainsi que la fiche d’une carte tout juste gagnée. Aucune migration ni modification des exemplaires n’est nécessaire.

Vérification du 24 octobre 2026 : consultation de l’API MediaWiki francophone (`action=query`, `redirects=1`, `pageprops`, `info`, `extracts` et `coordinates`), contrôle du titre, de l’introduction et de la localisation. Chaque entrée conserve le titre canonique, l’identifiant de page, l’identifiant Wikidata et la date de vérification. Les 186 sources candidates du catalogue ont été contrôlées ; la Conciergerie a été complétée séparément à partir de son article dédié. Aucun texte Wikipédia n’est recopié dans le registre.

Les cas qui demandent une lecture au-delà du rapprochement de noms :

- **Hôtel de Cluny** : article du bâtiment, `Hôtel de Cluny` (page 1232043), plutôt que l’article du musée qui était la source candidate.
- **Conciergerie** : article `Conciergerie de Paris` (page 15253923). `Conciergerie` est une page d’homonymie et n’est pas retenue.
- **Église Saint-Germain-des-Prés** : l’article `Abbaye de Saint-Germain-des-Prés` inclut explicitement l’église actuelle et son histoire ; la redirection de son nom aboutit à cet article.
- **Institutions culturelles** : la BnF, la Comédie-Française, la Monnaie de Paris et l’Institut de France sont documentés par leur article propre, qui décrit aussi leur implantation parisienne. Aucun article consacré à une personne éponyme n’est utilisé.
- **Emprises étendues** : la localisation représentative d’un quartier ou du canal Saint-Martin n’est pas nécessairement son centroïde de jeu. L’identité est confirmée par l’article et sa description géographique ; la proximité d’un point ne suffit pas à elle seule.

Les transports restent exclus de ce bouton selon la règle existante. Les rues ne reçoivent pas automatiquement le lien d’une personnalité ou d’un homonyme. Une nouvelle entrée exige une vérification du lieu : ni page de recherche, ni page d’homonymie, ni lien déduit d’un simple nom.

Les tests locaux contrôlent l’intégrité du registre et les liens rendus dans les fiches, sans dépendre du réseau Wikipédia. Un changement de titre ou de sujet ultérieur demande une nouvelle vérification éditoriale.
