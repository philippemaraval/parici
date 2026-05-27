# Identite Visuelle Paris v1

## Intention
- Direction: "Paris mediterraneenne, portuaire et urbaine".
- Priorites: clarte de jeu cartographique, coherence de marque, progression lisible.

## Palette Officielle
| Token | Couleur | Usage |
|---|---|---|
| `--brand-sea-900` | `#12297A` | Bleu du logo, accents de marque |
| `--brand-sea-950` | `#0C1D57` | CTA primaire, titres forts, tooltips |
| `--brand-sea-600` | `#4057B2` | Hover/focus, accents secondaires |
| `--brand-stone-100` | `#F5F1E8` | Fonds globaux |
| `--brand-stone-300` | `#E3DCCF` | Bordures, separateurs |
| `--brand-sun-500` | `#F2A900` | Highlights, progression |
| `--brand-terra-500` | `#C96B3B` | Accent secondaire chaud |
| `--state-success` | `#1F9D66` | Reussite |
| `--state-danger` | `#D2463C` | Erreur/echec |
| `--state-warning` | `#E08A00` | Alerte |

## Objets UI par Couleur
| Couleur | Objets |
|---|---|
| `#12297A` | logo, accents marque, etats actifs non critiques |
| `#0C1D57` | boutons primaires, titres majeurs, fond tooltips |
| `#4057B2` | hover bouton primaire, focus ring, accents info |
| `#F5F1E8` | fonds de page/panels |
| `#E3DCCF` | bordures input/select, separateurs, tableaux |
| `#F2A900` | barres de progression, pills de difficulte, highlights |
| `#C96B3B` | mode emphasis secondaire, nuances "marathon/warm" |
| `#1F9D66` | feedback correct, score positif, reveal reussi |
| `#D2463C` | feedback incorrect, erreurs API/form |
| `#E08A00` | avertissements, chrono critique, hints "warm" |

## Carte et Gameplay (Couleurs)
| Etat | Couleur |
|---|---|
| Rue visible | `#F2A900` |
| Rue hover/focus | `#F8C870` |
| Correct | `#1F9D66` |
| Incorrect | `#D2463C` |
| Overlay arrondissement | `#12297A` |
| Monument normal (stroke/fill) | `#DFE6FF` / `#4057B2` |

## Regles de Cohesion
- Pas de violet dans les gradients de badges/profil.
- Les etats `success/warning/danger` sont reserves aux feedbacks d'etat.
- Les composants interractifs utilisent les tokens; pas de couleur inline hors exception justifiee.
