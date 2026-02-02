## Contexte
La gouvernance doit être mesurée par section.

## Objectif
Calculer un score de complétude par section critique et bloquer la validation si < 100%.

## Entrées
- Sections: identification, conformité, habilitations, qualité

## Sorties attendues
- Calcul de complétude par section
- Statut `valide` bloqué si section critique < 100%

## Critères d’acceptation
- Les scores par section sont visibles.
- `valide` est refusé si complétude critique insuffisante.
