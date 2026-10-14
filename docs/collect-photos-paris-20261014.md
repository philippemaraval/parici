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

## Complément : cadrage des voies

32 voies supplémentaires disposent d'une photographie : 22 Google Street View et
10 Panoramax (CC-BY-SA-4.0). La recherche Street View a interrogé d'autres positions
sur 260 voies encore sans photo (10 %, 90 % et 35 % de leur segment principal),
avec les mêmes contrôles de provenance, date, distance à la géométrie (18 m maximum)
et orientation sur la tangente locale. 60 panoramas candidats ont été examinés dans
les deux sens. 201 autres prises de vue Panoramax ont été examinées pour 46 voies.

La sélection privilégie la perspective dans la longueur, une voie reconnaissable
ou son accès caractéristique. Les façades seules, les rues parallèles, les obstacles
et les vues trop déformées ont été écartés. Le contrôle dans Chrome à 390 et 1440 px
sur les cartes réelles a notamment éliminé deux panoramas trop déformés. Les fichiers
retenus conservent leurs crédits et leurs justificatifs géographiques dans le manifeste.

État après ce complément :

- Voies : **5 076 / 5 711 (88,88 %)** ; **635** restent au logo.
- Quartiers : **80 / 80** ; monuments : **107 / 107** ; transports : **45 / 45**.
- Ensemble : **5 308 / 5 943** cartes photographiées.
- Il manque **350** voies photographiées pour atteindre 95 %.

Collect reste sans bouton d'accès public. Les illustrations des autres cartes restent
le logo Parici et les dérogations manuelles existantes restent prioritaires.
