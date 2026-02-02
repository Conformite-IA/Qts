## Contexte
La gouvernance inter-couloirs doit être visible et contraignante.

## Objectif
Afficher un graphe orienté des diffusions et bloquer celles hors graphe.

## Entrées
- `politique_diffusion`

## Sorties attendues
- Graphe orienté (nœud=couloir, arête=diffusion)
- Validation empêchant diffusion non déclarée

## Critères d’acceptation
- Le graphe reflète les diffusions déclarées.
- Diffusion non déclarée est bloquée.
