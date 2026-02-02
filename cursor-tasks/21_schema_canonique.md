## Contexte
Le modèle DataPact doit être strict, avec clés canoniques.

## Objectif
Définir `schemas/datapact.schema.json` avec `additionalProperties: false` partout.

## Entrées
- Spécification sections: identification, parties, donnees, cas_d_usage, dependances_couloirs, politique_diffusion, habilitations
- YAML existants

## Sorties attendues
- `schemas/datapact.schema.json`
- Validation backend alignée sur ce schéma

## Critères d’acceptation
- Toute clé non déclarée est rejetée.
- Les YAML existants passent après normalisation canonique.
