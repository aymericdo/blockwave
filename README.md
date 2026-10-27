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

## Utilisation

1. Se connecter à `instagram.com` dans un onglet
2. Cliquer sur l'icône **Blockwave** dans la barre d'extensions
3. Cliquer sur **Bloquer les N comptes**

Le popup indique d'où vient la liste (`liste partagée`, `cache local` ou
`liste de secours`) et depuis quand elle est en cache.

L'onglet Instagram est piloté en direct : tu vois chaque profil s'ouvrir et le
blocage se faire. À la fin, l'onglet revient sur le fil d'accueil.

Le popup peut être fermé pendant l'exécution : l'orchestration tourne dans le
service worker et l'état est conservé. Rouvre le popup pour voir l'avancement.

## Liste collaborative

### Mise en place, une seule fois

1. Créer un projet sur [supabase.com](https://supabase.com) (région Europe).
2. **SQL Editor → New query** : coller tout `supabase/schema.sql`, puis **Run**.
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

### Ajouter des comptes à la main

Directement dans Supabase → **Table Editor → accounts** : créer une ligne avec
`username` et `status = 'approved'`. Pratique pour amorcer la liste.

La liste de secours (si Supabase est injoignable et sans cache) reste les 6
comptes d'origine, dans `FALLBACK_ACCOUNTS` (`src/background.js`).

## Architecture

| Fichier | Rôle |
| --- | --- |
| `config.js` | URL + clé `anon` Supabase, partagés par l'extension et les pages |
| `handles.js` | Normalisation des pseudos (`@x`, URL, `?hl=fr`…) — source unique |
| `supabase/schema.sql` | Table, contraintes, RLS, trigger anti-spam, amorçage |
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
| `introuvable` | Profil supprimé / renommé |
| `session` | Instagram demande une reconnexion → le bot s'arrête |
| `échec` | Sélecteur introuvable, page inattendue, onglet fermé |

## Rythme

Aucun délai n'est fixe : tout est tiré au hasard entre deux bornes, pour éviter
le rythme métronomique caractéristique d'un script.

**Dans la page** (`src/content.js`, objet `PACE`) :

| Étape | Délai |
| --- | --- |
| Arrivée sur le profil | 0,6 – 1,4 s avant de réagir |
| Lecture | 1 à 2 scrolls de 180–460 px, 0,45–1 s entre chaque, puis retour en haut |
| Avant d'ouvrir le menu « … » | 0,25 – 0,65 s |
| Lecture du menu avant « Bloquer » | 0,35 – 0,85 s |
| Hésitation devant la confirmation | 0,4 – 0,95 s |

Chaque clic est lui-même décomposé : approche de la souris en 3 `mousemove`,
survol, 90–220 ms de réaction, appui maintenu 50–110 ms, puis relâchement.

**Entre deux profils** (`src/background.js`, objet `PACING`) :

| Étape | Délai |
| --- | --- |
| Stabilisation de la page | 1,2 – 2,3 s |
| Pause avant le profil suivant | 2,5 – 5,5 s |
| Pause longue (20 % des cas) | 8 – 14 s |

Au total, comptes environ **10 à 20 secondes par compte**. Le popup affiche la
durée de la pause en cours, et les pauses longues sont découpées en tranches de
4 s avec un appel d'API entre chaque : sans ça, Chrome tue le service worker
au bout de 30 s d'inactivité et le bot s'arrête silencieusement.

Pour ralentir davantage, augmente les bornes de `PACE` et `PACING`.

## Limites connues

- Instagram peut changer son interface : dans ce cas, ajuste les regex de
  `src/content.js` (`RE.options`, `RE.block`, `RE.unblock`).
- Comptes privés : le menu « Options » reste accessible, le blocage fonctionne.
- Le scroll de lecture suppose une fenêtre assez haute pour que le contenu
  défile ; sur une fenêtre très courte il ne fait rien, sans casser le flux.
