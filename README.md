# Blockwave

Extension Chrome (Manifest V3) qui bloque automatiquement une liste de comptes
sur **Instagram** et **Facebook** : le bot ouvre chaque profil, ouvre le menu
« … », clique sur **Bloquer**, confirme, puis passe au suivant.

La liste des comptes vit dans Supabase. Tu la modères depuis une console web ;
les extensions déjà installées récupèrent la liste à jour toutes seules.

```
  popup « + » ──▶ table accounts (platform, status = 'pending')
                              │
        toi ──▶ admin/ (Netlify) ──▶ 'approved'
                              │
          extension ──◀───────┘  (lecture seule + cache 6 h)
```

### Une exécution = une plateforme

Il n'y a ni sélecteur ni enchaînement : **la plateforme est celle de l'onglet
actif**. Ouvre le popup depuis un onglet Instagram, il bloque des comptes
Instagram ; depuis un onglet Facebook, il bloque des comptes Facebook.

Conséquence sur les données : le pseudo seul ne suffit pas à identifier
quelqu'un. La table est donc unique sur le couple `(platform, username)` — le
même nom peut désigner deux personnes différentes sur deux réseaux.

## Installation (mode développeur)

1. Ouvrir `chrome://extensions`
2. Activer **Mode développeur** (en haut à droite)
3. Cliquer sur **Charger l'extension non empaquetée**
4. Sélectionner le dossier `blockwave/` (celui qui contient `manifest.json`)

> Après une modification des scripts, un ↻ dans `chrome://extensions` **et** un
> rechargement de l'onglet Instagram ou Facebook sont nécessaires : un content
> script ne s'injecte qu'au chargement de la page.

## Publication

Le store ne doit recevoir que le strict nécessaire. Les dossiers `admin/`
(console, hébergée sur Netlify), `supabase/`, `scripts/` et `assets/` ne doivent
**pas** partir : le relecteur y verrait une application web et un schéma de
base, sans rapport avec l'extension.

```bash
./scripts/package.sh
```

Le script lit la version dans `manifest.json`, vérifie que les fichiers
nécessaires sont présents et produit `blockwave-<version>.zip` à la racine.
Contenu attendu : **15 fichiers** — `manifest.json`, `config.js`,
`handles.js`, les 5 fichiers de `src/` à la racine, les 3 content scripts de
`src/content/`, les 4 PNG de `icons/`.

Équivalent manuel, si tu préfères :

```bash
rm -f blockwave-0.2.0.zip
zip -rq blockwave-0.2.0.zip manifest.json config.js handles.js src icons \
  -x '*.DS_Store' 'icons/icon512.png'
```

Réponse à « Utilisez-vous du code distant ? » : **Non**. Tout le JavaScript est
embarqué dans l'archive ; l'appel à Supabase est un `fetch` de données, pas du
code exécuté.

## Utilisation

1. Se connecter à `instagram.com` **ou** `facebook.com` dans un onglet
2. Cliquer sur l'icône **Blockwave** dans la barre d'extensions
3. Cliquer sur **Bloquer les N comptes**

Le popup affiche la plateforme détectée dans son en-tête, d'où vient la liste
(`liste partagée`, `cache local` ou `liste de secours`) et depuis quand elle
est en cache. Si l'onglet actif n'est ni Instagram ni Facebook, tout est
désactivé avec un message explicite.

### Ajouter un compte depuis le popup

Le champ sous la ligne d'en-tête accepte un `@pseudo` ou une URL de profil ;
`handles.js` normalise la saisie.

| Action | Effet |
| --- | --- |
| **Ajouter** (`+`) | Le compte entre dans **ta** liste locale (`chrome.storage`), sans validation, et il est traité en premier au prochain lancement. |
| *(automatique)* | Une ligne `pending` est envoyée dans Supabase : le compte rejoint la liste partagée après validation depuis la console de modération. |

Les comptes ajoutés à la main portent une pastille rouge et un `×` pour les
retirer. Ils sont stockés à part de la liste partagée : un `Réinitialiser` ne
les efface pas, et si Supabase tombe ils restent disponibles.

### Pré-remplissage depuis l'onglet actif

Si l'onglet actif est une page de profil, le champ d'ajout est pré-rempli avec le
pseudo courant et le texte est sélectionné : ouvrir le popup puis appuyer sur
**Entrée** suffit à ajouter le compte qu'on est en train de regarder.

La détection passe par `handleFromProfileUrl()` (`src/platforms.js`) : chaque
plateforme déclare ses segments réservés, pour ne pas confondre `/explore` ou
`/marketplace` avec un pseudo.

Aucune interface n'est injectée dans Instagram : l'extension ne touche au DOM de
la page que pour cliquer sur « Bloquer ».

