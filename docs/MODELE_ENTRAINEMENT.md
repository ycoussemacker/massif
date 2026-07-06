# Massif — Le modèle d'entraînement, vu côté physiologie & coaching

> **À qui s'adresse ce document.** Il décrit, **sans aucun détail technique**, la logique
> physiologique et sportive derrière les chiffres que produit Massif : comment on mesure l'effort d'une
> séance, comment on suit la forme et la fatigue, et comment le coach décide quoi faire chaque jour.
> Il est volontairement écrit pour être **lu, critiqué et validé par un vrai coach sportif** spécialisé
> montagne. Les valeurs chiffrées citées sont nos **points de départ** — l'objet même de la relecture est
> de les confirmer ou de les corriger. Les détails d'implémentation vivent ailleurs
> (`ARCHITECTURE.md`, `MODEL_UPGRADES.md`, `research/heat-altitude.md`) et ne sont pas nécessaires ici.
>
> Massif est une app perso, **mono-athlète aujourd'hui** (multi-sport montagne : course, trail, rando,
> alpinisme, grande voie, ski de rando, escalade…). L'enjeu : réunir toutes ces disciplines dans **une
> seule logique de charge** comparable, pour piloter l'entraînement vers un objectif.

---

## 1. Le principe central : une seule charge, deux canaux

Chaque séance — quelle que soit la discipline — produit **une charge d'entraînement** exprimée dans une
**monnaie unique** (des « points de charge »). Cela permet de comparer un footing, une journée d'alpi et
une séance d'escalade sur la même échelle, et de les additionner jour après jour.

Mais une seule note ne suffit pas, parce que **deux systèmes physiologiques bien différents** encaissent
l'effort, et **ne récupèrent pas à la même vitesse**. On répartit donc toujours la charge en **deux
canaux qui s'additionnent** :

- **Le canal AÉROBIE** — le coût cardio-respiratoire, « le moteur ». C'est ce que voient une montre, une
  FC, la VFC (HRV), le Body Battery. Il récupère **vite** (heures à 1–2 jours).
- **Le canal NEUROMUSCULAIRE** — le coût pour le système nerveux et les **structures** (muscles, tendons,
  articulations) : descente en excentrique, port de charge, impacts, gestes techniques engagés, force.
  Les montres y sont **presque aveugles**. Il récupère **lentement** (24–72 h, et les tendons des
  semaines).

**Pourquoi c'est crucial en montagne.** Une grosse descente ou une journée d'alpi peut coûter très cher
au système neuromusculaire **tout en gardant une FC calme** — donc une charge « aérobie » modeste. Un
modèle mono-canal piloté par la FC sous-estimerait gravement la fatigue réelle des jambes. En séparant les
deux, on peut dire : *« côté cœur tu es frais, mais tes jambes ont encaissé — on protège les structures
aujourd'hui »*. C'est le cœur de la valeur du modèle.

> Les deux canaux sont calculés **indépendamment puis additionnés** — ce n'est pas une note unique
> découpée selon un ratio fixe. Deux sorties peuvent avoir le même coût cardio et des coûts
> neuromusculaires très différents (selon le dénivelé négatif, surtout).

---

## 2. Mesurer l'effort d'une séance (le calcul de charge)

### 2.1 L'idée de base : durée × intensité²
La charge aérobie d'une séance suit la logique classique d'une « dose d'entraînement » : elle croît avec
la **durée** et, surtout, avec le **carré de l'intensité**. Référence : **1 heure pile à l'intensité du
seuil = 100 points**. Une heure à intensité plus basse vaut beaucoup moins (le carré pénalise le faible) ;
une heure au-dessus du seuil vaut davantage. (Cadre type *TSS / Intensity Factor* de TrainingPeaks/Coggan,
et *TRIMP/PMC* de Banister.)

### 2.2 Le moteur cardiaque (canal aérobie)
Quand on a la **fréquence cardiaque**, l'intensité est mesurée par rapport au **seuil cardiaque (LTHR)** :
à la FC du seuil, l'intensité vaut 1,0. On utilise la FC de réserve (entre FC de repos et FC max) pour
situer l'effort. C'est la méthode privilégiée pour course, trail, rando avec cardio.

