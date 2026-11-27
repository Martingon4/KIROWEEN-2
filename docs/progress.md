# Avance del desarrollo

## Propuestas de construcción desde una foto (27 nov 2026)

- La revisión visual de la foto aportada mostró que la propuesta anterior parecía un parque con bancas. Se reemplazaron los dos bocetos automáticos por construcciones conceptuales: A, módulo comunitario cerrado con puerta, ventanas, cubierta y acceso; B, pabellón público abierto con estructura, cubierta y estancia integrada. Ambos son hipotéticos y editables en el simulador de terreno. Las piezas nuevas no se ofrecen como objetos publicables en las ramas, cuyo catálogo de base de datos sigue siendo distinto.
- Cada tipología prueba tres huellas, de mayor a menor, para elegir la que cabe en el contorno y fuera del paso reservado. Los componentes complementarios se colocan solo cuando caben y no colisionan. Al actualizar un diseño guardado con el generador anterior, los objetos manuales válidos se consideran antes de ubicar la nueva estructura. La foto orienta el contorno y el contexto visible; no determina por sí sola el uso, la ingeniería ni los permisos de la construcción.
- En Node v24.22.3, `npm run typecheck` terminó con código 0. `npm run test:unit` aprobó 515 pruebas en 28 archivos. `npm run build` terminó con código 0 tras el último pulido de fachada y estancia. `git diff --check` terminó con código 0 antes de la documentación final.
- Con la primera build de este cambio, `npm run test:e2e -- tests/e2e/terrain.spec.ts --grep 'dos fotos de igual tamaño|ajusta una construcción|actualiza un boceto de foto' --workers=2 --retries=0 --reporter=list --output=/tmp/fork-city-building-e2e` pasó 6 de 6 casos en escritorio y a 360 px. Con la build final, un spec temporal con la foto exacta del usuario pasó 2 de 2 casos y produjo capturas de ambas alternativas en escritorio y móvil. El spec temporal se retiró. Se revisaron visualmente las capturas finales. No se ejecutó `check:ci` completo en este cambio.

## Corrección del diseño asistido por foto (27 nov 2026)

- La captura aportada por el usuario muestra un campo abierto y árboles al fondo. El flujo anterior calculaba una sola cubierta que visualmente parecía una mesa. Además, el borde oscuro de la captura podía confundirse con suelo, y el alto de la franja de césped en píxeles se trataba como profundidad real.
- La lectura local omite ese borde cuando busca suelo, propone un contorno editable y parte de una escala explícitamente aproximada de 10 × 10 m. Si reconoce una franja verde bajo el cielo, representa el arbolado de fondo como contexto aproximado y separado de las intervenciones. El suelo del visor toma el color de la zona visible aunque no se cargue el modelo opcional de profundidad.
- Se generan dos bocetos hipotéticos distintos según la geometría disponible: B, mostrado primero, combina árboles, bancas y mobiliario; A combina cubierta, bancas y mobiliario. Se validan las huellas, la separación entre piezas y el paso reservado. El selector y el enfoque individual permanecen. Una revisión guardada con el antiguo generador se actualiza al abrirla, conservando los objetos manuales válidos. La foto y la captura de prueba no se copiaron al repositorio.
- En Node v24.22.3, `npm run lint`, `npm run typecheck`, `npm run test:unit` (513 pruebas en 28 archivos), `git diff --check` y `npm run build` salieron con código 0 durante la implementación. Se repitió `npm run build` con éxito después de los últimos cambios de interfaz. Los primeros intentos de Playwright con `CI=1` no arrancaron el servidor porque el entorno aislado bloqueó el puerto interno del cargador CSS; la compilación directa y Playwright contra `npm run start -- --port 3100` funcionaron al habilitar puertos locales.
- Antes del ajuste final de alternativa inicial, `npm run test:e2e -- tests/e2e/terrain.spec.ts tests/e2e/photo-field.temporary.spec.ts --workers=2 --retries=0 --reporter=list --output=/tmp/fork-city-field-final-e2e` aprobó 26 de 26 casos. Una ejecución posterior aprobó 24 de 26: los dos fallos asumían que volver al contorno restauraba A, mientras la nueva pantalla mostraba B. Se corrigió la conservación de la alternativa elegida y el spec. Sobre la última build, `npm run test:e2e -- tests/e2e/terrain.spec.ts tests/e2e/photo-field.temporary.spec.ts --grep 'la foto aportada|ajusta una cubierta' --workers=2 --retries=0 --reporter=list --output=/tmp/fork-city-photo-variant-final` pasó 4 de 4 casos en escritorio y a 360 px, sin reintentos. El spec temporal se retiró. No se ejecutó `check:ci` completo después de estos cambios.
- Tras retirar el spec temporal, `npm run lint`, `npm run typecheck` y `git diff --check` salieron con código 0. `curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3100/es/terrain` devolvió HTTP 200 con el servidor de producción local activo.
- `npm run test:e2e -- tests/e2e/terrain.spec.ts --grep 'actualiza un boceto de foto' --workers=2 --retries=0 --reporter=list --output=/tmp/fork-city-photo-legacy-final` pasó 2 de 2 casos, en escritorio y a 360 px. Confirmó que un diseño guardado con el generador anterior se actualiza y conserva el objeto añadido manualmente.
- La vista sigue siendo un boceto 3D orientado por el contorno y colores de una sola foto. No recupera medidas reales, edificios ocultos ni una réplica fotogramétrica de 360°. La persona debe revisar el contorno, las medidas, el arbolado aproximado y cada intervención.

## Cubierta ajustada al terreno desde una foto

- El simulador propone un contorno editable a partir de la región de color conectada con el primer plano. Si la señal es débil, invita a revisar y redibujar el contorno aproximado. La cubierta se calcula después de confirmar el terreno.
- Dos puntos y un ancho opcionales reservan un paso. El cálculo prueba rectángulos en varias orientaciones, valida la huella dentro del contorno y mantiene libre el paso. Si cambia el contorno, la escala o el paso, vuelve a calcular la cubierta. La vista en planta y la perspectiva muestran la reserva y conservan la propuesta hipotética en el navegador.
- En Node v24.22.3, `CI=1 npm run test:e2e -- tests/e2e/terrain.spec.ts --workers=2 --retries=0 --reporter=list --output=/tmp/fork-city-photo-fit-e2e` pasó los 24 casos de terreno en escritorio y a 360 px. Se comprobaron contornos y cubiertas distintos para dos fotos del mismo tamaño, el recálculo al reservar un paso con el teclado y la persistencia del relieve estimado con el modelo local.
- En la versión final pasaron `npm run lint`, `npx --no-install vitest run tests/unit/terrain-model.test.ts` (30 pruebas) y `git diff --check`. `npm run build && npm run start -- --port 3100` dejó el simulador activo con HTTP 200. `npm run test:e2e -- tests/e2e/terrain.spec.ts --grep 'dos fotos de igual tamaño|ajusta una cubierta' --workers=2 --reporter=list --output=/tmp/fork-city-photo-fit-final` pasó 4 de 4 casos en escritorio y a 360 px, incluido el aviso para un terreno demasiado estrecho.

## Visibilidad de intervenciones en la vista general 3D

- La vista general conserva la escala de los modelos. Cuando una intervención ocupa menos de 24 píxeles en su dimensión visible mayor, aparece un marcador anclado. Los marcadores próximos se agrupan y el selector de enfoque está disponible desde la vista general. Enfocar una intervención muestra su nombre y resalta su huella.
- El editor de ramas del Zócalo muestra el recorte local de OpenStreetMap con colores tenues, alturas aproximadas y atribución visible. La cámara general encuadra la plaza y el entorno se oculta durante el enfoque individual.
- En Node v24.22.3 pasaron `npm run lint`, `npm run typecheck`, `git diff --check` y `npx --no-install vitest run tests/unit/terrain-model.test.ts` con 29 pruebas unitarias.
- `CI=1 npm run test:e2e -- tests/e2e/editor.spec.ts tests/e2e/terrain.spec.ts tests/e2e/overview-capture.temporary.spec.ts --grep 'elige modelos individuales|dibuja diez puestos|coloca mobiliario con teclado|muestra calles y edificios|conserva el recorte|captura la vista general' --workers=2 --retries=0 --reporter=list --output=/tmp/fork-city-overview-check` pasó 11 casos entre escritorio y 360 px. La segunda ejecución del caso de captura se omitió por diseño, pues el caso de escritorio produjo ambos tamaños. La revisión de la captura móvil motivó compactar los controles.
- `npm run build && npm run start -- --port 3100` dejó activa la versión final. Sobre esa compilación, `npm run test:e2e -- tests/e2e/editor.spec.ts tests/e2e/terrain.spec.ts tests/e2e/overview-capture.temporary.spec.ts --grep 'elige modelos individuales|coloca mobiliario con teclado|captura la vista general' --workers=2 --reporter=list --output=/tmp/fork-city-overview-confirm` pasó 5 casos. Se omitió por diseño la ejecución duplicada de las capturas. Se comprobó el selector en español e inglés, el enfoque desde marcadores, el retorno a la vista general, 0 px de desbordamiento en las capturas de 1440 y 390 px y ningún hallazgo grave o crítico de axe en el visor capturado a 390 px. Se eliminó el spec temporal.

## Validación aislada de los cambios locales