L'onglet Instagram est piloté en direct : tu vois chaque profil s'ouvrir et le
blocage se faire. À la fin, l'onglet revient sur le fil d'accueil.

Le popup peut être fermé pendant l'exécution : l'orchestration tourne dans le
service worker et l'état est conservé. Rouvre le popup pour voir l'avancement.

## Console de modération

`admin/` est une application Vite + React + Tailwind, déployée sur Netlify. Elle
remplace l'ancienne page statique `web/admin.html`, qui chargeait
`@supabase/supabase-js` depuis `https://esm.sh` : ce seul `import` déclenchait
**15 requêtes** (~4,9 s de latence cumulée) avant le premier rendu utile. Le
paquet est désormais empaqueté dans le bundle et servi depuis le même domaine.

```bash
cd admin
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + build dans admin/dist
```

Déploiement : Netlify lit `netlify.toml` à la racine (`base = "admin"`,
`publish = "dist"`, `command = "npm run build"`). Aucune variable
d'environnement à renseigner — la configuration Supabase vient de `config.js`,
à la racine du dépôt, partagée avec l'extension.

Le favicon n'est pas un fichier à maintenir à part : `node scripts/build-icons.mjs`
le génère dans `admin/public/` depuis `assets/icon-source.png`, la même source
que les icônes de l'extension.

> Après le premier déploiement, ajoute l'URL Netlify dans **Supabase →
> Authentication → URL Configuration** (`Site URL` et `Redirect URLs`), sinon le
> lien magique renverra vers l'ancien domaine GitHub Pages.

## Liste collaborative

### Mise en place, une seule fois

