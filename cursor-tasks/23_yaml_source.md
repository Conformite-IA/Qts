## Contexte
Le YAML est la source de vérité contrôlée.

## Objectif
Forcer toute modification UI → modèle JSON → YAML régénéré → revalidation.

## Entrées
- Formulaire JSON Schema
- Générateur YAML

## Sorties attendues
- YAML régénéré à chaque action UI
- Sauvegarde bloquée si schéma invalide

## Critères d’acceptation
- Aucune sauvegarde invalide ne passe.
- Le YAML affiché correspond au modèle JSON.
