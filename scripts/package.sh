#!/usr/bin/env bash
#
# Blockwave — construit l'archive de publication.
#
#   ./scripts/package.sh
#
# Sortie : blockwave-<version>.zip à la racine du dépôt, où <version> est lue
# dans manifest.json. Le contenu est volontairement restreint : web/,
# supabase/, scripts/ et assets/ ne doivent pas partir, un relecteur du store
# y verrait un import vers esm.sh et conclurait à du code distant.

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v zip >/dev/null 2>&1; then
  echo "erreur : la commande 'zip' est introuvable" >&2
  exit 1
fi

VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -1)

if [[ -z "$VERSION" ]]; then
  echo "erreur : version illisible dans manifest.json" >&2
  exit 1
fi

NAME="blockwave-${VERSION}.zip"

# Tout ce que Chrome charge doit être présent ; on échoue tôt plutôt que de
# produire une archive incomplète que le store refusera.
FILES=(manifest.json config.js handles.js src icons)

for path in "${FILES[@]}"; do
  if [[ ! -e "$path" ]]; then
    echo "erreur : '$path' manquant" >&2
    exit 1
  fi
done

# Toutes les archives, pas seulement celle qu'on s'apprête à produire : après un
# changement de version, l'ancienne resterait sinon indéfiniment sur le disque
# et on risque d'uploader la mauvaise.
rm -f blockwave-*.zip

zip -rq "$NAME" "${FILES[@]}" -x '*.DS_Store' '*__MACOSX*' 'icons/icon512.png'

COUNT=$(unzip -Z1 "$NAME" | grep -v '/$' | wc -l | tr -d ' ')
SIZE=$(du -h "$NAME" | cut -f1 | tr -d ' ')

echo "$NAME — $COUNT fichiers, $SIZE"

# Rappel utile au moment de l'envoi : la clé Supabase part dans l'archive.
if grep -q "supabaseUrl: ''" config.js; then
  echo "attention : supabaseUrl est vide dans config.js — l'extension utilisera la liste de secours" >&2
fi
