# Handoff: estado del proyecto y lo que falta

Fork the City (Kiroween 2026, categoría Frankenstein). Repo: `/home/martin/KIROWEEN-2`. Fecha límite: 4 dic 2026, 14:00 PST.
Contexto del producto: `.kiro/steering/*`, `AGENTS.md`, `FORK-THE-CITY-PLAN-KIRO.md`. Historia y evidencia: `docs/progress.md`, `docs/kiro-evidence.md`, ADRs `docs/adr/0001`–`0006`.

## Hecho (Specs 01 a 05, FT-01 a FT-15)
Lugar piloto (Zócalo de Puebla), cuentas y RLS, editor con ramas y revisiones inmutables, publicación, fork, escenarios solares, comparación, fusión con conflictos, comunidad y moderación, expedientes con hitos, evidencia y exportaciones (HTML, GeoJSON, CSV, JSON).
Último `npm run check:ci` en Node 24 tras reset limpio: exit 0 (unit 462, pgTAP 2835 en 24 archivos, Playwright 135). Después se añadió "colocar tocando la vista previa" en el editor: unit 478, specs editor/merge/fork/publication/compare 90 pasan. **Falta volver a correr `check:ci` completo y actualizar los totales en `docs/progress.md`.**

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
1. **Commit y push** (no hecho; el repo solo tiene "Initial commit" y casi todo está sin versionar). Pedir aprobación al usuario antes del push. Tras el push, mirar que GitHub Actions pase (el CI remoto nunca ha corrido).
2. **Pulido visual** y capturas de evidencia en `docs/kiro-evidence/`: expediente (`/es/dossiers/<id>` y `/manage`) a 1440 px y 390 px, editor, lista de ramas (se ve plana, sin separación), comparación, fusión, moderación. Guardar con un spec Playwright temporal y borrarlo después.
3. **Spec 06 (solo video y entrega):** guion del video, grabación, texto de Devpost, informe final. Crear `.kiro/specs/06-*` con requirements, design y tasks.
4. **Hook de Spec 01 (tarea 8):** sin evidencia de disparo real. Si se disparó en otro chat, debe existir `.kiro/hooks/run.log`; si no existe, dejarlo documentado como no evidenciado.
5. **Ejecutar `npm run check:ci` en Node 24** (`npx --yes -p node@24 -c 'npm run check:ci'`) tras `supabase db reset` + `npm run provision:local`, y anotar los totales exactos.
6. **Limpiar datos de prueba:** la cuenta de participante tiene decenas de ramas creadas por E2E. `db reset` + `provision:local` las borra.

## Limitaciones conocidas (documentadas en ADR 0006)
Sin retirada de evidencia; la corrección solo revierte el último cambio de estado; `targetDate` solo valida forma; la página de expediente no disponible reutiliza la de publicación; un refresco tardío puede reiniciar campos del formulario de gestión en móvil; la vista previa del editor es esquemática (SVG), no un mapa con calles.

## Sin acceso (requiere al usuario)
Supabase alojado, Vercel, Devpost, extracto PMTiles y inventario de estacionamientos.
