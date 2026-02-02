## Contexte
L’UI doit être générée depuis le JSON Schema, avec onglets et blocs repliables.

## Objectif
Implémenter un moteur de formulaires JSON Schema avec validation temps réel.

## Entrées
- `schemas/datapact.schema.json`

## Sorties attendues
- UI avec 1 onglet par section
- Blocs collapsibles par sous-section
- Validation champ par champ

## Critères d’acceptation
- La structure UI reflète le schéma.
- Les erreurs sont visibles au niveau des champs.
