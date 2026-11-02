#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ID="pbbcorretajes"
SITE_ID="pbbcorretajes-cl"
TARGET="pbbweb"

echo "PBB Corretajes — despliegue al sitio correcto"
echo "Proyecto: $PROJECT_ID"
echo "Hosting site: $SITE_ID"

gcloud config set project "$PROJECT_ID" >/dev/null

for file in firebase.json .firebaserc firestore.rules firestore.indexes.json public/index.html public/app.js; do
  [[ -f "$file" ]] || { echo "ERROR: falta $file" >&2; exit 1; }
done

echo "1/4 Verificando que Firebase vea el sitio..."
firebase hosting:sites:list --project "$PROJECT_ID"

echo "2/4 Aplicando target '$TARGET' -> '$SITE_ID'..."
firebase target:apply hosting "$TARGET" "$SITE_ID" --project "$PROJECT_ID"

echo "3/4 Creando vista previa..."
firebase hosting:channel:deploy pbb-prueba --expires 1d --only "$TARGET" --project "$PROJECT_ID"

echo
read -r -p 'Si la vista previa se ve bien, escriba SI para publicar: ' CONFIRM
if [[ "${CONFIRM^^}" != "SI" ]]; then
  echo "Publicación en vivo cancelada."
  exit 0
fi

echo "4/4 Publicando al sitio $SITE_ID..."
firebase deploy --project "$PROJECT_ID" --only "hosting:$TARGET,firestore"

echo
echo "PUBLICACIÓN COMPLETADA"
echo "Hosting: https://${SITE_ID}.web.app"
echo "Dominio propio (cuando DNS quede conectado): https://pbbcorretajes.cl"
