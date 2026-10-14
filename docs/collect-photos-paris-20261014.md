# Photographies Collect Paris — enrichissement du 14 octobre 2026

Le catalogue ajoute 355 photographies vérifiées : 231 voies, les 9 quartiers restants, les 70 monuments restants et les 45 lignes de transport. Elles correspondent à 351 fichiers distincts : quelques vues représentent à la fois un monument et son quartier ou sa voie.

| Famille | Photos | Total | Couverture |
| --- | ---: | ---: | ---: |
| Voies | 5 044 | 5 711 | 88,32 % |
| Quartiers | 80 | 80 | 100 % |
| Monuments | 107 | 107 | 100 % |
| Transports | 45 | 45 | 100 % |

Le seuil de 95 % des voies nécessite encore 382 photographies. Les 667 voies sans photographie affichent le logo Parici. Les identités, le dénominateur et les règles de jeu sont conservés.

## Sélection des sujets

Les pages des lignes de métro, RER, tramway et Transilien fournissent des photographies de matériel roulant associé à chaque ligne. Les 45 cadrages ont été examinés : ils montrent les véhicules, plutôt que des plans ou des logos. Les photos sont affichées intégralement dans leur cadre de carte.

Les photographies de monuments montrent un extérieur identifiable, un ensemble architectural ou un intérieur propre au lieu. Les pages d'homonymie, logos et illustrations ont été remplacés par des fichiers photographiques adaptés. Le Jardin des Plantes et le quartier du Père-Lachaise utilisent une vue représentative de leur lieu, plutôt qu'un plan ou une vue générale de Paris.

Pour les voies, 898 cartes étaient encore dépourvues de photo. La recherche dans leurs articles Wikipédia a identifié 238 candidates avec coordonnées parisiennes à 350 mètres au plus du repère du catalogue. L'examen visuel en a retenu 231 et écarté 7 (vues historiques ou sans vue utile de la voie). Les coordonnées de l'article servent à résoudre l'identité de la voie ; elles ne sont pas présentées comme la position de l'appareil photo. Les vues d'entrée portent la légende « Entrée de la voie ». Une vue de voie souterraine est également explicitement légendée.

## Sources et crédits

Les fichiers retenus proviennent de Wikimedia Commons et, pour trois monuments, de fichiers Wikipédia français portant une licence CC BY-SA 3.0 explicite. Les licences des autres photographies sont CC BY, CC BY-SA, CC0 ou domaine public. Une candidate « Image non libre » de la Géode a été écartée au profit d'une photographie sous CC BY-SA 4.0.

Chaque entrée de `data/collect_photos_paris.json` conserve l'auteur, la licence, la page du fichier, l'article associé, le fichier original, sa date lorsqu'elle est connue et le SHA-256 des octets livrés. Les images sont copiées sans retouche. Les crédits sont affichés sur la carte et dans sa fiche, avec un lien vers la page source.

L'importateur `scripts/import_collect_wikimedia_photos.js` valide les identités, les sources, les licences, les fichiers et, pour les voies, la correspondance géographique de l'article. Il refuse les cartes déjà photographiées. Le générateur de catalogue intègre ensuite ces références.

La synchronisation existante met à jour les références d'images et préserve les corrections manuelles, les cartes possédées et l'historique Daily. Collect et Explorer restent sans bouton d'accès public ; les cartes Daily restent conditionnées au lancement public de Collect.

## Validation de la livraison

Les 188 tests unitaires passent. L'intégration PostgreSQL isolée valide la synchronisation des images et les protections des collections et corrections manuelles. Le parcours Chrome complet passe, avec des cartes Wikimedia de rue, monument et transport, ainsi qu'un logo de repli, aux largeurs 390 et 1 440 pixels. Les contrôles de contenu, types, format et budgets de performance passent également. Le contrôle Git confirme que seuls les champs d'image et d'illustration des 355 cartes changent ; les autres champs du catalogue sont conservés. La validation locale et le push ne constituent pas une preuve du déploiement public.