1. Créer un projet sur [supabase.com](https://supabase.com) (région Europe).
2. **SQL Editor → New query** : coller tout `supabase/schema.sql`, puis **Run**.
   Enchaîner avec `supabase/seed.sql` (la liste de départ). Le seed est
   idempotent : tu peux le relancer seul pour resynchroniser la liste.
3. **Settings → API** : copier `Project URL` et la clé `anon public` dans
   `config.js` (racine du dépôt).
4. **Authentication → URL Configuration** :
   - `Site URL` = `https://<ton-site>.netlify.app/` — l'origine de la console
   - `Redirect URLs` += `https://<ton-site>.netlify.app/`
   - idem en `http://localhost:5173/` pour le développement local.
5. Déployer la console sur Netlify (voir « Console de modération » ci-dessous),
   l'ouvrir et saisir ton e-mail : le clic sur le lien crée la ligne dans
   `auth.users`.
6. Retour au SQL Editor : décommenter la section **6** de `schema.sql`, y
   remplacer l'e-mail, **Run**. Tu es administrateur.
7. Recharger la console : la file d'attente s'affiche.

> La console tourne sous Vite : `cd admin && npm install && npm run dev`, puis
> `http://localhost:5173`.
>
> Il n'y a plus de formulaire public : les propositions viennent uniquement du
> popup de l'extension (bouton « + »), et seule la console les valide.

### Modération

L'onglet **En attente** liste les propositions. **Approuver** rend le compte
public immédiatement ; **Rejeter** le garde en base mais le retire de la liste.
Un compte rejeté ne peut pas être re-soumis (index unique), ce qui évite les
propositions en boucle.

L'extension cache la liste pendant 6 h (`CONFIG.listTtlMs`). Le bouton
**Actualiser** du popup force la synchronisation.

### Modèle de sécurité

| Qui | Peut | Ne peut pas |
| --- | --- | --- |
| `anon` (extension) | insérer une ligne en `pending`, lire les comptes `approved` | lire les `pending` / `rejected`, modifier quoi que ce soit, s'auto-approuver |
| `authenticated` non-admin | idem `anon` | idem |
| admin (table `admins`) | tout | — |

Points clés :

- la clé `anon` dans `config.js` est **publique par conception** — c'est la RLS
  qui protège, pas le secret. Ne jamais y mettre la clé `service_role`.
- le `with check` de la politique d'insertion force `status = 'pending'` : même
  en forgeant une requête PostgREST, on ne peut pas s'auto-approuver ;
- `public.admins` a la RLS active et **aucune politique** : la table est
  illisible en direct, y compris pour un utilisateur connecté. Elle n'est
  interrogée que par `is_admin()`, en `security definer` ;
- l'extension n'a qu'un accès **lecture**. Elle ne peut rien modifier.
- le trigger anti-spam exempte les administrateurs (`is_admin()`), sinon
  n'importe qui pourrait saturer le quota de 40/heure et bloquer tes propres
  ajouts ;
- l'index unique sur `(platform, lower(username))` couvre **tous** les statuts :
  un compte déjà présent — approuvé, en attente ou rejeté — ne peut plus être
  soumis, et un pseudo Instagram peut exister en parallèle sur Facebook ;
- `schema.sql` est idempotent : le relancer après une mise à jour applique les
  changements sur une base existante, sans toucher aux données.

### Appliquer une migration

`supabase/seed.sql` amorce une base neuve. Sur une base **déjà en service** —
comptes approuvés, propositions en attente —, préférer `supabase/migrations/` :
chaque fichier n'ajoute que son delta et peut être relancé sans risque.

| Migration | Contenu |
| --- | --- |
| `20261028160000_ajout_comptes_politiques.sql` | 36 comptes Instagram, dont 29 nouveaux |
| `20261028190000_ajout_platform.sql` | colonne `platform`, index `(platform, lower(username))` |

Les deux premières migrations doivent être appliquées **dans l'ordre
chronologique** : la seconde suppose que les comptes existants ont déjà été
insérés.

Les deux scripts coupent le trigger `blockwave_throttle` le temps de l'insertion
(52 lignes dépassent son plafond de 40/heure) et le réarment dans la même
transaction ; un échec annule le `disable` en même temps que l'insertion.

### Ajouter des comptes à la main

Directement dans Supabase → **Table Editor → accounts** : créer une ligne avec
`platform` (`instagram` ou `facebook`), `username` et `status = 'approved'`.
Pratique pour amorcer la liste.

La liste de secours (`FALLBACK_ACCOUNTS`, dans `src/background.js`) ne sert
qu'au tout premier lancement hors-ligne : Supabase injoignable **et** aucun
cache. C'est un amorçage figé, volontairement **non** aligné sur le seed — la
source de vérité reste la table `accounts`, pas le code de l'extension.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `config.js` | URL + clé `anon` Supabase, partagés par l'extension et les pages |
| `handles.js` | Normalisation d'un pseudo (`@x`, URL, `?hl=fr`…) — indépendante de la plateforme |
| `src/platforms.js` | Réseaux pris en charge : détection depuis l'URL, URL de profil, segments réservés |
| `supabase/schema.sql` | Table, contraintes, RLS, trigger anti-spam, amorçage |
| `supabase/seed.sql` | Liste de départ (52 comptes), réexécutable |
| `supabase/migrations/` | Ajouts incrémentaux à appliquer sur une base déjà en service |
| `admin/` | Console de modération React + Tailwind (Netlify), sources et build Vite |
| `src/background.js` | Orchestrateur : récupère la liste, navigue profil par profil, gère l'état et le rythme |
| `src/content/common.js` | Briques partagées par les content scripts : clic « humain », attentes, lecture simulée, messagerie |
| `src/content/instagram.js` | Scénario Instagram : « Options » → « Bloquer » → confirmation → vérification « Débloquer » |
| `src/content/facebook.js` | Scénario Facebook : menu « … » → « Bloquer » → confirmation → vérification |
| `src/popup.html/.css/.js` | Interface : lancement, provenance de la liste, suivi compte par compte |

### Pourquoi pas les sélecteurs CSS fournis ?

Les classes d'Instagram (`x1n2onr6`, `x9f619`, `x78zum5`…) et de Facebook, comme
les identifiants `#mount_0_0_xxx`, sont **générés** et changent à chaque
déploiement. Les content scripts ciblent donc des signaux stables : `role`,
`aria-label`, `aria-haspopup`, texte visible.

| | Instagram | Facebook |
| --- | --- | --- |
| Menu | `[aria-label]` ≈ « Options » | `[aria-haspopup="menu"]` ≈ « Plus » |
| Entrée | « Bloquer » dans le menu | « Bloquer » dans `[role="menu"]` |
| Confirmation | « Bloquer » dans la boîte | **« Confirmer »** dans `[role="dialog"]` (jamais « Bloquer ») |
| Déjà bloqué | bouton du header = « Débloquer » | le menu propose « Débloquer » |

Le texte est cherché par expression régulière, jamais par position : le libellé
le plus court gagne, ce qui évite d'attraper un conteneur parent.

## Statuts possibles

| Statut | Sens |
| --- | --- |
| `bloqué` | Blocage effectué et vérifié |
| `déjà` | Le compte était déjà bloqué (l'élément « Débloquer » est présent) |
| `traité` | Bloqué lors d'une exécution précédente — le profil n'est même pas ouvert |
| `introuvable` | Profil supprimé / renommé |
| `session` | Le réseau demande une reconnexion → le bot s'arrête |
| `échec` | Sélecteur introuvable, page inattendue, onglet fermé |

## Registre des comptes traités

Chaque compte bloqué (qu'il l'ait été par l'extension ou qu'il le soit déjà) est
mémorisé dans `chrome.storage.local`, sous la clé `blockwave:done`. La clé porte
la plateforme : bloquer `marine_lepen` sur Instagram ne dispense pas de bloquer
son homonyme Facebook.

```json
{ "instagram:marine_lepen": 1761700000000, "facebook:marine_lepen": 1761700001000 }
```

Au lancement suivant, ces comptes reçoivent le statut `traité` et sont **sautés
sans navigation** — pas de page ouverte, pas de clic. Sur une relance où rien
n'a changé, l'opération se termine donc en quelques centaines de millisecondes
au lieu de repasser sur chaque profil.

Le popup affiche le nombre de comptes traités dans sa ligne de provenance, et
un lien **Revérifier** apparaît : il vide le registre et remet tous les comptes
en file.

> Limite à connaître : le registre est local et ne sait pas ce que tu fais sur
> le réseau. Si tu débloques quelqu'un à la main dans l'application, Blockwave
> continuera de le considérer comme traité. C'est à ça que sert **Revérifier**
> (qui n'efface que les comptes de la plateforme affichée).
> Le registre n'est pas synchronisé entre appareils — chaque navigateur a le sien.

## Rythme

Aucun délai n'est fixe : tout est tiré au hasard entre deux bornes, pour éviter
le rythme métronomique caractéristique d'un script.

**Dans la page** (`PACE`, propre à chaque content script) :

| Étape | Délai |
| --- | --- |
| Arrivée sur le profil | 0,25 – 0,7 s avant de réagir |
| Lecture | 1 à 2 scrolls de 180–460 px, 0,25–0,6 s entre chaque, puis retour en haut |
| Avant d'ouvrir le menu « … » | 0,12 – 0,35 s |
| Lecture du menu avant « Bloquer » | 0,2 – 0,5 s |
| Hésitation devant la confirmation | 0,2 – 0,55 s |

Facebook est plus lent (rendu client, menu différé) : ses bornes sont environ
deux fois plus larges, dans `src/content/facebook.js`.

Chaque clic est lui-même décomposé : approche de la souris en 3 `mousemove`,
survol, 50–130 ms de réaction, appui maintenu 35–80 ms, puis relâchement.

**Entre deux profils** (`src/background.js`, objet `PACING`) :

| Étape | Délai |
| --- | --- |
| Stabilisation de la page | 0,6 – 1,2 s |
| Pause avant le profil suivant | 0,8 – 2 s |
| Pause longue (15 % des cas) | 4 – 7 s |

Au total, comptes environ **5 à 9 secondes par compte**. Le popup affiche la
durée de la pause en cours, et les pauses longues sont découpées en tranches de
4 s avec un appel d'API entre chaque : sans ça, Chrome tue le service worker
au bout de 30 s d'inactivité et le bot s'arrête silencieusement.

Sur Instagram, un compte **déjà bloqué** est détecté avant tout le reste : le
bouton d'action du header vaut « Débloquer » et non « Suivre ». Ce contrôle
précède la lecture du profil et l'ouverture du menu, ce qui ramène ces cas à
1–2 secondes. Facebook n'offre pas d'indicateur équivalent dans l'en-tête : il
faut ouvrir le menu pour le savoir.

Pour ralentir davantage, augmente les bornes de `PACE` et `PACING`.

## Limites connues

- Le scénario Facebook est validé sur une **Page** (profil public). Trois
  particularités y sont encodées — ne pas les « simplifier » :
  deux boutons portent le libellé « Plus » (le « … » de l'en-tête et l'onglet
  de la rangée d'onglets), et c'est la géométrie qui les départage ; la
  confirmation s'appelle **`Confirmer`**, jamais `Bloquer` ; un profil
  personnel peut se comporter différemment d'une Page. Tout est dans
  `src/content/facebook.js`. En cas d'échec, le popup liste les entrées
  réellement trouvées (« Vu : … ») et la console (F12) trace les scores
  `[Blockwave:facebook]`.
- Instagram peut changer son interface : dans ce cas, ajuste les regex de
  `src/content/instagram.js` (`RE.options`, `RE.block`, `RE.unblock`).
- Seuls les profils à **pseudo** sont gérés (`facebook.com/nom`). Les pages
  `/profile.php?id=…`, sans pseudo public, sont rejetées à l'ajout.
- Comptes privés : le menu « Options » / « … » reste accessible, le blocage
  fonctionne.
- Le scroll de lecture suppose une fenêtre assez haute pour que le contenu
  défile ; sur une fenêtre très courte il ne fait rien, sans casser le flux.
