# Recherche — Périodisation, découpage d'un objectif en phases, séances clés & pilotage par la charge

> **Statut : revue de littérature → vérification adversariale des sources → gap analysis → deltas
> proposés (NON appliqués).** Même schéma que [`descent-neuromuscular-rpe.md`](descent-neuromuscular-rpe.md)
> et [`heat-altitude.md`](heat-altitude.md) : on documente d'abord ce que dit la littérature, on **mesure
> l'écart** avec ce que fait Massif aujourd'hui (lecture du code), puis on propose des changements
> **bornés et défendables**. Aucun code ni la méthode coach ([`../MODELE_ENTRAINEMENT.md`](../MODELE_ENTRAINEMENT.md))
> n'a été modifié à ce stade — ce doc est une base de décision.
>
> **Question d'origine.** « Comment découper un objectif long terme (trail, rando, escalade, course,
> alpinisme, vélo…) en phases (construction, affûtage…), proposer des séances clés adaptées à chaque
> phase, et intégrer CTL/ATL/TSB/ACWR pour éviter la blessure ? »
>
> **Méthode des sources.** Recherche Perplexity (chaîne de 7 prompts, juin 2026), puis **vérification
> adversariale automatisée de chaque citation** (résolution réelle des DOI/PMID + contrôle que le papier
> soutient bien l'affirmation). Résultat : **0 source totalement inventée**, **toutes les affirmations
> soutenues par un vrai papier**, mais **6 citations sur 21 portaient une erreur** — dont 4
> misattributions d'auteur hallucinées par Perplexity (voir §0). Les sources escalade (peu de DOI dans
> la réponse brute) ont été **re-sourcées** sur les vrais papiers d'ancrage (Schöffl, Schweizer,
> Vigouroux, López-Rivera, Bohm/Arampatzis, Magnusson/Kjaer…).
>
> **Niveau de preuve — convention.** 🟢 méta-analyse / revue systématique · 🔵 ECR / expérimental ·
> 🟡 observationnel · 🟠 revue narrative / commentaire méthodo · ⚪ avis d'expert-entraîneur / pratique
> de terrain. La périodisation « fine » et la programmation montagne/escalade relèvent largement de
> ⚪/🟠 ; le taper, la distribution d'intensité et la biomécanique des poulies sont les blocs les mieux
> étayés (🟢/🔵).

---

## 0. Note sur la fiabilité des sources (résultat de la vérification)

**À retenir : Perplexity a produit des DOI/PMID majoritairement réels et des affirmations correctes,
mais a halluciné des noms d'auteurs sur 4 références descente/périodisation.** Toujours citer la
**colonne corrigée**.

| Cité par Perplexity | Problème | Référence **réelle** vérifiée |
|---|---|---|
| « Vollaard NBJ 2008 » (descente 7 j vs 4 j) | Auteur faux (DOI correct) | **Marqueste T, Giannesini B, Le Fur Y, Cozzone PJ, Bendahan D. 2008.** J Appl Physiol 105(1):299-307. PMID 18467547 |
| « Smoliga JM 2020 » (revue descente) | Auteur halluciné | **Bontemps B, Vercruyssen F, Gruet M, Louis J. 2020.** Sports Med 50(12):2083-2110. PMID 33037592 |
| « Stellingwerff 2026 » (EIMD trail) | Auteur faux (PMID réel) | **Martínez-Navarro I et al. 2026.** Sports (Basel) 14(1):12. PMID 41590954 |
| « Stöggl & Sperlich, IJSPP, 2021 » | Mauvais journal **et** année | **Stöggl TL & Sperlich B. 2015.** *Front Physiol* 6:295. PMID 26578968 (revue) ; ECR compagnon 2014, Front Physiol 5:33, PMID 24550842 |
| « Mujika & Padilla 2003, Part I/II » | Pas de « Part I/II » (1 seul article) ; durée réelle **4 à >28 j**, pas 8-14 | **Mujika I, Padilla S. 2003.** Med Sci Sports Exerc 35(7):1182-7. PMID 12840640 |
| « Bradbury 2020 » | C'est un **ECR**, pas une revue ; « Goods PSR » | OK sinon — PMID 30161090 |

Les **15 autres sont confirmées telles quelles** (Impellizzeri 2020, Hellard 2006, Eston 1996 *(déjà
dans le descent doc)*, Piatrikova 2021, Wang 2023, Bosquet 2007, Issurin 2016 & 2019, Mølmen 2019,
Smith 2007, Seiler 2010, Gabbett 2016, Lolli 2019, + les livres Koop/Rutberg et House/Johnston).

---

## Partie A — Découper un objectif : cycles, modèles, phases

### A.1 Hiérarchie des cycles
- **Macrocycle** : la saison / le grand cycle vers l'objectif principal — **3 à 12 mois**.
- **Mésocycle** : un bloc à dominante (base, force, spécifique, affûtage) — **3 à 6 semaines** (jusqu'à 8).
- **Microcycle** : l'unité hebdomadaire — **7 jours** (parfois 5-10 j pour caler récup/stages).

Pour un athlète montagne multi-sport, le macrocycle se pense comme **une suite de mésocycles à thème**
(base aérobie → capacité musculaire/force → spécificité montagne → affûtage), le microcycle faisant
varier la charge au jour le jour sans casser la logique du bloc en cours.

### A.2 Phases canoniques (durées = points de départ)

| Phase | Durée typique | Objectif physio | Volume / Intensité / Spécificité |
|---|---|---|---|
| **Base / prépa générale** | 4-10 sem | socle aérobie, tolérance au volume, robustesse musculo-tendineuse | Volume ↑, intensité basse-modérée, spécificité faible |
| **Build / prépa spécifique** | 3-8 sem | transformer la base en capacité spécifique (seuil, côtes, **descente**, sorties longues) | Volume stable/↑ léger, intensité ciblée ↑, spécificité ↑↑ |
| **Peak / pré-compétition** | 1-4 sem | fraîcheur max sans désentraînement | Volume ↓, intensité-clé maintenue, spécificité max |
| **Affûtage / taper** | 7-21 j | évacuer la fatigue sans perdre les adaptations | Volume **−41 à −60 %**, intensité **maintenue**, décroissance progressive/exponentielle |
| **Transition / récup** | 1-4 sem | restaurer tissus/SNC/motivation, faire redescendre le CTL | Volume très bas, intensité quasi nulle, spécificité minimale |

### A.3 Modèles de périodisation (avec niveau de preuve)

| Modèle | Principe | Pour qui | Preuve |
|---|---|---|---|
| **Linéaire classique** | volume↑ puis intensité↑ vers l'objectif | saison simple, 1 pic, amateur | 🔵 ECR : « planifié > non planifié », mais **pas** de supériorité du linéaire — Bradbury 2020 |
| **Linéaire inversé** | intensité tôt, volume après | fenêtre de forme précoce | 🔵 pas de gain clair vs linéaire — Bradbury 2020 |
| **Par blocs (Issurin)** | blocs concentrés accumulation→transmutation→réalisation | athlète entraîné, **qualités conflictuelles** (endurance + force + excentrique + portage) | 🟢/🟠 favorable pour certaines adaptations, **hétérogénéité forte** — Issurin 2016/2019, Mølmen 2019 |
| **Polarisé** | ~80 % facile / ~20 % très dur, peu de « gris » | endurance bien entraînée | 🟠/🔵 souvent supérieur sur VO2/perf chez l'entraîné — Seiler 2010, Stöggl & Sperlich 2015 |
| **Pyramidal** | majorité facile, un peu de modéré, encore moins de dur | amateur sérieux, saison réelle | 🟠 proche du polarisé selon le découpage de zones |
| **Sweet spot** | beaucoup de travail proche du seuil | temps limité, cyclisme | ⚪/🟠 pratique, moins robuste en endurance pure (trop de « gris ») |

**Quand préférer les blocs** : quand **trois conditions se cumulent** — plusieurs qualités en conflit,
niveau déjà élevé, possibilité d'isoler ces qualités. C'est le cas montagne (volume aérobie + tolérance
D− + force de portage + spécificité). En pratique : **hybride** — base plutôt linéaire, puis blocs
concentrés (force/descente, puis spécificité), puis affûtage.

### A.4 Décharges (deload)
- Cadence : **toutes les 3-5 sem**, standard **3:1** ; **2:1** quand la contrainte neuromusculaire est
  forte (D−, portage, force lourde) ou tolérance médiocre. ⚪ pratique de terrain.
- Ampleur : **−30 à −50 %** de charge ; **−40 à −60 %** près d'un bloc excentrique. Intensité **non
  supprimée** (rappels courts conservés), c'est le volume qu'on retire.
- Pour Massif : **3:1 en phase base/aérobie**, **2:1 dès qu'on empile du D−/portage/force**.

---

## Partie B — Périodisation par discipline

### B.1 Ultra-trail / course en montagne (objectif principal : 100K, ~6000 m D+) — P2
Trame **16-20 sem** (idéale pour reconstruire la tolérance D−) ; à **13 sem** : 4-5 base · 3-4 build
spécifique · 2 peak · 2 taper.

- **Côtes / montée** : 🟠/⚪ force-endurance → puissance → économie sous fatigue. 1 séance/sem en base
  (côtes courtes/vallonné), 1-2/sem en build (dont 1 longue force-endurance ou seuil en montée),
  20-60 min cumulées de travail spécifique en phase spécifique, bâtons.
- **Descente / excentrique (D−)** : 🔵 c'est le **coût caché** du 100K. *Repeated-bout effect* établi
  (Eston 1996 ; Smith 2007 ; Marqueste 2008 ; revue Bontemps 2020). **Intervalle 7-14 j entre grosses
  expositions** favorise l'adaptation ; un retour à 4 j entretient la casse (Marqueste 2008 : 4 j
  empêche la récupération, 7 j la permet). Réintroduire la descente **tôt mais à petite dose** pour
  éviter le « casse-pattes » (le cardio revient plus vite que la robustesse excentrique). Progression
  ⚪ : 200-800 m D−/sem (sem 1-3) → 800-1500 (sem 4-8) → 1500-3000 en blocs spécifiques (sem 9-16), avec
  pics ponctuels suivis de vraie récup. *Cohérent avec le canal neuro de Massif et l'Upgrade 7 descente.*
- **Sortie longue** : ⚪ progression **1h45-2h30 → 2h30-4h → 3h30-5h30** ; plafond raisonnable **5-6 h
  ou ~35-40 % du volume hebdo** (Koop, House/Johnston privilégient **week-ends chocs** + spécificité
  terrain plutôt que la très longue sortie isolée).
- **Race simulation** : ⚪ 2-4 sem avant J, après que la tolérance excentrique est construite ; teste
  pacing, nutrition, matériel, D− technique, portage.
- **Affûtage ultra** : 🟢 (Bosquet 2007, Wang 2023) — un peu plus long qu'en course courte. Schéma ⚪ :
  J-21→J-14 volume −20-30 % ; J-14→J-7 volume à 40-60 % du normal, **D− fortement réduit** ; dernière
  semaine 25-40 % + quelques accélérations courtes, **quasi aucune charge excentrique lourde**.