> **Point fin, important pour la montagne.** Pour les méthodes pilotées par la FC, on garde le **temps
> écoulé** (pas seulement le temps en mouvement). Raison physiologique : pendant les arrêts (relais,
> pauses, sommet), la FC **redescend** — donc la FC moyenne sur toute la sortie est **déjà « diluée »**
> par les pauses. Raccourcir aussi la durée reviendrait à corriger deux fois et **sous-estimerait**
> l'effort. Une longue journée à FC modérée est donc, à juste titre, une grosse charge.

Sans cardio fiable (escalade, alpi, surf…), on bascule sur l'**effort perçu (RPE)** ou, à défaut, une
estimation par la durée — moins précise, signalée comme telle. Quand l'athlète **saisit** un RPE, celui-ci
**prime** sur l'estimation par durée (c'est son ressenti qui fait foi). Et s'il **détaille par système**
(souffle, jambes, avant-bras), la **répartition aéro/neuro suit ce ressenti** plutôt qu'un découpage fixe
par sport — voir §11 Q5.

### 2.3 Le coût neuromusculaire (le « hors-cardio »)
En plus du moteur cardiaque, on **ajoute** un coût neuromusculaire indépendant, dominé par :

- **La descente (dénivelé négatif).** Le travail **excentrique** de freinage est la principale cause de
  dommages musculaires et de courbatures (DOMS). C'est, à notre sens, le facteur le plus sous-estimé des
  modèles classiques en montagne. ✅ **Ce coût est *entraînable*** (recherche faite — Q2) : un athlète
  habitué aux descentes encaisse moins et récupère plus vite. **Désormais implémenté** : la valeur de base
  est celle d'un descendeur **entraîné** (**~55 points / 1000 m de D−**, au lieu des ~70 « débutant »), et
  un **facteur dynamique** la fait remonter vers ~70 quand l'athlète est **peu exposé récemment**
  (reprise après coupure → premières descentes plus coûteuses, le « casse-pattes » de début de saison) et
  la fait baisser pendant un **gros bloc descente** (adaptation). Le facteur est **borné** (±25 %) et n'est
  appliqué qu'avec assez d'historique — sinon on **signale** une estimation peu fiable. *(Voir §11 Q2.)*
- **Le port de charge** (sac lourd, marche d'approche bivouac) — intégré à la charge.
- **L'impact** (la composante traumatique selon la discipline).
- **Le dénivelé positif** ajoute aussi un coût aérobie au-delà de ce que la FC seule capte.

Les disciplines très techniques (escalade, grande voie) chargent à la fois l'aérobie (longue journée,
approche, D+) **et** le neuromusculaire (avant-bras, gainage, gestes engagés) — on ne les réduit pas à un
seul canal.

### 2.4 Pourquoi une journée d'alpi peut être « petite » ou « énorme »
Deux leviers : la **durée réelle d'effort** et l'**intensité**. Une journée d'alpi de 7 h avec 2 h
d'arrêts (relais, manip de corde) n'est pas 7 h d'effort continu. Et l'alpi se déroule souvent à FC
basse. Résultat : le coût dépend énormément du **dénivelé** (surtout négatif, pour le neuromusculaire) et
de la **durée en mouvement** réelle. Une sortie type de 3–5 h / 400 m D+ à FC calme se situe vers
**80–100 points** ; une grosse journée de 7 h / 2000 m D+ peut largement dépasser **400 points** — et
c'est légitime, c'est une très grosse charge d'entraînement.

---

## 3. Forme, fatigue, fraîcheur (le suivi dans le temps)

À partir de la charge quotidienne (somme des deux canaux, tous sports confondus), on suit quatre
indicateurs classiques (cadre *Performance Management Chart*) :

- **Fitness / condition (CTL)** — moyenne **lente** (~6 semaines) de la charge. « Le fond que tu as
  construit. »
