import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { parseCsv } from "../../src/lib/format/csv";
import { validateGeoJson } from "../../src/lib/geo/export";
import {
  addDefaultCanopy,
  api,
  createBranch,
  openEditor,
  signIn,
  type ApiResult,
  type TestAccount,
} from "./helpers";

const DB_CONTAINER = "supabase_db_KIROWEEN-2";
const PAST_DATE = "2025-03-10";

/**
 * Borra las ventanas de límite de uso de las cuentas de prueba para que repetir la suite
 * no choque con el límite por hora. Los correos van como variables de psql y los
 * argumentos como arreglo, sin shell.
 */
function clearRateWindows(accounts: TestAccount[]) {
  const emails = accounts
    .map((account) => process.env[`FTC_${account.toUpperCase()}_EMAIL`])
    .filter((email): email is string => Boolean(email));
  if (emails.length === 0) return;
  const variables = emails.flatMap((email, index) => [
    "-v",
    `e${index}=${email}`,
  ]);
  const list = emails.map((_email, index) => `:'e${index}'`).join(", ");
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        DB_CONTAINER,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        ...variables,
        "-f",
        "-",
      ],
      {
        input: `delete from public.rate_windows where actor_id in (select id from auth.users where email in (${list}));`,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  } catch {
    throw new Error("No se pudieron limpiar las ventanas de límite de uso.");
  }
}

test.beforeEach(() => {
  clearRateWindows(["participant", "coordinator", "moderator"]);
});

async function withContext<T>(
  browser: Browser,
  baseURL: string | undefined,
  account: TestAccount | null,
  run: (page: Page, context: BrowserContext) => Promise<T>,
) {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    if (account) await signIn(page, account);
    else await page.goto("/es");
    return await run(page, context);
  } finally {
    await context.close();
  }
}

type Published = {
  publicationId: string;
  href: string;
  label: string;
  featureCount: number;
};

/**
 * Crea una rama con N cubiertas, la guarda y la publica por la API con una etiqueta
 * propia (así se puede probar texto hostil en las exportaciones).
 */
async function publishProposal(
  page: Page,
  label: string,
  publicLabel: string,
  featureCount = 1,
): Promise<Published> {
  const { branchId } = await createBranch(page, label);
  await openEditor(page, branchId);
  for (let index = 0; index < featureCount; index += 1) {
    await addDefaultCanopy(page);
  }
  await page.getByLabel("Describe el cambio").fill("Guardar para expediente");
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByText(/Revisión guardada\. Ahora es/)).toBeVisible();
  await expect(page.getByText("Sin cambios pendientes")).toBeVisible();
  const head = await api(page, `/api/v1/branches/${branchId}`);
  expect(head.status).toBe(200);
  const revisionId = head.body!.data.revisionId as string;
  const published = await api(page, `/api/v1/revisions/${revisionId}/publish`, {
    method: "POST",
    key: randomUUID(),
    body: { label: publicLabel, summary: "Resumen para expediente" },
  });
  expect(published.status).toBe(201);
  const publicationId = published.body!.data.publicationId as string;
  return {
    publicationId,
    href: `/es/publications/${publicationId}`,
    label: publicLabel,
    featureCount,
  };
}

// Next conserva la página anterior oculta en el DOM: solo se cuenta lo visible.
const successStatus = (page: Page, text: string) =>
  page.locator("p.editor-status[role=status]:visible", { hasText: text });
const errorAlert = (page: Page, text: string) =>
  page.locator("p.editor-status[role=alert]:visible", { hasText: text });

const dossierPath = (id: string) => `/api/v1/dossiers/${id}`;

async function readDossier(page: Page, dossierId: string) {
  const result = await api(page, dossierPath(dossierId));
  expect(result.status).toBe(200);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return result.body!.data as Record<string, any>;
}

function expectCode(result: ApiResult, status: number, code: string) {
  expect({ status: result.status, code: result.body?.code }).toEqual({
    status,
    code,
  });
}

async function openManage(page: Page, dossierId: string) {
  await page.goto(`/es/dossiers/${dossierId}/manage`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Gestionar expediente" }),
  ).toBeVisible();
}

async function selectStatus(page: Page, label: string) {
  await page.getByLabel("Nuevo estado").selectOption({ label });
}

const transitionForm = (page: Page) =>
  page.getByRole("form", { name: "Cambiar el estado" });

const EXPORT_FORMATS = ["html", "geojson", "csv", "json"] as const;