### B.2 Alpinisme / rando longue / ski de rando — P3 + sources vérifiées
Trame ⚪ (House/Johnston, *Training for the New Alpinism* 2014 / *Training for the Uphill Athlete* 2019) :
base aérobie + force générale (4-10 sem) → développement spécifique (4-8 sem) → bloc spécificité
terrain/portage/verticalité (2-6 sem) → pic fonctionnel (1-2 sem) → affûtage (7-21 j, plutôt 10-14) →
acclimatation finale. **Objectif daté mais non chronométré** : la priorité glisse de la « performance de
course » vers la **capacité à durer / porter / grimper / descendre / rester lucide**.

- **Endurance fondamentale** : gros volume à **très basse intensité** (zone 1 / sous seuil aérobie), LSD ;
  progression de durée ~5-10 %/sem avec deload. En montagne, l'échec vient de l'accumulation de fatigue,
  pas du manque de vitesse. ⚪ (House/Johnston).
- **Force → endurance de force (ME) → spécificité chargée** : force max d'abord (2×/sem, 3-5×3-6 reps),
  puis muscular endurance (circuits, step-ups, marches inclinées), puis transfert vers marche
  d'approche / portage / rando-course chargée. ⚪ (House/Johnston).
- **Port de charge** — 🟢/🔵 coût + blessure bien étayés, ⚪ pour les seuils chiffrés :
  - coût métabolique **non-linéaire avec le % du poids de corps** (modèle LCDA ≈ charge^1,36 — Looney
    2022 ; pénalités respiratoires/CV nettes dès 25-50 % PC — Faghy 2022) ;
  - **la masse distale coûte 7-10× plus** que dans le sac (chaque kg au pied = +7-10 % de dépense ; sac
    dorsal > portage à l'épaule — Knapik 2004, Legg 1992) ;
  - **facteur de blessure de surcharge** (membres inférieurs : fractures de fatigue, ampoules, lombalgie,
    neuropathies de bretelle — Orr 2014, Walsh 2021) ;
  - ⚠️ **les plafonds « 10-20 % du poids de corps » viennent de l'ergonomie cartable/rando, PAS de la
    littérature militaire** (où l'on porte 35-55 %+) — **aucun seuil % « sûr » validé chez l'adulte**. Ce
    qui est solide = le **principe** : os/tissus s'adaptent plus lentement que le moteur cardio, donc
    **progression lente** (+5-10 %/sem en charge OU distance, jouer aussi vitesse/pente/terrain), pas un
    chiffre précis. Cadre directement le **canal neuro** de Massif.
- **Pic & affûtage** : viser la fraîcheur **J-7 à J-14**, forme « stable/lucide » plutôt qu'un pic
  explosif ; allègement **−30 à −50 %** du volume, intensité en rappels courts, **suppression des séances
  laissant des courbatures profondes (excentrique)**. ⚪ (House/Johnston), cohérent avec §D.4.
- **Acclimatation altitude (planification)** — clinique/🟠 :
  - **seuils** : risque dès ~2500 m (sensibles dès ~2000 m), notable 2500-3500 m, majeur >3500 m
    (WMS 2024 ; Bärtsch & Saltin 2008) ;
  - **vitesse d'ascension** : au-dessus de **3000 m**, ne pas augmenter l'**altitude de SOMMEIL** de plus
    de **500 m/jour**, **jour de repos tous les 3-4 j** (WMS 2024). *« Grimper haut, dormir bas »* est
    encouragé — la limite porte sur le sommeil (300-350 m/nuit = cible coach plus conservatrice, pas la
    valeur du guideline) ;
  - **durée** : acclimatation progressive sur **jours → 2 semaines** (Bärtsch & Saltin) ; arriver
    quelques jours avant aide, plus c'est mieux. **Pré-acclimatation** proportionnelle à altitude ×
    durée ; altitude réelle / chambre hypobare > tente normobare (Fulco/Beidleman/Muza 2013) ;
  - **Live-high/train-low** : 🟢/🔵 surtout pour la perf **au niveau de la mer** (~+1-4 % — Levine &
    Stray-Gundersen 1997 ; dose-altitude optimale ~2000-2500 m, Chapman 2014 ; méta Bonetti & Hopkins
    2009), avec forte **variabilité répondeurs/non-répondeurs** (Chapman 1998) et effets débattus. **Pour
    un objectif EN montagne, c'est l'ACCLIMATATION (WMS) qui prime, pas le LHTL** ; l'IHT n'améliore pas
    l'endurance au niveau de la mer (Millet 2010).
- **Pilotage CTL/ATL** : confirme l'architecture 2 canaux — beaucoup de charge à **FC basse mais
  structurellement coûteuse** (portage, longues journées, D−) → CTL **aérobie** plus libre, CTL **neuro**
  conservateur (cf. F2). *« Prêt cardio ≠ prêt jambes/dos/tendons ».*

> Rappel : l'altitude **comme contexte de charge/récup** (VO₂max −6,3 %/1000 m, HRmax, acclimatation
> chaleur + décroissance) est déjà traitée et sourcée dans [`heat-altitude.md`](heat-altitude.md) — non répété ici.

### B.3 Escalade (bloc / voie / falaise / grande voie) — P4 + sources re-vérifiées
Phases classiques ⚪ : **endurance de base/volume** (4-8 sem) → **force max des doigts** (4-6 sem) →
**puissance** (3-5 sem) → **résistance / power-endurance** (4-8 sem) → **peak** (1-3 sem). Bloc =
priorité force/puissance ; voie/falaise = power-endurance/résistance au *pump* ; grande voie =
volume + durabilité + gestion d'effort + portage (≈ une endurance longue).

**Le fait dur de la périodisation escalade : les structures s'adaptent bien plus lentement que la force.**
- 🟠/🟢 **Muscle/nerf vs tendon** : la force monte en **3-6 sem** (gains surtout **neuraux** sem 1-4),
  alors que le tendon ne se mesure qu'après **≥8 sem** (rigidité +17-77 %, section +4-10 % plus lente) ;
  Kubo (via Mersmann 2017) : la force **précède** la rigidité tendineuse de **1-2 mois**. Le **cœur**
  du tendon renouvelle son collagène très lentement (mois-années) — Magnusson & Kjaer 2019. → **base
  physiologique directe du piège de reprise/début de saison** : on peut tirer fort avant que les poulies
  ne suivent.
- 🔵 **Poulies A2/A4 — biomécanique** : en **arquée** (crimp), la force sur **A2 est ~36× celle en prise
  tendue** (A4 ~4×) — Vigouroux 2006 ; A2 voit **~3-4× la force au bout du doigt** — Schweizer 2001.
  Charge à la rupture **A2 ~407 N** (A4 ~210 N) — Lin 1990 ; une chute tout le poids sur un doigt arqué
  (~70 kg) ≈ **450 N**, au-dessus du seuil → explique les ruptures d'A2. **Privilégier prise
  ouverte/semi-arquée** tôt, réserver l'arquée franche aux phases où le tissu est préparé (consensus
  clinique Schöffl ; pas d'ECR sur l'incidence).
- 🟠 **Classification Schöffl** (grading I-IV ; conservateur I-III ~immobilisation 10-14 j puis 3 mois
  fonctionnel ; chirurgie IV) — Schöffl 2003, Miro/Schöffl 2021. A2 = poulie clé.
- 🔵/🟢 **Hangboard (Eva López)** : López-Rivera & González-Badillo 2019 (ECR n=26, 8 sem) — **endurance
  de prise** : suspensions intermittentes réglette mini **+45 %** (ES 1.0) > max + lest **+34 %** >
  combiné **+7 %** (un seul focus bat le mélange) ; **force max** = intensité maximale (lest, réglette
  ~15 mm, repos longs). Méta Stien 2023 : l'entraînement de force spécifique **bat** « grimper seul »
  (perf SMD 0.57, force doigts 0.41, endurance avant-bras 1.23). Nuance Gilmore/Baar 2024 : du
  **low-intensity fréquent** peut égaler les max-hangs (rétrospectif app).
- 🟡 **Force de doigts = meilleur corrélat entraînable de la performance** (justifie une phase dédiée) :
  Buraas 2025 — force spécifique (suspension réglette 22 mm, **N/kg**) explique jusqu'à **~80 %** de la
  variance (bloc r=0.89) ; **le handgrip classique sous-estime massivement** (r≈0.47-0.54). ⚠️ « n°1
  universel » = raccourci : Mermier 2000 → technique/expérience expliquent **58,9 %** de la variance
  (la technique domine surtout chez le non-élite) ; revue Faggian 2025 met force ET endurance
  cardio-respiratoire en « primaires » sans hiérarchie chiffrée.
- ⚪ **Repères pratiques (consensus de coaches, preuve faible)** : **48-72 h** entre 2 grosses séances
  doigts (étayé indirectement par la cinétique du collagène : équilibre net positif **~36-72 h**
  post-effort — Kjaer 2009, Magnusson 2010), progression du stress doigts **+5-10 %/sem** (transfert de
  l'ACSM, **non validé** en escalade ; Quarmby 2023 trouve même la relation volume-blessure
  **contradictoire**). À traiter comme **garde-fous prudents**, pas comme seuils prouvés.

**Intégration multi-sport** : ⚪ ne pas coller une grosse séance « doigts durs » la veille/lendemain
d'une grosse séance endurance systémique (D−, fractionné trail, portage). Z1 vélo / course facile
coexistent bien avec un jour de grimpe. → **valide directement la règle Massif « pas 2 jours durs même
système »**, et plaide pour traiter la grimpe lourde comme un **jour dur neuromusculaire**.

### B.4 Vélo & multi-sport concurrent — P5
- **Cadre Friel** ⚪ : Base (8-16 sem) → Build (6-12) → Specialty/Peak (3-6) → Taper (7-14 j). Base ~75-90 %
  facile ; Build : ↑ seuil/VO2. Sweet-spot (≈88-94 % FTP) = gains rapides du seuil mais fatigue cumulée ;
  polarisé = meilleur pour VO2/athlète entraîné.
- **Entraînement concurrent (force ↔ endurance)** 🔵/🟠 : effet d'interférence **réel mais atténuable**
  (AMPK vs mTOR, fatigue) ; il dépend du **volume d'endurance, du type de force, de l'ordre et de
  l'espacement**. Règles ⚪ : **24 h minimum, 48-72 h préférable** entre 2 fortes stimulations
  neuromusculaires (doigts, D−, force lourde) ; force **2-3×/sem** en développement, **1×/sem** en
  maintien ; faire la **qualité quand on est frais** ; progression du volume total combiné **+5-10 %/sem
  max** ; deload 3:1 (2:1 si charge neuro forte). En **peak**, supprimer la force max **10-14 j** avant l'objectif.

---

## Partie C — Bibliothèque de séances clés (par filière)