- **Fatigue (ATL)** — moyenne **rapide** (~1 semaine) de la charge. « La fatigue récente. »
- **Fraîcheur / forme (TSB = Fitness − Fatigue)** — positif = frais/affûté ; négatif = chargé.
- **Risque (ACWR, ratio charge aiguë / chronique)** — un pic de charge trop brutal par rapport à
  l'habitude augmente le risque de blessure (cadre *acute:chronic workload ratio*). Au-delà de ~1,5 on
  considère une zone à risque.

### 3.1 Deux vitesses de récupération (l'innovation clé)
La nouveauté physiologique de Massif : la **fatigue n'a pas la même durée de vie selon le canal**. On
calcule donc **une fraîcheur par canal** :

- **Fraîcheur aérobie** — fatigue récente sur **~7 jours** (le cœur récupère vite, c'est visible sur la
  VFC).
- **Fraîcheur neuromusculaire** — fatigue récente sur **~14 jours** (les structures/tendons traînent plus
  longtemps, et c'est **invisible aux montres**).

Conséquence concrète pour le coach : après un bloc descente/montagne, un athlète peut paraître **frais
côté cœur (et sur sa montre)** alors que ses **jambes portent encore une dette**. Le modèle le voit ; une
fraîcheur neuromusculaire nettement négative = on protège les structures même si tout le reste semble OK.
*(Constantes 7 j / 14 j : points de départ, à valider — §11. Le 14 j neuromusculaire n'est plus tout à
fait fixe : il se **raccourcit** quand l'athlète est bien adapté aux descentes — récupération plus rapide —
et s'**allonge** après une coupure, dans une fourchette ~11,5–16,5 j. Voir §11 Q2/Q6.)*

---

## 4. La disponibilité du jour (le « feu » vert / orange / rouge)

Chaque matin (à la demande), le coach pose un **verdict de disponibilité** :

- 🟢 **Vert — prêt** : feu vert pour une séance de qualité.
- 🟠 **Orange — prudence** : on reste facile / technique, on ne lance pas de séance dure.
- 🔴 **Rouge — repos/récup** : récupération ou repos.

Ce qu'on regarde pour trancher (et qui peut faire passer à orange/rouge) :
- la **fraîcheur** globale et **par canal** (une dette neuromusculaire marquée → prudence) ;
- le **risque (ACWR)** (un pic récent → prudence/repos) ;
- les **données de récupération Garmin du matin** : sommeil, VFC, FC de repos vs ta ligne de base,
  « readiness » Garmin. Une readiness Garmin **moyenne** (et non « au top »), surtout à l'approche d'un
  objectif, suffit à passer en **orange** : on ne donne pas le feu vert pour du dur.
- **l'absence de données Garmin** ce matin → prudence (on ne devine pas une récup qu'on n'a pas mesurée).

> Philosophie : mieux vaut un orange prudent qu'un vert optimiste la veille d'un gros objectif.

---

## 5. Le plan de la semaine

Le coach propose un plan **7 jours** construit sur des principes simples et défendables :

- **~80/20 facile/dur** sur le canal aérobie : la majorité du volume en endurance facile, une à deux
  séances de qualité par semaine.
- **Jamais deux jours durs d'affilée sur le MÊME système.** Une grosse journée de grimpe « dépense » le
  budget neuromusculaire même si la FC est basse — donc elle compte comme un jour dur, et on ne l'enchaîne
  pas avec un autre jour dur du même type.
- **Récup après un jour dur ou un gros événement**, repos placé dans la semaine.
- **Respect des contraintes de l'athlète** : jours sans séance dure, volume hebdo max, blessures/points
  faibles à consolider.

### 5.1 Événements vs objectifs (distinction importante)
- Un **événement** = une activité que l'athlète a planifiée (une grosse sortie, une course « pour le
  plaisir », une marche d'approche). Le coach **planifie autour** (récup après), mais **n'allège pas** la
  semaine pour lui.
- Un **objectif** = une cible datée et **classée par priorité**. C'est lui qui déclenche l'**affûtage
  (taper)** :
  - **Objectif primaire** : affûtage **1 à 2 semaines** avant, selon l'état de fatigue (réduction
    **progressive du volume** en gardant un peu d'intensité, pour évacuer la fatigue sans perdre la forme
    — la fraîcheur doit remonter et devenir nettement positive le jour J).
  - **Objectifs secondaires / moins prioritaires** : affûtage **plus court (max ~1 semaine)**, allègement
    léger.

> **Ce que dit la recherche sur l'affûtage** (méta-analyses Bosquet 2007, Wang 2023 ; revue Mujika &
> Padilla 2003 — détail sourcé dans [`research/periodisation-phases-seances-cles.md`](research/periodisation-phases-seances-cles.md)) :
> durée **7-21 j** (optimum souvent **10-14 j**), **baisse de volume de 41-60 %**, **intensité ET
> fréquence maintenues** (on garde des rappels courts à intensité de course), **décroissance
> exponentielle/progressive** plutôt qu'une chute brutale, et taper plus efficace **après un bloc de
> surcharge**. La **fraîcheur cible le jour J** se situe vers **TSB 0 à +10** pour un objectif
> d'endurance. Conséquence pour nos deux canaux : on **réduit le coût neuromusculaire plus tôt**
> (descente/excentrique, dès J-10 à J-14) que l'intensité aérobie. *(Aujourd'hui notre affûtage est
> linéaire et ne concerne que les objectifs — pistes d'évolution en Q18.)*