- Las suites de comunidad, expedientes, bifurcación y publicación obtienen el contenedor PostgreSQL del `project_id` de `supabase/config.toml`. El nombre fijo anterior apuntaba al contenedor de desarrollo incluso cuando Playwright trabajaba con una copia.
- La copia incluyó los archivos de trabajo actuales y excluyó `.env.local` y las dependencias instaladas. En Node v24.22.3, `npm ci --prefer-offline` instaló las dependencias. Se cambiaron solo los puertos del entorno de prueba y el identificador de Supabase en esa copia. El navegador usó el puerto 3120 y la base 56422.
- En la copia pasaron `DO_NOT_TRACK=1 /home/martin/KIROWEEN-2/node_modules/.bin/supabase start`, `DO_NOT_TRACK=1 npx --no-install supabase db reset --local`, `npm run configure:local` y `npm run provision:local`. El reinicio aplicó todas las migraciones, incluida `20261126040000_compare_overlap_summary.sql`, y se crearon las tres cuentas de prueba.
- La primera ejecución de `CI=1 npm run check:ci -- --workers=3 --reporter=list --output=/tmp/fork-city-ci-DFNHG7-playwright` aprobó 507 unitarias y 2851 pruebas pgTAP. Playwright arrancó con dos trabajadores porque el script anidado interpretó las opciones como configuración de npm. Se interrumpió con 60 aprobadas, 3 fallos de bifurcación, 1 caso en curso y 116 sin ejecutar. Los casos de moderación preparaban sus publicaciones en la copia y buscaban sus identificadores en el contenedor equivocado.
- Tras corregir los cuatro archivos que acceden a PostgreSQL directamente, se repitieron `DO_NOT_TRACK=1 npx --no-install supabase db reset --local` y `npm run provision:local`. Con tres trabajadores configurados solo en la copia, `CI=1 npm run check:ci` regresó código 0. Pasaron lint, tipos, 507 unitarias en 28 archivos, los controles solar y de apoyo, build y 2851 pruebas pgTAP en 25 archivos. De los 180 casos de Playwright, 174 pasaron al primer intento, 3 al reintentar y 3 se omitieron. Se omitió por diseño la prueba móvil de límite de uso y faltó instalar el modelo opcional de relieve para sus dos casos. Los casos que requirieron reintento fueron la carga de MapLibre en escritorio y el recorrido de accesibilidad de fusión en los dos proyectos.
- La verificación de MapLibre espera hasta 15 s a que el mapa local esté listo, y el recorrido de accesibilidad de fusión dispone de hasta 60 s para preparar las ramas y ejecutar axe dos veces. Con los tiempos ajustados, `CI=1 npm run test:e2e -- tests/e2e/catalog.spec.ts tests/e2e/merge.spec.ts --grep 'loads the local MapLibre enhancement|la página de fusión es accesible' --workers=3 --retries=0 --repeat-each=2 --reporter=list --output=/tmp/fork-city-ci-DFNHG7-timing` pasó 8 de 8 casos en escritorio y a 360 px.

## Colocación, enfoque individual y resumen de comparación

- El editor reúne la selección, el plano y la colocación. Las flechas mueven cualquier intervención desde el botón de colocar, y las coordenadas quedan en un panel opcional. El siguiente paso lleva a guardar o publicar según el estado de la rama.
- Cada intervención tiene una acción para abrir su encuadre 3D. El visor mantiene el enfoque por objeto y el retorno a la vista general. La interfaz explica qué intervenciones aportan a la sombra modelada y cómo se presenta el mobiliario sin precio.
- La comparación presenta primero los posibles conflictos de espacio, la diferencia de sombra y el costo ilustrativo por alternativa. La lectura de solapamientos usa PostGIS y las reglas espaciales de fusión, con las mismas comprobaciones de acceso a las revisiones.
- En Node v24.22.3 pasaron `npm run lint`, `npm run typecheck`, `npm run test:unit` (507 pruebas en 28 archivos), `npm run check:solar`, `npm run check:support` y `git diff --check`. `DO_NOT_TRACK=1 npx --no-install supabase migration up --local` aplicó la migración `20261126040000_compare_overlap_summary.sql` a la base de desarrollo existente.
- `DO_NOT_TRACK=1 npm run test:db` pasó las 2851 pruebas pgTAP en 25 archivos al ejecutarlo después de Playwright. La primera ejecución en paralelo falló en una aserción que contaba revisiones mientras las pruebas de navegador estaban creando ramas.
- La primera corrida de navegador se interrumpió al comprobar que había reutilizado una compilación anterior. Con el puerto 3100 libre, `CI=1 npm run test:e2e -- tests/e2e/editor.spec.ts tests/e2e/compare.spec.ts tests/e2e/merge.spec.ts --workers=2 --retries=0 --reporter=list --output=/tmp/fork-city-flow-final` compiló y pasó 62 de 64 casos. Los dos fallos de accesibilidad correspondían al nombre del nuevo botón «Ver en 3D» en escritorio y a 360 px. Se ajustó la etiqueta para incluir el texto visible en ambos idiomas.
- `npm run build && npm run start -- --port 3100` dejó activa la compilación corregida. `curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3100/es` devolvió HTTP 200. `npm run test:e2e -- tests/e2e/editor.spec.ts tests/e2e/compare.spec.ts tests/e2e/merge.spec.ts --grep 'guarda una revisión desde el formulario|elige modelos individuales|el editor no tiene hallazgos graves|la API de fusión: vista previa|la persona participante publica' --workers=2 --reporter=list --output=/tmp/fork-city-flow-confirm` pasó 10 de 10 casos en Chromium de escritorio y a 360 px, incluidos los dos casos de accesibilidad y la coincidencia de superficie entre comparación y fusión.

## Enfoque por objeto y paleta de la rama

- **Enfocar modelos** encuadra una intervención a la vez. Si hay varias, el usuario puede cambiar de objetivo por nombre con **Objeto a enfocar**. La distancia se calcula con las dimensiones del objeto elegido. **Ver todo el terreno** recupera el encuadre y el zoom generales.
- La paleta y el selector de la rama ofrecen nueve objetos para nuevas intervenciones, además de las cuatro intervenciones originales. Los objetos que ya estaban guardados siguen siendo compatibles con el editor y el visor.
- En Node v24.22.3, `npm run lint`, `git diff --check` y `npx --no-install vitest run tests/unit/terrain-model.test.ts` salieron con código 0. Pasaron 28 pruebas unitarias, incluida la comprobación de que un segundo objeto lejano no altera el encuadre de una banca.
- `npm run build && npm run start -- --port 3100` dejó activa la nueva versión local. `npm run test:e2e -- tests/e2e/editor.spec.ts tests/e2e/terrain.spec.ts --grep 'elige modelos individuales|coloca mobiliario en una rama|dibuja diez puestos|coloca mobiliario con teclado' --workers=2 --reporter=list` pasó 8 casos en escritorio y a 360 px. Se verificaron las nueve opciones de la paleta, el cambio de un escenario a una banca en el enfoque, el retorno a la vista general y el giro del mercado. `npm run test:e2e -- tests/e2e/branch-focus.temporary.spec.ts --project=chromium --workers=1 --reporter=list` pasó, se revisó visualmente la captura de la banca a 1440 px y se retiró el spec temporal.

## Catálogo de objetos en el editor de ramas

- El selector **Tipo de intervención** ahora muestra los 16 objetos por nombre en cuatro categorías, además de las cuatro intervenciones originales. Elegir o agregar un objeto desde el formulario mantiene abierta la perspectiva 3D. Un botón permite volver al plano para elegir la ubicación con el puntero.
- Para este ajuste, `npm run lint`, `git diff --check` y `npm run build` pasaron en Node v24.22.3. `npm run test:e2e -- tests/e2e/editor.spec.ts --grep 'elige modelos individuales|coloca mobiliario en una rama|colocar con un clic|el editor no tiene hallazgos graves' --workers=2 --reporter=list` pasó 8 casos en escritorio y a 360 px. La prueba nueva verificó las 20 opciones, los cuatro grupos, el escenario y la banca dibujados en el visor al agregarlos y el retorno al plano para elegir la ubicación.
- `npm run test:e2e -- tests/e2e/editor.spec.ts --grep 'dibuja diez puestos' --workers=1 --reporter=list` pasó los dos casos de enfoque, giro y retorno a la vista general en escritorio y a 360 px.
- El editor de ramas ofrece **Colocar objetos** junto a **Vista previa 3D**. La paleta reutiliza los 16 modelos de mobiliario y equipamiento del simulador, con miniaturas, medidas y categorías. El usuario puede arrastrar una ficha al plano o elegir su posición y confirmar desde el formulario. Las flechas sobre el botón de agregar o editar mueven el marcador. Se guardan el modelo, la altura y la huella como una intervención hipotética de la revisión.
- Se valida la huella de catálogo en el servidor y se rechazan cruces entre objetos, con un tronco o con un mercado. La fusión trata esos solapamientos como conflictos. El catálogo de costos registra estos objetos como cantidades sin precio, por lo que el costo queda marcado como parcial.
- En Node v24.22.3, `DO_NOT_TRACK=1 npx --no-install supabase migration up --local` aplicó las migraciones `20261126020000` y `20261126030000` en la base de desarrollo. `DO_NOT_TRACK=1 npm run test:db` pasó 2851 comprobaciones en 25 archivos. La aplicación local se recompiló y arrancó con `npm run build && npm run start -- --port 3100`.
- `npm run lint`, `npm run typecheck` y `git diff --check` terminaron con código 0. `npm run test:unit` pasó 506 pruebas en 28 archivos.
- `npm run test:e2e -- tests/e2e/editor.spec.ts --workers=2 --reporter=list` pasó 33 de 34 casos, incluidos el guardado, publicación, comparación y bifurcación de la misma rama con objetos en ambos tamaños. La prueba del giro del mercado agotó la espera en escritorio. `npm run test:e2e -- tests/e2e/editor.spec.ts --project=chromium --grep 'dibuja diez puestos' --reporter=list --workers=1` aprobó ese caso con una espera mayor para el renderizador. El resultado acumulado es de 34 casos aprobados.
- Tras ajustar la altura de las fichas y hacer visible el centro de la huella, `npm run test:e2e -- tests/e2e/editor.spec.ts --grep 'coloca mobiliario en una rama|colocar con un clic' --workers=2 --reporter=list` pasó los 4 casos en escritorio y a 360 px. `npm run test:e2e -- tests/e2e/branch-objects.temporary.spec.ts --project=chromium --workers=1 --reporter=list` comprobó el arrastre y generó una captura a 1440 px. Se revisó la captura y se eliminó el spec temporal.

## Interfaz de colocación y ampliación del catálogo