| Séance | Objectif | Structure type | Intensité | Phase(s) | Fréq./sem | Canal dominant |
|---|---|---|---|---|---|---|
| **Endurance fond. / Z2** | base aérobie, oxydation lipidique, durabilité | 45 min-3 h+ continu | Z1-Z2 (~60-75 % FCmax) | base→entretien | 2-5 | **Aérobie** |
| **Seuil / tempo** | ↑ seuil lactique, économie | 2×15-30 ou 3×10-20 min (récup 2-5 min) | ~85-95 % FCmax / LTHR | build (+rappel peak) | 1-2 | Aérobie (+périph. si long) |
| **VO2max / intervalles** | puissance aérobie, tolérance acidose | 4×4, 5×3, 30/30, 40/20 | ~90-95 % FCmax+ | build (+rappel) | 1 (2 en bloc) | Aérobie (neuro modéré) |
| **Force-vitesse en côte** | force spécifique montée, économie en pente | 6-10 × 30 s-5 min, ou blocs 8-20 min | fort, contrôlé | base avancée→spécifique | 1 (2 en spécif.) | **Mixte → neuro** si raide/chargé |
| **Répétitions descente / excentrique** | tolérance DOMS, repeated-bout, technique | 4-8 × 2-8 min descente contrôlée, récup complète | qualité, **pas la casse** | base avancée→build | 1/1-2 sem → 1/sem | **Neuromusculaire** |
| **Sortie longue spécifique** | durabilité, nutrition, posture sous fatigue | 2-6 h terrain spécifique, D+/D− | modérée globale | base→peak | 1 (ou /10-14 j si lourde) | Aéro→**neuro** dès que long/technique |
| **Race simulation** | pacing, nutrition, matériel, enchaînement | 4-10 h ou week-end choc | modérée, charge totale élevée | peak (fin de build) | 1-3 sur le cycle | **Mixte, souvent neuro** |

**Spécifique montagne** : côtes en montée (mixte, neuro si raide/chargé) · descente contrôlée (neuro
dominant) · rando-course longue D+/D− (aéro + neuro, la plus complète et la plus coûteuse).
**Règle de protection neuro** ⚪ : pas 2 séances mixte/neuro lourdes à <48 h · Z2 = amortisseur ·
**réduire fortement D− et côtes raides dans les 10-14 derniers jours** · garder des rappels courts
d'intensité pour ne pas « éteindre » la forme.

Niveau de preuve : 🟢/🔵 endurance fond., seuil, VO2, taper (très étudiés) ; 🟠/⚪ formats montagne
ultra-spécifiques (physio appliquée + expertise — Friel, Koop, House/Johnston, Seiler).

---

## Partie D — Piloter avec CTL / ATL / TSB / ACWR & affûtage