---

### 5.2 Découper l'objectif en phases (périodisation) — *implémenté v1 (Upgrade 9)*

Au-delà du plan de 7 jours, un objectif lointain se prépare en **phases** (vocabulaire : macrocycle =
la saison ; mésocycles = blocs de 3-6 semaines ; microcycles = semaines). Les phases canoniques et
leurs points de départ chiffrés :

| Phase | Durée | Objectif | Ce qui change |
|---|---|---|---|
| **Base** (prépa générale) | 4-10 sem | socle aérobie, robustesse musculo-tendineuse | volume ↑, intensité basse, peu de spécifique |
| **Build** (prépa spécifique) | 3-8 sem | seuil, côtes, **descente**, sorties longues | intensité ciblée ↑, spécificité ↑↑ |
| **Peak** (pré-compétition) | 1-4 sem | fraîcheur sans désentraînement | volume ↓, intensité-clé maintenue |
| **Affûtage** (taper) | 7-21 j | évacuer la fatigue (voir §5.1) | volume −41-60 %, intensité maintenue |
| **Transition** (récup) | 1-4 sem | restaurer, faire baisser le CTL | charge très basse |

En montagne (plusieurs qualités en conflit : volume aérobie, tolérance D−, force de portage, technique),
l'approche la plus défendable est **hybride** : base plutôt linéaire, puis **blocs concentrés**
(force/descente, puis spécificité), puis affûtage. La distribution d'intensité de fond reste
**polarisée ~80/20** (Seiler).

Deux garde-fous chiffrés pour **progresser sans se blesser**, à terme **par canal** :
- **Vitesse de montée du fond (CTL)** : ~**+3 à +5 points/semaine** côté aérobie, **+1 à +3** côté
  **neuromusculaire** (les structures encaissent plus lentement — un CTL global masque le vrai risque).
