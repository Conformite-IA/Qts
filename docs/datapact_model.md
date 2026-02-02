## Modèle DataPact

- Schéma canonique: `schemas/datapact.schema.json`
- Sections principales: identification, parties, duree_du_datapact, donnees, cas_d_usage, dependances_couloirs, politique_diffusion, habilitations
- Statut: `statut_datapact` (brouillon → en_validation → valide → expire/retire)

## Source de vérité

- Le modèle JSON est la source de vérité contrôlée.
- Le YAML est régénéré depuis le modèle JSON et validé avant sauvegarde.
