# Fork the City — Documento maestro de implementación para Kiro IDE

**Proyecto:** Fork the City · **Evento:** Kiroween 2026 · **Categoría propuesta:** Frankenstein  
**Fecha de referencia:** 19 de noviembre de 2026 · **Cierre:** 4 de diciembre de 2026, 14:00 PST / 17:00 EST  
**Destino:** repositorio nuevo e independiente para Fork the City. Guarda este Markdown en su raíz.  
**Estado:** especificación para validar y ejecutar. Las elecciones técnicas y el sitio piloto son decisiones iniciales que Kiro debe verificar en la fase 0.

## 0. Instrucción inicial para pegar en el chat de Kiro IDE

Abre la carpeta de Fork the City en **Kiro IDE**. Deja este documento en la raíz. Si el repositorio activo contiene otro producto, abre una carpeta separada. Pega lo siguiente en el chat de Kiro:

> Lee completo el archivo FORK-THE-CITY-PLAN-KIRO.md de la raíz. Este documento define el producto, la arquitectura, los criterios de aceptación y el orden de trabajo. Verifica la raíz Git, las instrucciones del repositorio y las herramientas disponibles. Ejecuta la fase 0 y guarda los resultados reales en docs/validation.md. Genera steering de producto, tecnología y estructura. Crea Feature Specs con el flujo Requirements-First indicado en el documento. Conserva los IDs y crea requirements.md, design.md y tasks.md para la primera Spec. Usa el flujo de revisión integrado del IDE cuando lo presente. Una vez que la primera Spec permita ejecución, empieza su primera tarea ejecutable y continúa por dependencias. Ejecuta las verificaciones indicadas, registra sus resultados y actualiza el estado. Si un servicio, credencial, permiso o dato real falta, registra el bloqueo exacto y avanza con las tareas locales e independientes. Aplica la alternativa documentada cuando corresponda. Respeta el alcance y conserva el historial de los datos. No afirmes que validaste, probaste o publicaste algo si no ocurrió. La publicación o modificación de recursos externos requiere que el equipo confirme el destino y facilite el acceso correspondiente.
Si el chat prepara los documentos pero no ejecuta tareas, entra a **Specs → Feature → Requirements-First**, referencia este archivo y abre el `tasks.md` generado. Inicia la primera tarea disponible desde el panel o desde el control de ejecución del IDE. Usa los nombres que muestre tu versión. Para reanudar, referencia este plan, `docs/validation.md`, `docs/progress.md` y el `tasks.md` activo. [Primer proyecto en Kiro](https://kiro.dev/docs/getting-started/first-project/) · [Feature Specs](https://kiro.dev/docs/specs/feature-specs/)
## 1. Contexto y propósito
Cuando un colectivo quiere mejorar una plaza, una calle o un terreno, es frecuente que las ideas se expresen en conversaciones, dibujos y documentos en formatos distintos. Es difícil saber qué parte cambió, quién la propuso, cómo comparar dos opciones y qué quedó pendiente cuando una persona intenta llevarlas a revisión. **Fork the City convierte un lugar real en un proyecto editable con historial de propuestas.** Una persona parte del estado de referencia o de una versión pública, edita el lugar, publica una revisión y explica el efecto esperado. Otra persona puede comparar, comentar o combinar cambios con atribución. Un coordinador puede registrar responsables, hitos y evidencia de una ejecución documentada.
**Primeros usuarios:** colectivos vecinales, grupos estudiantiles de urbanismo y facilitadores que preparan propuestas de espacio público. El coordinador inicial puede ser parte de un colectivo. Una oficina pública puede recibir el expediente si existe un canal real. La app debe servir desde el primer taller y permitir incorporar más lugares mediante datos y reglas configurables.
**Hipótesis a validar:** una persona que conoce el lugar puede crear una alternativa entendible y compartirla para revisión. Otra persona puede distinguir en la comparación qué se gana, qué se sacrifica, qué se sabe y qué falta medir. Objetivos del piloto: cuatro de cinco personas completan crear y publicar una propuesta en diez minutos o menos, y cuatro interpretan correctamente costo y cambio espacial. Si no hay cinco participantes, reportar tamaño, tiempos y observaciones reales. Guardar feedback consentido y sin datos personales en el repositorio. Es una prueba de uso, no de adopción municipal.

**Apuesta para Frankenstein:** combinar edición geográfica, el historial y la fusión de versiones del desarrollo de software, cálculos de escenarios urbanos y seguimiento comunitario. La fusión tiene consecuencias visibles: combinar dos propuestas puede ocupar dos veces el mismo espacio, cambiar el presupuesto o mejorar la cobertura de sombra. El producto explica esas consecuencias.

### 1.1 Qué debe ver el jurado

| Criterio oficial, 20% cada uno | Evidencia que produce el equipo |
|---|---|
| Impacto | Lugar verificable, usuario concreto, comparación útil, expediente exportable y resultados reales de uso, si se recogen. |
| Implementación tecnológica | Specs, steering, automatización con un hook, pruebas de propiedades y bitácora que muestre decisiones, resultados y un cambio real derivado del proceso. |
| Diseño | Recorrido completo con textos de estado, edición guiada, comparación legible, móvil y teclado. |
| Innovación | Historial con bifurcación, fusión que detecta conflictos de edición y de espacio, costos trazables y cálculo espacial repetible. |
| Presentación | Video de una historia completa sobre el sitio piloto. Mostrar un conflicto real, el resultado de resolverlo y el expediente que sale de la aplicación. |

Antes de puntuar, Devpost verifica encaje temático y uso razonable de Kiro. Construir dentro de la ventana oficial. El material presentado va en inglés o con traducción al inglés. Registrar la procedencia de cualquier trabajo previo incorporado y cumplir las licencias de datos e integraciones. El jurado puede basarse en el material de la entrega. [Reglas oficiales](https://kiroween.devpost.com/rules)

## 2. Alcance de la versión para concurso

### 2.1 Sitio y caso

**Piloto propuesto:** Zócalo de Puebla, México, con límite acotado, un área peatonal de referencia y una revisión del inventario que se pueda sustentar. El Zócalo aporta un lugar identificable y un contexto patrimonial. Toda alternativa es un escenario ciudadano hipotético. Mostrar el estado real solo para elementos respaldados por datos o levantamiento documentado. Si el sitio no permite validar geometría o explicar el caso, elegir en fase 0 otra plaza real con procedencia verificable y guardar la decisión. [Referencia municipal del Centro Histórico](https://centrohistorico.pueblacapital.gob.mx/media/com_dpattachments/attachments/com_content.article/Revista-Cuetlaxcoapan-39.pdf)

**Caso narrativo:** un colectivo considera sombra y espacio para comercio temporal. La propuesta A incorpora sombra; la B organiza puestos. Las dos usan parte de la misma superficie. Una tercera versión conserva la sombra, recoloca el mercado, recalcula métricas y deja una propuesta enviable a revisión. El estado mostrado debe indicar si una actividad es hipotética o si su avance tiene evidencia. Un entorno de prueba puede incluir ejemplos de estacionamiento o cruce claramente rotulados; estos controles solo se aplican en un sitio real si su inventario correspondiente está documentado.

**Alcance técnico:** uno o más sitios curados por el equipo, edición 2D, cuatro familias de intervención, revisión y publicación con historial inmutable, comparación, fusión, comentarios, apoyo, moderación, expediente y seguimiento con evidencia. La aplicación permite crear nuevas propuestas, conflictos y decisiones con datos persistentes. El mismo motor se parametriza por sitio, moneda, catálogo e inventario. Lo que queda para ampliaciones es alta autónoma de sitios, colaboración simultánea tipo documento, modelos de tráfico y térmicos validados, 3D, pagos e integraciones municipales. Los datos reales del piloto y los de prueba se mantienen identificables.
### 2.2 Usuarios y permisos

| Rol | Acciones |
|---|---|
| Visitante | Explorar sitio, consultar revisiones públicas, comparar y abrir expediente público. |
| Participante autenticado | Gestionar su alias, crear borradores, bifurcar revisiones públicas, editar y publicar sus ramas, importar a su rama cambios de una fuente visible, comentar, apoyar y reportar. |
| Coordinador de sitio | Actuar como participante y promover una revisión pública a expediente, gestionar estado, asignar responsables que consientan aparecer y registrar evidencia. |
| Moderador de sitio | Revisar reportes, ocultar o restaurar contenido, con motivo y auditoría. Opera en sitios asignados. |
| Operador | Aplicar migraciones, cargar sitios y escenarios, asignar roles por procedimiento documentado y revocar acceso. |

Cuentas conectadas a Supabase Auth. Visitantes leen sin sesión. Participantes se registran e inician sesión con correo y contraseña, confirmación de correo y recuperación por SMTP configurado para el entorno público. Para el jurado, provisionar cuentas confirmadas de participante y coordinador de **entorno de evaluación** con datos de prueba, credenciales entregadas solo en el campo privado de Devpost. Nunca colocar contraseñas en README, seed SQL versionado o video. En local, usar servidor de correo de la pila Supabase y script de aprovisionamiento local con variables privadas. El público ve alias, no correos. El entorno de evaluación puede usar cuentas verificadas preaprovisionadas mientras se termina la configuración de registro abierto. Comprobar límites y modo de recuperación en fase 0.

## 3. Requisitos verificables

Registrar cada requisito con el ID de esta tabla en `requirements.md`, tareas, pruebas y release. Para cada comportamiento escribir criterios EARS cuando proceda («Cuando… el sistema deberá…»). Las negativas deben tener prueba: error visible, ausencia de datos privados o transacción sin efectos.

| ID | Requisito y aceptación |
|---|---|
| FT-01 | Catálogo. Mostrar sitio, alcance del estudio, datos y fecha de referencia. Abrir el lugar por enlace directo. Si falla el mapa base, cargar geometrías y lista locales con mensaje y reintento. |
| FT-02 | Sesión y permisos. El visitante puede leer y comparar. Tras entrar, volver a la acción iniciada con redirección limitada al mismo origen. Dos cuentas independientes no pueden ver borradores ajenos ni modificar el rol propio. |
| FT-03 | Crear rama. Elegir revisión base pública o baseline del sitio y asignar título, objetivo y autor. Copiar el estado exacto y guardar la procedencia. La rama inicia privada y la fuente permanece intacta. |
| FT-04 | Editar. Crear, mover cuando corresponda, cambiar propiedades y eliminar intervenciones. Permitir deshacer y rehacer cambios locales. Validar límites, unidades, cantidad, topología y sitio en el servidor. Un error conserva la edición local y muestra cómo corregirla. |
| FT-05 | Guardar revisión. Guardar explícitamente una revisión inmutable con título de cambio, usuario, anterior, fecha y resultados reproducibles o estado de cálculo. Refrescar recupera el último guardado. Dos sesiones que guardan sobre la misma cabeza reciben un éxito y un conflicto recuperable. Reintentar la misma petición no duplica revisiones. |
| FT-06 | Publicar revisión explícita. El autor revisa el resumen, publica y obtiene URL fija. El enlace público abre esa revisión después de guardar otra privada. Una publicación posterior no altera enlaces históricos publicados. |
| FT-07 | Comparar. Seleccionar dos revisiones visibles del mismo sitio o baseline y una revisión. En mapa y tabla mostrar agregados, removidos y modificados, costos, cantidades, cobertura y procedencia. Si los insumos son distintos, informar incompatibilidad o usar un contexto común explícito. |
| FT-08 | Fusionar. En rama propia, previsualizar una revisión pública del mismo sitio con ancestro común. Integrar cambios compatibles. Mostrar conflictos con selección de alternativas o ajuste de geometría. Revalidar del lado servidor y guardar un solo resultado atómico con ambos padres. |
| FT-09 | Colaboración. Comentario de texto plano anclado a revisión, con anclaje opcional a elemento. Apoyo único por participante y revisión, reversible. El contador representa cuentas de la plataforma. La discusión sigue asociada a la versión original. |
| FT-10 | Moderación. Reportar contenido público, aplicar límites persistentes y permitir a moderación ocultar/restaurar con motivo. La ocultación bloquea las lecturas públicas, exportaciones y nuevas fusiones del contenido afectado. La auditoría conserva hechos de la moderación. |
| FT-11 | Análisis espacial. Medir sombra modelada, área ocupada y otros indicadores del catálogo con fórmula y entradas inspeccionables. Marcar valores incompletos y datos de ejemplo. El resultado conserva versión de motor, datos y escenario. |
| FT-12 | Costos. Calcular rango por conceptos, unidades y lista de precios fijada por revisión, frente al estado de referencia. Exponer supuestos, fuentes y fecha. Un concepto sin precio hace que el resultado sea parcial. |
| FT-13 | Expediente. Coordinador convierte una revisión pública en expediente mediante acción explícita. Guardar esa revisión, nota de decisión, nombre público del responsable si se autorizó, fechas objetivo e hitos. El apoyo se muestra como contexto y no dispara transiciones. |
| FT-14 | Seguimiento. Registrar cada cambio de estado con actor, fecha, nota y referencia de evidencia cuando corresponda. Cerrar como ejecutado requiere observación de lo construido y evidencia que un revisor pueda consultar. |
| FT-15 | Exportación. Ofrecer expediente HTML imprimible, GeoJSON de intervenciones, CSV de conceptos y JSON de supuestos. Para visitantes y usuarios, filtrar el contenido con las mismas reglas de acceso que la app. |
| FT-16 | Experiencia y acceso. Abrir interfaz en español e inglés, mantener etiquetas accesibles y alternativa textual al mapa. En dispositivo de 360 px no hay desbordamiento horizontal. Se pueden seleccionar elementos, comparar y editar con teclado mediante controles de formulario. |
| FT-17 | Operación. Arranque local reproducible, migraciones, seed identificado, pruebas en CI y despliegue con datos aislados. El README en inglés permite instalar, repetir el flujo y conocer limitaciones. |
| FT-18 | Evidencia de Kiro. Versionar `.kiro/` en la raíz. Registrar Specs, steering, hook, propiedades comprobadas y resultados observados durante el desarrollo. |

### 3.1 Intervenciones y reglas

| Tipo | Geometría y campos | Reglas explícitas |
|---|---|---|
| Árbol de sombra / cubierta | Punto para árbol con perfil de copa y altura; polígono para cubierta horizontal con altura de plano. Tipo de ficha y dimensiones en metros. | Perfil proviene de catálogo versionado. Las estimaciones de árbol describen el tamaño modelado. No se asume vegetación existente a partir de la ausencia de un levantamiento. |
| Mercado temporal | Polígono de ocupación, fecha o franja etiquetada, cantidad de puestos y módulo en m² por puesto. | Cantidad por módulo cabe en el polígono como chequeo preliminar. La cantidad aceptada y el área se muestran por separado. Polígonos exclusivos para una misma franja no pueden solaparse sobre el umbral configurado. |
| Reconversión de estacionamiento | Selección de IDs de plazas inventariadas y uso propuesto. El mapa muestra sus geometrías. | Contar la unión de IDs únicos. Cada plaza admite una intervención activa de reconversión por revisión. Sin inventario verificable se muestra como no disponible. |
| Cruce propuesto | Línea entre dos puntos mapeados, con longitud y ancho propuesto; polígono derivado para visualización. | Validar ambos extremos en zonas de conexión configuradas y permitir alertas espaciales, sin inferir reducción de accidentes ni conformidad normativa. |

Añadir etiquetas de restricciones de sitio, con geometrías y origen. Un bloqueo geométrico solo aplica cuando el tipo y el dato soportan la regla. Separar errores bloqueantes de observaciones que requieren revisión humana. Leyenda diferenciada para existente, agregado, removido y conflicto, con icono o patrón además del color.

### 3.2 Recorrido y pantallas

1. **Inicio y lugar.** Lista de lugares, ficha con problema, procedencia, mapa, acciones «Explorar propuestas» y «Crear alternativa». Separar versión de referencia, propuestas y expedientes.
2. **Editor.** Mapa a la izquierda y panel a la derecha en escritorio. En móvil alternar entre mapa y edición con controles visibles. Herramienta por tipo, lista de elementos, formulario de coordenadas o vértices, acciones de guardado y validación. Mantener selección cuando cambia el mapa. Mostrar cambios pendientes al navegar y recuperar un borrador local, si el usuario lo acepta, por sitio, rama y cuenta. Limpiarlo al cerrar sesión.
3. **Historial y publicación.** Lista de revisiones, procedencia, marcas de publicación, enlace a versión exacta. Confirmar la identidad del elemento y qué datos se harán públicos.
4. **Comparación.** Un mapa con capas A/B seleccionables y extensión común. Tabla de cambios con enlace al elemento, indicadores y supuestos, compatible con teclado y lector de pantalla. Opción de mapas sincronizados si se cumple el presupuesto de rendimiento.
5. **Fusión.** Confirmar fuente y destino, revisar operaciones y conflictos, seleccionar resolución o editar la forma. Mostrar estado y explicación de cada conflicto. Tras guardar, abrir nueva revisión y mostrar padres y métricas.
6. **Publicación y discusión.** Comentarios y apoyo por revisión. Aviso de alcance cívico, reportar contenido y enlace compartible.
7. **Expediente.** Texto del objetivo, comparación, rango de costo, detalle de partidas y fuentes, responsables, estado y cronología. Descargas y versión imprimible.
8. **Panel de moderación.** Reportes de los sitios asignados, enlace al objeto, motivo, resultado y registro. Estados de carga, vacío, desconectado, permiso insuficiente y error recuperable en pantallas operativas.

## 4. Arquitectura y tecnologías

**Arquitectura:** monolito modular con Next.js y una base PostgreSQL. El navegador dibuja, captura gestos y prepara cambios. Las rutas Next validan los contratos y gestionan la sesión. PostgreSQL aplica las reglas transaccionales y PostGIS calcula geometrías. Un mapa regional estático aporta contexto. Esto permite construir, probar y desplegar con un solo repositorio. Los precios, parámetros solares y artefactos de origen se cargan por scripts de mantenimiento reproducibles.

| Capa | Elección y uso |
|---|---|
| Runtime | Node.js 24 LTS, Linux y Git. npm con `package-lock.json` y `npm ci`. Fijar mayor de Node en `.nvmrc` y `engines`. Fijar parches resueltos de dependencias y herramientas de CI después de la fase 0. |
| Web | Next.js 16 estable, App Router y Route Handlers Node; React 19 compatible, TypeScript 5 en modo estricto, ESLint y Prettier. Componentes de servidor para vistas públicas cuando convenga y cliente para el editor. Revisar la compatibilidad exacta y soporte según documentación y lockfile. |
| UI | Tailwind CSS 4, HTML semántico y controles accesibles nativos. `next-intl` compatible para mensajes y rutas ES/EN. Usar `Intl` para moneda, fechas y zona. Mantener el mapa del proyecto fuera del contenido inicial no geográfico. |
| GIS navegador | MapLibre GL JS estable, `pmtiles` JS, `@protomaps/basemaps` compatible con el archivo y `@types/geojson`. Herramientas explícitas de punto, línea y polígono con MapLibre y formularios. GeoJSON por capa e ID estable, sin recargar el mapa en cada edición. |
| GIS servidor | Supabase PostgreSQL con PostGIS 3, según versión soportada por el proyecto local y remoto. GeoJSON en WGS84 / EPSG:4326 y operaciones de medición y sombras en UTM compatible con el sitio. Para Puebla, validar EPSG:32614. Usar índices GiST donde una consulta espacial los necesite. |
| Autenticación | Supabase Auth, `@supabase/supabase-js` v2 y `@supabase/ssr` compatible. Cookies de sesión según SDK, cliente SSR por solicitud, revalidar identidad en el servidor, sin caché compartida con datos de usuario. |
| Datos/API | Zod 4 para contratos de entrada y entorno, PostgreSQL SQL/PLpgSQL para transacciones, Supabase CLI para migraciones y tipos generados TypeScript. Lógica crítica validada en DB. Crear RPCs explícitas para escritura y vistas o consultas acotadas para lectura. |
| Mapa de referencia | Extracto regional OSM vía Protomaps PMTiles, `pmtiles` CLI para preparar, estilo y glyphs con fuentes autorizadas, almacenamiento estático con `Range` y CORS verificados. Para fallo del mapa base, mapa sin teselas con GeoJSON local. Rotular la atribución en mapas y capturas según el uso. |
| Solar | SunCalc con versión fijada y typings compatibles para generar ángulos de escenarios curados en un script Node. PostGIS aplica traslación, unión, recorte y área en el cálculo. Datos solares inmutables por escenario. |
| Verificación | Vitest para contratos y utilidades, fast-check para propiedades, pgTAP vía Supabase CLI para funciones, restricciones, permisos y cálculos, Playwright para recorridos, axe dentro de Playwright y verificación manual de teclado. GitHub Actions para CI. |
| Entornos | Kiro IDE para todo el desarrollo, Docker y Supabase CLI en local, Vercel para Next.js y Supabase alojado para PostgreSQL/Auth. Preview y producción usan proyectos de datos separados o preview queda local hasta contar con aislamiento. Hosting alternativo Node compatible si el equipo ya lo tiene contratado. |
| Formatos | GeoJSON RFC 7946, JSON documentado, CSV UTF-8 compatible con hojas de cálculo y HTML imprimible. Sin servidor de PDF. Código MIT sujeto a la aprobación del equipo antes de publicar; datos, fuentes y teselas conservan sus propias licencias. |

Referencias técnicas: [Next.js](https://nextjs.org/docs/app/getting-started/installation) · [Node en Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) · [Supabase con Next.js](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs) · [PostGIS en Supabase](https://supabase.com/docs/guides/database/extensions/postgis) · [MapLibre GeoJSON](https://maplibre.org/maplibre-gl-js/docs/API/classes/GeoJSONSource/) · [PMTiles y MapLibre](https://docs.protomaps.com/pmtiles/maplibre) · [SunCalc](https://github.com/mourner/suncalc) · [GeoJSON](https://www.rfc-editor.org/info/rfc7946/)

### 4.1 Estructura del repositorio

```text
FORK-THE-CITY-PLAN-KIRO.md
.kiro/steering/{product,tech,structure}.md
.kiro/specs/<nombre>/{requirements,design,tasks}.md
.kiro/hooks/                              # formato generado por la versión instalada
src/app/[locale]/                         # pantallas ES/EN
src/app/api/v1/                           # contratos HTTP
src/features/{places,editor,versions,compare,community,tracking}/
src/lib/{schemas,auth,supabase,i18n,geo,format}/
src/messages/{es,en}.json
supabase/{config.toml,migrations,tests,seed.sql}
data/sites/<slug>/                        # fuentes, metadatos y datos redistribuibles
scripts/                                  # importación, provisionado local, escenarios, verificación
tests/{unit,e2e,fixtures}/
docs/{validation,progress,kiro-evidence,data-sources,release,runbook}.md
docs/adr/
.github/workflows/ci.yml
.env.example
README.md
LICENSE
THIRD_PARTY_NOTICES.md
```

En módulos puros evitar dependencias de UI. Cambios de esquema solo por migración revisable. El cliente no importa módulos server-only, secretos ni modelos de sesión de otros usuarios. No se necesita LLM en el runtime. Los datos, los permisos y los resultados deben mantenerse utilizables cuando Kiro no esté abierto.

## 5. Modelo de datos y reglas transaccionales

Usar UUID, PK/FK reales, tiempos UTC con `timestamptz`, alias públicos y proyecciones de lectura que nunca devuelvan datos de `auth.users`. Todas las referencias a sitio, rama, revisión y elemento que atraviesan tablas deben comprobar compatibilidad de sitio mediante claves compuestas o validación en DB. `created_at` y actor se generan en servidor. Archivar contenido y retener historial según política del equipo. Incluir estrategia de retirada de datos personales que preserve un actor anonimizado cuando aplique.

| Entidad | Campos y restricciones principales |
|---|---|
| `profiles`, `site_roles` | Perfil vinculado a Auth, alias y variante de configuración privada si existe. Tabla de rol con sitio, usuario, tipo y unicidad. Asignación solo por operador. |
| `sites`, `site_baselines` | Slug único, nombre localizable, moneda ISO, zona IANA, SRID proyectado, extensión, límite, zona peatonal, referencias a fuentes y baseline activo. Baselines versionados. |
| `baseline_assets` | ID estable, tipo, geometría, dimensiones, status de cobertura y fuente. Ejemplos: árbol observado, zona de conexión, plaza inventariada, polígono protegido. Los cambios a un levantamiento generan un baseline distinto. |
| `branches` | Sitio, baseline, dueño, nombre, revisión de origen, revisión actual, metadatos y ocultación lógica. Publicación explícita de revisiones. Una rama puede tener una revisión pública y una cabeza privada simultáneamente. |
| `revisions`, `revision_features` | Inmutables. Rama, sitio, baseline, padre principal, segundo padre opcional, mensaje, autor, catálogo y escenario fijados, marcadores de versión y hash opcional. Snapshot por revisión con ID estable de elemento, clase, campos canónicos y geometría. Unicidad por revisión y elemento. |
| `publications` | Revisión, rama, fecha, identificador público y estado de moderación. La etiqueta pública y el resumen deben quedar fijados en la publicación. Mantener historial con último publicado derivado o puntero transaccional. |
| `catalog_versions`, `catalog_items`, `analysis_scenarios`, `revision_metrics` | Versiones inmutables, moneda, unidad, intervalos de precio, campos físicos, fuente y supuestos. Métricas con indicador de completitud, detalle, contexto y resultado. El resultado del caso predeterminado se registra al guardar y se puede recomputar con sus entradas. |
| `comments`, `supports`, `reports`, `moderation_events` | Comentario por publicación con elemento opcional de esa revisión, texto y visibilidad. Apoyo único por usuario y revisión publicada. Reporte privado para moderación. Historial de ocultaciones y restauraciones. |
| `dossiers`, `dossier_milestones`, `dossier_events`, `evidence_items` | Expediente único por publicación, sitio y responsable, estado, nota inicial. Hitos con fecha y estado. Eventos con anterior, nuevo, actor y motivo. Evidencia como URL HTTPS validada sintácticamente, título, fecha y descripción. El servidor no solicita la URL del usuario. |
| `mutation_requests`, `rate_windows` | Idempotencia por actor, operación y clave con hash de payload canónico, resultado y fecha. Contadores atómicos por actor, acción y ventana. Límites comprobados tanto por ruta como por transacción cuando aplique. |

### 5.1 Contratos y límites

- GeoJSON solo posición finita `[longitud, latitud]`, 2D, SRID 4326. Geometrías de edición `Point`, `LineString` o `Polygon` simple sin agujeros para la primera versión. Se permiten multipartes generadas por análisis en salida. Cerrar anillos y configurar precisión canónica de seis decimales. Normalizar orientación, origen del anillo y valores antes del hash/diff. Validar la geometría resultante tras redondear. Documentar igualdad de propiedades y tolerancia. La identidad depende del UUID del elemento y no de la forma.
- Guardar geometrías válidas y no vacías. Usar `ST_IsValid`, `ST_IsSimple` en líneas y `ST_Covers` contra el límite del piloto. Aplicar reglas de tipo y alertas con geometría proyectada. Aceptar solo listados conocidos de propiedades bien tipadas. Rechazar coordenadas fuera de rango, anillos degenerados y relaciones inválidas.
- Valores iniciales verificados en fase 0: 200 elementos por revisión, 100 vértices por elemento dibujado, 512 KiB por mutación, 100 caracteres para títulos y 1,000 para comentarios. Límite de 20 elementos por página para hilos e historial, con máximo de 50. Limitar candidatos y tiempo de consulta. Ajustar umbrales con una decisión registrada y datos medidos.
- Lecturas privadas devuelven 404 cuando revelar existencia sería un problema. Errores públicos en formato estable `{code,message,details?,requestId}`; 400 JSON malformado, 401 sin sesión, 403 permiso insuficiente en recurso ya visible, 404 recurso ausente o invisible, 409 conflicto de versión o idempotencia, 413 tamaño, 422 reglas de dominio, 429 límites con `Retry-After` cuando proceda, 500 mensaje genérico. Traducir por código, sin devolver diagnósticos SQL.
- API versionada: `GET /api/v1/sites`, `GET /api/v1/sites/:slug`, `GET /api/v1/revisions/:id`, `POST /api/v1/branches`, `POST /api/v1/branches/:id/revisions`, `POST /api/v1/revisions/:id/publish`, `GET /api/v1/compare?left=&right=&scenario=`, `POST /api/v1/branches/:id/merge/preview`, `POST /api/v1/branches/:id/merge/commit`, `GET|POST /api/v1/publications/:id/comments`, `PUT|DELETE /api/v1/publications/:id/support`, `POST /api/v1/reports`, `POST /api/v1/reports/:id/resolve`, `POST /api/v1/publications/:id/dossier`, `GET /api/v1/dossiers/:id`, `POST /api/v1/dossiers/:id/events`, `GET /api/v1/dossiers/:id/export?format=`. Añadir recursos explícitos para hitos cuando no sean un tipo de evento. Definir esquemas de solicitud y respuesta y ejemplos en `design.md`. En consultas y enlaces, diferenciar lectura pública de acceso autenticado a borradores.
- Las mutaciones de revisión llevan `expectedHeadId`, operaciones normalizadas y `Idempotency-Key`. Comparar la cabeza con bloqueo de fila o compare-and-set en la transacción. Validar, materializar snapshot, guardar métricas, actualizar cabeza y registrar idempotencia de forma atómica. Si se reintenta la misma clave con distinto contenido devolver 409. Si falla una etapa, revertir todo. No reemplazar el borrador local sobre un 409. Ofrecer recarga y reaplicación revisable.
- Priorizar snapshots completos pequeños con índices por rama/fecha y revisión/elemento. Las lecturas de una revisión no reproducen un historial ilimitado. Aplicar límites al cálculo de ancestros y pruebas sobre un conjunto de al menos 25 revisiones con 200 intervenciones. Versionar parámetros por revisión para prevenir cambios retroactivos.

### 5.2 Bifurcación, comparación y fusión

1. **Baselines y ramas.** El estado base se referencia por ID. La rama hija copia la foto exacta de la revisión pública elegida, conserva IDs de elementos y usa esa revisión como padre principal de su primera revisión. Los agregados reciben UUID nuevos. La primera revisión se crea en la misma transacción que la rama. Una rama nueva desde el baseline usa su representación canónica como ancestro sintético. Una consulta pública no devuelve IDs, mensajes ni autores de un padre privado. Renderiza «revisión privada» sin enlace o colapsa el tramo del historial.
2. **Diff.** Unir por ID y clasificar igual, agregado, eliminado o modificado. Un cambio indica propiedades y/o geometría. Mostrar conteos por clase y cambios de métricas. La UI no confunde el estado «existente en el sitio» con «presente en una propuesta».
3. **Fusión de tres vías.** Exigir mismo sitio y mismo baseline. Encontrar el ancestro común más cercano por cadena de padre principal, como regla de la primera versión, con orden determinista y límite de recorrido. Registrar el segundo padre como procedencia de la importación. Si no hay ancestro admitido, indicar incompatibilidad. No implementar historial arbitrario ni reclasificar fuentes por fecha. Para cada elemento comparar A, B y ancestro. Un lado cambió: conservar ese cambio. Ambos hicieron el mismo cambio: conservarlo una vez. Ambos cambiaron de forma diferente: pedir resolución. Edición contra eliminación también es conflicto. Después ejecutar validaciones de espacio sobre el conjunto combinado, incluso si los elementos conflictivos tienen UUID distintos.
4. **Conflicto espacial.** Empezar con superposición de zonas de ocupación exclusiva para una franja, más reutilización de plaza. Detectar intersección con área mayor al umbral del sitio e identificar los dos elementos. El caso del video debe usar una cubierta con zona de implantación exclusiva documentada y puestos en la misma franja sobre esa zona. Sombra proyectada por sí sola no provoca conflicto. Las soluciones son conservar uno, quitar uno o mover/redibujar y volver a validar. No autoajustar geometrías.
5. **Confirmación.** El servidor vuelve a computar comparación y reglas con los IDs exactos. Comprueba permisos y vigencia de la publicación de origen dentro de la transacción, verifica cabeza y aplica resolución. Escribe un segundo padre y un resumen de decisiones, conservando autores. Si hay resoluciones faltantes o cabeza antigua, no guarda. Fusionar una fuente oculta posteriormente no borra cambios ya materializados. Mostrar que la referencia dejó de estar disponible y permitir moderar el derivado como contenido independiente.

### 5.3 Indicadores y presupuesto

**Contexto común.** Fijar baseline, país/moneda, alcance, modelo, fecha/instante de análisis, catálogo y configuración. Cada cálculo devuelve valores, unidades, parámetros, avisos de cobertura y procedencia. Comparar entre revisiones con distinta versión de catálogo mediante un contexto explícito o desactivar delta de precio. Los valores históricos siguen consultables. No combinar monedas ni traducir porcentajes faltantes a cero.

**Sombra modelada.** Precomputar posición solar para escenarios curados por sitio usando fecha/hora de la zona IANA, instante UTC, latitud y longitud. El script genera azimut medido desde el norte en sentido horario y elevación en radianes, confirmando la convención de la versión fijada de SunCalc con una prueba conocida. PostGIS proyecta geometrías al SRID métrico del sitio. Para un plano horizontal de altura H, el desplazamiento de sombra es `H / tan(elevación)` en dirección opuesta al sol. Usar componentes este/norte `-d*sin(azimut), -d*cos(azimut)`. Árbol: disco aproximado de radio de copa a altura de catálogo. Cubierta: traslación del polígono de cubierta. Unir sombras, recortar por superficie peatonal de referencia y dividir área sombreada entre área de superficie válida para el porcentaje. Limitar escenarios a elevación solar de al menos 10°, con explicación para los casos fuera del rango; validar este umbral en el ADR. Capturar variación con dos momentos curados. Medir m² modelados y porcentaje bajo el mismo denominador. El método asume suelo plano y no incluye edificios u objetos sin geometría y altura. Si el inventario existente es parcial, mostrar «sombra modelada de los elementos inventariados» y destacar la cobertura incompleta.

**Ocupación y otros indicadores.** Unir polígonos de ocupación por franja para evitar doble conteo. Mostrar área de referencia, cantidad de puestos propuestos, cantidad de plazas afectadas si hay inventario, longitud de cruces, y saldo de superficie disponible en el alcance. Explicar que cabida por área es preliminar y que faltan verificaciones de circulación, permisos y otros requisitos locales.

**Costos.** Partidas derivadas del delta frente al baseline (agregar, modificar o retirar cuando existe concepto). Una partida conserva unidad (`u`, `m`, `m²`, `jornada`), cantidad, fórmula, código de catálogo, rango de precio unitario y fecha. Importe por línea igual a cantidad por precio unitario inferior y superior. Sumar extremos, mostrar conceptos desconocidos e indicar inclusiones, impuestos y contingencia por separado si se configuran. Usar `numeric` o centavos enteros según el contrato; redondear por línea con la regla publicada y sumar líneas redondeadas. Cada exportación contiene fuente, moneda, regla de redondeo y escenario. Precios ilustrativos deben decir «supuesto de evaluación» con fecha y responsable del supuesto. Un presupuesto íntegramente ilustrativo debe estar rotulado como tal en pantalla y exportación. Los datos presupuestarios se usan como comparación orientativa.

### 5.4 Seguimiento

Estados: `en_revision → planeado → en_ejecucion → ejecutado`. Desde los tres primeros se admite `descartado` con motivo. El operador debe documentar el procedimiento de corrección cuando un cierre se registra por error, con un evento adicional y trazabilidad. El rol coordinador verifica expediente y transición en DB. Planear requiere responsable público voluntario o nombre de equipo autorizado y al menos un hito. Comenzar ejecución requiere nota de avance con evidencia o referencia verificable. Marcar ejecutado requiere evidencia y una descripción de lo observado y de su diferencia frente a la revisión propuesta. Mostrar claramente quién registró la evidencia y si fue verificada por el equipo. Ocultar la revisión pública afecta la lectura pública de su expediente y descargas.

## 6. Datos, permisos y operación

### 6.1 Ingestión y procedencia

- Crear un manifiesto de sitio con `id, slug, sourceUrl, sourceKind, license, attribution, captureDate, retrievedAt, boundingBox, projection, timezone, currency, completeness, checksum` y detalle por capa. Identificar medición propia, dato abierto, aproximación o fixture. Revisar cobertura y derechos antes de incluir datos. Incluir el manifiesto en la vista del sitio y el README.
- Documentar el recorte PMTiles, origen fechado, zoom y hash. El extracto, los glyphs y los sprites deben estar disponibles desde ubicaciones autorizadas. Mantener atribución visible a OpenStreetMap y seguir los términos de Protomaps y de cada recurso. Si faltan derechos, remover el artefacto y elegir otra fuente. Preparar un paquete local de GeoJSON y estilo básico con licencia clara, con capas de autoría propia o redistribuibles. Si hay marcadores de prueba, distinguirlos de mediciones. Comprobar tamaño, CORS, `206 Partial Content` y estrategia de caché. [Descargas y recorte](https://docs.protomaps.com/basemaps/downloads) · [Licencia de OpenStreetMap](https://www.openstreetmap.org/copyright)
- La importación valida geometrías, manifiesto y catálogo; ofrecer modo de simulación y ejecución idempotente. Cargar cambios reales como nuevas versiones. No rellenar números de campo con valores inventados. Documentar fuentes descartadas y por qué. Separar seed demostrativo de migraciones de esquema y tener dos escenas reproducibles: datos ficticios para CI y una propuesta hipotética en un lugar real para evaluación.
- Para operación normal, fuente de tiles y datos estáticos independientes de servicios de geocodificación en vivo. Si MapLibre o WebGL fallan, mostrar un mapa esquemático o vista previa estática y las tablas/formularios disponibles. El editor tiene selección de vértices y entrada manual.

### 6.2 Seguridad, privacidad y moderación

- RLS en todas las tablas expuestas. Lectura pública mediante vistas con `security_invoker` bajo políticas correctas, o RPCs explícitas que proyecten un subconjunto y comprueben visibilidad. Si una política permite consultar una fila sensible, limitar columnas o pasar la tabla a esquema privado. Proteger también metadatos, conteos, historial, ancestros, descargas y endpoints directos de Supabase. Mantener la lógica de autorización en una capa de base de datos con pruebas.
- Mutaciones complejas por función transaccional, con identidad `auth.uid()` y permisos del sitio comprobados dentro de la función. Revocar escritura directa a tablas para los roles expuestos. Si se usa `SECURITY DEFINER`, fijar `search_path` vacío, calificar todos los objetos, restringir propietario a los permisos necesarios y revocar `EXECUTE` por defecto de `PUBLIC`, `anon` y `authenticated` antes de dar permisos por función. Demostrar visibilidad para visitantes, autor, otro participante y coordinador de otro sitio. Nunca colocar claves de administración en web; aprovisionado fuera de rutas públicas. [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) · [Funciones de base de datos](https://supabase.com/docs/guides/database/functions)
- Mutación HTTP solo desde orígenes permitidos, cookies seguras en producción y flujos SSR/PKCE según el SDK. Validar origen y sesión en servidor. Ajustar políticas de autenticación de Supabase, incluir confirmación de correo y CAPTCHA si se habilita registro público con riesgo de abuso. Límites persistentes iniciales por cuenta: 10 comentarios y 10 reportes por hora, 10 ramas por hora y 30 operaciones de guardado por minuto, revisables. Prevención de abuso de signup mediante Supabase. Los límites no sustituyen moderación.
- Tratar títulos y comentarios como texto plano. Mitigar fórmulas al exportar CSV. URLs externas HTTPS, validación de esquema, abrir con `noopener noreferrer`, mostrar dominio y evitar consumo automático. Aplicar encabezados de seguridad compatibles con MapLibre, autenticación y assets. Probar política de contenido antes de fijarla. Registrar IDs y códigos de error, sin cookies, credenciales ni contenido sensible.
- Privacidad en prototipo: alias, sin teléfono ni domicilio, sin HTML de terceros ni archivos adjuntos. No solicitar datos de vecinos, responsables reales o verificadores sin consentimiento. Moderación con motivo visible cuando proceda y auditoría privada. Documentar procedimiento para retirar contenido, deshabilitar cuentas y rotar credenciales.

### 6.3 Despliegue y recuperación

- Variables de ejemplo: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_MAP_STYLE_URL` si se sirve externo. `APP_ALLOWED_ORIGINS` y claves administrativas de importación o cuentas de prueba solo para servidor o herramienta fuera del runtime. La web funciona con la clave pública y los permisos de la sesión. Documentar qué se usa en build, runtime y scripts. Validar esquema y omitir secretos de Git. Mantener `.kiro/` fuera de las exclusiones del repositorio.
- Crear README con prerrequisitos, `npm ci`, `npx supabase start`, `npx supabase db reset` **solo en local**, aprovisionado local, `npm run dev`, comandos de pruebas, seed, acceso y diagnósticos. Fijar Supabase CLI en el proyecto. Documentar cómo obtener URL y clave pública locales sin escribir secretos en archivos versionados. Incluir un smoke test que arranque desde clon limpio.
- Promoción: validar desde local con seed, aplicar migraciones a preview aislado, ejecutar smoke, reservar snapshot o respaldo según el servicio, aplicar migraciones compatibles al destino y desplegar el mismo commit. Registrar versión, migración y rollback. Revertir la aplicación a la versión anterior cuando el esquema lo permita. Para cambios de base, preparar migración correctiva y restauración probada en local. Ningún script ejecuta reset remoto ni publica por defecto.
- Mantener app disponible para el jurado hasta el cierre del periodo de evaluación del 29 de enero de 2027 a las 13:00 PST / 16:00 EST. Confirmar acceso, presupuesto o cuotas, reglas de inactividad, credenciales de evaluación y contacto del equipo. Ensayar falla de mapa base y de email. Si las cuentas del equipo o el acceso de despliegue faltan, preparar migraciones, entorno local y paquete de entrega con instrucciones verificadas para que el equipo pueda publicarlo.

## 7. Verificación, rendimiento y criterios de salida

**Antes de cerrar cada tarea,** vincular requisito, cambio, comando ejecutado y resultado. Documentar lo que se probó en la máquina y en el entorno publicado por separado. Los umbrales de rendimiento son objetivos iniciales que se validan en fase 0. Cualquier cambio debe basarse en métricas y quedar registrado.

| Área | Casos mínimos |
|---|---|
| Dominio | Alta, edición y borrado de los cuatro tipos; rechazo de coordenadas inválidas; límites del sitio; validación del anclaje de comentario; cantidades y rangos monetarios. |
| Historial | Guardar, publicar, revisar de nuevo en privado, compartir enlace histórico, bifurcar una publicación, conservar procedencia y bloquear una escritura concurrente. |
| Fusión | Fuentes iguales, cambios disjuntos, mismo cambio en ambos lados, eliminación contra edición, edición contra edición, solapamiento entre IDs distintos, incompatibilidad de baseline, fuente ocultada y resolución completa. |
| Propiedades | La comparación de una revisión consigo misma tiene delta cero. Cambios disjuntos conservan ambos conjuntos de ediciones. Una repetición de solicitud no agrega revisiones. La sombra de la unión no excede el área peatonal. Un presupuesto completo conserva inferior ≤ superior y su total coincide con las líneas según la regla de redondeo. Comparar no cambia snapshots. Correr con semillas registradas y guardar contraejemplos como casos de regresión. |
| Base de datos | Migrar desde limpio, tablas y vistas privadas, RPC sin permiso, salida reducida de proyecciones públicas, revocaciones, idempotencia en carrera, concurrencia, rollback y restricciones de referencias. Probar aislamiento de email, revisiones privadas y roles de otro sitio para rutas y llamadas directas permitidas por el SDK. |
| Cálculo | Geometrías simples con resultados conocidos, sombra de dos objetos en la misma área, sombra fuera de límite, orientación solar, escala, zona horaria, costo parcial y límites de inventario. Comparar con tolerancia publicada para área y exactitud decimal en moneda. |
| Comunidad | Dos cuentas comentan y ven el resultado, un apoyo repetido cuenta una vez, retirar apoyo, someter reporte, moderar, retirar visibilidad y verificar efecto en exportaciones y conteos. |
| Expediente | Usuario sin rol no puede promover. Coordinador genera expediente y asigna hito, cierre sin evidencia bloqueado, actor registrado, descarga GeoJSON válida y CSV sin ejecución de fórmulas. |
| Usabilidad | 360 px, escritorio, teclado, alternativas al mapa, zoom, contraste, estados y lectores de pantalla en recorridos críticos. Meta WCAG 2.2 AA en el flujo principal. Ejecutar axe como apoyo y revisión manual, sin afirmar certificación. |
| Extremo a extremo | Playwright Chromium, WebKit y Firefox en flujos representativos, con fallback cuando WebGL no se ejecute. Ejecutar al menos un flujo con mapa real en navegador con WebGL; el uso del fallback no sustituye esa prueba. Simular red interrumpida y respuestas lentas. |

**Rendimiento inicial:** con sitio de 200 elementos, en perfil de navegador y red anotados, llegar a interacción con el mapa en ≤4 s en el p75 y completar una comparación en ≤1.5 s en el p95 de al menos 30 peticiones representativas en entorno de prueba, excluyendo arranque en frío del segundo objetivo y reportándolo aparte. Si no se cumple, capturar tiempos de traslado, red, SQL y render antes de decidir. Lazy loading del mapa, un canvas por defecto, caché por artefacto inmutable, paginación por cursor e índices según consultas medibles. Lectura autenticada y contenido sujeto a moderación usan `no-store` inicialmente. Recursos estáticos públicos cacheados por versión. Medir tamaño de payload y usar logs por solicitud con IDs de correlación en el servidor. Probar fallback de tiles sobre fallo controlado.

**Comandos que el repo debe exponer:** `npm run lint`, `npm run typecheck`, `npm run test:unit`, `npm run test:db`, `npm run test:e2e`, `npm run build`, `npm run check` para comprobaciones rápidas y `npm run check:ci` para la secuencia completa con infraestructura de prueba. Los scripts deben fallar cuando una comprobación falla. Ejecutar `build` con valores compatibles y sin hacer que el empaquetado dependa de un servicio remoto no probado.

**Definición de terminado:** criterios de todos los requisitos implementados en una aplicación instalable, enlaces públicos e históricos probados, persistencia y permisos verificados, datos con licencia y cobertura documentadas, informe de pruebas del release, inglés completo para el jurado, instrucciones de operación y acceso al deploy de evaluación confirmado una vez publicado. Si algún criterio sigue abierto, enumerarlo con impacto en `docs/release.md`. [Correctness en Kiro](https://kiro.dev/docs/specs/correctness/) · [Playwright](https://playwright.dev/docs/test-projects) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## 8. Ejecución en Kiro

### Fase 0. Validación inicial y primera Spec

1. Inspeccionar raíz, estado Git, documentación del repo, sistema, versión de Kiro, Node, npm, Docker, Supabase CLI y acceso a paquetes. Confirmar que el repositorio es para Fork the City antes de introducir código. Registrar resultados medidos, enlaces consultados y comandos. Separar elecciones confirmadas, pendientes y alternativas. Verificar rango de versiones e incompatibilidades conocidas, no fijar parches arbitrarios.
2. Validar la categoría y fechas de Devpost, URLs y estructura que pide la entrega. Confirmar que el proyecto se inicia dentro de la ventana nueva. Abrir un apartado para dependencias, licencias y el trabajo previo que se incorpore. Registrar créditos y cuentas de servicio solo por estado de disponibilidad. Las credenciales viven fuera del repositorio.
3. Preparar una comprobación pequeña de viabilidad de datos. Obtener sitio verificable, límite y área peatonal, fuentes que se puedan usar, posición y zona IANA, extensión métrica y uso de datos incompletos. Valorar el Zócalo como hipótesis y anotar la decisión. Verificar MapLibre con GeoJSON, PMTiles con Range/CORS donde esté disponible, instalación local de PostGIS y prueba de lectura pública versus borrador en esquemas mínimos. Documentar alternativas: GeoJSON local para mapa base, fixtures para pruebas y cuentas preaprovisionadas para evaluación.
4. Crear steering de producto, stack y estructura. Iniciar `01-foundation-place` desde **Feature Specs → Requirements-First**. Generar `requirements.md` con FT-01, FT-02 y fundación de FT-17, `design.md` con decisiones comprobadas, y `tasks.md` con dependencias y verificación. Registrar la salida en `docs/validation.md`. Avanzar a la primera tarea ejecutable de la Spec una vez que el IDE permita ejecutarla.
5. Si una dependencia externa bloquea una parte, delimitar la tarea, probar la alternativa y seguir el trabajo local restante. Registrar lo bloqueado y el efecto sobre el release. No copiar archivos de otros proyectos ni usar credenciales de un entorno ajeno.

### Secuencia de Specs y calendario propuesto

| Fechas de noviembre/diciembre 2026 | Spec y dependencias | Resultado observable |
|---|---|---|
| 19–20 nov | Fase 0 y `01-foundation-place` · FT-01, FT-02, FT-17 | App local, sitio visible con variante sin tiles, dos cuentas de prueba, migraciones reproducibles, CI inicial. |
| 21–24 nov | `02-editor-versions` · FT-03 a FT-06. Depende de 01. | Crear rama, editar, conservar revisión y publicar enlaces exactos. Prueba de concurrencia e idempotencia. |
| 24–27 nov | `03-analysis-compare-merge` · FT-07, FT-08, FT-11, FT-12. Depende de 02. | Dos revisiones comparables, presupuesto y sombra calculados, conflicto espacial resuelto con ambos padres. |
| 27–29 nov | `04-community-moderation` · FT-09, FT-10. Depende de publicación de 02. | Comentarios, apoyo reversible, moderación con privacidad y auditoría. |
| 29 nov–1 dic | `05-dossiers` · FT-13 a FT-15. Depende de 02 y 03 y aplica visibilidad de 04. | Promoción, responsable, hitos, cambios de estado, evidencia y descargas. |
| 1–3 dic | `06-release-evidence` · FT-16 a FT-18 y regresión. Depende de los recorridos. | Recorrido completo en inglés y español, pruebas de acceso y navegador, comprobación de despliegue, README, video y texto. |
| 3 dic | Margen recomendado | Entregar antes del día de cierre, tras revisar URL, licencia, credenciales y grabación. |

FT-16, FT-17 y FT-18 se aplican durante todas las Specs y se comprueban al cierre. Las fechas son una estimación inicial para un equipo pequeño que usa Kiro como implementador. Kiro debe actualizarla con el avance de la fase 0. En caso de atraso, preservar el recorrido completo sobre un sitio, reescalar el número de escenarios, capas y mejoras visuales. Solo retirar un requisito mediante una decisión escrita que indique el impacto y actualice la entrega. Las integraciones con cuentas de equipo, la aprobación de licencias y la publicación requieren intervención del equipo si Kiro carece de acceso.

### Cómo trabajar y guardar evidencia real

- **Specs.** Un conjunto pequeño por bloque. En `design.md`, incluir contratos, modelo de datos, permisos, estados y propiedades rastreables. En `tasks.md`, cada tarea indica archivos o módulo, dependencias, requisito y comando de comprobación. Partir la tarea si no deja un comportamiento verificable. Usar los controles del IDE para ejecutar por dependencias y registrar estado.
- **Steering.** `product.md` explica usuario y recorrido. `tech.md` fija versiones, contratos y fuentes. `structure.md` delimita cliente, servidor y base. Añadir guía de análisis con reglas geográficas, evidencia y política de datos si se repite en varias Specs. Actualizar steering cuando una decisión comprobada cambia.
- **Hook.** Crear desde el IDE un hook al completar tareas del dominio si la versión lo soporta. Ejecutar una comprobación local corta, sin publicar ni modificar archivos de datos. Usar el trigger de tarea disponible y documentar el formato real generado y el comando. Si el IDE instalado no lo soporta, seleccionar un evento acotado de guardado de los archivos pertinentes o documentar la verificación manual. Capturar un resultado real del hook.
- **Pruebas de propiedades.** Pedir a Kiro derivar propiedades de FT-05, FT-07, FT-08, FT-11 y FT-12. Traducirlas a fast-check o pgTAP según dónde viva la regla y ejecutar la suite. Registrar semilla, hallazgo, arreglo y enlace a la prueba. Un hallazgo solo se comunica si se reproduce.
- **Contexto de ejecución.** Kiro mantiene `docs/progress.md` con Spec, tarea, salida, pendientes y bloqueos. Registrar decisiones de alcance, estrategia de snapshots/merge, autenticación, mapas y costos como ADRs. No modificar migraciones aplicadas. Al reanudar, revisar Git y trabajo concurrente para no sobreescribir ajeno.
- **Evidencia.** `docs/kiro-evidence.md` vincula un requisito, una decisión o experimento, el artefacto de Kiro y el resultado. Incluir cuándo se usó el IDE y cómo cambió el desarrollo, con commits o rutas. Registrar herramientas adicionales solo si su uso fue real. El valor se demuestra con el resultado de cada herramienta, no con su número. [Steering](https://kiro.dev/docs/steering/) · [Triggers de hooks](https://kiro.dev/docs/hooks/types/)

## 9. Preparación de la entrega

1. **Aplicación funcional:** URL accesible para el jurado, instrucciones de prueba en inglés, acceso gratuito durante evaluación y credenciales de prueba en el campo privado de Devpost cuando sean necesarias. Comprobar desde sesión limpia y dispositivo distinto que no requieren acceso interno.
2. **GitHub público:** código, assets autorizados, instrucciones reproducibles, licencia abierta visible, carpeta `.kiro` en la raíz y sin ignorar. Revisar archivos versionados y excluir claves, usuarios reales, configuraciones privadas, evidencias sensibles y datos no redistribuibles. Vincular el commit disponible en el despliegue.
3. **Descripción en inglés:** problema, audiencia, caso real, tecnologías que se combinan, qué mide el motor, flujo, fuentes, limitaciones y uso efectivo de Kiro. Guardar texto y guía de prueba en artefactos revisables.
4. **Video público en YouTube de menos de tres minutos:** 0:00–0:22, sitio y decisión del colectivo; 0:22–0:55, crear o abrir una rama y publicar dos alternativas; 0:55–1:48, comparar y resolver un conflicto real con historial, cambio de costo y sombra; 1:48–2:20, comentarios, expediente, hito y evidencia; 2:20–2:48, cómo una Spec, el hook y una propiedad verificada cambiaron el trabajo. Mostrar ejecución real, utilizar contenido autorizado y revisar audio o subtítulos en inglés. Usar capturas con atribución según las fuentes.
5. **Devpost:** categoría Frankenstein, URL del proyecto, repo y video, resumen de desarrollo con Kiro y nombre del equipo. Completar campos y bonos solo si el equipo es elegible y tiene los materiales exigidos. El representante del equipo verifica y envía el formulario. [Reglas y requisitos de presentación](https://kiroween.devpost.com/rules)

### Primer resultado exigible de Kiro

Después de leer este documento, Kiro debe dejar `docs/validation.md`, el steering y la Spec `01-foundation-place`, y arrancar la primera tarea ejecutable. La primera entrega de código debe permitir levantar la base local, abrir la app, ver el lugar de estudio y distinguir los datos de referencia de un escenario de prueba. La entrega siguiente que demuestra el núcleo del producto es guardar una propuesta, publicarla y bifurcar la revisión publicada desde otra cuenta.
