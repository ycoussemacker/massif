# Cas d'or — parité `load.py` ↔ `load.ts`

Le modèle de charge est écrit **deux fois** : `ingest/massif_ingest/load.py` (601 lignes, source de
vérité, exécutée par le cron et le re-scoring) et `web/src/lib/load.ts` (516 lignes, exécutée par la
synchro à la demande et par chaque correction faite depuis l'app). Si les deux divergent, la charge
d'une activité dépend du **chemin** par lequel elle a été calculée — et rien ne le signale, puisque
les deux valeurs sont plausibles.

`load-parity.json` fige 141 cas `compute_load` (les 6 méthodes de l'échelle couvertes) plus les
fonctions pures partagées, avec les valeurs **calculées par Python**. Les deux suites les rejouent à
**1e-9**, sur chaque push :

| Qui | Fichier | Ce qu'il garde |
|---|---|---|
| pytest | `ingest/tests/test_load_parity.py` | une régression de `load.py` (source de vérité) |
| node | `web/src/lib/load.parity.test.ts` | **la parité** — que le miroir TS n'a pas dérivé |

## Après un changement volontaire du modèle

```bash
ingest/.venv/bin/python ingest/scripts/gen_load_golden.py
```

…puis **committer le fichier régénéré avec le changement**. Son diff montre alors exactement ce que
le changement déplace, activité par activité — c'est la revue qu'aucun commentaire « KEEP IN SYNC »
ne donnait. Oublier de régénérer ne passe pas inaperçu : pytest rougit aussitôt.

## Ce que ce harnais a trouvé à sa première exécution

Deux divergences réelles entre les implémentations, toutes deux dans l'arrondi, toutes deux
silencieuses :

1. **Égalité exacte.** `Math.round` arrondit la moitié vers le haut, `round()` de Python vers le
   **pair** : 105,125 donnait 105,13 côté TS et 105,12 côté Python.
2. **Mise à l'échelle.** `Math.round(x * 100) / 100` multiplie avant d'arrondir, ce qui introduit une
   erreur : 50,495 vaut en réalité 50,49499… en binaire, mais `50.495 * 100` rend 5049,500000000001 —
   TS montait, Python descendait.

`load.ts` a été aligné sur Python (`roundPy`, arrondi sur le développement décimal exact). Écart de
0,01 point par activité concernée : minuscule en valeur, mais c'était une divergence entre deux
chemins d'écriture d'une même donnée.