async function getExports(request: APIRequestContext, dossierId: string) {
  const out: Record<string, Awaited<ReturnType<APIRequestContext["get"]>>> = {};
  for (const format of EXPORT_FORMATS) {
    out[format] = await request.get(
      `/api/v1/dossiers/${dossierId}/export?format=${format}`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------
// Historia completa (R6): una publicación, un expediente, pasos encadenados.
// ---------------------------------------------------------------------------------
test.describe("historia del expediente", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  const suffix = randomUUID().slice(0, 8);
  // Etiqueta hostil: fórmula de hoja de cálculo y HTML. Es texto plano en todos lados.
  const hostileLabel = `=1+1 <b>x</b> & "q" ${suffix}`;
  const responsibleName = `Equipo Plaza ${suffix}`;
  const milestoneTitle = `Hito sombra ${suffix}`;
  let proposal: Published;
  let dossierId = "";
  let evidenceOneTitle = "";
  let evidenceTwoTitle = "";

  test("1. una persona sin rol no ve el formulario de promover y la API da 404", async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page);
    proposal = await publishProposal(
      page,
      "Expediente historia",
      hostileLabel,
      2,
    );

    // La autora de la propuesta no tiene rol de coordinación.
    await page.goto(proposal.href);
    await expect(
      page.getByRole("heading", { level: 1, name: hostileLabel }),
    ).toBeVisible();
    await expect(page.locator("#dossier")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Promover a expediente" }),
    ).toHaveCount(0);

    const promote = await api(
      page,
      `/api/v1/publications/${proposal.publicationId}/dossier`,
      {
        method: "POST",
        key: randomUUID(),
        body: { decisionNote: "Sin permiso" },
      },
    );
    expect(promote.status).toBe(404);
    expect(promote.body!.requestId).toEqual(expect.any(String));

    // Un visitante anónimo tampoco ve el formulario.
    await withContext(browser, baseURL, null, async (anon) => {
      await anon.goto(proposal.href);
      await expect(
        anon.getByRole("heading", { level: 1, name: hostileLabel }),
      ).toBeVisible();
      await expect(anon.locator("#dossier")).toHaveCount(0);
    });
  });

  test("2. coordinación promueve, añade responsable autorizado y un hito, y planifica", async ({
    page,
  }) => {
    await signIn(page, "coordinator");
    await page.goto(proposal.href);
    const section = page.locator("#dossier");
    await expect(
      section.getByRole("heading", { level: 2, name: "Expediente" }),
    ).toBeVisible();
    await section
      .getByLabel("Nota de decisión")
      .fill(`Se promueve por la sombra ${suffix}`);
    await section
      .getByRole("button", { name: "Promover a expediente" })
      .click();

    await expect(page).toHaveURL(/\/es\/dossiers\/[0-9a-f-]{36}\/manage/);
    dossierId = /dossiers\/([0-9a-f-]{36})\//.exec(page.url())![1];
    await expect(successStatus(page, "Expediente creado.")).toBeVisible();
    await expect(
      page.getByText("Estado: En revisión", { exact: false }).first(),
    ).toBeVisible();

    // La publicación ahora enlaza al expediente y ya no ofrece promover otra vez.
    await page.goto(proposal.href);
    await expect(
      page
        .locator("#dossier")
        .getByRole("link", { name: "Abrir el expediente" }),
    ).toHaveAttribute("href", `/es/dossiers/${dossierId}`);
    await expect(
      page.getByRole("button", { name: "Promover a expediente" }),
    ).toHaveCount(0);

    await openManage(page, dossierId);

    // Responsable con autorización.
    await page
      .getByLabel("Nombre de la persona o del equipo")
      .fill(responsibleName);
    await page.getByLabel("Autorizó que su nombre se publique").check();
    await page.getByRole("button", { name: "Guardar responsable" }).click();
    await expect(successStatus(page, "Responsable actualizado.")).toBeVisible();

    // Hito.
    await page.getByLabel("Título del hito").fill(milestoneTitle);
    await page.getByLabel("Fecha objetivo del hito").fill("2030-06-15");
    await page.getByRole("button", { name: "Agregar hito" }).click();
    await expect(successStatus(page, "Hito agregado.")).toBeVisible();
    await expect(
      page.locator("#manage-main").getByText(milestoneTitle),
    ).toBeVisible();

    // Planear.
    await selectStatus(page, "Planeado");
    await page.getByLabel("Nota", { exact: true }).fill("Listo para planear");
    await transitionForm(page)
      .getByRole("button", { name: "Registrar el cambio" })
      .click();
    await expect(
      successStatus(page, "Cambio de estado registrado."),
    ).toBeVisible();
    await expect(
      page.getByText("Estado: Planeado", { exact: false }).first(),
    ).toBeVisible();
  });

  test("3. iniciar sin evidencia da un error bloqueado con mensaje", async ({
    page,
  }) => {
    await signIn(page, "coordinator");
    await openManage(page, dossierId);

    // Sin nota.
    await selectStatus(page, "En ejecución");
    await transitionForm(page)
      .getByRole("button", { name: "Registrar el cambio" })
      .click();
    await expect(
      errorAlert(page, "Para iniciar la ejecución escribe una nota de avance."),
    ).toBeVisible();

    // Con nota pero sin evidencia citada.
    await selectStatus(page, "En ejecución");
    await page.getByLabel("Nota", { exact: true }).fill("Arranca la obra");
    await transitionForm(page)
      .getByRole("button", { name: "Registrar el cambio" })
      .click();
    await expect(
      errorAlert(
        page,
        "Para iniciar la ejecución cita al menos una evidencia registrada.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Estado: Planeado", { exact: false }).first(),
    ).toBeVisible();

    // Nada cambió en el servidor.
    const data = await readDossier(page, dossierId);
    expect(data.status).toBe("planeado");
  });

  test("4. registra evidencia, inicia y marca ejecutado con evidencia nueva", async ({
    page,
  }) => {
    await signIn(page, "coordinator");
    await openManage(page, dossierId);

    const addEvidence = async (title: string, path: string) => {
      const url = `https://example.org/${path}/${suffix}`;
      // A late refresh from the previous action can reset the form: fill until it sticks.
      await expect(async () => {
        await page.getByLabel("Enlace a la evidencia (HTTPS)").fill(url);
        await page.getByLabel("Título", { exact: true }).fill(title);
        await page
          .getByLabel("Descripción", { exact: true })
          .fill(`Descripción de ${title}`);
        await page.getByLabel("Fecha de la evidencia").fill(PAST_DATE);
        await expect(
          page.getByLabel("Enlace a la evidencia (HTTPS)"),
        ).toHaveValue(url, { timeout: 500 });
      }).toPass({ timeout: 10_000 });
      await page.getByRole("button", { name: "Registrar evidencia" }).click();
      await expect(successStatus(page, "Evidencia registrada.")).toBeVisible({
        timeout: 15_000,
      });
    };

    // Un enlace HTTP se rechaza con su propio mensaje.
    await page
      .getByLabel("Enlace a la evidencia (HTTPS)")
      .fill("http://example.org/inseguro");
    await page.getByLabel("Título", { exact: true }).fill("Inseguro");
    await page
      .getByLabel("Descripción", { exact: true })
      .fill("No debe guardarse");
    await page.getByLabel("Fecha de la evidencia").fill(PAST_DATE);
    await page.getByRole("button", { name: "Registrar evidencia" }).click();
    await expect(
      errorAlert(page, "El enlace debe ser una dirección HTTPS válida"),
    ).toBeVisible();

    evidenceOneTitle = `Foto inicio ${suffix}`;
    evidenceTwoTitle = `Acta cierre ${suffix}`;
    await addEvidence(evidenceOneTitle, "inicio");

    // Iniciar citando la primera evidencia.
    await selectStatus(page, "En ejecución");
    await page.getByLabel("Nota", { exact: true }).fill("Arranca la obra");
    await transitionForm(page).getByLabel(evidenceOneTitle).check();
    await transitionForm(page)
      .getByRole("button", { name: "Registrar el cambio" })
      .click();
    await expect(
      successStatus(page, "Cambio de estado registrado."),
    ).toBeVisible();
    await expect(
      page.getByText("Estado: En ejecución", { exact: false }).first(),
    ).toBeVisible();

    // Cerrar sin evidencia: bloqueado.
    await selectStatus(page, "Ejecutado");
    await page.getByLabel("Nota", { exact: true }).fill("Cierre de la obra");
    await page
      .getByLabel("Lo observado", { exact: false })
      .fill("Se instaló la cubierta");
    await page
      .getByLabel("Diferencia frente a la propuesta", { exact: false })
      .fill("Es más pequeña que la propuesta");
    await transitionForm(page)
      .getByRole("button", { name: "Registrar el cambio" })
      .click();
    await expect(
      errorAlert(
        page,
        "Para marcar como ejecutado cita evidencia nueva, distinta de la que respaldó el inicio.",
      ),
    ).toBeVisible();

    // Cerrar citando solo la evidencia del inicio: también bloqueado.
    await selectStatus(page, "Ejecutado");
    await page.getByLabel("Nota", { exact: true }).fill("Cierre de la obra");
    await page
      .getByLabel("Lo observado", { exact: false })
      .fill("Se instaló la cubierta");
    await page
      .getByLabel("Diferencia frente a la propuesta", { exact: false })
      .fill("Es más pequeña que la propuesta");
    await transitionForm(page).getByLabel(evidenceOneTitle).check();
    await transitionForm(page)
      .getByRole("button", { name: "Registrar el cambio" })
      .click();
    await expect(
      errorAlert(
        page,
        "cita evidencia nueva, distinta de la que respaldó el inicio",
      ),
    ).toBeVisible();
    expect((await readDossier(page, dossierId)).status).toBe("en_ejecucion");

    // Evidencia nueva: ahora sí.
    await addEvidence(evidenceTwoTitle, "cierre");
    const evidenceTwo = page
      .locator("#manage-main li", { hasText: evidenceTwoTitle })
      .first();
    await evidenceTwo
      .getByRole("button", { name: "Marcar como verificada por el equipo" })
      .click();
    await expect(
      successStatus(page, "Verificación actualizada."),
    ).toBeVisible();

    await selectStatus(page, "Ejecutado");
    await page.getByLabel("Nota", { exact: true }).fill("Cierre de la obra");
    await page
      .getByLabel("Lo observado", { exact: false })
      .fill("Se instaló la cubierta");
    await page
      .getByLabel("Diferencia frente a la propuesta", { exact: false })
      .fill("Es más pequeña que la propuesta");
    await transitionForm(page).getByLabel(evidenceTwoTitle).check();
    await transitionForm(page)
      .getByRole("button", { name: "Registrar el cambio" })
      .click();
    await expect(
      successStatus(page, "Cambio de estado registrado."),
    ).toBeVisible();
    await expect(
      page.getByText("Estado: Ejecutado", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("El expediente está cerrado.", { exact: false }),
    ).toBeVisible();
    // Cerrado: ya no hay formularios de registro.
    await expect(transitionForm(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Registrar evidencia" }),
    ).toHaveCount(0);
  });

  test("5. la corrección revierte el último cambio y deja un evento", async ({
    page,
  }) => {
    await signIn(page, "coordinator");
    await openManage(page, dossierId);

    await page
      .getByLabel("Motivo de la corrección")
      .fill("Se marcó ejecutado por error");
    await page.getByRole("button", { name: "Corregir", exact: true }).click();
    await expect(successStatus(page, "Corrección registrada.")).toBeVisible();
    await expect(
      page.getByText("Estado: En ejecución", { exact: false }).first(),
    ).toBeVisible();

    const data = await readDossier(page, dossierId);
    expect(data.status).toBe("en_ejecucion");
    const last = data.events.at(-1);
    expect(last.kind).toBe("correction");
    expect(last.correctsSeq).toEqual(expect.any(Number));
    // El historial no se edita: el cambio a ejecutado sigue ahí.
    expect(
      data.events.some(
        (event: { kind: string; newState: string | null }) =>
          event.kind === "status_change" && event.newState === "ejecutado",
      ),
    ).toBe(true);
    await expect(page.locator(".dossier-timeline li").last()).toContainText(
      "Corrección",
    );
  });

  test("6. la página pública muestra cronología, apoyo como contexto y responsable autorizado", async ({
    page,
    browser,
    baseURL,
  }) => {
    await signIn(page, "coordinator");
    const support = await api(
      page,
      `/api/v1/publications/${proposal.publicationId}/support`,
      { method: "PUT" },
    );
    expect(support.status).toBe(200);

    await withContext(browser, baseURL, null, async (anon, context) => {
      expect(await context.cookies()).toEqual([]);
      const response = await anon.goto(`/es/dossiers/${dossierId}`);
      expect(response!.status()).toBe(200);
      const main = anon.locator("#dossier-main");
      await expect(
        main.getByRole("heading", { level: 1, name: hostileLabel }),
      ).toBeVisible();
      await expect(main.getByText("Estado: En ejecución")).toBeVisible();
      await expect(
        main.getByText("Todas las intervenciones son hipotéticas", {
          exact: false,
        }),
      ).toBeVisible();

      // Responsable autorizado visible.
      await expect(main.locator(".dossier-facts dd").first()).toHaveText(
        responsibleName,
      );

      // Hitos y evidencia con dominio y enlace seguro.
      await expect(main.getByText(milestoneTitle)).toBeVisible();
      const evidenceItem = main
        .locator("li", { hasText: evidenceTwoTitle })
        .filter({ hasText: "Dominio externo" });
      await expect(evidenceItem).toContainText("Dominio externo: example.org");
      await expect(evidenceItem).toContainText("Verificada por el equipo");
      await expect(
        evidenceItem.getByRole("link", { name: /Abrir enlace externo/ }),
      ).toHaveAttribute("rel", /noopener noreferrer/);
      await expect(
        main
          .locator("li", { hasText: evidenceOneTitle })
          .filter({ hasText: "Dominio externo" }),
      ).toContainText("Sin verificación del equipo");

      // Cronología completa y en orden, también con la corrección.
      const data = (
        await anon.request.get(dossierPath(dossierId)).then((r) => r.json())
      ).data;
      const timeline = main.locator(".dossier-timeline > li");
      await expect(timeline).toHaveCount(data.events.length);
      await expect(timeline.first()).toContainText("Expediente creado");
      await expect(timeline.last()).toContainText("Corrección");
      await expect(main.locator(".dossier-timeline")).toContainText(
        "Se instaló la cubierta",
      );

      // El apoyo es contexto y no cambia el estado.
      await expect(
        main.getByText(
          "1 cuentas de la plataforma apoyan esta propuesta. Es contexto: no aprueba ni cambia ningún estado.",
        ),
      ).toBeVisible();
      expect(data.status).toBe("en_ejecucion");
      expect(data.supportCount).toBe(1);

      // Sin datos privados.
      const html = await anon.content();
      const emails = [
        process.env.FTC_PARTICIPANT_EMAIL,
        process.env.FTC_COORDINATOR_EMAIL,
        process.env.FTC_MODERATOR_EMAIL,
      ].filter((value): value is string => Boolean(value));
      for (const email of emails) {
        expect(html).not.toContain(email);
        expect(JSON.stringify(data)).not.toContain(email);
      }
      expect(JSON.stringify(data)).not.toMatch(
        /[\w.+-]+@[A-Za-z-]+(\.[A-Za-z-]+)*\.[A-Za-z]{2,}/,
      );

      // La lista pública incluye el expediente.
      await anon.goto("/es/dossiers");
      await expect(
        anon.getByRole("link", { name: new RegExp(`${suffix}`) }),
      ).toBeVisible();
    });
  });

  test("7. las descargas coinciden con los totales y el número de intervenciones", async ({
    request,
  }) => {
    const data = (
      await request.get(dossierPath(dossierId)).then((r) => r.json())
    ).data;
    const files = await getExports(request, dossierId);
    const slug = data.siteSlug as string;
    const id8 = dossierId.slice(0, 8);

    for (const format of EXPORT_FORMATS) {
      const response = files[format];
      expect(response.status(), format).toBe(200);
      const headers = response.headers();
      expect(headers["cache-control"]).toContain("no-store");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["content-disposition"]).toContain(
        `filename="${slug}-${id8}.${format}"`,
      );
    }
    expect(files.html.headers()["content-type"]).toContain("text/html");
    expect(files.html.headers()["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(files.geojson.headers()["content-type"]).toContain("geo+json");
    expect(files.csv.headers()["content-type"]).toContain("text/csv");

    // GeoJSON: mismo número de intervenciones que la propuesta y la página.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geo: any = await files.geojson.json();
    expect(validateGeoJson(geo)).toEqual([]);
    expect(geo.features).toHaveLength(proposal.featureCount);
    expect(geo.features).toHaveLength(data.publication.features.length);
    for (const feature of geo.features) {
      expect(feature.properties.status).toBe("hypothetical");
    }
    expect(geo).not.toHaveProperty("crs");
    expect(geo.metadata.scenario).toBe(data.snapshot.scenario.slug);

    // CSV: filas, totales y neutralización.
    const csvText = await files.csv.text();
    expect(csvText.startsWith("\ufeff")).toBe(true);
    expect(csvText).toContain("\r\n");
    const rows = parseCsv(csvText);
    const [header, ...body] = rows;
    expect(header[0]).toBe("concept");
    expect(body).toHaveLength(data.snapshot.cost.lines.length + 1);
    const total = body.at(-1)!;
    expect(total[0]).toBe("TOTAL");
    expect(total[header.indexOf("amount_low")]).toBe(
      (data.snapshot.cost.totalLowCents / 100).toFixed(2),
    );
    expect(total[header.indexOf("amount_high")]).toBe(
      (data.snapshot.cost.totalHighCents / 100).toFixed(2),
    );
    const numericColumns = ["quantity", "amount_low", "amount_high"].map(
      (name) => header.indexOf(name),
    );
    const formulaStart =
      /^[\s\u00a0\ufeff]*[=+\-@\t\r\n\uff1d\uff0b\uff0d\uff20]/;
    for (const row of body) {
      expect(row).toHaveLength(header.length);
      row.forEach((cell, column) => {
        if (numericColumns.includes(column)) {
          expect(cell).toMatch(/^(\d+(\.\d+)?)?$/);
        } else {
          expect(cell, `columna ${header[column]}`).not.toMatch(formulaStart);
        }
      });
    }
    // Todo el texto del CSV está entre comillas (la fila de cabecera lo demuestra).
    expect(csvText.slice(1).startsWith('"concept","code"')).toBe(true);
    // El texto hostil del usuario no se cuela como fórmula en el CSV.
    expect(csvText).not.toContain("=1+1");

    // JSON de supuestos.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assumptions: any = await files.json.json();
    expect(assumptions.dossierId).toBe(dossierId);
    expect(assumptions.scenario.slug).toBe(data.snapshot.scenario.slug);
    expect(assumptions.engine.version).toBe(
      data.snapshot.analysis.engineVersion,
    );
    expect(assumptions.currency).toBe(data.snapshot.cost.currency);
    expect(assumptions.budgetLabel).toBe(data.snapshot.cost.label);
    expect(assumptions.rounding).toBe(data.snapshot.cost.rounding ?? null);

    // HTML: texto del usuario escapado, sin scripts, con las mismas cifras.
    const html = await files.html.text();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain(milestoneTitle);
    expect(html).toContain(responsibleName);

    // Mismo contenido en inglés.
    const english = await request.get(
      `/api/v1/dossiers/${dossierId}/export?format=html&locale=en`,
    );
    expect(english.status()).toBe(200);
    expect(await english.text()).toContain("Timeline");
  });

  test("8. moderación oculta la publicación y todo desaparece; al restaurar vuelve", async ({
    page,
    browser,
    baseURL,
    request,
  }) => {
    const reason = `Motivo ${suffix}`;
    await signIn(page, "moderator");
    const moderate = (action: "hide" | "restore") =>
      api(page, "/api/v1/moderation/actions", {
        method: "POST",
        key: randomUUID(),
        body: {
          targetKind: "publication",
          targetId: proposal.publicationId,
          action,
          reason: `${reason} ${action}`,
        },
      });

    const hidden = await moderate("hide");
    expect([200, 201]).toContain(hidden.status);
    try {
      const response = await request.get(`/es/dossiers/${dossierId}`);
      expect(response.status()).toBe(404);
      const english = await request.get(`/en/dossiers/${dossierId}`);
      expect(english.status()).toBe(404);

      expectCode(
        {
          status: (await request.get(dossierPath(dossierId))).status(),
          body: await request.get(dossierPath(dossierId)).then((r) => r.json()),
        },
        404,
        "dossier_not_found",
      );
      for (const format of EXPORT_FORMATS) {
        const file = await request.get(
          `/api/v1/dossiers/${dossierId}/export?format=${format}`,
        );
        expect(file.status(), format).toBe(404);
      }

      await withContext(browser, baseURL, null, async (anon) => {
        await anon.goto("/es/dossiers");
        await expect(
          anon.getByRole("heading", { level: 1, name: "Expedientes" }),
        ).toBeVisible();
        await expect(anon.getByText(suffix)).toHaveCount(0);
      });

      // Coordinación sigue viendo el historial, pero no puede registrar cambios.
      await withContext(browser, baseURL, "coordinator", async (coord) => {
        await openManage(coord, dossierId);
        await expect(
          coord.getByText("La publicación está oculta por moderación", {
            exact: false,
          }),
        ).toBeVisible();
        await expect(
          coord.getByRole("button", { name: "Agregar hito" }),
        ).toHaveCount(0);
        const blocked = await api(
          coord,
          `${dossierPath(dossierId)}/milestones`,
          {
            method: "POST",
            key: randomUUID(),
            body: { title: `Oculto ${suffix}`, targetDate: "2030-01-01" },
          },
        );
        expectCode(blocked, 409, "publication_hidden");
      });
    } finally {
      const restored = await moderate("restore");
      expect([200, 201]).toContain(restored.status);
    }

    const back = await request.get(`/es/dossiers/${dossierId}`);
    expect(back.status()).toBe(200);
    for (const format of EXPORT_FORMATS) {
      const file = await request.get(
        `/api/v1/dossiers/${dossierId}/export?format=${format}`,
      );
      expect(file.status(), format).toBe(200);
    }
    await withContext(browser, baseURL, null, async (anon) => {
      await anon.goto("/es/dossiers");
      await expect(
        anon.getByRole("link", { name: new RegExp(suffix) }),
      ).toBeVisible();
    });
  });

  test("9. accesibilidad, sin desbordamiento a 360 px y versión en inglés", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
    const serious = async () => {
      const results = await new AxeBuilder({ page }).analyze();
      return results.violations
        .filter(({ impact }) => impact === "serious" || impact === "critical")
        .map(({ id, impact, nodes }) => ({
          id,
          impact,
          targets: nodes.slice(0, 3).map((node) => node.target),
        }));
    };

    await page.goto(`/es/dossiers/${dossierId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: hostileLabel }),
    ).toBeVisible();
    expect(await serious()).toEqual([]);
    expect(await overflow()).toBeLessThanOrEqual(0);

    await page.goto("/es/dossiers");
    await expect(
      page.getByRole("heading", { level: 1, name: "Expedientes" }),
    ).toBeVisible();
    expect(await serious()).toEqual([]);
    expect(await overflow()).toBeLessThanOrEqual(0);

    await signIn(page, "coordinator");
    await page.setViewportSize({ width: 360, height: 800 });
    await openManage(page, dossierId);
    expect(await serious()).toEqual([]);
    expect(await overflow()).toBeLessThanOrEqual(0);

    await page.goto(proposal.href);
    await expect(page.locator("#dossier")).toBeVisible();
    expect(await serious()).toEqual([]);
    expect(await overflow()).toBeLessThanOrEqual(0);

    // Inglés.
    await page.goto(`/en/dossiers/${dossierId}`);
    const main = page.locator("#dossier-main");
    await expect(
      main.getByRole("heading", { level: 1, name: hostileLabel }),
    ).toBeVisible();
    await expect(main.getByText("Status: In execution")).toBeVisible();
    await expect(
      main.getByRole("heading", { level: 2, name: "Timeline" }),
    ).toBeVisible();
    await expect(
      main.getByRole("heading", { level: 2, name: "Evidence" }),
    ).toBeVisible();
    await expect(main.getByText("Responsible", { exact: true })).toBeVisible();
    await expect(
      main.getByText("platform accounts support this proposal", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(main.getByText("Cronología")).toHaveCount(0);
    expect(await serious()).toEqual([]);
    expect(await overflow()).toBeLessThanOrEqual(0);

    await page.goto(`/en/dossiers/${dossierId}/manage`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Manage dossier" }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------
// Matriz de la API (10).
// ---------------------------------------------------------------------------------
test("matriz de la API de expedientes", async ({
  page,
  browser,
  baseURL,
  request,
}) => {
  test.setTimeout(240_000);
  const suffix = randomUUID().slice(0, 8);
  await signIn(page);
  const proposal = await publishProposal(
    page,
    "Expediente API",
    `Matriz API ${suffix}`,
  );
  const promotePath = `/api/v1/publications/${proposal.publicationId}/dossier`;

  await withContext(browser, baseURL, "coordinator", async (coord) => {
    const post = (path: string, body: unknown, key: string = randomUUID()) =>
      api(coord, path, { method: "POST", key, body });
    const put = (path: string, body: unknown) =>
      api(coord, path, { method: "PUT", key: randomUUID(), body });

    // --- 401 sin sesión, 403 sin Origin ---------------------------------------------
    await withContext(browser, baseURL, null, async (anon) => {
      const unauth = await api(anon, promotePath, {
        method: "POST",
        key: randomUUID(),
        body: { decisionNote: "Hola" },
      });
      expectCode(unauth, 401, "authentication_required");
      const unauthEvent = await api(
        anon,
        `${dossierPath(randomUUID())}/events`,
        {
          method: "POST",
          key: randomUUID(),
          body: {
            expectedState: "en_revision",
            newState: "planeado",
            note: "x",
          },
        },
      );
      expect(unauthEvent.status).toBe(401);
      const publicRandom = await api(anon, dossierPath(randomUUID()));
      expect(publicRandom.status).toBe(404);
    });
    const noOrigin = await coord.request.post(promotePath, {
      headers: { "Idempotency-Key": randomUUID() },
      data: { decisionNote: "Sin origen" },
    });
    expect(noOrigin.status()).toBe(403);
    expect((await noOrigin.json()).code).toBe("origin_not_allowed");
    const noOriginPut = await coord.request.put(
      `${dossierPath(randomUUID())}/responsible`,
      { data: { responsibleName: null } },
    );
    expect(noOriginPut.status()).toBe(403);

    // --- Promover: validación, creación, repetición ---------------------------------
    const invalidPromote = await post(promotePath, { decisionNote: "" });
    expectCode(invalidPromote, 422, "invalid_dossier_request");
    const emailName = await post(promotePath, {
      decisionNote: "Nota",
      responsibleName: "alguien@example.org",
      responsibleAuthorized: true,
    });
    expectCode(emailName, 422, "invalid_dossier_request");
    const extra = await post(promotePath, { decisionNote: "Nota", extra: 1 });
    expectCode(extra, 422, "invalid_dossier_request");

    const key = randomUUID();
    // Un nombre sin autorización nunca se guarda: el servidor lo rechaza.
    const unauthorizedPromote = await post(promotePath, {
      decisionNote: `Nota API ${suffix}`,
      responsibleName: `Persona sin permiso ${suffix}`,
      responsibleAuthorized: false,
    });
    expectCode(unauthorizedPromote, 422, "invalid_request");
    expect(JSON.stringify(unauthorizedPromote.body)).not.toContain(
      "Persona sin permiso",
    );
    const promoteBody = {
      decisionNote: `Nota API ${suffix}`,
    };
    const created = await post(promotePath, promoteBody, key);
    expect(created.status).toBe(201);
    const dossierId = created.body!.data.dossierId as string;
    expect(created.body!.data.created).toBe(true);
    const replay = await post(promotePath, promoteBody, key);
    expect([200, 201]).toContain(replay.status);
    expect(replay.body!.data.dossierId).toBe(dossierId);
    const conflict = await post(
      promotePath,
      { ...promoteBody, decisionNote: "Otra nota" },
      key,
    );
    expectCode(conflict, 409, "idempotency_conflict");
    const again = await post(promotePath, promoteBody);
    expect(again.status).toBe(200);
    expect(again.body!.data).toEqual({ dossierId, created: false });

    // Un nombre sin autorización nunca se publica.
    let data = await readDossier(coord, dossierId);
    expect(data.responsibleName).toBeNull();
    expect(data.status).toBe("en_revision");
    expect(data.events).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain("Persona sin permiso");

    const base = dossierPath(dossierId);
    const event = (body: Record<string, unknown>, k?: string) =>
      post(`${base}/events`, body, k);

    // --- Extraños: 404 sin efecto ---------------------------------------------------
    const strangerBodies: [string, string, unknown][] = [
      ["POST", promotePath, { decisionNote: "Intruso" }],
      [
        "POST",
        `${base}/events`,
        { expectedState: "en_revision", newState: "planeado", note: "x" },
      ],
      [
        "POST",
        `${base}/corrections`,
        { expectedState: "en_revision", note: "x" },
      ],
      ["POST", `${base}/milestones`, { title: "x", targetDate: "2030-01-01" }],
      [
        "POST",
        `${base}/evidence`,
        {
          url: "https://example.org/x",
          title: "x",
          description: "x",
          evidenceDate: PAST_DATE,
        },
      ],
      ["PUT", `${base}/responsible`, { responsibleName: null }],
      [
        "POST",
        `/api/v1/milestones/${randomUUID()}`,
        {
          expectedStatus: "pendiente",
          title: "x",
          targetDate: "2030-01-01",
          status: "cumplido",
        },
      ],
      [
        "PUT",
        `/api/v1/evidence/${randomUUID()}/verification`,
        { verified: true },
      ],
    ];
    for (const [method, path, body] of strangerBodies) {
      const result = await api(page, path, {
        method,
        key: randomUUID(),
        body,
      });
      expect(result.status, `${method} ${path}`).toBe(404);
      if (path.startsWith("/api/v1/milestones/")) {
        expect(result.body?.code, path).toBe("milestone_not_found");
      }
      if (path.startsWith("/api/v1/evidence/")) {
        expect(result.body?.code, path).toBe("evidence_not_found");
      }
    }
    // Un id inexistente da el mismo 404 y el mismo código que un extraño con id real.
    expectCode(
      await post(`/api/v1/milestones/${randomUUID()}`, {
        expectedStatus: "pendiente",
        title: "x",
        targetDate: "2030-01-01",
        status: "cumplido",
      }),
      404,
      "milestone_not_found",
    );
    expectCode(
      await put(`/api/v1/evidence/${randomUUID()}/verification`, {
        verified: true,
      }),
      404,
      "evidence_not_found",
    );
    // Un cuerpo mayor de 1 KiB se rechaza antes de buscar el recurso.
    expectCode(
      await put(`/api/v1/evidence/${randomUUID()}/verification`, {
        verified: true,
        padding: "x".repeat(1100),
      }),
      413,
      "payload_too_large",
    );
    // Las mismas rutas con ids inexistentes o mal formados, siendo coordinación.
    for (const id of [randomUUID(), "no-es-uuid"]) {
      const events = await post(`${dossierPath(id)}/events`, {
        expectedState: "en_revision",
        newState: "planeado",
        note: "x",
      });
      expect(events.status, id).toBe(404);
      expect((await api(coord, dossierPath(id))).status).toBe(404);
      expect(
        (
          await post(`/api/v1/publications/${id}/dossier`, {
            decisionNote: "x",
          })
        ).status,
      ).toBe(404);
    }
    data = await readDossier(coord, dossierId);
    expect(data.events).toHaveLength(1);

    // --- Planear: cada requisito ----------------------------------------------------
    expectCode(
      await event({
        expectedState: "en_revision",
        newState: "ejecutado",
        note: "x",
      }),
      422,
      "transition_not_allowed",
    );
    expectCode(
      await event({ expectedState: "en_revision", newState: "planeado" }),
      422,
      "note_required",
    );
    expectCode(
      await event({
        expectedState: "en_revision",
        newState: "planeado",
        note: "Plan",
      }),
      422,
      "plan_requires_responsible",
    );
    const stale = await event({
      expectedState: "planeado",
      newState: "en_ejecucion",
      note: "x",
    });
    expectCode(stale, 409, "stale_state");
    expect(stale.body!.details.currentState).toBe("en_revision");
    expectCode(
      await event({ expectedState: "nope", newState: "planeado" }),
      422,
      "invalid_dossier_request",
    );

    // Un nombre sin autorización no se guarda: la API lo rechaza o no lo publica.
    const unauthorized = await put(`${base}/responsible`, {
      responsibleName: `Sin permiso ${suffix}`,
      responsibleAuthorized: false,
    });
    expect([200, 422]).toContain(unauthorized.status);
    expect((await readDossier(coord, dossierId)).responsibleName).toBeNull();
    const withEmail = await put(`${base}/responsible`, {
      responsibleName: "x@example.org",
      responsibleAuthorized: true,
    });
    expectCode(withEmail, 422, "invalid_dossier_request");
    const responsible = await put(`${base}/responsible`, {
      responsibleName: `Equipo API ${suffix}`,
      responsibleAuthorized: true,
    });
    expect(responsible.status).toBe(200);
    expect((await readDossier(coord, dossierId)).responsibleName).toBe(
      `Equipo API ${suffix}`,
    );

    expectCode(
      await event({
        expectedState: "en_revision",
        newState: "planeado",
        note: "Plan",
      }),
      422,
      "plan_requires_milestone",
    );

    // --- Hitos ----------------------------------------------------------------------
    expectCode(
      await post(`${base}/milestones`, { title: "", targetDate: "2030-01-01" }),
      422,
      "invalid_dossier_request",
    );
    expectCode(
      await post(`${base}/milestones`, {
        title: "Hito",
        targetDate: "2030-13-45x",
      }),
      422,
      "invalid_dossier_request",
    );
    const milestoneKey = randomUUID();
    const milestoneBody = {
      title: `Hito uno ${suffix}`,
      targetDate: "2030-01-01",
    };
    const firstMilestone = await post(
      `${base}/milestones`,
      milestoneBody,
      milestoneKey,
    );
    expect([200, 201]).toContain(firstMilestone.status);
    const milestoneReplay = await post(
      `${base}/milestones`,
      milestoneBody,
      milestoneKey,
    );
    expect(milestoneReplay.status).toBe(firstMilestone.status);
    data = await readDossier(coord, dossierId);
    expect(data.milestones).toHaveLength(1);
    const milestoneId = data.milestones[0].id as string;

    const milestoneUpdate = (
      expectedStatus: string,
      status: string,
      k: string = randomUUID(),
    ) =>
      api(coord, `/api/v1/milestones/${milestoneId}`, {
        method: "POST",
        key: k,
        body: {
          expectedStatus,
          title: milestoneBody.title,
          targetDate: milestoneBody.targetDate,
          status,
        },
      });
    expect((await milestoneUpdate("pendiente", "cancelado")).status).toBe(200);
    expectCode(
      await milestoneUpdate("pendiente", "cumplido"),
      409,
      "stale_milestone",
    );
    expectCode(
      await milestoneUpdate("cancelado", "pendiente"),
      422,
      "milestone_transition_not_allowed",
    );
    // Un hito cancelado no cuenta para planear.
    expectCode(
      await event({
        expectedState: "en_revision",
        newState: "planeado",
        note: "Plan",
      }),
      422,
      "plan_requires_milestone",
    );
    expect(
      (
        await post(`${base}/milestones`, {
          title: `Hito dos ${suffix}`,
          targetDate: "2030-02-01",
        })
      ).status,
    ).toBeLessThan(300);

    const planKey = randomUUID();
    const plan = {
      expectedState: "en_revision",
      newState: "planeado",
      note: "Plan",
    };
    const planned = await event(plan, planKey);
    expect([200, 201]).toContain(planned.status);
    expect(planned.body!.data.status).toBe("planeado");
    const plannedReplay = await event(plan, planKey);
    expect([200, 201]).toContain(plannedReplay.status);
    expect(plannedReplay.body!.data.eventId).toBe(planned.body!.data.eventId);
    expectCode(
      await event({ ...plan, note: "Otra" }, planKey),
      409,
      "idempotency_conflict",
    );
    data = await readDossier(coord, dossierId);
    expect(
      data.events.filter((e: { kind: string }) => e.kind === "status_change"),
    ).toHaveLength(1);

    // --- Iniciar --------------------------------------------------------------------
    const start = { expectedState: "planeado", newState: "en_ejecucion" };
    expectCode(await event(start), 422, "start_requires_note");
    expectCode(
      await event({ ...start, note: "Inicio" }),
      422,
      "start_requires_evidence",
    );
    expectCode(
      await event({ ...start, note: "Inicio", evidenceIds: [randomUUID()] }),
      422,
      "invalid_evidence_reference",
    );

    // --- Evidencia ------------------------------------------------------------------
    const evidenceBody = {
      url: `https://example.org/api/${suffix}`,
      title: `Evidencia uno ${suffix}`,
      description: "Descripción",
      evidenceDate: PAST_DATE,
    };
    for (const url of [
      "http://example.org/x",
      "https://user:pass@example.org/x",
      "https://localhost/x",
      "javascript:alert(1)",
      `https://example.org/${"a".repeat(2100)}`,
    ]) {
      expectCode(
        await post(`${base}/evidence`, { ...evidenceBody, url }),
        422,
        "invalid_dossier_request",
      );
    }
    expectCode(
      await post(`${base}/evidence`, {
        ...evidenceBody,
        evidenceDate: "2999-01-01",
      }),
      422,
      "evidence_date_in_future",
    );
    const evidenceKey = randomUUID();
    const evidenceCreated = await post(
      `${base}/evidence`,
      evidenceBody,
      evidenceKey,
    );
    expect(evidenceCreated.status).toBeLessThan(300);
    const evidenceReplay = await post(
      `${base}/evidence`,
      evidenceBody,
      evidenceKey,
    );
    expect(evidenceReplay.status).toBe(evidenceCreated.status);
    data = await readDossier(coord, dossierId);
    expect(data.evidence).toHaveLength(1);
    const evidenceOne = data.evidence[0].id as string;
    expect(data.evidence[0].host).toBe("example.org");

    const verificationPath = `/api/v1/evidence/${evidenceOne}/verification`;
    expect((await put(verificationPath, { verified: true })).status).toBe(200);
    expect((await put(verificationPath, { verified: true })).status).toBe(200);
    expect(
      (await readDossier(coord, dossierId)).evidence[0].verifiedByTeam,
    ).toBe(true);
    expect(
      (
        await api(page, verificationPath, {
          method: "PUT",
          body: { verified: false },
        })
      ).status,
    ).toBe(404);
    expectCode(
      await put(verificationPath, { verified: "sí" }),
      422,
      "invalid_dossier_request",
    );

    const started = await event({
      ...start,
      note: "Inicio",
      evidenceIds: [evidenceOne],
    });
    expect([200, 201]).toContain(started.status);
    expect(started.body!.data.status).toBe("en_ejecucion");

    // --- Ejecutar: cada requisito ---------------------------------------------------
    const execute = {
      expectedState: "en_ejecucion",
      newState: "ejecutado",
      note: "Cierre",
    };
    expectCode(
      await event({ ...execute, evidenceIds: [evidenceOne] }),
      422,
      "execute_requires_observation",
    );
    const full = { ...execute, observation: "Visto", difference: "Distinto" };
    expectCode(await event(full), 422, "execute_requires_evidence");
    expectCode(
      await event({ ...full, evidenceIds: [evidenceOne] }),
      422,
      "execute_requires_evidence",
    );
    expectCode(
      await event({ ...full, expectedState: "planeado" }),
      409,
      "stale_state",
    );

    // --- Descartar y cerrar ---------------------------------------------------------
    const discard = { expectedState: "en_ejecucion", newState: "descartado" };
    expectCode(await event(discard), 422, "discard_requires_reason");
    const discarded = await event({ ...discard, note: "Sin presupuesto" });
    expect([200, 201]).toContain(discarded.status);
    expectCode(
      await post(`${base}/milestones`, {
        title: "Tarde",
        targetDate: "2030-03-01",
      }),
      409,
      "dossier_closed",
    );

    // --- Corrección -----------------------------------------------------------------
    expectCode(
      await post(`${base}/corrections`, {
        expectedState: "descartado",
        note: "",
      }),
      422,
      "invalid_dossier_request",
    );
    expectCode(
      await post(`${base}/corrections`, {
        expectedState: "en_ejecucion",
        note: "Corrige",
      }),
      409,
      "stale_state",
    );
    const correction = await post(`${base}/corrections`, {
      expectedState: "descartado",
      note: "Se descartó por error",
    });
    expect([200, 201]).toContain(correction.status);
    expect(correction.body!.data.status).toBe("en_ejecucion");
    data = await readDossier(coord, dossierId);
    expect(data.status).toBe("en_ejecucion");
    expect(data.events.at(-1).kind).toBe("correction");
    // seq consecutivos: el historial solo crece.
    expect(data.events.map((e: { seq: number }) => e.seq)).toEqual(
      data.events.map((_e: unknown, index: number) => index + 1),
    );

    // --- Exportaciones: formato inválido y ids ajenos -------------------------------
    for (const query of [
      "format=pdf",
      "format=",
      "",
      "format=HTML",
      "format=csv%0d",
    ]) {
      const result = await request.get(`${base}/export?${query}`);
      expect(result.status(), query).toBe(400);
      expect((await result.json()).code).toBe("invalid_export_format");
    }
    expect(
      (
        await request.get(`${dossierPath(randomUUID())}/export?format=csv`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.get("/api/v1/dossiers/no-es-uuid/export?format=csv")
      ).status(),
    ).toBe(404);
    // Un formato inválido en un id inexistente sigue siendo un error de formato o 404, nunca 200.
    expect(
      (
        await request.get(`${dossierPath(randomUUID())}/export?format=pdf`)
      ).status(),
    ).not.toBe(200);
  });
});
