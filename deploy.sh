#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-}"
if [[ -z "$PROJECT_ID" ]]; then
  echo "Uso: bash deploy.sh ID_DEL_PROYECTO_FIREBASE"
  exit 1
fi

firebase deploy --project "$PROJECT_ID" --only firestore,hosting

echo ""
echo "Sitio publicado. Revise: https://${PROJECT_ID}.web.app"