- El simulador presenta un catálogo con miniaturas de los modelos, medidas y filtro por categoría. El plano cenital indica el norte y dibuja la huella del objeto antes de colocarlo. La selección, la acción de colocar y el estado de la operación tienen un lugar fijo junto al plano. Después de colocar una pieza, el usuario puede abrir la perspectiva desde el mismo panel.
- El catálogo contiene 18 objetos hipotéticos. Se añadieron rampa, bolardo, bebedero, mesa de ping-pong, tobogán y escenario con geometrías propias y dimensiones de ejemplo. Los objetos usan el mismo flujo de colocación por arrastre, toque o teclado y el mismo guardado local por alternativa.
- En Node v24.22.3, `npm run lint` y `npm run typecheck` salieron con código 0. `npm run test:unit` pasó 505 pruebas en 28 archivos y `npm run build && npm run start -- --port 3100` dejó activa la compilación de producción local.
- `npm run test:e2e -- tests/e2e/terrain.spec.ts tests/e2e/compare.spec.ts --workers=2 --reporter=list` pasó 37 de 38 casos. A 360 px, la primera prueba de arrastre desplazaba la paleta fuera de la ventana antes de comenzar el gesto. Se ajustó la posición de la ventana para dejar ambos extremos visibles y `npm run test:e2e -- tests/e2e/terrain.spec.ts --grep 'plano cenital admite' --workers=1 --reporter=list` aprobó los dos tamaños. En conjunto aprobaron los 38 casos.
- Tras compactar las fichas móviles, los dos casos de colocación y guardado aprobaron en ambos tamaños. Al repetir el arrastre en paralelo, el desplazamiento animado de la página pudo mover el punto inicial medido por la prueba. El caso ahora espera la tipografía y comprueba ambos puntos en la misma ventana con desplazamiento inmediato. `npm run test:e2e -- tests/e2e/terrain.spec.ts --grep 'plano cenital admite' --workers=2 --repeat-each=2 --reporter=list` pasó los 4 casos en la compilación final.
- La prueba temporal de capturas `npm run test:e2e -- tests/e2e/terrain-interface.temporary.spec.ts --project=chromium --workers=1 --reporter=list` pasó. Se revisaron el plano, la paleta y las fichas compactas a 1440 y 390 px. La prueba confirmó 0 px de desbordamiento horizontal a 390 px y el archivo temporal se retiró.

## Paleta del terreno y entorno de OpenStreetMap