- **Semaines de décharge (deload)** : une toutes les **3-4 semaines** (**3:1** en base, **2:1** dès
  qu'on empile descente/portage/force), **−30 à −50 %** de volume, intensité conservée.

> Ces valeurs sont des **points de départ sourcés** (détail + références dans
> [`research/periodisation-phases-seances-cles.md`](research/periodisation-phases-seances-cles.md)).
> **Implémenté v1 (Upgrade 9, `MODEL_UPGRADES.md`)** : les phases sont rétro-comptées depuis l'objectif
> principal daté (`phaseFromDaysTo` — affûtage ≤ 14 j · peak S−3..S−5 · build S−6..S−13 · base au-delà),
> les mésocycles **2:1 (build) / 3:1 (base)** placent une **décharge** (volume ×0.65, une qualité
> conservée) en fin de chaque bloc, et en semaine de charge une **rampe de CTL** vise +4 pts/sem en
> gonflant les jours easy générés (borné ×1.35 ; les séances de qualité et les ancres ne bougent pas ;
> la readiness quotidienne reste au-dessus). La phase est affichée sous l'objectif (dashboard), ouvre le
> `state_assessment` du briefing et est fournie au chat (`training_phase`). **Pas encore** : rampe par
> canal (le neuro reste protégé par les seuils quotidiens), phase transition post-objectif.

---

## 6. Estimer la charge d'une séance **prévue**

Quand l'athlète déclare une sortie future (« samedi, alpi 7 h, 700 m D+ »), on en estime la charge **à
partir de ses propres sorties passées similaires** (médiane des efforts les plus proches en durée,
distance, dénivelé), plutôt qu'un barème théorique. C'est le meilleur signal : ça capte **son** coût réel.

Deux raffinements importants, issus de la pratique montagne :

1. **On compare un sport avec LE MÊME sport.** Le ratio « temps en mouvement / temps total » d'une journée
   d'**alpinisme** (manip de corde, longueurs lentes, relais, pauses) n'a rien à voir avec celui d'une
   **rando**. Sur les données réelles de l'athlète : alpi ≈ **40 % de temps en mouvement**, rando ≈
   **90 %**. On estime donc le ratio **dans la discipline déclarée**, pas dans une catégorie élargie.
2. **L'athlète déclare une durée TOTALE, on raisonne en temps de MOUVEMENT.** On convertit la durée
   annoncée en temps de mouvement estimé via ce ratio (ses propres données si dispo, sinon un standard par
   sport — voir §7). Exemple réel : 7 h d'alpi déclarées → ~2,8 h de mouvement → estimation **~105 points**
   (au lieu de ~330 si on avait comparé bêtement à des sorties de 7 h en mouvement). On retombe pile dans
   l'ordre de grandeur attendu d'une journée d'alpi.

Si l'athlète n'a **jamais** fait cette discipline, on part d'un **standard par sport** (voir §7), puis le
système bascule sur **ses** données dès qu'il en a assez.

---

## 7. Personnalisation : le modèle apprend de l'athlète

Principe directeur : **ça marche sans rien savoir de l'athlète (valeurs de population par défaut), et ça
s'affine tout seul avec ses données** — jamais de réglage manuel obligatoire.

- **Charges cibles des séances du coach.** Plutôt qu'un barème en dur, on calcule la charge cible de
  chaque **type** de séance à partir de **la médiane des vraies séances de l'athlète** de ce type sur ~90
  jours. Pour cet athlète : séance au **seuil ≈ 68 pts**, **endurance facile ≈ 59 pts** (ses valeurs, pas
  des constantes). On ne personnalise que là où le signal est **fiable** : l'**aérobie** (facile + seuil),
  piloté par l'intensité FC. Le **neuromusculaire** et la **récup/repos** gardent des valeurs par défaut
  (le neuro est dominé par la descente, donc l'historique refléterait des grosses descentes plutôt qu'une
  séance de côtes ; la récup est une dose **prescrite** légère, pas une moyenne du passé).
- **Ratios « temps en mouvement »** (§6) : ceux de l'athlète quand il a ≥ 3 sorties dans la discipline,
  sinon un standard par sport (alpi 0,55 · grande voie 0,35 · rando 0,82 · trail 0,92 · course 0,95…).
- **Zones cardiaques** (§8), **seuils** (FC max / seuil / repos), et à terme les coefficients du modèle.

Côté multi-utilisateur (à venir), c'est le bon design : chaque athlète part des valeurs de population
puis le modèle apprend **ses** chiffres — un débutant et un alpiniste confirmé ne reçoivent pas la même
« dose ».

---

## 8. Zones cardiaques — alignées sur la montre
Les conseils d'intensité (« reste en Z2 ») n'ont de sens que si la **Z2 de Massif = la Z2 de ta montre**.
On récupère donc les **zones réellement configurées sur la Garmin** de l'athlète (sinon on les estime
depuis sa FC max / seuil / repos). Le coach raisonne **d'abord** en charge aéro/neuro, **puis** traduit la
cible en une **zone FC concrète avec ses bornes en bpm** — pour que la consigne corresponde exactement à
ce que l'athlète voit sur sa montre pendant la séance.

---

