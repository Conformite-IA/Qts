# Pack DSFR — Questionnaire de satisfaction (offline)

## Contenu
- `satisfactions.html` : formulaire de satisfaction (15 questions)
- `results.html` : tableau de bord — résultats question par question
- `assets/dsfr.min.css` : DSFR CSS
- `assets/icons.min.css` : CSS icônes DSFR
- `assets/jspdf.umd.min.js` : jsPDF UMD (export PDF)

## Prérequis
- Navigateur récent (Chrome / Edge recommandés).
- Aucune connexion internet.

## Utilisation

### Remplir le questionnaire
1. Ouvrir `satisfactions.html`.
2. Remplir les 15 questions (brouillon sauvegardé automatiquement).
3. Cliquer **« Soumettre ma réponse »** — le formulaire se réinitialise pour le prochain répondant.

### Consulter les résultats
1. Ouvrir `results.html` — les réponses apparaissent automatiquement.
2. Pour chaque question : distribution des réponses avec barres visuelles.
3. KPIs en haut : satisfaction moyenne (1–5), recommandation (0–10), NPS.
4. Tableau brut en bas avec toutes les réponses individuelles.
5. Export CSV disponible.

## Structure du questionnaire

| Section | Questions | Type |
|---------|-----------|------|
| Profil & contexte | Q1 Profil, Q2 Niveau, Q3 Temps | Radio |
| Qualité du contenu | Q4 Langage, Q5 Mesures, Q6 Structure | Likert 1–5 |
| Pertinence par phase | Q7–Q11 (Cadrage → Exploitation) | Matrice de pertinence |
| Amélioration | Q12 Besoin, Q13 Thèmes, Q14 Verbatim, Q15 NPS | Likert / Checkbox / Texte / NPS 0–10 |

## Stockage
- Les données sont stockées dans le `localStorage` du navigateur (clé `satisfaction_responses`).
- Les deux pages partagent le même stockage (même origine).
- Chrome et Edge : fonctionne nativement en `file://`.
- Firefox : nécessite un serveur local (`python -m http.server`).
