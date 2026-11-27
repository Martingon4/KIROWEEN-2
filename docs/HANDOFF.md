# Handoff: estado del proyecto y lo que falta

Fork the City (Kiroween 2026, categoría Frankenstein). Repo: `/home/martin/KIROWEEN-2`. Fecha límite: 4 dic 2026, 14:00 PST.
Contexto del producto: `.kiro/steering/*`, `AGENTS.md`, `FORK-THE-CITY-PLAN-KIRO.md`. Historia y evidencia: `docs/progress.md`, `docs/kiro-evidence.md`, ADRs `docs/adr/0001`–`0006`.

## Hecho (Specs 01 a 05, FT-01 a FT-15)
Lugar piloto (Zócalo de Puebla), cuentas y RLS, editor con ramas y revisiones inmutables, publicación, fork, escenarios solares, comparación, fusión con conflictos, comunidad y moderación, expedientes con hitos, evidencia y exportaciones (HTML, GeoJSON, CSV, JSON).
El candidato parte de `81e7fdd` (Specs 01–05), con [GitHub Actions en verde](https://github.com/Martingon4/KIROWEEN-2/actions/runs/45466384450). El registro de la validación local de entrega está en [progress.md](progress.md). La [Spec 06](../.kiro/specs/06-delivery/tasks.md) reúne el guion, Devpost y lo pendiente. La demo usa un solo sitio y el flujo de edición 2D.

## Cómo arrancar
```bash
cd /home/martin/KIROWEEN-2
DO_NOT_TRACK=1 npx supabase start      # Docker
npm run provision:local                # solo tras `supabase db reset`
npm run build && npm run start -- --port 3100
```
Abrir `http://127.0.0.1:3100/es` (usar 127.0.0.1). No usar `npm run dev`: sirve el CSS incompleto. Cuentas de prueba: claves `FTC_*` de `.env.local` (no se versiona).
Playwright reutiliza el servidor del puerto 3100: ciérralo antes de correr E2E si cambiaste código.

## Reglas que no se deben romper
- Migraciones append-only (`supabase/migrations/`); nunca editar una aplicada.
- No secretos en Git. No `git push`, deploy ni servicios remotos sin aprobación del usuario.
- Todo lo propuesto es "hipotético". Los datos reales y los de demostración van en archivos separados.
- Cada acción de mapa tiene alternativa por formulario (teclado, 360 px, ES/EN).
- Antes de usar APIs de Next.js, leer `node_modules/next/dist/docs/` (versión 16, `params` es Promise).
- No afirmar que una comprobación corrió si no corrió; registrar comandos y resultados reales en `docs/progress.md`.

## Pendiente
1. **Publicación del candidato.** Verificar el estado de GitHub Actions en el commit que se publique. El push y el despliegue requieren aprobación y acceso al destino.
2. **Evidencia visual.** La lista de ramas tiene separación entre filas y las siete vistas del recorrido tienen capturas a 1440 y 390 px. Consultar [kiro-evidence.md](kiro-evidence.md).
3. **Grabación y presentación.** Grabar el recorrido de la Spec 06 con subtítulos en inglés y completar los enlaces públicos de Devpost.
4. **Hook de Spec 01 (tarea 8):** sin evidencia de disparo real. Si se disparó en otro chat, debe existir `.kiro/hooks/run.log`; si no existe, dejarlo documentado como no evidenciado.
5. **Aprobación de despliegue.** Confirmar proyecto de Supabase alojado y aplicación de Vercel, y verificar acceso del jurado desde una sesión limpia.
6. **Datos de grabación.** Usar cuentas y propuestas de demostración en un entorno dedicado. Consultar la preparación del ensayo en la Spec 06.

## Limitaciones conocidas (documentadas en ADR 0006)
Sin retirada de evidencia; la corrección solo revierte el último cambio de estado; `targetDate` solo valida forma; la página de expediente no disponible reutiliza la de publicación; un refresco tardío puede reiniciar campos del formulario de gestión en móvil; la vista previa del editor es esquemática (SVG), no un mapa con calles.

## Sin acceso (requiere al usuario)
Supabase alojado, Vercel, Devpost, extracto PMTiles y inventario de estacionamientos.
