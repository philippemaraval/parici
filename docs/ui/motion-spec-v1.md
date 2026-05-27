# Motion Spec v1

## Tokens
- `--motion-fast`: `120ms`
- `--motion-base`: `180ms`
- `--motion-soft`: `260ms`
- `--motion-emphasis`: `400ms`
- Easing principal: `cubic-bezier(0.4, 0, 0.2, 1)`

## Actions
| Action | Duree | Effet |
|---|---|---|
| Hover bouton | 120ms | levee legere + couleur |
| Ouverture select | 180ms | slide/fade vertical |
| Validation correcte | 260ms | pulse cible + feedback vert |
| Erreur | 180ms | shake map + feedback rouge |
| Fin de session | 400ms | apparition recap + confetti |
| Badge unlock | 260ms | scale up puis settle |

## Regles
- Une seule animation dominante par interaction utilisateur.
- Pas d'animation continue hors `chrono-blink`.
- Sur mobile, reduire amplitude de 15%.

## Accessibilite
- Respect `prefers-reduced-motion: reduce`:
  - supprimer shake/pulse
  - conserver feedback couleur/texte.

