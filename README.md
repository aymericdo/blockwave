# Blockwave

Extension Chrome (Manifest V3) qui bloque automatiquement une liste de comptes
Instagram : le bot ouvre chaque profil, clique sur **Options → Bloquer**, confirme,
puis passe au suivant.

La liste des comptes est **collaborative** : n'importe qui peut proposer un
compte depuis une page web, tu valides, et les extensions déjà installées
récupèrent la liste à jour toute seules.

```
  visiteur ──▶ web/index.html ──▶ table accounts (status = 'pending')
                                             │
                            toi ──▶ web/admin.html ──▶ 'approved'
                                             │
                            extension ──◀────┘  (lecture seule + cache 6 h)
```

## Installation (mode développeur)

1. Ouvrir `chrome://extensions`
2. Activer **Mode développeur** (en haut à droite)
3. Cliquer sur **Charger l'extension non empaquetée**
4. Sélectionner le dossier `blockwave/` (celui qui contient `manifest.json`)

> Après une modification des scripts, un ↻ dans `chrome://extensions` **et** un
> rechargement de l'onglet Instagram sont nécessaires : un content script ne
> s'injecte qu'au chargement de la page.

## Publication

Le store ne doit recevoir que le strict nécessaire. Le dossier `web/` (formulaire
et console, hébergés sur GitHub Pages), `supabase/`, `scripts/` et `assets/` ne
doivent **pas** partir : un relecteur y verrait un `import` vers `esm.sh` dans
`web/admin.js` et conclurait à du code distant.

```bash
./scripts/package.sh
```

Le script lit la version dans `manifest.json`, vérifie que les fichiers
nécessaires sont présents et produit `blockwave-<version>.zip` à la racine.
Contenu attendu : **12 fichiers, ~64 Ko** — `manifest.json`, `config.js`,
`handles.js`, les 5 fichiers de `src/`, les 4 PNG de `icons/`.

Équivalent manuel, si tu préfères :

```bash
rm -f blockwave-0.1.0.zip
zip -rq blockwave-0.1.0.zip manifest.json config.js handles.js src icons \
  -x '*.DS_Store' 'icons/icon512.png'
```

Réponse à « Utilisez-vous du code distant ? » : **Non**. Tout le JavaScript est
embarqué dans l'archive ; l'appel à Supabase est un `fetch` de données, pas du
code exécuté.

## Utilisation

1. Se connecter à `instagram.com` dans un onglet
2. Cliquer sur l'icône **Blockwave** dans la barre d'extensions
3. Cliquer sur **Bloquer les N comptes**

Le popup indique d'où vient la liste (`liste partagée`, `cache local` ou
`liste de secours`) et depuis quand elle est en cache.

### Ajouter un compte depuis le popup

Le champ sous la ligne d'en-tête accepte un `@pseudo` ou une URL de profil ;
`handles.js` normalise la saisie.

| Action | Effet |
| --- | --- |
| **Ajouter** (`+`) | Le compte entre dans **ta** liste locale (`chrome.storage`), sans validation, et il est traité en premier au prochain lancement. |
| *(automatique)* | Une ligne `pending` est envoyée dans Supabase : le compte rejoint la liste partagée après validation depuis `web/admin.html`. |

Les comptes ajoutés à la main portent une pastille rouge et un `×` pour les
retirer. Ils sont stockés à part de la liste partagée : un `Réinitialiser` ne
les efface pas, et si Supabase tombe ils restent disponibles.

### Pré-remplissage depuis l'onglet actif

Si l'onglet actif est une page de profil, le champ d'ajout est pré-rempli avec le
pseudo courant et le texte est sélectionné : ouvrir le popup puis appuyer sur
**Entrée** suffit à ajouter le compte qu'on est en train de regarder.

La détection passe par `handleFromUrl()` (`handles.js`), qui exclut les chemins
qui ressemblent à un pseudo sans en être un : `/explore`, `/reels`, `/direct`,
`/accounts`…

Aucune interface n'est injectée dans Instagram : l'extension ne touche au DOM de
la page que pour cliquer sur « Bloquer ».