### D.1 Ramp-rate de CTL « sûr »
⚪ (héritage Banister/PMC + usage TrainingPeaks/Friel — **pas** un chiffre issu d'un ECR) :
- **CTL aérobie : +3 à +5 / sem** (+6-8 réservé athlète très entraîné, bloc court).
- **CTL neuromusculaire : +1 à +3 / sem** (récup structurelle plus lente).
- Point clé : **un CTL global masque le risque** — le moteur cardio peut monter plus vite que la
  tolérance descente/tendons/doigts. → argument fort pour **surveiller le ramp-rate par canal**.

### D.2 ACWR — utile mais à manier prudemment
- 🟠 Zone « sweet spot » **0,8-1,3**, danger **≥1,5** (risque ×2-4) — Gabbett 2016.
- 🟠 **Controverse** : couplage mathématique (numérateur inclus au dénominateur) → corrélation factice
  (Lolli 2019) ; *pitfalls* conceptuels/statistiques, **aucune preuve causale de prévention**
  (Impellizzeri 2020). EWMA lisse mieux qu'une moyenne mobile mais **ne résout pas** le problème de fond.
- **En pratique** : ACWR = **signal de prudence descriptif, pas un feu rouge automatique**. Lire
  **charge absolue + tendance + contenu**. Un 1,5 venant d'une charge faible ≠ un 1,5 sur charge déjà élevée.

### D.3 TSB / fraîcheur le jour J
⚪/🟠 endurance : **TSB ≈ −10 à +10**, pic fréquent **0 à +10** (objectif long, intensité moyenne non
maximale). Pic très important : certains visent **+5 à +20** si bonne réponse à l'affûtage. Logique PMC :
monter le CTL en bloc, puis faire baisser l'ATL **plus vite** que le CTL en taper pour remonter le TSB.

### D.4 Affûtage fondé sur preuves
🟢 Bosquet 2007 (méta) : **~2 sem**, volume réduit **exponentiellement de 41-60 %**, **intensité ET
fréquence maintenues**. 🟢 Wang 2023 (méta) : **−41-60 %**, **≤21 j**. 🟠 Mujika & Padilla 2003 : durée
**4 à >28 j** (optimum souvent **10-14 j**), réduction de volume **jusqu'à 60-90 %**, **décroissance
non-linéaire (progressive/exponentielle) > palier brutal**, taper plus efficace **après un bloc de
surcharge**.

### D.5 Neuro ≠ aéro — les seuils ne se transposent PAS
- ACWR « acceptable » côté aéro peut être **trop haut** pour descente/portage/force.
- TSB aéro correct peut **masquer** une fatigue structurale.
- → côté **aéro** : ramp-rate plus rapide, taper 7-21 j, TSB course 0 à +10. Côté **neuro** : ramp-rate
  plus lent, **deloads plus fréquents**, et **réduction plus précoce** des stress excentriques/lourds
  (J-10 à J-14). *« Prêt cardio mais pas prêt quadriceps/tendons/doigts » = la raison d'être des 2 canaux.*

---

## Partie E — Gap analysis : ce que fait Massif aujourd'hui

Lecture du code (vérifiée) — [`briefing-algo.ts`](../../web/src/lib/briefing-algo.ts),
[`planning.ts`](../../web/src/lib/planning.ts), [`load.py`](../../ingest/massif_ingest/load.py),
[`sync.py`](../../ingest/massif_ingest/sync.py), [`rollup.ts`](../../web/src/lib/rollup.ts),
[`coach-context.ts`](../../web/src/lib/coach-context.ts).

| Thème | Massif aujourd'hui | Écart vs recherche |
|---|---|---|
| **Macro-phases** (base/build/peak/taper) | **Aucune.** `buildWeekPlan` = fenêtre glissante **7 j** reconstruite chaque jour, sans état de bloc/mésocycle ni champ « phase » | Pas de découpage de saison ; le plan ne sait pas « où » l'athlète est dans le macrocycle |
| **Affûtage** | Codé mais **objectifs seulement** (pas les événements) ; facteur volume **linéaire** `clamp(0.5+0.5·(jours/fenêtre),0.5,1)` ; fenêtre **14 j** primaire / **7 j** secondaire ; `hardCap` → **0** si J≤4 | Recherche : décroissance **exponentielle**, **intensité maintenue** (or hardCap 0 supprime l'intensité), neuro coupé **plus tôt** que l'aéro |
| **Décharge (deload)** | **Absente** (un seul jour de repos intra-semaine heuristique) | Pas de cadence 3:1 / 2:1 |
| **Ramp-rate CTL** | **Aucun garde-fou** : croissance hebdo de CTL non bornée par le calcul | Pas de cap +3-5 (aéro) / +1-3 (neuro) |
| **ACWR** | `atl/ctl` EWMA **couplé**, **total-load** (pas par canal) ; seuil **1,5** (rouge) dans `computeReadiness`, pas de bande 0,8-1,3 | Pas de vigilance à 1,3, pas de lecture charge absolue, pas d'ACWR neuro |
| **TSB jour J** | Cibles événement (clé : tsb 12 / aéro 10 / neuro 8) **advisory**, non bouclées sur le volume | Cohérent (12 ≈ haut de la fourchette pic) mais non documenté/borné |
| **Règle dans les prompts LLM** | Taper **uniquement dans l'algo** ; chat/ask ne connaissent ni la fenêtre d'affûtage ni la distinction événement/objectif | À répliquer dans les prompts pour cohérence du coach conversationnel |
| **Constantes τ** | CTL 42 j · ATL aéro 7 j · ATL neuro 14 j (variable 11,5-16,5 via Upgrade 7) | OK / cohérent avec la littérature impulse-response |

---

## Partie F — Deltas proposés (bornés, **non appliqués** — à valider)

Chaque delta : **valeur actuelle (emplacement) → cible (source)**, borné, **inerte par défaut** quand
c'est possible (mêmes principes que les upgrades `load.py` existants). Ordre conseillé d'implémentation :
**F5 → F4 → F2 → F1 → F3** (du plus simple/sûr au plus structurant). Tout ceci est **spécifié, non codé**.

### F1 — Modèle de macro-phase dérivé (pas de table)
- **Existant** : aucune phase ; `buildWeekPlan` = fenêtre 7 j ([`briefing-algo.ts:217`](../../web/src/lib/briefing-algo.ts)) ; seule logique « saison » = `taperState` (fenêtre objectif 14/7 j, lignes 166-182).
- **Cible** : fonction `phaseForGoal(ctx)` dérivant la phase de `primary_goal.days_to` (kind `race`) :

  | Phase | `days_to` | `hardCap` | `phaseMul` (volume) | emphase |
  |---|---|---|---|---|
  | base | > 84 j | 2 | 1.0 | volume facile, côtes légères |
  | build | 29-84 j | 2 | 1.0 | seuil + descente + sortie longue |
  | peak | 15-28 j | 2 | 0.85 | spécifique course, volume ↓ |
  | taper | ≤ 14 j | *(voir F4)* | *(voir F4)* | affûtage |
  | transition | pas d'objectif daté / post-objectif | 1 | 0.6 | récup |

- **Inerte** : sans objectif `race` daté → phase `base` = comportement actuel (hardCap 2, mul 1.0).
- **Où** : nouvelle fn + wiring `buildWeekPlan` (hardCap / loadMul / focus) ; **miroir** dans les prompts chat/ask (sinon le coach conversationnel ignore la phase).

### F2 — Garde-fou de ramp-rate CTL, par canal *(forme close, sans projection lourde)*
- **Existant** : aucun cap ; la montée hebdo de CTL n'est bornée par rien (EWMA seul, `rollup.ts`/`sync.py`).
- **Maths** : EWMA CTL (τ=42 j) sur 7 j à charge moy. journalière L̄ ⇒ `ΔCTL₇ ≈ 0,1535·(L̄ − CTL₀)`. Donc pour borner ΔCTL :
  - **aéro** ΔCTL ≤ **+5/sem** ⇒ `L̄_aéro ≤ CTL_aéro + 32,6`
  - **neuro** ΔCTL ≤ **+3/sem** ⇒ `L̄_neuro ≤ CTL_neuro + 19,5`
- **Cible** : après construction du `week_plan`, calculer L̄_aéro/L̄_neuro (via `splitByTag`) ; si dépassement, **rabattre** `loadMul` des jours non-ancrés jusqu'au cap + lever un **flag**. N'utilise que `fitness_model_latest.{ctl_aerobic, ctl_neuromuscular}` (déjà en contexte) — pas besoin de la série `dm`.
- **Constantes** : `RAMP_AERO_MAX = 5`, `RAMP_NEURO_MAX = 3` (⚪, Q15). Soft (rabat progressif), pas de gate dur.
- **Où** : `buildWeekPlan` (passe finale).

### F3 — Cadence de décharge (deload)
- **Existant** : aucune ; seul un jour de repos intra-semaine heuristique ([`briefing-algo.ts:258`](../../web/src/lib/briefing-algo.ts)).
- **Cible** : semaine de décharge **3:1** (base/build) / **2:1** (bloc neuro), `phaseMul × 0,55` (−45 %), `hardCap − 1`, intensité conservée.
- **Dépendance** : besoin d'un index « semaine dans le bloc » → soit dérivé de F1 + un `block_start_date` (nouveau champ léger sur `athlete_profile`), soit un compteur. **Priorité plus basse** (faire F1 d'abord).

### F4 — Affûtage : exponentiel + intensité maintenue + neuro coupé plus tôt
- **Existant** : `factor = clamp(0.5 + 0.5·(daysTo/win), 0.5, 1)` **linéaire** ; `hardCap = daysTo≤4 ? 0 : 1` (coupe l'intensité) ([`briefing-algo.ts:179-180`](../../web/src/lib/briefing-algo.ts)).
- **Cible** (Bosquet 2007, Mujika 2003, Wang 2023) :
  - **décroissance exponentielle** : `daysIn = win − daysTo ; factor = FLOOR + (1−FLOOR)·e^(−DECAY·daysIn/win)`, avec `FLOOR=0.45`, `DECAY=2.3` ⇒ ~1,0 au début du taper, ~0,50 le jour J (réduction front-loaded, dans la bande −41-60 %).
  - **intensité maintenue** : `hardCap = 1` pendant tout le taper (≥1 rappel court), au lieu de 0 près de J.
  - **neuro coupé plus tôt** : si `daysTo ≤ 14`, rétrograder `hard_neuromuscular`/`hard_structural` → `easy/recovery` (pas d'excentrique/force lourde dans les 2 dernières semaines), en gardant un `hard_aerobic` court.
- **Inerte** : seulement si `taperState.active`.
- **Où** : `taperState` + `buildWeekPlan`.

### F5 — ACWR nuancé *(le plus simple — à faire en premier)*
- **Existant** : `acwr > 1.5 → red` ([`briefing-algo.ts:111`](../../web/src/lib/briefing-algo.ts)) ; pas de bande orange ; ACWR `atl/ctl` **couplé, total** ([`rollup.ts:131`](../../web/src/lib/rollup.ts)).
- **Cible** : ajouter `acwr_amber = 1.3` → orange (après les gates rouge) ; **ACWR neuro** dérivé `atl_neuromuscular/ctl_neuromuscular` (déjà en contexte, **aucune migration**) → orange si > 1,3 ; lire la **charge absolue** (un 1,5 sur charge faible ≠ sur charge élevée). Documenter le caractère **descriptif** (Impellizzeri 2020, Lolli 2019) — rester un signal, pas un gate dur.
- **Où** : `computeReadiness` + `R` (briefing-algo.ts) ; optionnel : persister `acwr_neuromuscular` dans rollup.

### Question ouverte (pas un delta imposé)
- **Affûtage pour événements clés ?** Aujourd'hui on n'affûte que pour les **objectifs** ([§5.1](../MODELE_ENTRAINEMENT.md)) ; un `is_key` declared_event sans objectif associé reçoit une semaine pleine. La recherche ne tranche pas → décision coach (Q18).

> **Ajouts à [`MODELE_ENTRAINEMENT.md`](../MODELE_ENTRAINEMENT.md) : FAITS** (§5.1 enrichi, nouvelle §5.2,
> Q15-Q18). Les deltas **F1-F5 ci-dessus sont spécifiés mais NON codés** — à implémenter sur feu vert.

---

## Partie F-bis — Corrections issues de la critique adversariale (FONT FOI sur §F)

> Une critique adversariale (3 agents : logique / viz / arithmétique) a validé l'implémentabilité mais
> relevé **2 blockers + 5 majeurs**. Ces corrections **priment** sur la spec §F brute.

**F1×F4 — fusionner en UNE courbe de volume continue (BLOCKER + amélioration).** Ne pas multiplier
phaseMul × taperFactor (double-réduction), mais surtout : un simple `taper.active ? factor : phaseMul`
crée un **saut absurde** au passage peak→taper (J-15 = peak ×0,85, J-14 = taper ×1,0 → le volume
*remonte*). Solution : **une seule fonction monotone `volumeMul(days_to)`** — base/build **1,0** → peak
décroît **1,0→0,85** → taper décroît (exponentiel) **0,85→~0,53** → transition **0,6**. Le taper est
ancré sur le plafond du peak : `factor = 0,5 + 0,35·e^(−2,3·daysIn/win)` (J-14 = 0,85 ✓ continu ; J-0 ≈
0,535, soit ~−46 % de volume, dans la bande 41-60 %). ⚠️ **Le tableau I.2 utilisait l'ancienne forme
(plafond 1,0) → à recalculer avec `volumeMul`.** Dry-run de transition J-15→J-14 obligatoire.

**F2 — cap proportionnel + plancher + coefficient discret (BLOCKER).** Le cap absolu seul est absurde en
reprise (CTL bas → +228 pts/sem autorisés sur un désentraîné). Caper la charge hebdo moyenne :
`L̄ ≤ min( CTL₀·(1+r), CTL₀ + RAMP_MAX/coef )` avec `r≈0,5` (neuro) / `0,6` (aéro) + un **plancher absolu**
`L̄_min` pour ne pas geler une vraie réathlétisation. +5/+3 = caps **en régime établi**, pas en reprise.
**Coefficient** : forme **discrète** du rollup `coef = 1−(1−α)^7 ≈ 0,152` (α=1−e^(−1/42)), pas 0,1535
(continue) → caps ≈ +32,9 (aéro) / +19,7 (neuro) en régime établi.

**F2 vs F4 (MAJEUR).** Désactiver F2 quand `taper.active` (l'affûtage est déjà une décharge volontaire).
Sinon, F2 ne peut QUE réduire (`loadMul = min(loadMul, capF2)`), jamais relever, et par-jour (ne pas
aplatir la courbe de F4).

**F2 — dégradation gracieuse sur ancre (MAJEUR + I.3).** Calculer le dépassement APRÈS avoir mis les jours
libres à leur plancher ; si l'**événement ancré seul** dépasse encore, **ne plus rabattre** (jamais
écraser les jours libres à 0, jamais toucher l'ancre) → **flag descriptif uniquement**, nombre
d'itérations borné. Pour les jours ANCRÉS, utiliser le **split réel `estimated_load`** de l'ancre, pas
`splitByTag` (sinon faux split neuro → faux flag).

**F5 — ACWR neuro fiabilisé (MAJEUR).** N'armer l'orange ACWR-neuro que si `ctl_neuromuscular ≥ plancher`
(~10-15, cohérent avec `MIN_SAMPLES=12` du modèle descente) ; sinon `low-confidence`, pas d'orange (petit
dénominateur → orange permanent = le reproche Lolli/Impellizzeri). Garde `ctl≥plancher ? : null`.

**F5 — orange ACWR ORTHOGONAL (MAJEUR).** N'armer l'orange ACWR que si **TSB n'est PAS déjà négatif**
(forme fraîche + charge aiguë haute = la vraie valeur ajoutée, cf. I.1). Si déjà orange par TSB,
**fusionner** le message, ne pas empiler un 2e flag (ACWR et TSB sont 2 fonctions du même couple atl/ctl).

**F4 — coupe neuro (MAJEUR).** Restreindre la rétrogradation neuro aux **jours GÉNÉRÉS** (jamais retag une
ancre `hard_neuromuscular`). Et **« pas d'excentrique LOURD »** plutôt que « pas de neuro du tout » :
garder une **touche de descente spécifique courte** si l'objectif est une course de descente (sinon
désentraînement excentrique avant un 100K à 6000 m D−, qui EST l'objectif neuro).

**F3 — exige `block_start_date` (mineur, confirmé).** F1 ne donne PAS l'index intra-bloc (build ≈ 8 sem).
F3 a besoin d'un champ persistant `block_start_date` (migration) + `weekInBlock`. Inerte (no-op) si NULL.

**F1 — câbler la transition (mineur).** `loadMul = taper.active ? taperFactor : volumeMul(ctx)`, où
`phaseForGoal` renvoie `0,6` quand le dernier objectif est passé (J négatif) ou absent → pas de reprise à
pleine charge juste après la course.

**F4 — objectif secondaire win=7 (mineur).** DECAY constant sur 7 j ⇒ affûtage ~2× plus raide ; soit
l'accepter (taper plus léger en absolu), soit remonter `FLOOR` (~0,6) pour un B-race. Dry-run win=7 à ajouter.

**Nettoyage.** Supprimer `TAPER_DAYS=2` (mort, briefing-algo.ts:90) dans le PR de F4.

---

## Partie G — Synthèse de la phase de recherche & feuille de route

> But : un **point global clair** avant de planifier l'intégration. Effort : **S** ≈ ½ j · **M** ≈ ½-1 j ·
> **L** ≈ plusieurs jours / état persistant · **XL** ≈ nécessite un schéma + modèle. Priorité :
> **P0** (sûr, sans migration) → **P4** (différé). Tout ce qui touche `briefing-algo.ts` impose la
> **discipline de miroirs** (prompts chat/ask) + mise à jour de `briefing-algo.test.ts`.

### G.1 Ce que cette phase a produit (état)
- ✅ Doc de recherche **sourcé & vérifié** (ce fichier) — 21 citations contrôlées, **6 corrigées**, 0 inventée.
- ✅ [`MODELE_ENTRAINEMENT.md`](../MODELE_ENTRAINEMENT.md) **enrichi** (§5.1 affûtage chiffré, §5.2 phases, Q15-Q18).
- ✅ 5 deltas code **spécifiés** (F1-F5) + 1 question ouverte + 1 levier montagne (portage).
- ✅ §B.2 alpinisme/ski/rando : **sourcé & vérifié** (altitude WMS 2024 / Bärtsch / Fulco · LHTL Levine / Chapman / Bonetti · portage Knapik / Orr / Looney).

### G.2 À INTÉGRER (nouveau)
| ID | Nouveau point | Réf / source | Cible | Effort | Dépend de | Prio |
|---|---|---|---|---|---|---|
| **N4** | ACWR **neuro** + bande **orange 1,3** | F5 · Gabbett, Impellizzeri, Lolli | `computeReadiness` + `R` | **S** | CTL/ATL neuro exposés en ctx *(vérif)* | **P0** |
| **N2** | Garde-fou **ramp-rate CTL par canal** (+3-5 aéro / +1-3 neuro), forme close | F2 · ⚪ TrainingPeaks/Friel | `buildWeekPlan` (passe finale) | **M** | CTL aéro/neuro en ctx *(vérif)* | **P1** |
| **N1** | **Modèle macro-phase** (base/build/peak/taper/transition) dérivé de `days_to` | F1 · Issurin, Friel | `phaseForGoal` + `buildWeekPlan` + prompts | **L** | — *(débloque N3, N7, M3)* | **P2** |
| **N7** | **Cartographie séances-clés par phase** (quelle filière dans quelle phase) | §C | emphasis/focus de F1 | **S** | N1 | **P2** |
| **N3** | **Cadence de deload** 3:1 / 2:1 | F3 · ⚪ | `buildWeekPlan` + index de bloc | **L** | N1 + champ `block_start_date` | **P3** |
| **N6** | **Conseil d'acclimatation altitude** (vitesse d'ascension ≤500 m/j sommeil, arriver J-N) | P3 · WMS 2024, Bärtsch ✅ | prompt rule 8 + `environment` (hooks déjà là) | **S-M** | — (sources OK) | **P3** |
| **N5** | **Port de charge** = charge structurelle progressive (5-20 % PC) | P3 · Knapik, House ⚪ | modèle + `planned_sessions.pack_weight` | **XL** | nouveau champ + terme modèle | **P4** (différé) |

### G.3 À MODIFIER (existant)
| ID | Modification | De → vers | Cible | Effort | Prio |
|---|---|---|---|---|---|
| **M1** | Forme de l'**affûtage** | linéaire `0.5+0.5·(j/win)` → **exponentiel** ; `hardCap` 0→**1** (intensité maintenue) ; **neuro coupé J-14** | F4 `taperState`/`buildWeekPlan` + tests | **M** | **P0** |
| **M2** | Lecture **ACWR** | seuil unique 1,5 → bande **1,3/1,5** + charge absolue + cadrage **descriptif** | F5 `computeReadiness` | *(inclus N4)* | **P0** |
| **M3** | **Prompts coach** chat/ask | n'ont ni phase ni règle d'affûtage → **injecter** phase + règle d'affûtage | `coach-chat.ts`/`ask.ts` (miroirs) | **S-M** | **P2** (avec N1) |
| **M4** | Cible **TSB événement clé** (12) | documenter / éventuellement aligner sur 0-10 (pic +5 à +20) | `buildEventTargets` | **S** (option) | **P3** |
| **M5** | [`MODELE_ENTRAINEMENT.md`](../MODELE_ENTRAINEMENT.md) | §5.1 + §5.2 + Q15-Q18 | — | **FAIT** ✅ | — |

### G.4 À SUPPRIMER / NE PAS FAIRE
- **Constante morte `TAPER_DAYS = 2`** ([`briefing-algo.ts:90`](../../web/src/lib/briefing-algo.ts)) — déclarée, **jamais utilisée** → la retirer (ou la recâbler dans F4). Effort **S**.
- **Ne jamais citer** les 4 réfs misattribuées par Perplexity (Vollaard / Smoliga / Stellingwerff / « Stöggl 2021 ») — remplacées en §0. *(Rien à supprimer dans le repo : elles n'y sont jamais entrées.)*
- **Pas de multiplicateur environnemental sur la charge** — déjà tranché dans [`heat-altitude.md`](heat-altitude.md) ; on s'y tient (la FC intègre déjà chaleur/altitude).
- **Pas de nouvelle table pour les phases** — F1 **dérive** la phase de `days_to` ; éviter le sur-engineering.

### G.5 Dépendances (graphe)
- **Indépendants, livrables seuls** : **F5** (N4/M2) · **F4** (M1).
- **F2** (N2) : vérifier que `ctx.fitness_model_latest` expose `ctl_aerobic`/`ctl_neuromuscular`/`atl_*` (colonnes déjà en base ⇒ au pire +1 ligne dans `coach-context.ts`, **aucune migration**).
- **F1** (N1) ⟶ **débloque** F3 (N3), N7, et le miroir prompts (M3).
- **F3** (N3) : F1 **+** un champ `block_start_date` (petite migration).
- **N5** (portage) : migration `pack_weight` + terme modèle (gros) ⇒ **différé**.
- **§B.2** : **sourcé** ✅. **N6** (conseil altitude) : prompt-only, sources OK.

### G.6 Priorisation & séquence suggérée
1. **P0 — quick wins, 0 migration, gain sûreté** : **F5** (ACWR nuancé) + **F4** (affûtage exponentiel/intensité maintenue/neuro plus tôt) + nettoyage `TAPER_DAYS`.
2. **P1** : **F2** (garde-fou ramp-rate par canal) — forme close, faible risque.
3. **P2** : **F1** (modèle de phase) + miroir prompts (M3) + N7 (séances par phase).
4. **P3** : **F3** (deload, après F1) · **N6** (conseil altitude) · M4 (TSB cible).
5. **P4 — différé** : **N5** (port de charge, nécessite schéma + modèle).
- **Transverse** : finaliser **§B.2** quand les sources alpi rentrent · garder la liste « do-not-cite » · à chaque PR : **miroirs + tests** + `web`/`coach` `tsc` verts.

### G.7 Décisions tranchées (coach, 2026-06-26)
- **Q18 — Affûtage : objectifs seulement (statu quo).** On n'affûte PAS pour les événements clés ; ils restent planifiés *autour* ([§5.1](../MODELE_ENTRAINEMENT.md)). → `taperState` **inchangé** sur ce point (pas d'extension aux `declared_events`).
- **F5 — orange ACWR : armé uniquement si ACWR >1,3 ET charge absolue en hausse ET TSB pas déjà négatif** (signal orthogonal — anti-doublon avec le TSB, anti-clignotement sur un 1,31 anodin).
- *Restent ouverts (réglage à l'implémentation)* : valeurs `phaseMul`/bornes de phase (F1), `FLOOR`/`DECAY` du taper (F4), `r`/plancher du ramp-rate (F2), migration `block_start_date` (F3).

---

## Partie H — Visualisation athlète (l'utilisateur doit COMPRENDRE)

> Principe : l'athlète doit comprendre **(a) où il en est** (phase), **(b) pourquoi le verdict du jour**
> (par canal), **(c) pourquoi la semaine a cette forme** (phase + affûtage + garde-fou + décharge), **(d)
> que la progression est bornée pour le protéger**. Tout en **langage clair FR** et **conforme au design
> system** : la **phase/période = neutre `stone`** (ce n'est PAS une physiologie) ; aéro = **Alpine**,
> neuro = **Summit** ; readiness = `ready`/`caution`/`rest` ; `tabular-nums` ; bordé, pas d'ombre.

| # | Élément à voir | Surface | Type | Ce que ça fait comprendre | Lié à |
|---|---|---|---|---|---|
| **H1** | **Bandeau de phase** : `Base → Build → Peak → Affûtage` avec la phase courante + « J-90 avant Roubion-Nice » | dashboard `CoachHero` + `/seance` | **NEW** (stone) | « Où j'en suis dans ma saison » | F1/N1 |
| **H2** | **« Pourquoi » enrichi** : nomme la phase + la règle du jour (« Affûtage J-7 : −38 % de volume, on garde une touche d'intensité, pas de descente ») | `briefing-detail.tsx` (Afficher plus) | **MODIFY** | « Pourquoi le coach me dit ça aujourd'hui » | F1/F4 |
| **H3** | **Readiness par canal** : ACWR montré avec sa **bande** (vert 0,8-1,3 / orange >1,3 / rouge >1,5), pas un nombre nu ; **puce « jambes chargées »** (neuro) distincte du cardio | bulle readiness + tuiles | **MODIFY** | « Pourquoi orange alors que mon cardio est frais » | F5 |
| **H4** | **Enveloppe de progression sûre** sur le graphe CTL : un liseré « plafond de montée » par canal ; flag si la semaine planifiée le dépasse | `charts-section.tsx` (Forme) | **NEW** (Alpine/Summit) | « Je monte vite mais sous le plafond / au-dessus » | F2 |
| **H5** | **Semaine de décharge balisée** : libellé discret « décharge » + barres plus basses | bandeau semaine + `/calendrier` | **NEW** (stone) | « Cette semaine est plus légère exprès » | F3 |
| **H6** | **Courbe d'affûtage** (pendant le taper) : volume qui descend vers J + marqueur « intensité maintenue » | carte coach pendant le taper | **NEW** | « La baisse est voulue, et je garde du jus » | F4 |
| **H7** | **Note d'acclimatation altitude** pour un événement clé en altitude (≤500 m/j de sommeil, arriver J-N) | carte contexte si `expected_altitude_m` haut | **NEW** (stone) | « Comment aborder un objectif en altitude » | N6 |
| **H8** | **Indicateur charge du sac** sur les séances montagne *(différé)* | `/seance` | **NEW** | « Le portage compte comme charge » | N5 (P4) |
| **H9** | Lien discret **« Comprendre »** → explication en langage clair (extraits MODELE) | depuis H1/H2 | **NEW** | renforce la pédagogie | transverse |

**Règle d'or comprehension** : chaque chiffre montré (TSB, ACWR, phase, %) doit être accompagné d'**une
phrase en clair** au survol/tap. Pas de jargon nu. La couleur ne porte JAMAIS la catégorie de sport.

**Corrections post-critique (font foi sur §H ; aucun blocker, surtout du rédactionnel) :**
- **H3 : « ambre (caution) », pas « orange ».** Bande ACWR mappée sur les tokens readiness : <0,8 `cool`
  (alpine-400, sous-charge) · 0,8-1,3 `ready` · 1,3-1,5 `caution` (ambre) · >1,5 `rest` (rouge). ⚠️
  « orange » = Summit (neuro) → **ne pas** réutiliser `summit-*` ici. La gauge `acwrZones` de
  `charts-section.tsx` fait **déjà** ce mapping → H3 = y brancher l'ACWR neuro, pas recréer une palette.
- **Figer le micro-copy clair** (la règle d'or l'exige mais ne le rédige pas) ; réutiliser les blocs
  `HelpContent` existants. Ex. ACWR : « Tu montes en charge un peu vite (1,38, au-dessus de la zone
  confort 0,8-1,3). Pas un feu rouge — juste un signal : on garde de la marge. » · ramp-rate : « Tes
  jambes encaissent plus lentement que ton cœur : tu restes sous le plafond qui te protège. »
- **H4 discret/conditionnel** : ne tracer le liseré que sur le canal concerné, fin / faible opacité, et
  n'afficher le flag « au-dessus du plafond » QUE quand le plan le dépasse (sinon masqué) — le graphe
  Forme est déjà chargé (§4 « restraint » du design system). Sinon déporter H4 vers `/analyse`.
- **H6 courbe d'affûtage = `stone`** (planification, pas physiologie) ; marqueur « intensité maintenue »
  neutre + texte, jamais une pastille de readiness.
- **H3 « jambes chargées »** : le CANAL = accent Summit + label « jambes » (pattern `FreshTile`), l'ÉTAT =
  token readiness séparé. Phrase clé : « Cardio frais (Alpine) mais jambes encore chargées (Summit) —
  d'où l'évitement de la grosse descente aujourd'hui. »
- **H1 sous-libellés clairs** (sans jargon) : Base = « Construire le socle » · Build = « Travail
  spécifique » · Peak = « Affiner la forme » · Affûtage = « On allège pour arriver frais » · Transition =
  « Récupération ». Lier H1 → H9.
- **H5** : « **Semaine allégée (volontaire)** » (pas « décharge ») + tooltip « −45 % de volume pour
  assimiler — la forme se consolide, elle ne se perd pas ».
- **Transverse** : nouvelles cartes **bordées, sans ombre** (`shadow-lg` réservé aux popovers) ; tout
  chiffre injecté (J-N, %) en `tabular-nums` ; l'ambre H3 **conditionné à la décision F5** (ambre
  seulement si ACWR >1,3 **ET** charge absolue en hausse — sinon il clignoterait sur un 1,31 anodin).

---

## Partie I — Dry-runs (comportement du coach sous F1-F5, AVANT implémentation)

> Valeurs **illustratives** (l'athlète n'a pas de CTL live ici). Baselines perso : easy ≈ 59, seuil
> ≈ 68 pts. Objectif primaire = 100K le 24/09/2026 (J-90 au 26/06). Affûtage : `win=14`,
> `factor = 0.45 + 0.55·e^(−2.3·(win−daysTo)/win)`. Ramp-rate : `ΔCTL₇ ≈ 0,1535·(L̄ − CTL₀)`.

### I.1 — F5 ACWR nuancé *(le verdict change)*
Entrées : TSB +2 · tsb_neuro −3 · **ACWR 1,38** · readiness Garmin 70.
- **Aujourd'hui (ancien)** : 1,38 < 1,5, tsb_neuro −3 > −4, readiness 70 > 60 → **🟢 vert** → feu vert pour du dur.
- **Avec F5** : 1,38 > 1,3 → **🟠 orange** + flag « charge aiguë 1,38, zone de vigilance — on reste prudent ».
- **Révèle** : F5 rattrape une montée que l'ancien ratait. ⚠️ *À valider : orange dès 1,3 est-il trop sensible ? (ACWR contesté — peut-être n'armer l'orange que si 1,3 ET charge absolue en hausse).*

### I.2 — F4 affûtage exponentiel vs linéaire (jour « easy », ×59)
| | J-14 | J-10 | J-7 | J-3 | J-1 |
|---|---|---|---|---|---|
| **factor exp (new)** | 1,00 | 0,74 | 0,62 | 0,54 | 0,52 |
| easy (new) | 59 | **43** | **37** | **32** | 30 |
| factor lin (old) | 1,00 | 0,86 | 0,75 | 0,61 | 0,54 |
| easy (old) | 59 | 51 | 44 | 36 | 32 |
| **hardCap** | new 1 / old 1 | 1 / 1 | 1 / 1 | **1 / 0** | **1 / 0** |
- **Révèle** : le volume baisse **plus tôt** (J-10 : 43 vs 51) puis tient bas ; et on **garde 1 rappel court d'intensité** jusqu'à J-3 (au lieu de 0). Le **neuro est coupé dès J-14** (descente/force → easy/recovery). ⚠️ *À valider : garder un hard_aerobic court à J-3 est-il OK (oui en théorie taper) ? FLOOR / DECAY à régler.*
- ⚠️ *Post-critique : ce tableau utilise l'ancien plafond de taper 1,0. La version corrigée (§F-bis) ancre le taper sur le peak (**0,85 → ~0,535** via `0,5+0,35·e^(−2,3·daysIn/14)`) → chiffres à recalculer, mais la **forme/comportement sont identiques** (baisse front-loaded, intensité gardée, pas de saut peak→taper).*

### I.3 — F2 garde-fou ramp-rate (contexte montagne = surtout neuro)
Reprise après coupure : **CTL_neuro = 8**. Semaine avec une **sortie alpi ancrée** (neuro ≈ 180) + 2 séances de côtes (neuro 37 chacune).
- Alpi **seule** : L̄_neuro = 180/7 = 25,7 → ΔCTL_neuro ≈ 0,1535·(25,7−8) = **+2,7/sem** (sous le cap +3) ✓.
- **+ les 2 côtes** : L̄_neuro ≈ 36 → ΔCTL_neuro ≈ **+4,3/sem** (> cap +3) → F2 **rétrograde les 2 côtes → easy** et **flag**. Même après coupe, l'alpi ancrée domine → reste **≈ +3,2** (légèrement au-dessus de +3) → flag « charge structurelle au-dessus de la cible, mais c'est ta sortie alpi qui pèse — assume-la, récupère après ». *(chiffres recalés post-critique arithmétique.)*
- **Révèle** : F2 est surtout un **garde-fou NEURO** en montagne. ⚠️ *Edge case majeur : un événement ancré seul peut dépasser le cap — F2 ne peut PAS le défaire → doit **dégrader en simple flag**, jamais bloquer/réécrire l'événement.*

### I.4 — F1 transition base→build *(douceur)*
- **J-90 (base)** : hardCap 2, mul 1,0, emphase volume facile + côtes légères.
- **J-83 (build)** : hardCap 2, mul 1,0, emphase **seuil + descente + sortie longue**.
- **J-20 (peak)** : mul **0,85** → charges ×0,85.
- **Révèle** : au passage base→build, le volume ne saute pas (mul identique) ; seule l'**emphase** des séances change (N7). Bon = pas de marche d'escalier. La vraie bascule de volume arrive en peak/taper.

### I.5 — F3 semaine de décharge (3:1)
Semaine 4 d'un bloc build : `mul ×0,55`, `hardCap 2→1`. easy 59 → **32**, 2 jours durs → **1**.
- **Révèle** : semaine nettement plus légère, balisée « décharge » (H5). ⚠️ *Dépendance : F3 a besoin de l'index de semaine dans le bloc → F1 + `block_start_date`. Sans ça, le coach ne « sait » pas que c'est la semaine 4.*

### I.6 — N6 conseil altitude (événement clé en altitude)
Événement clé déclaré à **3200 m** dans 8 sem (`expected_altitude_m=3200`).
- Le coach (prompt rule 8 + contexte) ajoute : « Objectif à 3200 m : prévois **5-7 j d'acclimatation**, ne monte pas ton **altitude de sommeil** de plus de **500 m/j** au-dessus de 3000 m, **repos tous les 3-4 j** ; grimper haut/dormir bas aide. »
- **Révèle** : pur **contexte/prompt** (aucun changement d'algo), surfacé en carte (H7).

### I.7 — Synthèse des points à trancher (sortis des dry-runs)
1. **F5** ✅ **tranché** : orange seulement si ACWR >1,3 **ET** charge absolue en hausse **ET** TSB pas déjà négatif.
2. **F4** : régler `FLOOR`/`DECAY` ; confirmer « 1 rappel court jusqu'à J-3 ».
3. **F2** : **dégradation gracieuse obligatoire** quand un événement ancré dépasse le cap (flag, jamais bloquer).
4. **F3** : nécessite `block_start_date` (gate) — sinon inopérant.
5. **F1** : valeurs `phaseMul` (peak 0,85 ?) et bornes de phases (84/28/14 j) à valider.

---

## Partie J — Multi-objectifs, profils de discipline & suggestion multi-sport

> Confirme l'intuition : **l'affichage ET les suggestions varient selon le SPORT de l'objectif, la PHASE,
> et le nombre d'objectifs**. Aujourd'hui Massif est presque sport-agnostique (plan par *système*, sport =
> favori). Cette partie définit la couche manquante. Tout reste **piloté par `goals[]` rangés** (déjà en
> contexte) — pas de nouvelle table sauf mention.

### J.1 — Profils de discipline (registre `disciplineProfile(sport)`)
La brique centrale : chaque sport-objectif porte un profil qui dit **quels canaux comptent**, **quoi
afficher**, **quelles séances clés**, **quel cross-training est supportif**, **quelle emphase par phase**.

| Discipline (sport objectif) | Canaux dominants | Métriques en avant | Séances clés (§C) | Cross-training supportif | Emphase par phase |
|---|---|---|---|---|---|
| **Trail / ultra montagne** | aéro + **neuro-jambes** (descente/impact) | CTL/ATL/TSB 2 canaux · familiarité descente · ACWR · D+/D− | sortie longue D+/D−, côtes force-endurance, **répétitions descente**, seuil | **renfo** (force→ME), **vélo** (volume sans impact) | base : volume + côtes légères · build : descente + seuil + long · peak/taper : spécifique, **descente coupée J-14** |
| **Course route** | aéro + neuro-jambes (impact modéré) | CTL/ATL/TSB · ACWR · allure/seuil | seuil/tempo, VO2, long, côtes | renfo léger, vélo | linéaire base→build→peak |
| **Cyclisme** | **aéro** (neuro faible) | CTL aéro · puissance/FTP · TSB | FTP/sweet-spot, VO2, longue | renfo jambes, gainage | Friel base/build/specialty |
| **Alpinisme / rando / ski-rando** | aéro (LSD) + **neuro-jambes** (portage, descente) + **altitude** | CTL aéro · TSB neuro · **portage** · **acclimatation altitude** · D+ | LSD, **ME (endurance de force)**, marche chargée, vert, simulation | **renfo (ME)**, vélo, portage progressif | base aérobie longue · build ME + portage + spécificité · **pic doux** J-7-14 |
| **Escalade** (bloc/voie/falaise/grande voie) | **neuro-doigts/haut** + aéro faible (sauf grande voie) | **charge doigts/structurelle** · readiness neuro-haut · **prudence poulies** | force doigts (hangboard), puissance, résistance/power-endurance, volume | gainage/antagonistes, (endurance si grande voie) | base volume technique · force max → puissance → résistance · peak projets |

### J.2 — Nuance « tissus » du canal neuro (planning seulement — invariant préservé)
Le canal neuro reste **UN seul canal de CHARGE** (on ne touche pas à l'invariant 2-canaux). Mais pour le
**placement** des séances, on distingue deux **pools de fatigue tissulaire** : **neuro-jambes** (descente,
impact, portage, force basse) vs **neuro-haut/doigts** (escalade, tractions). C'est un simple **tag de
tissu** sur la séance (hint de scheduling), **pas** une 3ᵉ charge. Règle : ne pas empiler deux séances
lourdes du **même tissu** à < 48-72 h ; mais une séance doigts + une sortie jambes facile coexistent.

### J.3 — Q1 · Établissement des phases en multi-objectifs
- **Une seule horloge de macro-phase, ancrée sur l'objectif PRIMAIRE** (rang 1, daté, kind `race`/`performance`) — c'est lui qui définit base/build/peak/taper (F1).
- **Chaque objectif porte en plus une « fenêtre d'emphase spécifique »** qui monte à l'approche de SA date (le sport de cet objectif reçoit plus de séances clés dans les semaines avant lui).
- **Gestion d'un objectif secondaire selon sa relation au primaire :**
  - *même sport* → se fond dans la progression du primaire ;
  - *sport différent, plus TÔT* → mini-fenêtre d'emphase + **affûtage court** (≤1 sem, déjà `taperState` fenêtre 7 j), **borné** pour ne pas casser le bloc du primaire ;
  - *sport différent, plus TARD* → **dormant** jusqu'à ce que le primaire passe, puis l'horloge **se ré-ancre** sur l'objectif suivant (transition → nouvelle base) ;
  - *horizon flou / sans date* → **fil de maintien** (dose basse permanente), pas d'horloge de phase.
- **Garde-fou d'interférence (P5)** : quand la qualité d'un sport secondaire entrerait en conflit avec un **bloc clé du primaire**, le secondaire est tenu en **maintien** (≤1×/sem), jamais en développement.

### J.4 — Q2 · Adapter l'affichage selon le(s) sport(s) d'objectif × la phase
Méthode : **`dashboardComposition(goals[], phase)`** compose l'écran par **rang** ×  profil de discipline ×  phase.
- Le **profil du sport primaire** prend la place de choix : ses métriques (J.1) en grand, son vocabulaire dans le « pourquoi » (trail parle *descente/D−* ; escalade *doigts/poulies* ; alpi *portage/altitude*).
- Les **objectifs secondaires** apparaissent en **widgets compacts** (ex. une puce « doigts/structurel » + fil charge-doigts si un objectif escalade coexiste).
- Les sports **non-objectifs** restent **génériques** (juste dans l'historique d'activités).
- **La phase module quoi montrer** : base → métriques de construction (« construire le socle », volume) ; build → spécifique + familiarité descente ; peak/taper → **courbe d'affûtage** + cible de fraîcheur (H6) ; transition → récup. La bande de phase H1 nomme la phase du primaire + sous-fils par sport si multi.
- **Règle** : l'écran est **pondéré par les rangs** — jamais tout afficher ; le primaire domine, le reste est secondaire/compact.

### J.5 — Q3 · Suggérer les séances jour/semaine avec plusieurs sports-objectifs
- La semaine a un **budget de jours de qualité** (`hardCap`, ajusté par la phase). On **alloue** ces jours aux sports par **rang ×  phase ×  proximité de chaque date** :
  - le **sport primaire** prend la **sortie longue/spécifique** + ≥1 qualité ;
  - le(s) **secondaire(s)** : **maintien** (1 qualité /1-2 sem) sauf dans leur fenêtre d'emphase ;
- Le **système** de chaque jour dur alterne toujours (pas 2 mêmes systèmes d'affilée, `altHard`), et le **sport** est choisi pour servir l'objectif (trail `hard_aerobic` = séance seuil en course ; escalade `hard_neuromuscular` = séance doigts).
- Les jours **faciles/récup** prennent le sport le plus **commode/à faible impact** (ex. Z2 à **vélo** pour épargner les jambes — volume aéro sans impact, P5).
- **Placement** : règles de système (existant) **+ règle de tissu J.2** (48-72 h entre deux tissus identiques lourds) **+** le plus technique/frais en premier dans la semaine.

### J.6 — Q4 · Proposer un AUTRE sport que celui de l'objectif (renfo, escalade, vélo…)
**Oui** — c'est le **cross-training supportif** (P5). Arbre de décision pour un jour généré, étant donné
(phase, système cible, readiness par canal/tissu, proximité des objectifs, contraintes) :
1. **Slot endurance spécifique** → sport de l'objectif (ou **substitut aéro à faible impact = vélo** si les **jambes** (neuro-jambes) sont chargées).
2. **Slot force/structurel** → **renfo** : **supportif pour quasi tous les objectifs montagne** (force max en base/build → ME ensuite ; **coupé 10-14 j avant l'objectif**, P5). Format : 2-3×/sem en développement, 1×/sem en maintien.
3. **Escalade comme cross-training** : seulement si c'est aussi un objectif **ou** explicitement voulu — elle **ajoute** de la charge neuro-doigts, ce n'est **pas** une récup.
4. **Contrainte tissu** : ne jamais empiler 2 stimuli lourds du **même tissu** < 48-72 h (descente + doigts ok car tissus différents ; descente + renfo jambes lourd = non).
5. **Readiness** : si TSB **neuro-jambes** bas → le cross-training du jour est **aéro faible impact** (vélo) ou technique, **pas** plus de neuro (renfo lourd/escalade).
6. **Format** : tiré de la **bibliothèque §C** filtrée par (sport choisi ×  système ×  phase).
- **Invariant** : le sport de l'objectif garde toujours la **séance spécifique + la longue** ; le cross-training **sert** l'objectif, ne le remplace pas.

### J.7 — Implications code (esquisse, non chiffrée)
- **NEW** `disciplineProfile(sport)` (registre J.1) + **`dashboardComposition(goals[], phase)`** (J.4).
- `buildWeekPlan` devient **sport-aware** : aujourd'hui `fav = favourite_sports[0]` (briefing-algo.ts:219) → remplacer par une **allocation par objectif** (J.5) ; ajouter le **tag de tissu** (J.2) à la règle de spacing.
- Prompts chat/ask : injecter le **profil de discipline** + l'allocation multi-sport (miroir).
- Affichage : composition par rang (J.4) — gros chantier UI, à phaser après le moteur.

### J.8 — Questions ouvertes (décisions coach)
- Quand 2 objectifs de **sports différents** sont **proches** (même mois), partage-t-on la semaine 60/40 selon le rang, ou bloc-par-bloc (une semaine trail / une semaine escalade) ?
- Le **renfo** est-il prescrit **par défaut** pour tout objectif montagne, ou seulement si l'athlète l'active ?
- Granularité du **tag de tissu** (juste jambes/haut, ou plus fin : quadris vs tendons vs avant-bras) ?

---

## Partie J-bis — Corrections issues de la critique adversariale (FONT FOI sur §J)

> Critique (2 agents : cohérence design/code + solidité coaching). Verdict : **vision cohérente, moteur
> sous-spécifié** (J garde le squelette mono-sport / mono-`loadMul` / mono-`hardCap`). **3 blockers + des
> recalibrages d'assertivité.** Ordonnancement : **J est une couche P2+/P3, à implémenter APRÈS F1+F4**,
> et certaines briques sont à DIFFÉRER (données de fatigue par tissu).

**BLOCKER 1 — taper multi-objectif (filtre + portée).** `taperState` scanne aujourd'hui TOUS les goals,
sans filtre rang/kind/sport, et retient le plus proche → un secondaire proche (sport différent) imposerait
son affûtage à TOUTE la semaine, primaire compris (l'inverse de J.3). Corriger : (a) **horloge de phase
filtrée `kind ∈ {race, performance}`**, ancrée sur le **primaire effectif** ; (b) le mini-affûtage d'un
secondaire ne touche **QUE les jours alloués à son sport**, pas le `loadMul` global → exige un **`loadMul`
par jour/par-sport**. **Dépend de J.8-Q1.**

**BLOCKER 2 — semaine constructible (budget par sport).** `hardCap` est un entier global (2) ; le primaire
(longue + 1 qualité) le sature → 0 slot pour le maintien du secondaire ; et les **ancres `declared_events`
dures consomment des slots** sans que J.5 les compte. Corriger : **budget de qualité PAR SPORT** (les ancres
décrémentent le budget de leur sport) + **tag/séance « longue » distinct** (sinon « le sport de l'objectif
garde sa longue » n'a aucun support — aujourd'hui la longue tombe en easy/hard_aerobic).

**BLOCKER 3 — briques de données absentes (→ DIFFÉRER J.6 pt1/pt5).** Pas de mapping **système→sport**
(`buildWeekPlan` ne connaît que `fav`, écrit `sport_code: fav`) ; le contexte n'expose que
`tsb_neuromuscular` **global** (pas neuro-jambes vs neuro-haut). Donc « jambes chargées → vélo » est
**inapplicable**. Corriger : définir `systemToSport(profil, système, phase)` + **dériver une fatigue par
tissu** (depuis les sports des activités récentes) — sinon **marquer J.6 pt1/pt5 « différé »**, comme N5.

**MAJEUR — spacing au grain TISSU.** `altHard`/`systemFamily` voient `hard_neuromuscular` et
`hard_structural` comme un seul « neuro » → une qualité jambes (descente) et une qualité doigts (escalade)
seraient interdites la même semaine, alors que J.2 veut les **autoriser** (tissus différents). Corriger :
**le spacing du canal neuro passe du grain système au grain tissu** (2 qualités neuro de tissus différents
non bloquées ; même tissu → 48-72 h). Sinon **primaire trail + secondaire escalade = non-constructible**.

**MAJEUR — ré-ancrage de l'horloge.** `primary_goal = goals[0]` est figé sur le rang → quand le rang-1 est
passé, le système reste en transition 0,6 indéfiniment. Corriger : **« primaire effectif » = premier
objectif actif `kind ∈ {race, performance}` avec `days_to ≥ 0 »** → ré-ancrage automatique.

**MAJEUR — réconcilier renfo-coupé-J-14 (J.6.2) avec F4.** UNE seule règle : en taper, couper le
**neuro/structurel GÉNÉRAL** (renfo, force lourde) **en gardant** la touche spécifique de l'objectif
(descente courte pour un trail de descente). Ne pas coder deux fois.

**MAJEUR (coaching) — désamorcer la sur-vente du renfo.** Désagréger + graduer : (i) **retrait
excentrique/lourd J-10→J-14** = bien étayé (neuro) → ferme ; (ii) **renfo supportif** = ⚪ House/Johnston,
**recommandation par défaut activable** (J.8), PAS un transfert universel (B.4 : interférence « réelle mais
atténuable », maximale à haut volume aéro) ; (iii) le « 10-14 j » concerne l'**excentrique**, pas la force
max (détraining lent >2-3 sem) → « réduire le **volume** de force lourde en peak ».

**MAJEUR (coaching) — vélo Z2 ≠ gratuit.** Il épargne l'**impact/excentrique** (neuro-jambes), **pas** la
charge aérobie ni la **fatigue centrale** ; en bloc de force, gonfler le vélo **potentialise
l'interférence** (B.4). → substitut vélo réservé aux jours **EASY** (pas récup) ; jour récup = vélo Z1-bas borné.

**MINEUR.** • J.4 : **fallback** « pas d'objectif daté → composition générique/maintien ». • J.5 : lire
`anchors[].sport` + `days_to` pour l'emphase des jours libres (ancre trail samedi → longue trail mercredi).
• Garde-fou d'interférence J.3 **dépend de F1**. • **Fatigue centrale partagée** : pas deux séances
**maximales** le même jour, même tissus différents. • J.2 = heuristique de scheduling **périphérique** (⚪),
pas un modèle de récup ; « jambes » mêle muscle (récup jours) et tendon (récup semaines) → pas de grosse
arquée tôt en reprise (piège tendineux B.3). • Escalade : **intense** = jour dur neuro-doigts ; **volume
technique facile** = jour léger/technique, jamais récup neuro complète. • Cyclisme « neuro faible **sauf
gros D+/force-cadence-basse** » (le moteur de charge tranche).

**TROU DE COUVERTURE — profil « objectif de capacité » (volume/skill non daté).** J.1 n'a pas de profil
pour un objectif réel **sans date et sans canal de perf dominant** (ski freeride technique, projet escalade
sans date, gros volume de saison). « Horizon flou → fil de maintien » est l'**inverse** (un objectif de
développement doit **construire**). Ajouter un cas **« objectif de capacité »** : horloge par **paliers de
volume/compétence** (+5-10 %/sem, deload 3:1). **« Sans date » ≠ « maintien ».**

**Invariant 2-canaux** : ✅ non cassé — le tag de tissu reste un **hint de scheduling** sur
`WeekDay`/`DetailedSession`, jamais une colonne de charge.

### J.9 — Décisions tranchées (coach, 2026-06-26)
1. **Multi-objectifs proches = CHOIX DE L'ATHLÈTE** (réglage `multi_objective_strategy`, par athlète ou
   par paire). On développe **3 modes sélectionnables** : **(a) primaire absolu** (secondaire en
   maintien) · **(b) bloc-par-bloc** (alternance de semaines à dominante) · **(c) partage 60/40 par
   rang**. **Défaut = (a)**. → l'allocateur J.5 doit gérer les 3 modes + un réglage (nouveau champ
   `coach_settings`). *(Tranche le blocker 1 / J.8-Q1 : pas un choix figé, un réglage.)*
2. **Renfo = par défaut, désactivable.** Prescrit (force → ME) en base/build, **excentrique/lourd coupé
   J-10→J-14**, sauf si l'athlète le désactive. Présenté comme **recommandation** (⚪), pas un fait de
   transfert. → réglage on/off.
3. **Tag de tissu = simple (jambes / haut-doigts)** + **garde-fou anti-arquée précoce** (pas de grosse
   séance doigts arquée en reprise — piège tendineux B.3). Le grain fin muscle/tendon = évolution future.
4. **Profil « objectif de capacité » (sans date) = CONSTRUIT.** Horloge par **paliers de
   volume/compétence** (+5-10 %/sem, deload 3:1), distinct du fil de maintien. À ajouter au registre J.1
   + J.3 (« sans date » ≠ « maintien »).

> Restent ouverts (réglage d'implémentation) : valeurs des profils J.1, seuils de fatigue par tissu
> (quand la donnée existera), pondération exacte du mode 60/40.

---

## Références (vérifiées — citer cette liste, pas la sortie brute Perplexity)

**Périodisation & distribution d'intensité**
- Issurin VB. 2016. *Benefits and Limitations of Block Periodized Training Approaches: A Review.* Sports Med 46(3):329-338. PMID 26573916. 🟠
- Issurin VB. 2019. *Biological Background of Block Periodized Endurance Training: A Review.* Sports Med 49(1):31-39. PMID 30411234. 🟠
- Mølmen KS, Øfsteng SJ, Rønnestad BR. 2019. *Block periodization of endurance training – a systematic review and meta-analysis.* Open Access J Sports Med 10:145-160. PMID 31802956. 🟢
- Bradbury DG, Landers GJ, Benjanuvatra N, Goods PSR. 2020. *Comparison of Linear and Reverse Linear Periodized Programs… Endurance Running.* J Strength Cond Res 34(5):1345-1353. PMID 30161090. 🔵 (ECR)
- Stöggl TL, Sperlich B. 2015. *The training intensity distribution among well-trained and elite endurance athletes.* Front Physiol 6:295. PMID 26578968. 🟠 (+ ECR compagnon 2014, Front Physiol 5:33, PMID 24550842, 🔵)
- Seiler S. 2010. *What is best practice for training intensity and duration distribution in endurance athletes?* Int J Sports Physiol Perform 5(3):276-291. PMID 20861519. 🟠

**Affûtage (taper)**
- Bosquet L, Montpetit J, Arvisais D, Mujika I. 2007. *Effects of tapering on performance: a meta-analysis.* Med Sci Sports Exerc 39(8):1358-65. PMID 17762369. 🟢
- Wang Z, Wang Y, Gao W, Zhong Y. 2023. *Effects of tapering on performance in endurance athletes: a systematic review and meta-analysis.* PLOS ONE 18(5):e0282838. PMID 37155628. 🟢
- Mujika I, Padilla S. 2003. *Scientific bases for precompetition tapering strategies.* Med Sci Sports Exerc 35(7):1182-7. PMID 12840640. 🟠

**Modélisation de la charge / ACWR**
- Hellard P, Avalos M, Lacoste L, Barale F, Chatard JC, Millet GP. 2006. *Assessing the limitations of the Banister model in monitoring training.* J Sports Sci 24(5):509-20. PMID 16608765. 🟡
- Piatrikova E, et al. 2021. *Monitoring the HRV Responses to Training Loads… Banister Impulse-Response Model.* Int J Sports Physiol Perform 16(6):787-795. DOI 10.1123/ijspp.2020-0201. 🟡
- Gabbett TJ. 2016. *The training-injury prevention paradox…* Br J Sports Med 50(5):273-280. PMID 26758673. 🟠
- Impellizzeri FM, Tenan MS, Kempton T, Novak A, Coutts AJ. 2020. *Acute:Chronic Workload Ratio: Conceptual Issues and Fundamental Pitfalls.* Int J Sports Physiol Perform 15(6):907-913. DOI 10.1123/ijspp.2019-0864. 🟠
- Lolli L, et al. 2019. *Mathematical coupling causes spurious correlation within the conventional ACWR calculations.* Br J Sports Med 53(15):921-922. PMID 29101104. 🟠

**Descente / excentrique (canal neuro)**
- Marqueste T, Giannesini B, Le Fur Y, Cozzone PJ, Bendahan D. 2008. *Comparative MRI analysis of T2 changes… single and repeated bouts of downhill running.* J Appl Physiol 105(1):299-307. PMID 18467547. 🔵
- Eston RG, Finney S, Baker S, Baltzopoulos V. 1996. *Muscle tenderness and peak torque changes after downhill running following a prior bout of isokinetic eccentric exercise.* J Sports Sci 14(4):291-9. PMID 8887208. 🔵
- Smith LL, et al. 2007. *Changes in serum cytokines after repeated bouts of downhill running.* Appl Physiol Nutr Metab 32(2):233-240. PMID 17486164. 🔵
- Bontemps B, Vercruyssen F, Gruet M, Louis J. 2020. *Downhill Running: What Are The Effects and How Can We Adapt? A Narrative Review.* Sports Med 50(12):2083-2110. PMID 33037592. 🟠
- Martínez-Navarro I, et al. 2026. *Downhill Running-Induced Muscle Damage in Trail Runners…* Sports (Basel) 14(1):12. PMID 41590954. 🔵

**Escalade — tissus, poulies, force des doigts**
- Mersmann F, Bohm S, Arampatzis A. 2017. *Imbalances in the Development of Muscle and Tendon as Risk Factor for Tendinopathies…* Front Physiol 8:987. PMID 29249987. 🟠
- Bohm S, Mersmann F, Arampatzis A. 2015. *Human tendon adaptation in response to mechanical loading: systematic review and meta-analysis.* Sports Med Open 1(1):7. PMID 27747846. 🟢
- Magnusson SP, Kjaer M. 2019. *The impact of loading, unloading, ageing and injury on the human tendon.* J Physiol 597(5):1283-1298. PMID 29920664. 🟠
- Kjaer M, et al. 2009. *From mechanical loading to collagen synthesis, structural changes and function in human tendon.* Scand J Med Sci Sports 19(4):500-510. PMID 19706001. 🟠
- Shaw G, Lee-Barthel A, Ross MLR, Wang B, Baar K. 2017. *Vitamin C-enriched gelatin supplementation before intermittent activity augments collagen synthesis.* Am J Clin Nutr 105(1):136-143. PMID 27852613. 🔵 (ECR)
- Schöffl V, Hochholzer T, Winkelmann HP, Strecker W. 2003. *Pulley injuries in rock climbers.* Wilderness Environ Med 14(2):94-100. 🟠
- Miro PH, vanSonnenberg E, Sabb DM, Schöffl V. 2021. *Finger Flexor Pulley Injuries in Rock Climbers.* Wilderness Environ Med 32(2):247-258. 🟠
- Schweizer A. 2001. *Biomechanical properties of the crimp grip position in rock climbers.* J Biomech 34(2):217-223. PMID 11165286. 🔵
- Vigouroux L, Quaine F, Labarre-Vila A, Moutet F. 2006. *Estimation of finger muscle tendon tensions and pulley forces during specific sport-climbing grip techniques.* J Biomech 39(14):2583-2592. PMID 16225880. 🔵
- Lin GT, Cooney WP, Amadio PC, An KN. 1990. *Mechanical properties of human pulleys.* J Hand Surg Br 15(4):429-434. 🔵
- López-Rivera E, González-Badillo JJ. 2019. *Comparison of the Effects of Three Hangboard Strength and Endurance Training Programs on Grip Endurance in Sport Climbers.* J Hum Kinet 66:183-195. PMID 30988852. 🔵
- Stien N, Riiser A, Shaw MP, Saeterbakken AH, Andersen V. 2023. *Effects of climbing- and resistance-training on climbing-specific performance: a systematic review and meta-analysis.* Biol Sport 40(1):179-191. PMID 36636194. 🟢
- Saul D, Steinmetz G, Lehmann W, Schilling AF. 2019. *Determinants for success in climbing: A systematic review.* J Exerc Sci Fit 17(3):91-100. PMID 31193395. 🟢
- Buraas BF, Brobakken MF, Wang E. 2025. *Climbing performance in males: the importance of climbing-specific finger strength.* Eur J Appl Physiol. PMCID PMC12479556. 🟡
- Mermier CM, Janot JM, Parker DL, Swan JG. 2000. *Physiological and anthropometric determinants of sport climbing performance.* Br J Sports Med 34(5):359-365. PMID 11049146. 🟡 (contre-point : technique/expérience dominent)
- Quarmby A, et al. 2023. *Risk factors and injury prevention strategies for overuse injuries in adult climbers: a systematic review.* Front Sports Act Living 5:1269870. PMID 38162697. 🟢
- Gilmore NK, Klimek P, Abrahamsson E, Baar K. 2024. *Effects of Different Loading Programs on Finger Strength in Rock Climbers.* Sports Med Open 10(1):125. PMID 39560837. 🟡

**Altitude, hypoxie & port de charge (alpinisme)**
- Luks AM, Beidleman BA, Freer L, et al. 2024. *Wilderness Medical Society Clinical Practice Guidelines for the Prevention, Diagnosis, and Treatment of Acute Altitude Illness: 2024 Update.* Wilderness Environ Med 35(1_suppl):2S-19S. DOI 10.1016/j.wem.2023.05.013. 🟠 (guideline clinique — vitesse d'ascension : ≤500 m/j de sommeil >3000 m, repos /3-4 j)
- Bärtsch P, Saltin B. 2008. *General introduction to altitude adaptation and mountain sickness.* Scand J Med Sci Sports 18(Suppl 1):1-10. DOI 10.1111/j.1600-0838.2008.00827.x. 🟠
- Fulco CS, Beidleman BA, Muza SR. 2013. *Effectiveness of preacclimatization strategies for high-altitude exposure.* Exerc Sport Sci Rev 41(1):55-63. PMID 22653279. 🟠
- Levine BD, Stray-Gundersen J. 1997. *"Living high-training low"…* J Appl Physiol 83(1):102-12. PMID 9216951. 🔵 (ECR fondateur LHTL)
- Chapman RF, Stray-Gundersen J, Levine BD. 1998. *Individual variation in response to altitude training.* J Appl Physiol 85(4):1448-56. PMID 9760340. 🔵 (répondeurs/non-répondeurs)
- Chapman RF, et al. 2014. *Defining the 'dose' of altitude training…* J Appl Physiol 116(6):595-603. PMID 24157530. 🔵 (live ~2000-2500 m optimal)
- Bonetti DL, Hopkins WG. 2009. *Sea-level exercise performance following adaptation to hypoxia: a meta-analysis.* Sports Med 39(2):107-27. PMID 19203133. 🟢
- Millet GP, et al. 2010. *Combining hypoxic methods for peak performance.* Sports Med 40(1):1-25. PMID 20020784. 🟠
- Knapik JJ, Reynolds KL, Harman E. 2004. *Soldier load carriage: historical, physiological, biomechanical, and medical aspects.* Mil Med 169(1):45-56. PMID 14964502. 🟠
- Orr RM, Pope R, Johnston V, Coyle J. 2014. *Soldier occupational load carriage: a narrative review of associated injuries.* Int J Inj Control Saf Promot 21(4):388-396. PMID 24028439. 🟠
- Looney DP, et al. 2022. *Modeling the Metabolic Costs of Heavy Military Backpacking.* Med Sci Sports Exerc 54(4):646-654. PMID 34772899. 🔵 (coût ≈ charge^1,36)
- Walsh GS, Low DC. 2021. *Military load carriage effects on the gait of military personnel: a systematic review.* Appl Ergon 93:103376. PMID 33540208. 🟢
- Legg SJ, Ramsey T, Knowles DJ. 1992. *The metabolic cost of backpack and shoulder load carriage.* Ergonomics 35(9):1063-1068. PMID 1505506. 🔵
- Faghy MA, et al. 2022. *Physiological impact of load carriage exercise…* Physiol Rep 10(21):e15502. PMID 36324291. 🟠

**Coaching (livres, ⚪)**
- Koop J, Rutberg J. *Training Essentials for Ultrarunning.* VeloPress, 2016 (2e éd. 2021, +Malcolm C).
- House S, Johnston S. *Training for the New Alpinism.* Patagonia Books, 2014.
- House S, Johnston S, Jornet K. *Training for the Uphill Athlete.* Patagonia Books, 2019.

---
*Ce document est une base de décision. Aucune valeur n'est appliquée tant qu'un coach ne l'a pas validée
— l'objectif est de remplacer nos points de départ par des valeurs confirmées sur le terrain.*
