# Massif sur ton téléphone — passage en prod

> ⚠️ **OBSOLÈTE en partie (cron + web push retirés).** Le briefing n'est plus généré par un cron et il
> n'y a plus de notification matinale : il se génère **à la demande** dans l'app (modes *gratuit*
> algorithmique / *IA* — voir CLAUDE.md « ON-DEMAND TWO-MODE BRIEFING »). Ce qui reste **valable** ici :
> l'installation PWA, le gate mot de passe, et le rafraîchissement **Garmin à la demande**
> (`garmin-refresh.yml`, déclenché par `GarminAutoRefresh` à l'ouverture). À **ignorer** : les étapes
> Web Push / VAPID / `push_subscriptions` / `nightly.yml` / notifications. Les secrets `VAPID_*` (Vercel +
> Actions) et `ANTHROPIC_API_KEY`/`COACH_MODEL` (Actions) sont inutiles ; Vercel garde `ANTHROPIC_API_KEY`
> + `COACH_MODEL` pour le mode IA et le chat.

Objectif : l'app sur l'écran d'accueil de l'iPhone + l'automatisation qui tourne **sans ton Mac**.

Architecture :

```
iPhone (PWA écran d'accueil)
   ▲ web push                 ▲ ouvre l'URL (login)
Vercel  massif.vercel.app  ── web/ déployé · gate mot de passe · service worker · /api/push
   ▲ lit / écrit
Supabase cloud  ── + table push_subscriptions · token Garmin (integration_tokens)
   ▲ pull + rollup + coach + push
GitHub Actions (cron)  ── remplace nightly.sh/morning.sh · Garmin via token stocké (pas de MFA)
```

Le code est déjà en place (ce commit). Ci-dessous **uniquement ce que tu dois faire toi**.
Coche dans l'ordre.

---

## 0. Générer les secrets (sur le Mac, 2 min)

```bash
# Clés Web Push (VAPID). Note les deux lignes affichées.
npx web-push generate-vapid-keys

# Secret pour signer le cookie de session (copie la sortie) :
openssl rand -base64 32
```

Choisis aussi un **mot de passe** d'accès à l'app (ce sera `APP_PASSWORD`).

Tu as maintenant : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `AUTH_SECRET`, `APP_PASSWORD`.

---

## 1. Appliquer la migration DB (Mac → Supabase cloud, 1 min)

Ajoute la table `push_subscriptions` + la colonne token Garmin.

```bash
cd /Users/b/dev/perso/massif
supabase db push          # applique supabase/migrations/20260622000006_push_and_garmin_token.sql
```

> Rappel projet : piloter la DB Massif avec le **CLI Supabase**, jamais le MCP.

---

## 2. Seeder le token Garmin vers le cloud (Mac, 1 min)

Le login MFA Garmin est fait UNE fois sur ton Mac (le token est déjà en cache dans
`~/.garminconnect`). On le copie dans Supabase pour que le cron cloud le réutilise sans MFA :

```bash
ingest/.venv/bin/python -m massif_ingest.sync --export-garmin-token
# → "garmin token: exported to Supabase"
```

(À refaire seulement si un jour Garmin invalide le token : refais un login local puis ré-exporte.
Chaque sync nocturne local le ré-exporte aussi, donc le cloud reste à jour tant que le Mac tourne.)

---

## 3. Mettre à jour le lockfile coach + pousser sur GitHub

J'ai ajouté la dépendance `web-push` au coach. Mets à jour son lockfile, puis pousse le repo :

```bash
pnpm -C coach install            # met à jour coach/pnpm-lock.yaml
git add -A
git commit -m "Phone access: PWA + web push + cloud cron + login gate"
git push                          # vers ton repo GitHub (crée-le en privé si pas déjà fait)
```

> Le repo doit être sur GitHub pour que Vercel et GitHub Actions y accèdent. **Privé** de préférence.

---

## 4. Déployer sur Vercel (5 min)

1. https://vercel.com → **Add New… → Project** → importe ton repo GitHub.
2. **Root Directory = `web`** ← le seul réglage important (le dossier `web/` est autonome,
   Vercel détecte Next.js 16 + pnpm tout seul). Framework = Next.js. Laisse le reste par défaut.
3. **Environment Variables** (scope *Production*) — copie ces valeurs. Marque les secrets `Sensitive`.
   ⚠️ Ne mets JAMAIS le préfixe `NEXT_PUBLIC_` sur un secret.

   | Variable | Valeur | Type |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | (depuis `.env`) | public |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (depuis `.env`) | public |
   | `SUPABASE_SERVICE_ROLE_KEY` | (depuis `.env`) | secret |
   | `STRAVA_CLIENT_ID` | (depuis `.env`) | public |
   | `STRAVA_CLIENT_SECRET` | (depuis `.env`) | secret |
   | `ANTHROPIC_API_KEY` | (depuis `.env`) | secret |
   | `COACH_MODEL` | `claude-sonnet-4-6` | public |
   | `ATHLETE_TZ` | `Europe/Paris` | public |
   | `APP_PASSWORD` | ton mot de passe (étape 0) | secret |
   | `AUTH_SECRET` | `openssl rand` (étape 0) | secret |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | clé publique VAPID (étape 0) | public |

   > **Pas** de `VAPID_PRIVATE_KEY` ici — seul le cron en a besoin (étape 6).
4. **Deploy.** Tu obtiens `https://massif.vercel.app` (renomme le projet en `massif` si besoin pour
   fixer ce sous-domaine, dans Settings → Domains).

> Le gate de login s'active automatiquement dès que `APP_PASSWORD` + `AUTH_SECRET` sont présents.
> Sans eux, l'app serait **ouverte à tous** (rappel : RLS OFF, clé service-role). Ne déploie pas sans.

---

## 5. Mettre à jour le callback Strava (1 min)

https://www.strava.com/settings/api → **Authorization Callback Domain** : remplace `localhost` par
`massif.vercel.app`. Sinon le bouton « Connecter Strava » du Profil échouera (le reste marche).

---

## 6. Configurer le cron cloud — GitHub Actions (5 min)

Sur le repo GitHub : **Settings → Secrets and variables → Actions → New repository secret**. Ajoute :

| Secret | Valeur |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | (depuis `.env`) |
| `SUPABASE_SERVICE_ROLE_KEY` | (depuis `.env`) |
| `STRAVA_CLIENT_ID` | (depuis `.env`) |
| `STRAVA_CLIENT_SECRET` | (depuis `.env`) |
| `STRAVA_REFRESH_TOKEN` | (optionnel — fallback si la DB n'a pas de token Strava) |
| `ANTHROPIC_API_KEY` | (depuis `.env`) |
| `COACH_MODEL` | `claude-sonnet-4-6` (optionnel) |
| `ATHLETE_TZ` | `Europe/Paris` (optionnel) |
| `VAPID_PUBLIC_KEY` | clé publique VAPID (étape 0) |
| `VAPID_PRIVATE_KEY` | clé privée VAPID (étape 0) |
| `VAPID_SUBJECT` | `mailto:ton@email` |

> **Garmin : aucun secret ici** — le token vient de Supabase (étape 2).

Teste tout de suite sans attendre l'aube : **Actions → massif-nightly → Run workflow**. Vérifie que
le job vert pull Strava+Garmin, écrit le briefing, et logue `push: notified N/… device(s)` (N=0 tant
que tu n'as pas activé les notifs à l'étape 7 — c'est normal).

Le cron tourne ensuite à **05:30 et 06:30 UTC** (≈ 07:30 / 08:30 Paris en été). Pour changer l'heure,
édite les lignes `cron:` dans `.github/workflows/nightly.yml`.

---

## 7. Installer sur l'iPhone + activer les notifications (2 min)

1. Ouvre `https://massif.vercel.app` dans **Safari**, connecte-toi (ton `APP_PASSWORD`).
2. **Partager → Sur l'écran d'accueil.** L'icône Massif apparaît.
3. **Rouvre l'app depuis l'écran d'accueil** (pas l'onglet Safari — iOS l'exige pour le push).
4. Va dans **Profil → Notifications → Activer les notifications**, accepte la demande iOS.

> iOS n'envoie de push qu'à une PWA *installée* — l'ordre (installer puis activer) compte.

---

## 8. Bascule « sans Mac » (quand le cron cloud est vérifié)

Tant que tu valides, **garde le Mac comme filet** : il continue son cron et alimente le cloud.
Une fois le run GitHub Actions vert et la notif reçue, désactive le cron du Mac pour éviter que les
deux tournent en même temps (ils se disputeraient le token Garmin) :

```bash
launchctl unload ~/Library/LaunchAgents/io.massif.nightly.plist
```

Pour revenir en arrière : `launchctl load ~/Library/LaunchAgents/io.massif.nightly.plist`.

---

## Vérification finale

- [ ] `supabase db push` OK (table `push_subscriptions` visible)
- [ ] `--export-garmin-token` → "exported to Supabase"
- [ ] Vercel déployé, login demandé sur le tél, dashboard visible avec les vraies données
- [ ] Run manuel GitHub Actions vert (Strava + Garmin + briefing)
- [ ] App sur l'écran d'accueil, notifs activées (Profil → Notifications ✓)
- [ ] Lendemain matin : notif reçue ✅ → désactive le cron du Mac (étape 8)

## Limite connue (à faire avant tout partage / colocs)

L'app reste **mono-utilisateur, RLS OFF** : la seule barrière est le mot de passe. Avant d'ouvrir à
d'autres personnes, il faudra Supabase Auth + RLS + `athlete_id` (Phase 9, voir ARCHITECTURE.md).
Si le token Garmin expire, le job logue `garmin: skipped` — refais un login local + ré-exporte (étape 2).