## 9. Chaleur & altitude — du **contexte**, jamais un multiplicateur
La chaleur et l'altitude font **monter la FC** pour un même effort. Comme la charge aérobie est déjà
calculée **à partir de la FC**, elle **intègre déjà** cette contrainte — la multiplier en plus serait un
**double comptage**. La chaleur/altitude servent donc de **contexte d'interprétation** : ne pas confondre
une VFC en berne « à cause de la canicule » avec du surentraînement ; anticiper une FC/RPE plus hauts sur
une sortie chaude ou en altitude quand l'athlète n'est pas acclimaté ; suggérer une acclimatation avant un
gros objectif en chaleur/altitude. *(Revue de littérature dédiée : `research/heat-altitude.md`.)*

---

## 10. Ce que l'IA fait — et ne fait PAS
Pour rester **sobre et peu coûteux**, l'essentiel du raisonnement est **algorithmique** (déterministe,
vérifiable) : la disponibilité, le plan 7 jours, les charges cibles, l'affûtage, les estimations, les
zones. L'IA générative est réservée à ce qu'elle fait vraiment mieux : **habiller** la séance du jour et
l'analyse dans la **voix du coach** (mode optionnel), et **dialoguer** en langage naturel (« puis-je faire
une alpi AD+ ce week-end avec un bivouac la veille ? » → jugement + adaptation du plan). Le diagnostic
physiologique, lui, ne dépend pas de l'IA.

---

## 11. Hypothèses & questions pour le coach (à valider / ajuster)

C'est la section la plus importante : voici nos **valeurs de départ** et nos **partis pris**, à
challenger. Toutes sont ajustables, et destinées à être personnalisées à partir des données de l'athlète.
Chaque point porte un numéro stable (**Q1 … Q18**) pour qu'on puisse y revenir un par un. Plusieurs ont
fait l'objet d'une **revue de littérature** : **Q2** (descente) et **Q5** (RPE) — détail sourcé dans
`research/descent-neuromuscular-rpe.md` ; **Q15-Q18** (périodisation, phases, affûtage, pilotage de la
charge) — détail sourcé dans `research/periodisation-phases-seances-cles.md`.

### Calcul de charge
- **Q1 — Ancrage de la charge.** 1 h pile au seuil = 100 points ; la charge ∝ durée × intensité² (le carré
  pénalise le faible, valorise le dur). Cet ancrage et l'exposant 2 te semblent-ils justes pour un public
  montagne (longues sorties à intensité basse) ?
- **Q2 — ✅ Descente (coût neuromusculaire) : recherche faite + Phase 1 livrée.** **La littérature
  tranche : ce coût — *et sa vitesse de récupération* — est entraînable.** Effet « repeated-bout » : un
  athlète régulièrement exposé subit **~20–30 % de dommages en moins** pour le même D− et récupère **~1–2 j
  plus vite** ; adaptation **spécifique à la descente** (la montée ne protège pas), **rapide** (1–2 sem
  suffisent), à **rendements décroissants**. **Ce qu'on a implémenté** : (1) la base passe de ~70
  (« débutant ») à **~55 / 1000 m** = le coût d'un descendeur **entraîné** (≈0,78× la valeur naïve, ancrage
  littérature) — c'est la décote « entraîné » ; (2) un **facteur dynamique borné** (±25 %, qui sature)
  fait remonter le coût vers ~70 après une coupure (reprise = descentes plus coûteuses) et le fait baisser
  pendant un gros bloc descente. Un **point honnête issu des données réelles** : sur cet athlète, le facteur
  dynamique est **net ≈ 0** (ses plus grosses descentes tombent en début de saison, peu adapté → on les
  pénalise à juste titre) — c'est donc surtout un **signal de timing/risque** par jour, pas une décote
  globale ; la décote globale, elle, vient de la base (−5,6 % neuro). **Phase 2 livrée aussi** : la
  *vitesse de récupération* neuro dépend désormais de l'exposition (cf. Q6) — bien adapté → la fatigue
  s'efface plus vite (τ plus court, ~11,5 j) ; peu adapté → elle traîne (~16,5 j). C'est le levier qui
  bouge vraiment la fraîcheur neuro (`tsb_neuromuscular`). **Fiabilité** : tout ceci n'est appliqué qu'avec
  assez d'historique de descente, sinon l'estimation est **signalée comme peu fiable**.
  *(Détail + sources : `research/descent-neuromuscular-rpe.md`, partie A.)*
