# QCM Collect Parici — banque pour relecture

La banque couvre les **102 cartes légendaires** de la liste validée : **43 cartes à deux fragments, 23 à trois et 36 à quatre**, soit **299 questions et 1 196 propositions**. Chaque carte dispose d’autant de questions distinctes que de fragments requis.

**La banque est intégrée au catalogue privé à la demande de l’utilisateur (point 11).** Elle n’ouvre aucun accès public à Collect ou Explorer. Le catalogue et la migration utilisent `data/collect_paris_fragment_questions.json`. Les questions des parties en cours restent dans leurs instantanés ; les anciennes formulations sont archivées en base lors de la migration. `previous-questions.json` conserve la référence éditoriale initiale.

## Consignes reprises de Camino

- Questions et distracteurs rédigés individuellement ; pas de mélange automatique de faits d’autres cartes.
- Quatre propositions sur le même sujet, une seule bonne réponse ; mauvaises dates, personnages, fonctions ou lieux comparables.
- Noms avec article ; propositions commençant par « Il » ou « Elle », selon le sujet.
- Thème explicite, explication et liens sources pour chaque question.
- Banques distinctes pour les tronçons et les familles de cartes. Une question sur le repère de la carte ne prétend pas localiser l’intégralité d’une voie traversant plusieurs arrondissements.
- Positions des réponses équilibrées et irrégulières : **75 A, 75 B, 75 C, 74 D**.
- Numérotation stable de 1 à 102, reprise de la liste des légendaires. Une correction peut être indiquée « carte 54, question 2 ».

## Documents

- `questions.md` : toutes les questions, réponses, explications et sources.
- `questions-2-fragments.md`, `questions-3-fragments.md`, `questions-4-fragments.md` : exports par nombre de fragments.
- `questions.json` : banque structurée, avec identités exactes du catalogue et identifiants UUID stables.
- `authored.tsv` : rédaction manuelle ; colonnes numéro, thème, question, bonne réponse, trois distracteurs. Les clauses des propositions reçoivent le pronom du sujet au rendu.
- `cards.json` : identités, articles, pronoms, besoins en fragments et contexte sourcé des explications.
- `municipal-notices.json` : 49 notices textuelles de la Ville de Paris, consultées le 15 octobre 2026 ; source et attribution ODbL conservées.
- `source-audit.json` : trace de consultation des 108 URL sources. Une URL accessible ne prouve pas à elle seule l’exactitude d’un QCM.

Les faits municipaux s’appuient sur les notices de dénomination, historique et tracé des voies. Les monuments, quartiers et transports disposent de sources complémentaires. La page d’homonymie de la place de la Nation a été remplacée par la page parisienne. La question sur son changement de nom porte sur l’année 1880, pour distinguer la délibération de la fête nationale à laquelle elle se rapporte. Pour l’Odéon, la question porte sur le jardin du Luxembourg compris dans le quartier, sans lui attribuer à tort uniquement sa partie nord.

Les questions de transport portent principalement sur des étapes historiques datées. La question de la ligne 14 mentionne explicitement les prolongements de 2024 ; toute évolution du réseau impose une nouvelle revue des questions concernées.

## Génération et vérification

Depuis la racine du dépôt :

```sh
python3 reports/collect-fragment-qcm-review/generate.py
python3 reports/collect-fragment-qcm-review/generate.py --check
node reports/collect-fragment-qcm-review/validate-runtime.js
```

Le générateur met en forme les textes rédigés, sans inventer de questions ni de distracteurs. Le contrôle vérifie la couverture des 102 cartes du catalogue local, le nombre de fragments, les identités, les 299 UUID uniques, les quatre réponses distinctes, les pronoms, les thèmes, les explications, les liens sources, l’équilibrage A–D et la concordance JSON/Markdown. Le second validateur passe les 102 banques dans `validateFragmentConfig`, le validateur réel du backend.

Ces contrôles ne mesurent pas la difficulté ressentie et ne constituent pas une preuve historique automatique. La relecture éditoriale reste possible avant activation. L’activation en base est assurée par une migration idempotente qui protège les contenus manuels et les progressions.

## Configuration active

`data/collect_paris_fragments.json` contient les besoins validés des 102 cartes. La configuration active `data/collect_paris_fragments_active.json` les reprend intégralement. Le générateur exige une banque complète avant d’activer les fragments d’une carte : aucune carte ne reçoit un parcours QCM vide.