L'onglet Instagram est piloté en direct : tu vois chaque profil s'ouvrir et le
blocage se faire. À la fin, l'onglet revient sur le fil d'accueil.

Le popup peut être fermé pendant l'exécution : l'orchestration tourne dans le
service worker et l'état est conservé. Rouvre le popup pour voir l'avancement.

## Liste collaborative

### Mise en place, une seule fois

1. Créer un projet sur [supabase.com](https://supabase.com) (région Europe).
2. **SQL Editor → New query** : coller tout `supabase/schema.sql`, puis **Run**.
   Enchaîner avec `supabase/seed.sql` (la liste de départ). Le seed est
   idempotent : tu peux le relancer seul pour resynchroniser la liste.
3. **Settings → API** : copier `Project URL` et la clé `anon public` dans
   `config.js` (racine du dépôt).
4. **Authentication → URL Configuration** :
   - `Site URL` = `https://<ton-pseudo>.github.io/blockwave/`
   - `Redirect URLs` += `https://<ton-pseudo>.github.io/blockwave/web/admin.html`
   - idem en `http://localhost:8000/web/admin.html` si tu testes en local.
5. **Settings → Pages** : source = branche `main`, dossier `/ (root)`.
   Les pages sont alors sur `/web/index.html` et `/web/admin.html`.
6. Ouvrir `/web/admin.html`, saisir ton e-mail, cliquer sur le lien reçu. Le
   compte existe maintenant dans `auth.users`.
7. Retour au SQL Editor : décommenter la section **6** de `schema.sql`, y
   remplacer l'e-mail, **Run**. Tu es administrateur.
8. Recharger `admin.html` : la file d'attente s'affiche.

> Les pages utilisent des modules ES : `file://` ne fonctionne pas. Pour tester
> en local, sers le dossier (`python3 -m http.server`) et utilise `localhost`.

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
| `anon` (visiteur) | insérer une ligne en `pending`, lire les comptes `approved` | lire les `pending` / `rejected`, modifier quoi que ce soit, s'auto-approuver |
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
- l'index unique sur `lower(username)` couvre **tous** les statuts : un compte
  déjà présent — approuvé, en attente ou rejeté — ne peut plus être soumis.
  C'est ce qui empêche qu'un même compte soit traité deux fois ;
- `schema.sql` est idempotent : le relancer après une mise à jour applique les
  changements sur une base existante, sans toucher aux données.

### Appliquer une migration

`supabase/seed.sql` amorce une base neuve. Sur une base **déjà en service** —
comptes approuvés, propositions en attente —, préférer `supabase/migrations/` :
chaque fichier n'ajoute que son delta et peut être relancé sans risque.

| Migration | Contenu |
| --- | --- |
| `20261028160000_ajout_comptes_politiques.sql` | 36 comptes, dont 29 nouveaux |

Les deux scripts coupent le trigger `blockwave_throttle` le temps de l'insertion
(52 lignes dépassent son plafond de 40/heure) et le réarment dans la même
transaction ; un échec annule le `disable` en même temps que l'insertion.

### Ajouter des comptes à la main

Directement dans Supabase → **Table Editor → accounts** : créer une ligne avec
`username` et `status = 'approved'`. Pratique pour amorcer la liste.

La liste de secours (`FALLBACK_ACCOUNTS`, dans `src/background.js`) ne sert
qu'au tout premier lancement hors-ligne : Supabase injoignable **et** aucun
cache. C'est un amorçage figé, volontairement **non** aligné sur le seed — la
source de vérité reste la table `accounts`, pas le code de l'extension.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `config.js` | URL + clé `anon` Supabase, partagés par l'extension et les pages |
| `handles.js` | Normalisation des pseudos (`@x`, URL, `?hl=fr`…) — source unique |
| `supabase/schema.sql` | Table, contraintes, RLS, trigger anti-spam, amorçage |
| `supabase/seed.sql` | Liste de départ (52 comptes), réexécutable |
| `supabase/migrations/` | Ajouts incrémentaux à appliquer sur une base déjà en service |
| `web/index.html` + `submit.js` | Formulaire public de proposition |
| `web/admin.html` + `admin.js` | Console de modération (lien magique) |
| `src/background.js` | Orchestrateur : récupère la liste, navigue profil par profil, gère l'état et le rythme |
| `src/content.js` | Script injecté sur instagram.com : trouve le bouton « Options », clique « Bloquer », confirme, vérifie |
| `src/popup.html/.css/.js` | Interface : lancement, provenance de la liste, suivi compte par compte |

### Pourquoi pas les sélecteurs CSS fournis ?

Les classes Instagram (`x1n2onr6`, `x9f619`, `x78zum5`…) et les identifiants
`#mount_0_0_xxx` sont **générés** et changent à chaque déploiement. Le content
script cible donc des signaux stables :

- `svg[aria-label="Options"]` (ou `Plus d'options` / `More options`), sinon le
  dernier bouton-icône du `header` de profil ;
- les éléments `button` / `[role="button"]` dont le texte est exactement
  **Bloquer** / **Block** (le plus court gagne = l'élément le plus profond) ;
- la vérification finale : le bouton du profil devient **Débloquer**.

## Statuts possibles

| Statut | Sens |
| --- | --- |
| `bloqué` | Blocage effectué et vérifié |
| `déjà` | Le compte était déjà bloqué (l'élément « Débloquer » est présent) |
| `traité` | Bloqué lors d'une exécution précédente — le profil n'est même pas ouvert |
| `introuvable` | Profil supprimé / renommé |
| `session` | Instagram demande une reconnexion → le bot s'arrête |
| `échec` | Sélecteur introuvable, page inattendue, onglet fermé |

## Registre des comptes traités

Chaque compte bloqué (qu'il l'ait été par l'extension ou qu'il le soit déjà) est
mémorisé dans `chrome.storage.local`, sous la clé `blockwave:done` :

```json
{ "marine_lepen": 1761700000000 }
```

Au lancement suivant, ces comptes reçoivent le statut `traité` et sont **sautés
sans navigation** — pas de page ouverte, pas de clic. Sur une relance où rien
n'a changé, l'opération se termine donc en quelques centaines de millisecondes
au lieu de repasser sur chaque profil.

Le popup affiche le nombre de comptes traités dans sa ligne de provenance, et
un lien **Revérifier** apparaît : il vide le registre et remet tous les comptes
en file.

> Limite à connaître : le registre est local et ne sait pas ce que tu fais sur
> Instagram. Si tu débloques quelqu'un à la main dans l'application, Blockwave
> continuera de le considérer comme traité. C'est à ça que sert **Revérifier**.
> Le registre n'est pas synchronisé entre appareils — chaque navigateur a le sien.

## Rythme

Aucun délai n'est fixe : tout est tiré au hasard entre deux bornes, pour éviter
le rythme métronomique caractéristique d'un script.

**Dans la page** (`src/content.js`, objet `PACE`) :

| Étape | Délai |
| --- | --- |
| Arrivée sur le profil | 0,25 – 0,7 s avant de réagir |
| Lecture | 1 à 2 scrolls de 180–460 px, 0,25–0,6 s entre chaque, puis retour en haut |
| Avant d'ouvrir le menu « … » | 0,12 – 0,35 s |
| Lecture du menu avant « Bloquer » | 0,2 – 0,5 s |
| Hésitation devant la confirmation | 0,2 – 0,55 s |

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

Un compte **déjà bloqué** est détecté avant tout le reste : sur un profil
bloqué, le bouton d'action du header vaut « Débloquer » et non « Suivre ». Ce
contrôle précède la lecture du profil et l'ouverture du menu, ce qui ramène ces
cas à 1–2 secondes.

Pour ralentir davantage, augmente les bornes de `PACE` et `PACING`.

## Limites connues

- Instagram peut changer son interface : dans ce cas, ajuste les regex de
  `src/content.js` (`RE.options`, `RE.block`, `RE.unblock`).
- Comptes privés : le menu « Options » reste accessible, le blocage fonctionne.
- Le scroll de lecture suppose une fenêtre assez haute pour que le contenu
  défile ; sur une fenêtre très courte il ne fait rien, sans casser le flux.