- **Q3 — Dénivelé positif.** Un coût aérobie additionnel (~100 / 1000 m de D+) au-delà de ce que la FC
  capte. Pertinent, ou la FC suffit-elle déjà à le refléter ?
- **Q4 — FC sur le temps écoulé (pas le mouvement).** Parce que la FC moyenne est déjà « diluée » par les
  pauses (§2.2), on garde le temps total pour les méthodes pilotées par la FC. D'accord avec ce
  raisonnement, ou une autre approche pour les très longues journées avec beaucoup d'arrêts ?
- **Q5 — ✅ Effort perçu (RPE) : recherche faite + livrée.** Les sports techniques (alpi, grande voie,
  escalade) sont scorés au RPE faute de FC fiable. **Ce qu'on a implémenté** : (1) **échelle CR10 de Foster
  (0–10)** avec **ancrages verbaux** (0 repos · 3 modéré · 5 dur · 7 très dur · 10 maximal), **formulation
  globale** (« à quel point cette séance était-elle difficile ? Pense à toute la séance ») et un rappel de
  **timing 20–30 min après** ; (2) **correctif important** : quand l'athlète saisit lui-même un RPE, celui-ci
  **prime désormais** sur l'estimation par durée+dénivelé (avant, une grande voie notée 10/10 pouvait être
  scorée ~38 car l'estimation objective gagnait — le ressenti était ignoré) ; (3) **RPE différencié**
  (optionnel) : souffle/cardio → **aérobie**, jambes & avant-bras/prise → **neuromusculaire**. Dès qu'au
  moins **deux** systèmes sont notés, **la répartition aéro/neuro vient du ressenti** au lieu d'un découpage
  fixe par sport. Le coût **objectif de la descente reste un plancher** (un RPE pris juste après la séance
  sous-estime les courbatures à retardement — une grosse descente doit rester « lourde »). C'est notre
  logique à deux canaux rendue **mesurée**. *(Détail + sources : `research/descent-neuromuscular-rpe.md`,
  partie B.)*

