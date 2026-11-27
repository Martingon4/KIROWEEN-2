# Diseño de la entrega

La demo está pensada para un colectivo vecinal que prepara una propuesta y para la persona que coordina su seguimiento. Dos grupos quieren usar la misma zona del Zócalo de Puebla, uno para una cubierta de sombra y otro para puestos temporales. Ambos usos son hipotéticos. La persona que coordina puede revisar cómo se resolvió el conflicto y qué falta para cerrar el expediente.

## Preparación del ensayo

- Crear ambas ramas desde la misma línea base. Publicar una cubierta de 4 m desde la primera rama y un mercado de 10 puestos de 6 m² desde la segunda. Usar el mismo escenario solar al comparar.
- Desde la rama de la cubierta, importar la propuesta del mercado y redibujar su huella. Para ensayar con las geometrías del repositorio, usar los vértices de `CANOPY_COORDS`, `MARKET_COORDS` y `MARKET_REDRAW` en [merge.spec.ts](../../../tests/e2e/merge.spec.ts).
- Publicar la fusión y abrirla desde una sesión de coordinación. Configurar responsable e hito, y registrar una referencia de inicio claramente rotulada como ficticia en el entorno de ensayo. Intentar cerrar el expediente sin evidencia nueva y mostrar el mensaje de bloqueo. Abrir luego la página pública en una sesión anónima.

## Guion del video · 2 min 40 s

| Tiempo | Qué se muestra | Narración |
|---|---|---|
| 0:00–0:20 | Ficha del Zócalo y las dos propuestas de demostración. | «Dos grupos quieren mejorar la misma plaza. Uno propone sombra y otro, puestos temporales. Los dos ocuparían la misma zona.» |
| 0:20–0:50 | Comparación A/B bajo el mismo escenario solar. Acercar la captura al área de sombra y al rango de costos. | «Antes de combinar las propuestas, el grupo puede ver qué cambia. La sombra es modelada y los costos son ilustrativos.» Leer los valores visibles de la ejecución grabada. |
| 0:50–1:28 | Vista de fusión. Marcar el conflicto de ocupación, redibujar el mercado, revisar y guardar. Mostrar la procedencia visible. | «La fusión detecta el traslape y pide una decisión. Movemos el mercado y volvemos a comprobarlo. La revisión resultante conserva de dónde salió cada intervención.» |
| 1:28–2:14 | Abrir el expediente como coordinación. Mostrar responsable e hito. Intentar marcar como ejecutado sin evidencia y mostrar el bloqueo. | «La propuesta elegida queda vinculada al expediente. Cuando intentamos cerrar sin evidencia, la app explica qué falta. El estado registra lo que el grupo puede documentar.» |
| 2:14–2:30 | Mostrar la página pública y descargar el HTML del expediente. | «Otra persona puede revisar la propuesta, el estado y los supuestos sin tener que pedir el archivo original.» |
| 2:30–2:40 | Mostrar una Spec y su prueba correspondiente. | «En Kiro documentamos las reglas de fusión y las comprobamos con pruebas del flujo y de la base de datos.» |

Grabar con datos de demostración y usar subtítulos en inglés. El guion deja en pantalla los números observados durante la grabación.

## Texto para Devpost

### Inspiration

Two groups can agree on improving a public square and still propose incompatible uses for the same space. We wanted people to see what changed between proposals and follow the decision after the meeting.

### What it does

Fork the City brings version control to public space. Starting from the Zócalo in Puebla, Mexico, participants create private branches, publish immutable revisions, and compare hypothetical proposals under shared assumptions. A merge flags overlaps and records how people resolved them. A dossier links the selected revision to a responsible party, milestones, and evidence, with downloadable reports and data.

### How we built it

We used Kiro Specs and steering to define revision history, spatial conflicts, and evidence requirements, then tested them with database, unit, and browser checks. The app uses Next.js, Supabase and PostGIS. Geometry and versioned inputs drive the calculations. Shadow coverage is modeled, costs are illustrative, and people make the decisions.

### Demo and next steps

Our demo shows a canopy and a temporary market competing for the same part of the square. We compare them, resolve the conflict, and try to close the dossier without evidence. The app blocks closure and shows what is missing. The next product question is whether a neighborhood facilitator can take that dossier into a real discussion and explain the trade-off.

## Informe de entrega

- **Caso demostrado.** Cubierta de sombra y mercado temporal en el Zócalo de Puebla. La decisión del grupo se conserva como revisión y puede seguirse en un expediente.
- **Candidato de aplicación.** Commit `81e7fdd` de las Specs 01–05. [GitHub Actions](https://github.com/Martingon4/KIROWEEN-2/actions/runs/45466384450).
- **Verificación y capturas.** Los resultados observados se registran en [progress.md](../../../docs/progress.md) y [kiro-evidence.md](../../../docs/kiro-evidence.md).
- **Documento para compartir.** La descarga HTML del expediente incluye la propuesta y sus supuestos. GeoJSON, CSV y JSON están disponibles como exportaciones de datos.
- **Publicación.** Faltan el destino autorizado para Supabase y Vercel, la verificación pública del despliegue y la grabación final.
