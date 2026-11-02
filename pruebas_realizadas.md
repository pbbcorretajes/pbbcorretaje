# Pruebas realizadas — Firebase V14.2 Instagram

Fecha: 01-11-2026

## Cambio solicitado

- Reemplazada la sección pública **Propiedades destacadas** por el feed de Instagram `@pbb.corretajes`.
- Integrado Behold con `feed-id="2b1hL3USdf73VjO14AzL"`.
- Menú y pie cambiados de **Propiedades** a **Instagram**.
- Agregado enlace directo a `https://www.instagram.com/pbb.corretajes/`.
- El panel privado de propiedades se mantiene para conservar la información ya guardada.
- La página pública dejó de consultar la colección `properties`, reduciendo lecturas de Firestore.

## Validaciones realizadas

- `node --check public/app.js`: correcto.
- HTML parseado y verificado: existe una sola sección `#instagram` y un solo `behold-widget` con el feed ID solicitado.
- Confirmado que ya no existe `#props-grid` ni la antigua sección pública `#propiedades`.
- Prueba automatizada en Chromium a 1440×1000 y 390×844.
- En la prueba se interceptó únicamente el archivo externo de Behold con un stub equivalente, porque el entorno de ejecución no dispone de resolución DNS externa para `w.behold.so`.
- La carga del widget, responsive y JavaScript de la página pasaron sin errores.

## Importante

La publicación real en Firebase cargará directamente `https://w.behold.so/widget.js`, exactamente como fue entregado por la usuaria. Si un navegador bloquea scripts de terceros, la sección incluye un enlace directo a `@pbb.corretajes` como respaldo.
