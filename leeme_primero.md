
## Cambio V14.2 — Feed de Instagram

La página pública ya no muestra “Propiedades destacadas”. En esa ubicación se integró el feed de Instagram `@pbb.corretajes` mediante Behold, feed ID `2b1hL3USdf73VjO14AzL`. El panel privado de propiedades se conserva en Firebase para no perder la información ya cargada. Además, la página pública ya no consulta la colección `properties`, reduciendo lecturas de Firestore.

# PBB Corretajes — Firebase V14.2

Esta versión reemplaza por completo Google Apps Script, Google Sheets, Drive, Supabase, Cloudinary, Formspree y Netlify.

## Arquitectura

- **Firebase Hosting:** publica el sitio con HTTPS y CDN.
- **Cloud Firestore:** guarda propiedades, fotografías optimizadas, contactos, papelera y respaldos.
- **Firebase Authentication:** protege el panel administrativo.
- **Sin Cloud Storage:** se evita para mantener el proyecto en el plan gratuito Spark. Las fotografías se optimizan y se almacenan en documentos independientes de Firestore.

El sitio usa la configuración automática de Firebase Hosting mediante `/__/firebase/init.js`. No hay que copiar `apiKey`, `projectId` ni otras claves al código.

## Instalación definitiva

### 1. Crear el proyecto

1. Abra Firebase Console.
2. Cree un proyecto nuevo, por ejemplo `pbb-corretajes`.
3. No es necesario activar Google Analytics.

### 2. Crear Firestore

1. Entre en **Firestore Database**.
2. Presione **Crear base de datos**.
3. Seleccione edición estándar y modo producción.
4. Elija la ubicación más cercana disponible.

No cree colecciones manualmente. La página las crea al guardar los primeros datos.

### 3. Crear el usuario administrador

1. Entre en **Authentication**.
2. En **Método de acceso**, habilite **Correo electrónico/contraseña**.
3. Entre en **Usuarios** y presione **Agregar usuario**.
4. Use exactamente este correo:

```text
paulina.barriga@unne.cl
```

5. Defina una contraseña segura de al menos 10 caracteres.

Este correo está autorizado en `public/app.js` y en `firestore.rules`. Para usar otro correo, hay que reemplazarlo en ambos archivos antes de publicar.

### 4. Publicar

En un computador con Node.js:

```bash
npm install -g firebase-tools
firebase login
cd PBB_CORRETAJES_FIREBASE_V14
bash deploy.sh ID_DEL_PROYECTO
```

En Windows también puede ejecutar `DEPLOYAR_WINDOWS.bat`.

El comando publica simultáneamente:

- el sitio;
- las reglas de seguridad;
- las exenciones de índices para fotografías.

La dirección final será:

```text
https://ID_DEL_PROYECTO.web.app
```

Panel administrativo:

```text
https://ID_DEL_PROYECTO.web.app/?admin
```

## Dominio pbbcorretajes.cl

Después de comprobar la dirección `web.app`:

1. Firebase Console → Hosting.
2. **Agregar dominio personalizado**.
3. Ingrese `pbbcorretajes.cl`.
4. Copie en su proveedor de dominio los registros DNS que entregue Firebase.

No redireccione el dominio hacia Apps Script.

## Protección contra pérdida de propiedades

- Las propiedades no se borran definitivamente: pasan a papelera.
- Antes de guardar, editar, eliminar o restaurar se crea un respaldo de metadatos.
- Las fotografías permanecen en su subcolección aunque una propiedad esté en papelera.
- El sitio y `app.js` usan `no-cache`, para evitar que teléfono y computador conserven versiones antiguas.

## Límites de fotografías

- Hasta 10 fotografías por propiedad.
- El navegador reduce resolución y peso antes de guardar.
- Firestore impone un máximo de 1 MiB por documento; el sistema rechaza imágenes que superen el límite después de optimizarlas.

## Prueba sin Firebase

Para revisar la interfaz sin publicar, abra el sitio en un servidor local con `?mock=1`. En modo prueba la contraseña es:

```text
PBB2026!
```

El modo prueba nunca se activa en la publicación normal salvo que se agregue expresamente `?mock=1`.