- El simulador de terreno ofrece 12 objetos hipotéticos y filtros de sombra, mobiliario y recreación. Añadió mesa de pícnic, sombrilla, farola, estacionabicis, bote de basura, fuente, columpio y puesto de mercado. Los objetos se pueden colocar por arrastre, toque o teclado, mover desde su ficha y recuperar del guardado local. La simulación comprueba la huella y evita cruces a nivel de piso, incluidos el tronco y el puesto. Permite poner mobiliario bajo una cubierta cuando no coincide con un apoyo. La sombrilla y el puesto tienen sombra modelada.
- La perspectiva puede mostrar calles, senderos y edificios de OpenStreetMap. Usa el recorte incluido cerca del Zócalo y puede consultar Overpass al activar la capa en un terreno con ubicación. La posición y las alturas son aproximadas. Las consultas de lectura al servicio en línea desde este entorno devolvieron HTTP 406, HTTP 502 o agotaron el tiempo de espera. [Fuentes y límites](data-sources.md#entorno-cartográfico-del-zócalo).
- En Node v24.22.3, `npm run check` completó lint, tipos, 499 pruebas unitarias en 28 archivos, controles solar y de apoyo y compilación. Se inició el servidor de producción con `npm run start -- --port 3100`.
- `npm run test:e2e -- tests/e2e/terrain.spec.ts tests/e2e/compare.spec.ts --workers=2 --reporter=list` pasó 32 de 36 casos. Pasaron los 16 de comparación y las pruebas de consulta simulada y recorte local de OpenStreetMap en ambos tamaños. El selector del aviso de ocupación coincidía también con el anunciador de rutas de Next.js. Al cambiar de alternativa, la vista reiniciaba el encuadre. Se ajustó el selector y se corrigió la conservación de la cámara.
- Tras recompilar con `npm run build && npm run start -- --port 3100`, `npm run test:e2e -- tests/e2e/terrain.spec.ts --workers=2 --reporter=list` pasó los 20 casos del terreno en escritorio y a 360 px. Se verificaron la paleta, el rechazo de la colisión, el movimiento con el teclado, la recuperación después de recargar, la cámara y las dos respuestas de OpenStreetMap. `git diff --check` salió con código 0.
- `npm run test:e2e -- tests/e2e/terrain-neighborhood.temporary.spec.ts --project=chromium --workers=1 --reporter=list` pasó 1 prueba. Se revisaron visualmente los 12 objetos y el entorno del Zócalo en capturas con una ventana de 1440 px. Se retiró el spec temporal.

## Objetos detallados y giro de la vista 3D

- La perspectiva orbital carga modelos GLB locales de árboles, bancas, jardineras y puestos. El editor de ramas dibuja los puestos de cada mercado hipotético dentro de su contorno a partir del área por módulo y muestra cuántos pudo representar. La distribución es ilustrativa. El simulador de terreno representa las bancas y jardineras que se agregan en planta. Los créditos y la licencia CC0 constan en [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- El usuario puede enfocar los modelos, recuperar el encuadre de todo el terreno y activar o pausar la rotación continua. La rotación comienza apagada. El arrastre y las flechas permiten ajustar la cámara manualmente y detienen el giro si estaba activo.
- En Node v24.22.3, `npm run build && npm run start -- --port 3100` compiló e inició el servidor de producción local. Se verificó HTTP 200 en las rutas `/es`, `/es/terrain`, `/en/terrain` y en los tres nuevos GLB.
- `npm run lint`, `npm run typecheck` y `git diff --check` salieron con código 0. `npx --no-install vitest run tests/unit/terrain-model.test.ts` pasó 9 pruebas en 1 archivo.
- `npm run test:e2e -- tests/e2e/editor.spec.ts tests/e2e/terrain.spec.ts --grep 'dibuja diez puestos|muestra la intervención en 3D|coloca mobiliario|conserva el encuadre' --workers=2 --reporter=list` pasó 8 pruebas en Chromium de escritorio y a 360 px. Se verificaron los diez puestos, el enfoque y el regreso al encuadre general, el giro y su pausa, la colocación de mobiliario por teclado y el cambio entre la foto original y la propuesta. Las primeras ejecuciones comparaban el dibujo antes de que se estabilizara el renderizador y obtuvieron 5 y 7 aprobadas de 8. La ejecución final espera la carga de los modelos y comprueba la vista fotográfica sin el estimador opcional de profundidad, que tiene su propio caso.
- `npm run test:e2e -- tests/e2e/terrain-assets.temporary.spec.ts --project=chromium --workers=1 --reporter=list` pasó 1 prueba. Se revisaron las capturas del mercado en una ventana de 1440 px y del mobiliario en una de 390 px. Se retiró el spec temporal. Queda pendiente un `check:ci` completo para esta versión local.

## Ocupación del mercado y mapa de referencia

- El catálogo carga un recorte local y parcial de OpenStreetMap en MapLibre y en la alternativa esquemática. El recorte contiene calles, vías peatonales, cruces y edificios. Los datos de origen, la licencia y los hashes están en [data-sources.md](data-sources.md).
- El editor y la base de datos bloquean nuevos cruces entre el tronco de un árbol y la huella de un mercado, incluido su borde. La fusión comprueba ese caso y la invasión de cruces peatonales propuestos según su ancho modelado. Las revisiones históricas conservan sus datos. La fusión resalta en el mapa las intervenciones con conflictos pendientes.
- En Node 24, `DO_NOT_TRACK=1 npx --no-install supabase migration up --local` aplicó `20261126010000_market_occupancy.sql` a la base de desarrollo en el puerto 54322. `DO_NOT_TRACK=1 npm run test:db` pasó 2845 pruebas en 24 archivos. Pasaron `npm run lint`, `git diff --check` y la compilación con `npm run build && npm run start -- --port 3100`, incluida la comprobación de TypeScript.
- `npm run test:e2e -- tests/e2e/catalog.spec.ts tests/e2e/editor.spec.ts tests/e2e/merge.spec.ts --grep 'bloquea un árbol|historia: fusiona la propuesta B|local MapLibre enhancement|preserves the schematic|fits a 360 pixel' --reporter=list --workers=2` pasó 10 pruebas en escritorio y a 360 px. Se comprobó el rechazo desde el formulario y la API, el guardado tras mover el árbol, el resaltado en la fusión y el mapa con alternativa esquemática.

## Entrega de las Specs 01–05

- GitHub Actions informó `success` para el push de `81e7fdd977595d578139c885c8eaccd5340925df`. Consulta de solo lectura con `gh run list --repo Martingon4/KIROWEEN-2 --workflow ci.yml --limit 5 --json databaseId,headSha,status,conclusion,event,url`. [Ejecución 45466384450](https://github.com/Martingon4/KIROWEEN-2/actions/runs/45466384450).
- El candidato local incorpora la separación visual de la lista de ramas y el material de la [Spec 06](../.kiro/specs/06-delivery/design.md). Para comprobarlo se creó una copia de `81e7fdd` y una instancia local de Supabase independiente. Playwright usó el puerto 3110 y la base de pruebas el 55422. La configuración temporal del entorno se excluye del candidato.
- En Node v24.22.3 se ejecutó `npm ci --prefer-offline`. Después de `supabase db reset`, `npm run configure:local` y `npm run provision:local`, `npm run check:ci -- --reporter=list` pasó lint, typecheck, 478 pruebas unitarias en 27 archivos, los controles solar y de apoyo, build y 2835 pruebas pgTAP en 24 archivos. El proceso salió con código 143 durante Playwright. Se corrigió el ancho del botón de las ramas a 390 px y se compiló de nuevo con `npm run build` antes de repetir Playwright.
- `node scripts/capture-release.temporary.mjs` aprovisionó cuentas locales exclusivas para capturas y ejecutó el spec temporal en Chromium. Pasó una prueba integrada y produjo las [14 capturas](kiro-evidence.md#capturas-de-entrega). El primer intento había encontrado dos opciones que coincidían con el selector genérico «Redibujar». La segunda ejecución eligió explícitamente el mercado. Una consulta anónima con `curl` confirmó HTTP 200 para las dos portadas localizadas, la comparación, el expediente y la descarga HTML.
- Después del segundo reset del entorno aislado y de la recompilación, `npm run test:e2e -- --grep-invert 'recorrido de entrega y capturas' --workers=3 --reporter=list` ejecutó 146 casos en 9,1 min. Pasaron 144, se omitió por diseño la prueba móvil de límite de uso y falló la espera de 5 s para MapLibre en escritorio. El caso pasó con `npm run test:e2e -- tests/e2e/catalog.spec.ts --project=chromium --grep 'loads the local MapLibre' --workers=1 --reporter=list --output=/tmp/fork-city-map-recheck`. Resultado acumulado: 145 casos aprobados y 1 omitido. Se retiraron los archivos temporales de captura.

## Vista 3D en el editor de ramas

- El editor puede alternar entre planta y perspectiva 3D. La perspectiva usa las coordenadas y dimensiones de las intervenciones de la rama, incluidos los cambios sin guardar. Dibuja árboles y cubiertas con volumen, el mercado como superficie y el cruce a ras de suelo. La cámara gira con arrastre o teclado.
- En Node v24.22.3, `npm run typecheck` y `npm run lint` terminaron con código 0. `npx --no-install vitest run tests/unit/terrain-model.test.ts` pasó 9 pruebas. En el primer intento de Playwright, el servidor anterior respondió y las dos comprobaciones del nuevo botón agotaron su tiempo. Se cerró ese proceso y se ejecutó `npm run build && npm run start -- --port 3100`.
- Con la compilación nueva, `npm run test:e2e -- tests/e2e/editor.spec.ts tests/e2e/terrain.spec.ts --grep 'muestra la intervención en 3D|genera dos alternativas' --reporter=list --workers=2` pasó 4 pruebas. Se comprobaron el dibujo al agregar y deshacer, el giro con teclado, el retorno a planta y la generación de propuestas desde una foto en Chromium de escritorio y a 360 px.

## Captura asistida de terrenos

- La página «Tus ramas» enlaza al simulador con foto en el mismo idioma. En Node v24.22.3 pasaron `npm run lint` y `git diff --check`. `CI=1 npm run test:e2e -- tests/e2e/editor.spec.ts --grep 'la lista de ramas enlaza al editor y al simulador con foto' --workers=2 --retries=0 --reporter=list --output=/tmp/fork-city-branch-photo-link` compiló y pasó los 2 casos en escritorio y a 360 px. Se comprobó el acceso al editor existente y la navegación al selector de foto en español y al simulador en inglés.

- Para comprobar el acceso al prototipo desde la aplicación local, las solicitudes HEAD a `http://127.0.0.1:3100/es/terrain` y al archivo `/terrain-model/depth-anything-v2-small.onnx` devolvieron HTTP 200. En Node v24.22.3, `npm run test:e2e -- tests/e2e/terrain.spec.ts --project=chromium --grep 'genera dos alternativas automáticamente|estima el relieve con el modelo local' --workers=1 --reporter=list --output=/tmp/fork-city-photo-account-check` pasó 2 pruebas. Se verificaron las alternativas al elegir una foto y la conservación de la malla de relieve al guardar.

- En el simulador experimental, la paleta admite bancas y jardineras además de árboles y cubiertas. El mobiliario tiene huellas a escala, altura editable y modelos con asiento, respaldo y vegetación. Se puede colocar en planta y guardar por alternativa en el navegador. El modelo solar calcula las sombras de árboles y cubiertas. El visor orbital ahora ajusta la altura con arrastre vertical o con las flechas arriba y abajo.
- En Node v24.22.3, `npm run lint` y `git diff --check` terminaron con código 0. Pasaron las 9 pruebas de `npx --no-install vitest run tests/unit/terrain-model.test.ts`. `npm run build && npm run start -- --port 3100` compiló, completó TypeScript y levantó el simulador local.
- `npm run test:e2e -- tests/e2e/terrain.spec.ts --workers=2 --reporter=list` terminó con 13 pruebas aprobadas y una espera agotada en la vista fotográfica móvil. El caso pasó al repetirlo con `npm run test:e2e -- tests/e2e/terrain.spec.ts --project=mobile-360 --grep 'conserva el encuadre' --workers=1 --reporter=list --output=/tmp/fork-city-terrain-photo-recheck`. Los 14 casos aprobaron entre ambas corridas. La nueva prueba comprobó el dibujo del mobiliario, la inclinación con teclado y la recuperación de ambos objetos en escritorio y a 360 px.
- La vista desde la foto conserva el encuadre y usa una estimación de profundidad para que los detalles fotografiados puedan ocultar partes del árbol y la cubierta propuestos. Las propuestas se apoyan en el primer plano estimado. El visor carga un álamo de tevy y mapas de madera de Poly Haven desde el proyecto local. Ambos recursos tienen licencia CC0. La comparación Foto original / Ver propuesta mantiene la cámara fija. La perspectiva orbital conserva la reconstrucción aproximada.
- En Node v24.22.3, `npm run lint`, `npm run typecheck` y `git diff --check` finalizaron con código 0. `npx --no-install vitest run tests/unit/terrain-model.test.ts` pasó 9 pruebas. Playwright reportó 28 pruebas pasadas con `npm run test:e2e -- tests/e2e/terrain.spec.ts tests/e2e/compare.spec.ts --reporter=list --workers=3` antes del ajuste final de colocación. La sesión terminó con código 143 después de imprimir el resumen.
- La versión final se compiló con `npm run build && npm run start -- --port 3100`. `npm run lint && git diff --check` finalizó con código 0. El servidor devolvió HTTP 200 para las rutas de terreno en español e inglés y para el GLB, la textura de madera y el transcodificador. `npm run test:e2e -- tests/e2e/terrain.spec.ts tests/e2e/terrain-photo-capture.temporary.spec.ts --grep 'conserva el encuadre|foto de un patio' --reporter=list --workers=3 --output=/tmp/fork-city-photo-release-results` pasó 6 pruebas con código 0. Se comprobó la carga del álamo, la profundidad local, la comparación y la ausencia de desbordamiento. Las capturas de 1440 y 390 px se verificaron con la [foto CC0 del patio de Lan Su Chinese Garden, de Z3lvs](https://commons.wikimedia.org/wiki/File:Courtyard_pavilion_with_potted_plant_and_rock,_Lan_Su_Chinese_Garden.jpg). Se retiró el spec temporal.
- El visor de terreno genera una malla con relieve y colores a partir de la foto, con Depth Anything V2 Small y ONNX Runtime Web en el navegador. Los apoyos y el tronco se asientan sobre la malla. El ancho y el fondo se pueden calibrar con medidas reales. La sombra sigue usando un cálculo plano. El visor gira con mouse, toque o flechas y conserva los botones de acercamiento.
- En Node v24.22.3, `npm run setup:terrain-depth` descargó los pesos públicos y verificó su SHA-256. Se confirmó la salida del modelo `[1,224,280]` con una entrada `[1,3,224,280]`. Pasaron `npm run typecheck`, `npm run lint` y 9 pruebas de `npx --no-install vitest run tests/unit/terrain-model.test.ts`.
- `npm run test:e2e -- tests/e2e/terrain.spec.ts tests/e2e/compare.spec.ts --reporter=list --workers=2` pasó 26 pruebas con el modelo instalado. La prueba de relieve se repitió en ambas resoluciones con `npm run test:e2e -- tests/e2e/terrain.spec.ts --grep 'estima el relieve con el modelo local' --reporter=list --workers=2` y pasó 2 pruebas con calibración y guardado de 12 × 18 m. La prueba temporal de captura pasó a 1440 y 390 px y se retiró.
- La propuesta generada desde una foto se abre en perspectiva. La cámara se puede girar, acercar y alternar entre 1,65 m y una vista elevada. El visor dibuja el techo, los postes y las vigas de la cubierta, el tronco y la copa del árbol, y la foto proyectada sobre el suelo. La edición por arrastre sigue accesible desde la vista en planta.
- En Node v24.22.3, `npm run lint` y `npm run typecheck` finalizaron con código 0. `npx --no-install vitest run tests/unit/terrain-model.test.ts` pasó 8 pruebas, incluidas la geometría de la cubierta y la copa. `npm run test:e2e -- tests/e2e/terrain.spec.ts tests/e2e/compare.spec.ts tests/e2e/terrain-perspective-preview.temporary.spec.ts --reporter=list --workers=3` compiló y pasó 25 pruebas. La captura de 1440 y 390 px corrió una vez en Chromium y se omitió por diseño en el proyecto móvil. Se retiró el spec temporal.
- Elegir una foto abre dos propuestas de sombra ya construidas. El navegador muestrea el color y el contraste de la imagen, puntúa ubicaciones para árboles y cubiertas y comprueba que las huellas quepan dentro del contorno sugerido. La simulación conserva la foto local como referencia visual sobre una superficie plana aproximada.
- En Node v24.22.3, `npx --no-install vitest run tests/unit/terrain-model.test.ts` pasó 6 pruebas. Se comprobó que invertir la zona verde cambia la posición del árbol y que una imagen uniforme admite ambos objetos. Tras ajustar el diámetro inicial del árbol, `npm run test:e2e -- tests/e2e/terrain.spec.ts --reporter=list --workers=2` compiló y pasó 8 pruebas, incluida la generación inmediata de dos propuestas en Chromium y a 360 px.
- El croquis evita esquinas superpuestas y avisa cuando el usuario vuelve a marcar un punto. El contorno se cierra automáticamente. Un croquis válido puede abrirse con la escala aproximada de 10 m para el primer lado, con o sin foto. En Node v24.22.3 pasaron `npm run lint`, `npm run typecheck` y las 8 pruebas de `npm run test:e2e -- tests/e2e/terrain.spec.ts --reporter=list --workers=2`, incluida la regresión a 360 px.
- El recorrido con foto empieza con un contorno sugerido que se puede aceptar o redibujar sobre la imagen. La foto funciona como referencia tanto en el plano como sobre el suelo de la escena 3D. Los ajustes avanzados permiten introducir la medida y la ubicación. Al omitirlos, la simulación indica que usa un primer lado aproximado de 10 m y el sol de ejemplo de Puebla.
- En Node v24.22.3 pasaron `npm run lint`, `npm run typecheck` y las 4 pruebas de `npx --no-install vitest run tests/unit/terrain-model.test.ts`. `npm run test:e2e -- tests/e2e/terrain.spec.ts tests/e2e/compare.spec.ts --reporter=list --workers=3` compiló y pasó 22 pruebas, incluida la simulación a partir de una foto sin introducir medidas o ubicación en Chromium y a 360 px.
- Rutas `/es/terrain` y `/en/terrain`. El flujo crea un contorno en un croquis orientado al norte y lo escala con la medida real del primer lado. La foto opcional se visualiza desde un objeto local del navegador. El usuario proporciona la ubicación y la diferencia con UTC para el cálculo solar.
- El editor reutiliza la colocación de árboles y cubiertas de la vista 3D. Las alternativas A y B comparten contorno, fecha y hora. El diseño se guarda explícitamente en el navegador. La foto vive en la pestaña y el ejemplo hipotético se define por separado en `src/features/terrain/terrain-example.ts`.
- El modelo usa terreno plano y estima la sombra de los objetos añadidos. La geometría procede del croquis, con reconstrucción fotográfica e importación de mallas pendientes.
- En Node v24.22.3, `npm run lint`, `npm run typecheck`, `npm run test:unit` y `npm run check:solar` salieron con código 0. Pasaron 482 unitarias en 28 archivos, incluidas la calibración de escala, el rechazo de contornos inválidos, la validación de una cubierta en un contorno cóncavo y la coincidencia con el escenario solar curado de Puebla.
- `npm run test:e2e -- tests/e2e/terrain.spec.ts tests/e2e/compare.spec.ts --reporter=list --workers=2` compiló la aplicación y pasó 20 pruebas en Chromium y móvil de 360 px. Se comprobó la foto local, la geolocalización simulada, el dibujo del contorno, la colocación por teclado, el cambio entre alternativas, el guardado y la reapertura tras recargar. El primer intento había pasado 18 pruebas y fallado en el selector del control de alternativas. La repetición usó el nombre accesible del control.
- `npm run test:e2e -- tests/e2e/terrain-preview.temporary.spec.ts --project=chromium --reporter=list --output=/tmp/ftc-terrain-preview-results` pasó una prueba de captura del patio hipotético a 1440 y 390 px con 0 px de desbordamiento. Tras ajustar el encuadre, `npm run test:e2e -- tests/e2e/terrain.spec.ts tests/e2e/compare.spec.ts tests/e2e/terrain-preview.temporary.spec.ts --reporter=list --workers=3` pasó 21 pruebas. El proyecto móvil omitió por diseño la captura, que ya comprueba ambos tamaños en Chromium. El spec temporal se retiró.

## Simulación de sombra en 3D

- La vista 3D admite edición temporal de la escena. El usuario puede arrastrar árboles y cubiertas desde la paleta al suelo, elegir un punto con un toque, o usar las flechas y Enter para colocar. También puede cambiar alturas y eliminar objetos. La sombra dibujada responde a estas acciones. La cifra de superficie sigue vinculada a la revisión guardada.
- Para la colocación por arrastre, `npm run lint` y `npm run typecheck` salieron con código 0 en Node v24.22.3. `npm run test:e2e -- tests/e2e/compare.spec.ts --reporter=list --workers=2` pasó las 16 pruebas e incluyó arrastrar una cubierta y colocar un árbol por teclado en Chromium y a 360 px.
- Para esta edición, `npm run lint` y `npm run typecheck` salieron con código 0 en Node v24.22.3. `npm run test:e2e -- tests/e2e/compare.spec.ts --reporter=list --workers=2` compiló y pasó las 16 pruebas, incluidas la creación, el cambio de altura y la eliminación en Chromium y móvil de 360 px.
- La página de comparación permite elegir la revisión A o B y el escenario solar de las 10:00 o las 16:00 de Puebla. La vista esquemática muestra cubiertas y copas a su altura modelada y recorta sus sombras a la superficie de referencia. La cámara fija facilita comparar ambas revisiones.
- La migración `20261125070000_shade_scene.sql` lee la geometría métrica de la revisión completa mediante las mismas reglas de visibilidad de la comparación. El área de sombra que se muestra en texto sigue siendo la calculada por PostGIS. El modelo supone terreno plano y omite edificios.
- En Node v24.22.3, `DO_NOT_TRACK=1 npx --no-install supabase migration up --local` aplicó la nueva migración en la instancia local existente. `DO_NOT_TRACK=1 npm run test:db` salió con código 0: 2.840 aserciones pgTAP en 24 archivos.
- En Node v24.22.3, `npm run check` completó lint, tipos, 478 unitarias en 27 archivos y las comprobaciones solar y de apoyo. El intento de compilación en el entorno restringido terminó con código 1 porque Turbopack no pudo abrir un puerto local.
- `npm run test:e2e -- tests/e2e/compare.spec.ts --reporter=list --workers=2` salió con código 0 con los permisos locales requeridos por Turbopack. Playwright compiló la aplicación, arrancó el servidor de producción y pasó 16 pruebas en Chromium y móvil de 360 px. Verificó el cambio de horario por teclado, la conservación de una cubierta presente en las dos revisiones y la interfaz en español e inglés.
- `npm run test:e2e -- tests/e2e/shade-preview.temporary.spec.ts --project=chromium --reporter=list --output=/tmp/ftc-shade-preview-test-results` pasó una prueba de captura. La vista tuvo 0 px de desbordamiento horizontal a 1440 y 390 px. Se revisaron ambas capturas y se retiró el spec temporal.

## Current position

- Spec activa para la entrega: `06-delivery`. El candidato parte de las Specs 01–05 y las capturas del expediente se registran en la sección de entrega.
- Completed Specs: `01-foundation-place`, `02-editor-versions`, `03-analysis-compare-merge`, and `04-community-moderation`.
- Spec 01 task 8 is marked complete in Kiro (2026-11-22 12:09). Its hook firing is not yet evidenced: no `PostTaskExec` execution is recorded in the Kiro logs. See the hook note under Evidence and automation.
- Spec `03-analysis-compare-merge` covers FT-07, FT-08, FT-11, and FT-12. Spec `04-community-moderation` covers FT-09 and FT-10 and is closed with all seven tasks marked in `.kiro/specs/04-community-moderation/tasks.md`.
- Next Spec: `06` (FT-16 to FT-18: release, video, Devpost). It is not created yet.
- Submission deadline: December 4, 2026, 14:00 PST.
- Last update: 2026-11-22, Spec 04 closure.
- Local Supabase stack: running

## Delivered behavior

### Foundation and place catalog

- Spanish `/es` and English `/en` routes with correct document language.
- Plaza de la Constitución reference boundary from a retained OSM/Nominatim source capture.
- Separately labelled hypothetical shade and market fixtures.
- Server-rendered textual alternative plus a lazily loaded MapLibre WebGL enhancement.
- Controlled `?map=fallback` path proves that the geometry and list remain usable without the interactive map.
- `GET /api/v1/sites` and `GET /api/v1/sites/:slug` use allowlisted public schemas and stable errors.

### Database and authentication

- Supabase local stack with PostgreSQL 17 and PostGIS in `extensions`.
- Public site tables use RLS and expose an explicit `list_public_sites()` projection.
- Profiles, site roles, and private branches use RLS; another participant cannot discover a private branch.
- Operator role assignment is available only through a `SECURITY DEFINER` function granted to `service_role`.
- Local credentials are generated into mode-0600 `.env.local`, which is ignored by Git; two confirmed test users are provisioned without storing passwords in versioned files.
- Spanish and English sign-in routes validate inputs, return to a same-origin path, and avoid exposing account details in errors.

### Immutable version foundation

- Branch creation atomically writes a branch, initial immutable revision, head pointer, and idempotency result.
- Reusing a key with the same canonical payload returns the original IDs; different data returns a conflict.
- Revisions and revision features reject update/delete.
- Geometry supports Point, simple LineString, and Polygon without holes; a database trigger rejects features outside the pilot boundary.
- Authenticated `POST /api/v1/branches` validates origin, body size, JSON, schema, session, and idempotency key.
- The private branch dashboard and keyboard-operable form create and list owner-only branches.

### Editor and expected-head saves

- Form-based editor at `/es|en/branches/<branchId>` (`src/features/editor/branch-editor.tsx`) adds, edits, and deletes four types: `shade_tree` (Point), `shade_canopy` (Polygon), `temporary_market` (Polygon), and `proposed_crossing` (LineString).
- `parking_conversion` is rejected in v1 with `kind_not_supported` because no verifiable inventory exists for it.
- Coordinates are entered as text, `longitude, latitude`, one position per line. Polygons close automatically.
- An SVG preview draws points, lines, and polygons. Local undo and redo keep up to 100 steps.
- Unsaved drafts are stored in localStorage under a key scoped to account, site, and branch. Reloading offers recovery. Sign out deletes the drafts for that account. Leaving with unsaved changes shows a warning, and `beforeunload` guards the tab.
- `GET /api/v1/branches/:branchId` returns the owner's current head as GeoJSON. Other users receive 404.
- `POST /api/v1/branches/:branchId/revisions` requires an `Idempotency-Key` header and a body of `{expectedHeadId, message, features}`. A successful save returns 201 with `{data:{branchId,revisionId,parentRevisionId,featureCount}}`.
- Stable errors: 401 `authentication_required`, 404 `branch_not_found`, 409 `stale_head` (with `details.currentHeadId`), 409 `idempotency_conflict`, 422 with a validation `code` (for example `invalid_geometry`, `invalid_feature_properties`, `feature_outside_site`, `too_many_vertices`, `too_many_features`, `duplicate_feature_id`, `kind_not_supported`) and `details.featureIndex`, 413, and 400.
- Migration `20261122060000_save_revision.sql` adds the `SECURITY DEFINER` function `save_revision` and `get_branch_head`. It also changes `create_branch` to raise SQLSTATE `FT001` for a reused key with different data, instead of `23505`.
- Migration `20261122070000_save_revision_hardening.sql` applies the corrections from an independent review. A null snap-to-grid value or a changed geometry type now returns 422. Vertices are counted before rounding. `label` and `timeSlot` must already be trimmed. `get_branch_head` filters by owner explicitly and no longer relies only on RLS.
- Application error codes: `FT001` reused idempotency key, `FT409` stale head, `FT422` feature validation.
- Canonical coordinates use six decimal places. The server computes a SHA-256 hash of the canonical payload, with sorted keys and features sorted by lowercase id.
- Property tests (fast-check, seed 20260514) in `tests/unit/editor-state.test.ts` and `tests/unit/canonical.test.ts` checked that undo reverses each execute, redo reproduces the final state, and canonicalization is independent of input order and idempotent. No counterexample was found.
- Browser captures `docs/kiro-evidence/editor-1440.png` and `editor-390.png` show no horizontal overflow at 1440 px or 390 px (0 px measured).
- Review findings: the independent review reported two medium issues (a null snap-to-grid value caused a 500 response, and `get_branch_head` depended only on RLS) and several low ones. All were fixed in `20261122070000`.
- A defect in the first unpublished draft of the migration (`pg_catalog.unnest` over several arrays failed) was fixed before publication.

### Publication of a fixed revision (FT-06)

- `POST /api/v1/revisions/:id/publish` publishes one saved revision. It requires an `Idempotency-Key` header and returns 201 on success.
- Error responses: 401 `authentication_required`; 404 when the revision is not found; 409 `already_published` (the response includes the existing publication ID); 409 `idempotency_conflict`; 409 `profile_required`; 422 `empty_revision` or `invalid_publication`.
- `GET /api/v1/publications/:id` returns a public projection. It omits the account ID, email, branch ID, parent revision, and revision message. The response sends `Cache-Control: no-store`.
- Public page `/{es,en}/publications/:id` shows an immutability notice, a hypothetical notice, a schematic preview, the intervention list, and a language switch.
- Proxy gate (`src/lib/supabase/publication-gate.ts`) calls the RPC `public_publication_exists` with a 1.5 s timeout. Missing, invalid, and hidden IDs are rewritten to the prerendered route `/[locale]/publication-unavailable`, so the response status is a real 404. If the database check fails, the gate fails open and the request goes to the page.
- The tester agent found a soft 404: a missing publication returned HTTP 200 with a not-found page. The gate addresses it. E2E checks the 404 status for random and invalid IDs. Known limits that still return a streamed 200 are listed in ADR 0002.
- Why a gate: with Cache Components, Next.js sends the prerendered shell first, so a `notFound()` inside `<Suspense>` keeps status 200 (installed docs: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md`, section "Status codes"). The same docs recommend checking in Proxy before streaming starts.
- Editor publish form: the public name is prefilled with the branch title, the summary is required, a consent checkbox is required, and the button is disabled while the branch has pending changes or is empty. The branch's publications list shows a "Hidden by moderation" state.
- Evidence captures: `docs/kiro-evidence/publish-form-1440.png`, `publication-1440.png`, and `publication-390.png`. 0 px horizontal overflow was measured at 1440 px and 390 px. The branch title in the captures includes a random test suffix (`f8bde1d2`) from the E2E helper.

### Fork from a published revision (FT-03, R1 public-revision source)

- Requirement: R1 of Spec 02 says a participant may branch from a compatible baseline or a visible public revision. Task 2 implemented only the baseline. The closure review of task 6 found the gap, and it was closed within this Spec.
- Contract: `POST /api/v1/branches` accepts a strict union. Baseline: `{siteId, title}`. Fork: `{sourcePublicationId, title}`. Fork errors: 404 `publication_not_found`, 409 `idempotency_conflict`, 422 `invalid_branch`.
- Migration `20261122110000_fork_publication.sql`: adds `branches.source_publication_id`; adds the `fork_publication` RPC, which uses the same idempotency namespace as `create_branch`, takes `FOR SHARE` on the publication and the site, copies the source snapshot exactly without revalidation, and sets the source revision as the parent of the first revision with the message `Forked from publication`. `get_branch_head` gains `sourcePublicationId` and `sourceVisible`. The public read RPCs require a published site.
- Migration `20261122120000_fork_review_fixes.sql` (fork review fixes):
  - Composite foreign keys: `publications(id, revision_id)` and `branches(source_publication_id, source_revision_id)`.
  - `FOR SHARE` on the publication and the site, with a documented lock order: publication, then site. Moderation must use `FOR NO KEY UPDATE` on `sites`.
  - `create_branch` requires a published site. Otherwise it raises `P0002` `site_not_found`.
  - A `js_trim` helper gives JavaScript `String.trim()` parity for `label` and `timeSlot`. Before this fix, `btrim` removed only ASCII whitespace, so a direct RPC caller could save tab or NBSP labels that later broke Zod parsing and the fork editor.
  - Index `branches_source_publication_idx`.
  - Fork action error context: `?error=invalid_title` for invalid titles. `P0002` redirects to `/[locale]/publication-unavailable`.
  - `branchPayloadFingerprint` is reused in the fork action.
  - `GET /api/v1/branches/[branchId]` returns a controlled 500 on a malformed head, using `safeParse`.
- pgTAP finding: `TRUNCATE` on `publications` now fails with `0A000`, because the branches foreign key fires first. Coverage is kept through `TRUNCATE CASCADE`, which returns `55000`, and a `has_trigger` assertion.
- Public UI: the publication page has a fork form, "Bifurcar esta propuesta". The title is prefilled, and the form works without JavaScript. An anonymous submitter is redirected to sign-in with `returnTo`. Success opens the editor.
- Provenance UI: the editor shows a provenance line with a link to the source publication. When the source is hidden, it shows "…ya no está disponible".
- Tests: pgTAP `supabase/tests/008_fork_publication.test.sql` (92 tests) and `006_publications.test.sql` (updated to 33 tests); unit branch-schema tests; `tests/e2e/fork.spec.ts` (8 scenarios on chromium and mobile-360, 16 tests).
- Decision record: `docs/adr/0003-fork-from-publication.md`.

### Agents and models (fork, Spec 02 task 6)

- Architect (`architect`, claude-opus-5.5): designed the fork and six corrections, including the shared idempotency namespace and the `POST /api/v1/branches` union.
- Implementer (main session agent): role requested Claude Sonnet 5.5. The session ran as Claude Opus 5.5 and Kimi K3 in parts. Both are recorded here. The Sonnet model ID was not confirmed.
- Tester (`tester` profile, model `auto`, standing in for GPT-5.6 Luna; the model ID is not confirmed in Kiro): wrote pgTAP `008`, the unit tests, and the E2E tests. Found the constraint-introspection break.
- Reviewer (`reviewer-opus`, claude-opus-5.5): two independent reviews. The fork review found no blockers or majors and 8 findings, all fixed.
- Docs writer (`docs-writer`, claude-haiku-5.5 configured in the profile; the runtime model was not confirmed): wrote these docs.
- Model names are the configured profile values, except where a session model was reported. Kiro does not confirm the runtime model for each sub-agent call.

### Agents and models (FT-06)

- Architect (`architect`, claude-opus-5.5): designed the publication rules.
- Implementer and integrator (main session agent): wrote the migrations, routes, and UI. The role requested Claude Sonnet 5.5. The session ran as Claude Opus 5.5 for part of this work.
- Tester (`tester` profile, model `auto`): stands in for GPT-5.6 Luna. The GPT-5.6 Luna model ID is not confirmed in Kiro. The tester wrote pgTAP `006` and `007`, the unit tests, and the E2E tests, and found the soft 404 defect.
- Reviewer (`reviewer-opus`, claude-opus-5.5): no blockers, 8 findings. Fixed: the lock comment and the null-detail `unique_violation` path (migration `20261122100000`), a 1.5 s Proxy timeout, `missing_profile` mapped to 409 `profile_required`, and the hidden-by-moderation state in the editor. Documented as limits in ADR 0002: the site check on the page, the gate-to-page race window, and `published_by` blocking account deletion.
- Docs writer (`docs-writer`, claude-haiku-5.5): wrote these docs.
- Model names are the configured profile values. Kiro does not confirm the runtime model for each sub-agent call.

### Analysis, costs, compare and merge (Spec 03, FT-07, FT-08, FT-11, FT-12)

- Solar scenarios (FT-11): `scripts/generate-solar-scenarios.mjs` writes `data/sites/zocalo-puebla/solar-scenarios.json` using `suncalc` 1.9.0, pinned as an exact devDependency. `npm run check:solar` reports "solar scenarios match". The scenarios are `equinox-1000` (azimuth 1.94519 rad, elevation 0.804819 rad) and `equinox-1600` (azimuth 4.440486 rad, elevation 0.654517 rad) on 2027-03-20 in America/Mexico_City. `equinox-1900` is excluded because the sun is below 10°. An independent NOAA implementation agrees within 0.5°. The dataset checksum is in `manifest.json`.
- Spatial indicators (FT-11): `analysis_compute` and the public wrapper `get_snapshot_analysis` return shade, occupancy per time slot, crossing length, and remaining surface, with engine version and inputs. A probe on a known canopy gave 326.05 m² (2.87%). The pilot has no pedestrian-area layer, so the reference surface is the boundary fallback, and parking is `null` because no inventory exists.
- Costs (FT-12): `data/catalogs/zocalo-puebla-v1.json` is a fully illustrative evaluation price list dated 2026-11-22, owned by "Equipo del piloto Fork the City". Prices are pinned by `effective_from`, rounded half-up per line, and unpriced concepts make the result partial. The file is not a supplier quote. See `docs/data-sources.md`.
- Compare (FT-07): `compare_revisions` and `GET /api/v1/compare?left=&right=&scenario=`. The `/[locale]/compare` page shows an indicators table, an SVG change map with a pattern legend (not color alone), and a changes table. Both tables sit in keyboard-focusable scroll regions.
- Merge (FT-08): `POST /api/v1/branches/:id/merge/preview` and `/merge/commit`. The merge page resolves conflicts from the keyboard with keep, remove, or redraw. The entry point is the publication page, and the editor shows merge provenance.
- Performance (FT-07, R3): `scripts/perf-compare.mjs` ran on the production build on the Node 26 host with 200 features per side and 100 modified. Cold start was 1265 ms. Over 40 requests after 5 warm-up requests: p50 73 ms, p95 170 ms, max 198 ms. The target p95 of 1500 ms or less was met. Payload was 51,118 bytes.
- Captures: `docs/kiro-evidence/compare-1440.png`, `compare-390.png`, `merge-conflict-1440.png`, and `merge-resolved-1440.png`. Each shows 0 px horizontal overflow. These captures predate the CSS rule for `.publication-page > section`. The final `check:ci` run covers that rule.
- Demo: proposal A adds shade, proposal B adds temporary market stalls over the same surface, the spatial conflict is shown, and the merge resolves it with both parents kept. The E2E suite covers the demo with a redraw resolution and with a remove resolution.
- Tests: pgTAP `009_analysis`, `010_compare` (113 tests), and `011_merge` (292 tests). Unit tests `solar`, `analysis-props` (seed 20260514), `compare-schema` (24), and `merge-schema` (31). E2E `compare.spec.ts` (14 of 14) and `merge.spec.ts` (12 of 12).
- Defects found by the tester agent and fixed:
  - The catalog price CHECK accepted a half-null price pair (`20261123030000`).
  - `resolve_snapshot_ref` accepted trailing characters (`20261123030000`).
  - An axe `scrollable-region-focusable` violation on the compare tables, fixed with `role="region"`, `tabIndex={0}`, and `aria-labelledby`.
  - A merge resolution without `conflictId` raised SQLSTATE 22023 (`20261123060000`).
  - A test fragility: `010` compared global `mutation_requests` counts. It now compares before and after.
- Review: `reviewer-opus` found no blockers, 2 major and 6 minor or nit findings. All were fixed in migration `20261123070000` and the UI. The fixes cover iterative resolution rounds for overlaps that a redraw introduces, the blocking rule, no private ancestor IDs in operations, the stale-head check before domain checks, exact EWKB equality, the 200-feature message, and a bounding-box prefilter with a 512 KiB preview cap.
- Known limitations: see ADR 0004, section "Limitations".

### Agents and models (Spec 03)

- Architect (`architect`, claude-opus-5.5): wrote the design.
- Implementer (main session agent): the role requested Claude Sonnet 5.5. The session ran as Kimi K3 and Claude Opus 5.5 in parts. The Sonnet model ID was not confirmed.
- Tester (`tester` profile, model `auto`, standing in for GPT-5.6 Luna; the model ID is not confirmed in Kiro): two tester runs were cancelled and relaunched as smaller tasks.
- Reviewer (`reviewer-opus`, claude-opus-5.5): merge review.
- Docs writer (`docs-writer`, claude-haiku-5.5): wrote these docs.
- Profile models are the configured values. Kiro does not confirm the runtime model for each sub-agent call.

### Community and moderation (Spec 04, FT-09, FT-10)

- Schema (migrations `20261124010000_rate_limits`, `20261124020000_community_tables`): tables `comments`, `supports`, `reports`, `moderation_events`, `rate_limits`, and `rate_windows`. RLS is on for each table, and `anon` and `authenticated` have no table grants.
- Plain text (`plain_text_ok`): comments are 1 to 1,000 characters after trimming, moderation reasons are 1 to 500, and report notes are optional and at most 500. Control characters other than newline, bidi overrides, and invisible or zero-width characters are rejected. Routes normalize CRLF to LF. The UI renders text only.
- Comments: flat list per publication, no replies. Optional anchor to one feature of the published revision, checked in the database. Pages of 20 by default and 50 at most, with a keyset cursor on `(created_at, id)`. Authors can retract their own comments. The `mine` flag lets an author identify their own comments without any account id. Account ids and emails are never returned.
- Support: at most one per account and publication. Withdrawing deletes the row. Repeating support or withdrawal leaves the count unchanged. Visitors see the count. Only the account sees its own state. The count never triggers a state change.
- Reports: reasons `spam`, `harassment`, `misinformation`, `privacy`, and `other`, with an optional note of up to 500 characters. One open report per account and target. A duplicate returns the existing report. Reporters never see other reports.
- Rate limits (migration `20261124010000_rate_limits`): 10 comments per hour, 10 reports per hour, and 60 support changes per hour, per account. Limits live in data (`rate_limits`). Counters are atomic upserts per one-hour bucket, use the server clock, and are checked after validation and replay checks. A rejected request returns 429 with `Retry-After` and makes no change. A replay or a duplicate report does not consume a counter. Window length is capped at 86,400 seconds, and old windows are purged.
- Idempotency: `create_comment`, `create_report`, `moderate_target`, and `resolve_report` use the shared ledger. Replays return the original result, and a different payload returns 409. `set_support` and `retract_comment` are naturally idempotent.
- Migrations: `20261124030000_community_rpcs` (comment, support, and report RPCs and public reads), `20261124040000_moderation_rpcs` (report queue, target read, moderate, and resolve), `20261124050000_moderation_hidden_list` (`list_hidden_content`), `20261124060000_comments_mine_flag`, and `20261124070000_community_review_fixes`.
- Routes: ten routes under `/api/v1`: comments list and create, comment retraction, support read and set, report create, moderation report queue, moderation target read, moderation actions, and report resolve. Errors use stable codes, `no-store` caching, and the `readMutationOrigin` check for PUT and DELETE.
- UI: community section on the publication page (support toggle, comments with anchor labels, comment form, report controls, and author notices). Moderation panel at `/es/moderation` and `/en/moderation`, with the report queue, hide and restore forms, and the hidden list. Both work with the keyboard at 360 px. Status is never shown by color alone.
- Moderation: a moderator of the site hides or restores a publication or comment with a required public reason and an optional private note. Each action appends to `moderation_events`, which rejects update, delete, and truncate. A non-moderator, or a moderator of another site, gets 404 with no effect.
- Hidden publications: the public page returns 404 through the Proxy gate, and the public API, compare, analysis, fork, merge, comments, support, and reports stop working for it. Existing forks and merged revisions keep their content and show the source as unavailable. Restoring reverses these effects.
- Review fixes (`reviewer-opus`: 10 findings, 3 major). Fixed in `20261124070000_community_review_fixes.sql` and in app code:
  - Major: editable profile aliases could impersonate authors or moderators. Fixed with the `profile_alias_ok` constraint (NFC, Latin-1 letters only, reserved words) and a unique index on `lower(normalize(alias, NFKC))`.
  - Major: the author of a hidden publication could not read the public reason. Fixed with `list_my_hidden_publications`, shown in the editor list.
  - Major: concurrent reports with different idempotency keys could end in a 500. Fixed with an advisory lock per reporter and target.
  - Other fixes in the same change: `resolve_report` now rejects events older than the report; invisible characters are rejected by `plain_text_ok`; `__proto__` query parameters could crash the page and are now handled with `Object.hasOwn` and a clamped `wait`; the Proxy session refresh runs only when a session cookie exists, with a 2 s timeout; `moderation_events` gained indexes; the rate-limit purge and window cap were added.
- Found during testing, fixed: a prototype-key lookup in `mapCommunityError` (fixed with `Object.hasOwn`), and pgTAP assertions that counted global rows and failed once E2E rows were committed (the assertions now compare relative counts).
- Added during implementation: `list_hidden_content`, so moderators can find and restore hidden content, and the `mine` flag on comments.
- Tests: pgTAP `012_community_schema`, `013_rate_limits`, `014_comments_supports`, `015_reports_moderation` (4 users by 8 functions, all denied with `P0002` with no change), and `016_hidden_effects`. Unit `tests/unit/community-schema.test.ts`. E2E `tests/e2e/community.spec.ts`: 15 passed and 1 skipped by design (the rate-limit test runs on chromium only), covering the API matrix, the parallel-comment limit (12 requests give exactly 10 created and 2 rate-limited), axe, keyboard, 360 px, and plain-text rendering of `<img onerror>`.
- Captures: `docs/kiro-evidence/community-1440.png`, `community-390.png`, and `moderation-1440.png`, each with 0 px horizontal overflow. The moderation capture shows leftover reports from earlier local E2E runs. It does not contain real user data.
- Known limitations (details in `docs/adr/0005-community-and-moderation.md`): the hidden list and report queue show at most 50 items without paging; a report whose target is already hidden can only be dismissed; the panel does not show the audit history (the API has it); aliases accept Latin-1 letters only; account deletion is blocked by `ON DELETE RESTRICT` on authors.
- Known gaps in the evidence:
  - Spec 04 R7 property tests: `scripts/generate-support-properties.mjs` (fast-check, seed 20260514, 40 random sequences plus 2 regression sequences, 3 accounts per sequence) writes `supabase/tests/018_support_properties.test.sql`, 243 assertions run against the real `set_support` function: a repeated support leaves the count unchanged, a withdrawal returns it to its previous value, and after any interleaving the count equals the number of accounts currently supporting. `npm run check:support` (part of `npm run check`) fails if the committed file drifts from the generator. No counterexample was found. The two-account story of R7 is scenario 1 of `tests/e2e/community.spec.ts` (two accounts comment, support twice counts once, withdraw, report, moderator hides and restores, public effects verified).
  - R7 also asks for an E2E story with two accounts, support counted once, withdrawal, a report, and a moderator hide and restore. The closure evidence lists the API matrix and UI checks, not that story as one scenario.
- Migration note: ADR 0003 asks moderation to lock the site row. The Spec 04 moderation migration locks the publication row (`FOR NO KEY UPDATE`), as the Spec 04 design requires. ADR 0005 records this difference.

### Agents and models (Spec 04)

- Architect (`architect`, claude-opus-5.5): wrote the design.
- Implementer (main session agent): the role requested Claude Sonnet 5.5. The session ran as Claude Opus 5.5 and Auto. The Sonnet model ID was not confirmed.
- Tester (`tester` profile, model `auto`, standing in for GPT-5.6 Luna; the model ID is not confirmed in Kiro): 4 focused runs.
- Reviewer (`reviewer-opus`, claude-opus-5.5): review of the community increment, 10 findings, 3 major.
- Docs writer (`docs-writer`, claude-haiku-5.5): wrote these docs.
- Profile models are the configured values. Kiro does not confirm the runtime model for each sub-agent call.

### Dossiers, tracking, and exports (Spec 05, FT-13 to FT-15)

- Migrations `20261125010000` to `20261125060000`:
  - `010_dossier_tables`: enums, tables, constraints, triggers, RLS, and no grants. pgTAP `019_dossier_schema.test.sql`.
  - `020_dossier_rpcs`: promotion, responsible name, milestones, evidence, transitions with the full requirement matrix, and `revert_last_status_change`.
  - `030_dossier_reads`: public dossier, managed dossier, publication lookup, list, and existence check.
  - `040_dossier_fixes`: `add_evidence` validates the URL in a fixed order.
  - `050_dossier_evidence_trigger_definer`: the deferred evidence trigger is `SECURITY DEFINER` with an empty `search_path`. The E2E run found the defect, because the pgTAP suite runs as a superuser and did not.
  - `060_dossier_responsible_withdrawal`: after review, a coordinator can withdraw the public responsible name when the dossier is closed or its publication is hidden. pgTAP `024_dossier_responsible_withdrawal.test.sql`.
- Exports: `GET /api/v1/dossiers/{id}/export?format=html|geojson|csv|json`, generated from `get_public_dossier`. Responses use `no-store` and `nosniff`. CSV has a BOM and CRLF, and neutralizes formula cells. HTML uses a CSP with a hash for its only inline style, and its inline SVG uses presentation attributes.
- Review (`reviewer-opus`) findings fixed: responsible withdrawal in closed or hidden states, CSP and SVG style, uniform 404 codes, a 1 KiB body limit on evidence verification, and export 404 outside the pilot site.
- Tests: unit 462 passed, pgTAP 2835 passed in 24 files, and E2E `tests/e2e/dossier.spec.ts` 20 passed on chromium and mobile-360. These results were observed and reported by the main session. The docs agent did not rerun them.
- Not yet recorded: the Node 24 `check:ci` totals and the dossier captures. No dossier capture exists in `docs/kiro-evidence/` yet.
- Decisions and known limitations: `docs/adr/0006-dossiers.md`.
- Agents and models (Spec 05): tester, `tester` profile with model `auto`, standing in for GPT-5.6 Luna (model ID not confirmed in Kiro). Reviewer, `reviewer-opus` (claude-opus-5.5). The design was written by the architect agent, described in `design.md` as the Opus architect. Other roles are not recorded here.

## Actual validation results

| Command | Observed result |
|---|---|
| `npm run test:unit` (Spec 05 increment) | 462 tests passed. Observed and reported by the main session; not rerun by the docs agent. |
| `npm run test:db` (Spec 05 increment) | 2835 pgTAP tests passed in 24 files. Observed and reported by the main session; not rerun by the docs agent. |
| `npx playwright test tests/e2e/dossier.spec.ts` (Spec 05 increment) | 20 tests passed on chromium and mobile-360. Observed and reported by the main session; not rerun by the docs agent. |
| `npx --yes -p node@24 -c 'npm run check:ci'` (Spec 05 closure) | Exit 0 after a clean `supabase db reset` and `npm run provision:local`: unit 462, pgTAP 2835 in 24 files, Playwright 135. |
| `npx --yes -p node@24 -c 'npm run check:ci'` (Spec 04 closure) | Exit 0 on Node v24.22.3, after a clean `supabase db reset` and `npm run provision:local`. Covers lint, typecheck, unit (276 tests in 20 files), `check:solar`, build, pgTAP (1957 tests in 18 files), and Playwright (115 tests on chromium and mobile-360). One community rate-limit test runs only on chromium, by design. No edits were made after this run except the captures. |
| `npx --yes -p node@24 -c 'npm run check:ci'` (Spec 01 task 8, 2026-11-22) | Exit 0 on Node v24.22.3 in 2 min 56 s, run after a clean `supabase db reset` and `npm run provision:local`. `test:unit` 206 tests in 19 files, `check:solar` passed, build compiled, `test:db` 852 pgTAP tests in 11 files, `test:e2e` 100 of 100 on chromium and mobile-360. The first attempt in this task failed 1 of 100: `fork.spec.ts` "un nombre en blanco…" on mobile-360 compared the coordinator's whole branch list before and after, and a parallel worker in `merge.spec.ts` created "Propuesta B" as the same coordinator in between. The test now counts branches whose `source_publication_id` is that test's own publication. No application code changed. |
| `npx --yes -p node@24 -c 'npm run smoke:clean'` (Spec 01 task 8) | Exit 0 on Node v24.22.3 in 1 min 19 s: clean copy, `npm ci`, lint, types, 206 unit tests, and build without `.env.local`. |
| Hook command run by hand (`npm run lint && npm run typecheck && npm run test:unit`) | Exit 0 in 29 s, 206 unit tests, on the Node 26 host. This is not a hook trigger. |
| `npx --yes -p node@24 -c 'npm run check:ci'` (Spec 03 closure) | Exit 0 on Node v24.22.3, run after a clean `supabase db reset` and `npm run provision:local`. Covers `lint`, `typecheck`, `test:unit` (206 tests in 19 files), `check:solar` ("solar scenarios match"), `build`, `test:db` (pgTAP, 852 tests in 11 files), and `test:e2e` (Playwright, 100 tests on chromium and mobile-360). Includes the `.publication-page > section` CSS rule. |
| Compare performance, `scripts/perf-compare.mjs` | Node 26 host, production build. p95 170 ms over 40 requests (target 1500 ms). Cold start 1265 ms, reported separately. Not repeated on Node 24. |
| `npm audit --omit=dev` | 0 vulnerabilities (recorded before the editor work; not rerun) |
| `npx --yes -p node@24 -c 'npm run check:ci'` | Current run (Spec 02 closure, with fork): exit 0 on Node v24.22.3. Lint, typecheck, unit (126 tests in 15 files), build, pgTAP (213 tests in 8 files), and Playwright (74 tests on chromium and mobile-360) passed. Superseded run: lint, typecheck, unit (113 tests in 14 files), build, pgTAP (119 tests in 7 files), and Playwright (58 tests) passed. Earlier notes for that run follow. One CSS rule (`.publication-page h1 { max-width: 24ch }`) was added after this run. The `docs/kiro-evidence` publication captures predate that rule. After it, `npm run lint` passed and `npx playwright test tests/e2e/publication.spec.ts` (Node 26 host) passed 22 of 22; the full Node 24 sequence was not rerun |
| `npx playwright test tests/e2e/editor.spec.ts` | 16 passed (8 editor scenarios on chromium and mobile-360) |
| `npx -p node@24 -c 'npm run smoke:clean'` | Superseded by the Spec 01 task 8 run above. Passed on the foundation state: clean copy, `npm ci`, lint, types, unit tests, and build without `.env.local` |

Earlier Node 26 host runs of lint, typecheck, and build are superseded by the Node v24.22.3 results above.

## Dependency and runtime decisions

- Target runtime is Node 24 (`.nvmrc`, `engines`). The host remains Node 26, so npm prints the expected `EBADENGINE` warning during host-side installs.
- A temporary Node `v24.22.3` executed the full checks successfully.
- Vitest 5 required Node types 22 or 24+, so `@types/node` was upgraded from 20 to 24 instead of bypassing peer checks.
- ESLint 10 passes lint but is outside the peer ranges of Next's current React/import/accessibility plugins. The project therefore keeps peer-valid ESLint `9.39.5`; npm marks that major deprecated. Upgrade when those plugins publish ESLint 10 ranges.
- MapLibre 6's worker did not resolve under Turbopack. The pinned package worker is copied to `public/maplibre-gl-worker.mjs`; browser tests confirm it loads.

## Evidence and automation

- Desktop and mobile captures: `docs/kiro-evidence/catalog-1440.png` and `catalog-390.png`.
- GitHub Actions workflow: `.github/workflows/ci.yml`. Node 24, `npm ci`, Playwright Chromium, local Supabase start, `configure:local`, `provision:local`, `check:ci`, and Supabase stop in an `always()` step. Read-only `contents` permission. It has never run remotely because nothing was pushed.
- Kiro hook: `.kiro/hooks/check-after-task.json`. One `PostTaskExec` hook with a 300 s timeout that runs lint, typecheck, and unit tests after a Spec task. No real trigger has been observed yet; running its command by hand does not count.
- Clean-copy smoke: `npm run smoke:clean` (`scripts/smoke-clean-clone.mjs`).

## Next actions

1. Spec 01 task 8: local checks are done (`check:ci` and `smoke:clean` on Node 24). Still pending: the first real `PostTaskExec` firing of `.kiro/hooks/check-after-task.json`. The hook now also appends timestamps to `.kiro/hooks/run.log`, which git ignores, so the next firing leaves evidence there. A remote GitHub Actions run after a push is also pending.
2. Spec 05 closure: `check:ci` on Node 24 is recorded above. Still pending: dossier captures at 1440 px and 390 px, planned for Spec 06 polish.
3. Spec 06: FT-16 to FT-18 (release, video, Devpost). Not yet created. Finish before December 4, 2026, 14:00 PST.
4. Spec 04 has no open gaps beyond the documented limitations (paging of the hidden list, closing a report on already-hidden content, audit history in the panel).
5. Repeat the compare timing on the Node 24 host, so the performance evidence matches the target runtime.

## Remaining external blockers

- No PMTiles regional extract or redistributable pedestrian/inventory layer has been accepted.
- The pilot metric projection EPSG:32614 is `pending-validation` in `data/sites/zocalo-puebla/manifest.json`.
- No parking inventory exists, so parking impact is not computed.
- No hosted Supabase, Vercel, SMTP, or Devpost destination has been configured.
- Remote GitHub Actions has not run because no push was performed.

## Hook observation note (2026-11-22)
- Task 8 of Spec 01 is marked `[x]` in `.kiro/specs/01-foundation-place/tasks.md` (file modified 12:09:10). Kiro's log shows the hook registered at 11:47:21 and the task moving to `in_progress` at 11:47:28.
- The log has no entry for a `completed` task update or for a hook run after that. Either the completion was written outside the Spec UI or Kiro does not log a successful hook. The requirement "record one observed hook result" is therefore not demonstrated yet.
- To close it with evidence: set a throwaway Spec task to completed from the Spec UI and copy the hook output Kiro shows, or add a `Stop` or `PostTaskExec` hook that appends a timestamp to a log file and show that file.
- Update (Spec 04 closure): the hook was edited to also append timestamps to `.kiro/hooks/run.log`, which git ignores. The next real firing should leave a timestamp there. No firing is recorded yet, so the requirement is still open.
