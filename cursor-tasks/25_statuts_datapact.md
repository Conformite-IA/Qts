## Contexte
Le cycle de vie DataPact impose des statuts et actions autorisées.

## Objectif
Introduire `statut_datapact` et conditionner les actions en UI/API.

## Entrées
- États: brouillon, en_validation, valide, expire, retire

## Sorties attendues
- Schéma et UI avec statut
- Règles d’autorisation selon statut

## Critères d’acceptation
- Les transitions non autorisées sont refusées.