### Forme & fatigue
- **Q6 — Constantes de temps.** Fitness 42 j ; Fatigue aérobie 7 j ; **Fatigue neuromusculaire 14 j**. Le
  14 j (vs 7 j côté cardio) capture-t-il bien la traîne des courbatures / tendons ? Trop court, trop long ?
  *(lié à Q2 : ce 14 j est désormais le **centre** d'une fourchette — il se raccourcit/allonge avec
  l'exposition récente aux descentes, ~11,5–16,5 j, cf. Q2 Phase 2. Le centre 14 j reste à valider.)*
- **Q7 — Seuil de risque.** ACWR > ~1,5 = zone à risque. Adapté à un athlète montagne très variable d'un
  jour à l'autre ?

### Décision du jour & semaine
- **Q8 — Disponibilité (vert/orange/rouge).** Le orange est déclenché par une readiness Garmin « moyenne »,
  une dette neuromusculaire, un ACWR élevé ou l'absence de données. Les bons signaux ? Les bons seuils ?
- **Q9 — Structure de semaine.** ~80/20 facile/dur, et jamais 2 jours durs sur le même système d'affilée.
  Trop rigide / trop souple pour la montagne (où un « jour facile » est souvent une rando de 3–4 h) ?
- **Q10 — Affûtage.** 1–2 semaines (objectif primaire) / ~1 semaine (secondaires), baisse de volume à
  intensité maintenue. Durées et méthode validées pour des objectifs type ultra-trail / course d'alpi ?
- **Q11 — Événements ≠ objectifs.** On planifie *autour* des événements mais on n'allège (affûtage) que
  pour les objectifs. Distinction pertinente côté coaching ?

### Estimation & personnalisation
- **Q12 — Ratios « temps de mouvement » par sport** (alpi 0,55 · grande voie 0,35 · rando 0,82 · trail
  0,92 · course 0,95…), valeurs de départ avant d'avoir l'historique de l'athlète. Réalistes ?
- **Q13 — Cibles par la médiane.** On personnalise les charges cibles par la **médiane** des vraies séances
  (pas la moyenne) pour résister à une journée hors-norme. Bon choix ?

### Question ouverte de fond
- **Q14 — Rendements décroissants ?** La logique *durée × intensité²* donne des charges **élevées** pour
  les très longues sorties (5–7 h), même faciles. Est-ce le bon reflet du **stress d'entraînement** réel,
  ou faut-il introduire des **rendements décroissants** au-delà d'un certain temps pour ces journées
  d'endurance fondamentale ?

### Périodisation, phases & pilotage de la charge (recherche faite — `research/periodisation-phases-seances-cles.md`)
- **Q15 — ✅ Découpage en phases & vitesse de montée du CTL : implémenté v1 (Upgrade 9).** Phases
  rétro-comptées depuis l'objectif principal daté (affûtage/peak/build/base, §5.2) + **rampe de CTL
  +4 pts/sem** en semaine de charge (milieu de la fourchette +3-5, portée par les jours easy générés,
  bornée ×1.35). *Reste ouvert :* la rampe **par canal** (+1-3 neuro) — aujourd'hui le neuro est protégé
  par les seuils quotidiens (tsb_neuro, ACWR-neuro), pas par une rampe dédiée ; et la phase transition.
- **Q16 — Seuil ACWR & sa controverse.** On code aujourd'hui un seuil unique ~1,5 (rouge). La
  littérature propose une **bande 0,8-1,3** (vigilance au-delà de 1,3, alerte >1,5) **mais critique
  fortement l'ACWR** (couplage mathématique, pas de preuve causale — Impellizzeri 2020, Lolli 2019) :
  à lire comme **signal descriptif** + charge absolue, pas comme feu rouge automatique. Faut-il ajouter
  l'orange à 1,3 et un ACWR **par canal** (surtout neuromusculaire) ?
- **Q17 — ✅ Cadence de décharge (deload) : implémentée (Upgrade 9).** **3:1** en base, **2:1** en build,
  **−35 %** de volume (dans la bande −30/−50 %), **une** qualité conservée (intensité maintenue). Les
  mésocycles sont ancrés sur la **fin de phase** : la dernière semaine avant la phase suivante est une
  décharge (on encaisse le bloc avant d'intensifier). *Reste ouvert :* la question montagne (un « jour
  facile » = rando 3-4 h) — la décharge scale les cibles, pas la durée réelle des sorties de l'athlète.
- **Q18 — Forme de l'affûtage & événements.** La recherche (Bosquet, Mujika, Wang) penche pour une
  décroissance **exponentielle** avec **intensité maintenue** et un **canal neuro coupé plus tôt**
  (J-10 à J-14) ; notre affûtage actuel est **linéaire** et coupe l'intensité près de J (`hardCap=0`).
  Faut-il l'aligner ? Et faut-il **affûter aussi pour un événement clé** (aujourd'hui on n'allège que
  pour les objectifs — §5.1) ?

---

## 12. Glossaire express
- **Charge / points** : dose d'entraînement d'une séance (1 h au seuil = 100).
- **Canal aérobie / neuromusculaire** : coût cardio vs coût structures/CNS.
- **CTL / Fitness** : fond (moyenne lente ~6 sem). **ATL / Fatigue** : fatigue récente (~1 sem).
- **TSB / Fraîcheur** : Fitness − Fatigue (+ = frais, − = chargé).
- **ACWR** : ratio charge récente / charge habituelle (indicateur de risque).
- **LTHR / seuil** : fréquence cardiaque au seuil lactique (intensité = 1,0).
- **D+ / D−** : dénivelé positif / négatif. **RPE** : effort perçu. **Affûtage / taper** : allègement
  progressif avant un objectif.

---
*Ce document est vivant : il sera complété à chaque évolution du modèle. Toute correction d'un coach
spécialisé est la bienvenue — l'objectif est de remplacer nos valeurs de départ par des valeurs validées
sur le terrain.*
