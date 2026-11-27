import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  addDefaultCanopy,
  api,
  createBranch,
  localSupabaseDbContainer,
  openEditor,
  signIn,
} from "./helpers";

const SITE_ID = "8f5a6417-5f6d-4f02-a50c-76d97167db99";

/**
 * Borra las ventanas de límite de uso de cuentas de prueba fijas, para que repetir la
 * suite no choque con el límite por hora. Los correos van como variables de psql
 * (nunca dentro del SQL) y los argumentos como arreglo, sin shell.
 */
function clearRateWindows(
  accounts: ("participant" | "coordinator" | "moderator")[],
) {
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
        localSupabaseDbContainer(),
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
    // No se propaga el error original: sus argumentos contienen correos de prueba.
    throw new Error("No se pudieron limpiar las ventanas de límite de uso.");
  }
}

test.beforeEach(() => {
  clearRateWindows(["participant", "coordinator"]);
});

/** Copiado de fork.spec.ts: crea una rama con una cubierta, la guarda y la publica. */
async function publishNewProposal(page: Page, label: string) {
  const { branchId, title } = await createBranch(page, label);
  await openEditor(page, branchId);
  await addDefaultCanopy(page);
  await page.getByLabel("Describe el cambio").fill("Guardar para comunidad");
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByText(/Revisión guardada\. Ahora es/)).toBeVisible();
  await expect(page.getByText("Sin cambios pendientes")).toBeVisible();
  await page.locator("#publish-summary").fill("Resumen para comunidad");
  await page.locator("#publish-consent").check();
  await page
    .getByRole("form", { name: "Publicar revisión" })
    .getByRole("button", { name: "Publicar revisión" })
    .click();
  const link = page
    .locator(".editor-status")
    .getByRole("link", { name: "Abrir enlace público" });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  expect(href).toMatch(/^\/es\/publications\/[0-9a-f-]{36}$/);
  return { title, branchId, publicationId: href.split("/").pop()!, href };
}

async function withContext<T>(
  browser: Browser,
  baseURL: string | undefined,
  account: "participant" | "coordinator" | "moderator" | null,
  run: (page: Page, context: BrowserContext) => Promise<T>,
) {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    if (account) await signIn(page, account);
    return await run(page, context);
  } finally {
    await context.close();
  }
}

/** Contexto sin sesión con una página ya en el origen, para llamar a la API con Origin. */
async function anonymousPage(
  browser: Browser,
  baseURL: string | undefined,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/es");
  return { page, close: () => context.close() };
}

// Next conserva la página anterior oculta en el DOM: solo se cuenta lo visible.
const section = (page: Page) => page.locator("section#community:visible");
const commentItems = (page: Page) =>
  section(page).locator(".community-comments > li");
const commentItem = (page: Page, text: string) =>
  commentItems(page).filter({ hasText: text });
const successStatus = (page: Page, text: string) =>
  page.locator("p.editor-status[role=status]:visible", { hasText: text });
const errorStatus = (page: Page) =>
  page.locator("p.editor-status[role=alert]:visible");
const commentsHeading = (page: Page) => section(page).locator("h3#comments");
const moderationCards = (page: Page) =>
  page.locator(".moderation-card:visible");

async function postCommentFromForm(
  page: Page,
  body: string,
  options: { anchor?: boolean } = {},
) {
  await section(page).getByLabel("Tu comentario").fill(body);
  if (options.anchor) {
    // Opción 0 = «Toda la propuesta»; la 1 es la primera intervención.
    await section(page).locator("#comment-anchor").selectOption({ index: 1 });
  }
  await section(page)
    .getByRole("button", { name: "Publicar comentario", exact: true })
    .click();
  await expect(successStatus(page, "Comentario publicado.")).toBeVisible();
}

type RawResult = {
  status: number;
  headers: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any> | null;
};

/** Como `api`, pero devuelve también las cabeceras de respuesta. */
function rawApi(
  page: Page,
  path: string,
  init: { method?: string; key?: string; body?: unknown } = {},
): Promise<RawResult> {
  return page.evaluate(
    async ({ path, method, key, body }) => {
      const response = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.json().catch(() => null),
      };
    },
    { path, method: init.method ?? "GET", key: init.key, body: init.body },
  );
}

const commentPath = (publicationId: string) =>
  `/api/v1/publications/${publicationId}/comments`;

async function postComment(
  page: Page,
  publicationId: string,
  body: unknown,
  key: string = randomUUID(),
) {
  return api(page, commentPath(publicationId), {
    method: "POST",
    key,
    body,
  });
}

test("historia: comentar, apoyar, reportar, ocultar y restaurar un comentario", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  const { publicationId, href } = await publishNewProposal(
    page,
    "Comunidad historia",
  );
  const suffix = randomUUID().slice(0, 8);
  const anchoredBody = `Comentario anclado ${suffix}`;
  const generalBody = `Comentario general ${suffix}`;
  const reason = `Motivo de moderación ${suffix}`;
  const reportNote = `Detalle del reporte ${suffix}`;

  const coordinator = await browser.newContext({ baseURL });
  const moderator = await browser.newContext({ baseURL });
  try {
    const coord = await coordinator.newPage();
    await signIn(coord, "coordinator");
    await coord.goto(href);
    await expect(
      section(coord).getByRole("heading", { level: 2, name: "Comunidad" }),
    ).toBeVisible();
    await expect(
      section(coord).getByText("Todavía nadie ha apoyado esta propuesta."),
    ).toBeVisible();

    await postCommentFromForm(coord, anchoredBody, { anchor: true });
    await expect(commentItem(coord, anchoredBody)).toContainText("Sobre «");
    await postCommentFromForm(coord, generalBody);
    await expect(commentItem(coord, generalBody)).not.toContainText("Sobre «");
    await expect(commentsHeading(coord)).toHaveText("Comentarios (2)");
    // Sus propios comentarios se pueden retirar, no reportar.
    await expect(
      commentItem(coord, generalBody).getByRole("button", {
        name: "Retirar mi comentario",
      }),
    ).toBeVisible();
    await expect(
      commentItem(coord, generalBody).getByText("Reportar este comentario"),
    ).toHaveCount(0);

    // Apoyo desde la interfaz.
    await section(coord)
      .getByRole("button", { name: "Apoyar esta propuesta", exact: true })
      .click();
    await expect(successStatus(coord, "Apoyo registrado.")).toBeVisible();
    await expect(
      section(coord).getByRole("button", {
        name: "Quitar mi apoyo",
        exact: true,
      }),
    ).toBeVisible();
    await expect(section(coord)).toContainText(
      "1 persona apoya esta propuesta.",
    );
    // Repetir PUT por la API no suma otra vez.
    const supportPath = `/api/v1/publications/${publicationId}/support`;
    for (let i = 0; i < 2; i += 1) {
      const put = await api(coord, supportPath, { method: "PUT" });
      expect(put.status).toBe(200);
      expect(put.body!.data).toEqual({ supported: true, count: 1 });
    }
    const afterPut = await api(coord, supportPath);
    expect(afterPut.status).toBe(200);
    expect(afterPut.body!.data).toEqual({ count: 1, supported: true });
    // Retirar el apoyo desde la interfaz.
    await coord.reload();
    await section(coord)
      .getByRole("button", { name: "Quitar mi apoyo", exact: true })
      .click();
    await expect(successStatus(coord, "Apoyo retirado.")).toBeVisible();
    await expect(
      section(coord).getByRole("button", {
        name: "Apoyar esta propuesta",
        exact: true,
      }),
    ).toBeVisible();
    const afterWithdraw = await api(coord, supportPath);
    expect(afterWithdraw.body!.data).toEqual({ count: 0, supported: false });
    const deleteAgain = await api(coord, supportPath, { method: "DELETE" });
    expect(deleteAgain.status).toBe(200);
    expect(deleteAgain.body!.data).toEqual({ supported: false, count: 0 });

    // La persona autora de la propuesta ve ambos comentarios y reporta uno.
    await page.goto(href);
    await expect(commentItem(page, anchoredBody)).toBeVisible();
    await expect(commentItem(page, generalBody)).toBeVisible();
    await expect(commentsHeading(page)).toHaveText("Comentarios (2)");
    const reported = commentItem(page, generalBody);
    await reported.getByText("Reportar este comentario").click();
    await reported
      .getByLabel("Motivo")
      .selectOption({ label: "Spam o publicidad" });
    await reported
      .getByLabel("Detalle (opcional, hasta 500 caracteres)")
      .fill(reportNote);
    await reported.getByRole("button", { name: "Enviar reporte" }).click();
    await expect(
      successStatus(page, "Reporte enviado a moderación."),
    ).toBeVisible();

    // Moderación: ve el reporte y oculta el comentario con un motivo.
    const mod = await moderator.newPage();
    await signIn(mod, "moderator");
    await mod.goto("/es/moderation");
    await expect(
      mod.getByRole("heading", { level: 1, name: "Moderación" }),
    ).toBeVisible();
    await expect(
      mod.getByRole("heading", { level: 2, name: /^Reportes abiertos/ }),
    ).toBeVisible();
    const card = moderationCards(mod).filter({ hasText: generalBody });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Motivo del reporte: Spam o publicidad");
    await expect(card).toContainText(reportNote);
    await expect(card).toContainText("Comentario");
    await card
      .getByLabel("Motivo de la decisión (lo ve la persona autora)", {
        exact: true,
      })
      .fill(reason);
    await card.getByRole("button", { name: "Ocultar", exact: true }).click();
    await expect(successStatus(mod, "Contenido ocultado.")).toBeVisible();
    await expect(
      moderationCards(mod)
        .filter({ hasText: generalBody })
        .getByText("Oculto", { exact: false }),
    ).toHaveCount(1);
    // Ya no está en la cola de reportes abiertos, solo en «Contenido oculto».
    const hiddenSection = mod.locator(
      "section[aria-labelledby=hidden-title]:visible",
    );
    const queueSection = mod.locator(
      "section[aria-labelledby=queue-title]:visible",
    );
    await expect(queueSection.getByText(generalBody)).toHaveCount(0);
    await expect(hiddenSection.getByText(generalBody)).toBeVisible();

    // Un visitante anónimo ya no lo ve en la lista ni en el conteo.
    const anon = await anonymousPage(browser, baseURL);
    try {
      await anon.page.goto(href);
      await expect(section(anon.page)).toBeVisible();
      await expect(commentItem(anon.page, anchoredBody)).toBeVisible();
      await expect(section(anon.page).getByText(generalBody)).toHaveCount(0);
      await expect(commentsHeading(anon.page)).toHaveText("Comentarios (1)");
      const list = await api(anon.page, commentPath(publicationId));
      expect(list.status).toBe(200);
      expect(list.body!.data.items).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toContain(generalBody);
    } finally {
      await anon.close();
    }

    // La persona autora ve el aviso con el motivo.
    await coord.reload();
    await expect(section(coord).getByText(generalBody)).toBeVisible();
    await expect(
      section(coord).getByText(
        `Moderación ocultó tu comentario. Motivo: ${reason}`,
      ),
    ).toBeVisible();
    await expect(commentsHeading(coord)).toHaveText("Comentarios (1)");

    // Restaurar desde «Contenido oculto».
    await mod.reload();
    const restoreCard = mod
      .locator("section[aria-labelledby=hidden-title]:visible .moderation-card")
      .filter({ hasText: generalBody });
    await expect(restoreCard).toHaveCount(1);
    await expect(restoreCard).toContainText(`Motivo: ${reason}`);
    await restoreCard
      .getByLabel("Motivo de la decisión (lo ve la persona autora)", {
        exact: true,
      })
      .fill(`Restaurado ${suffix}`);
    await restoreCard
      .getByRole("button", { name: "Restaurar", exact: true })
      .click();
    await expect(successStatus(mod, "Contenido restaurado.")).toBeVisible();

    const anonAgain = await anonymousPage(browser, baseURL);
    try {
      await anonAgain.page.goto(href);
      await expect(commentItem(anonAgain.page, generalBody)).toBeVisible();
      await expect(commentsHeading(anonAgain.page)).toHaveText(
        "Comentarios (2)",
      );
    } finally {
      await anonAgain.close();
    }
    await coord.reload();
    await expect(
      section(coord).getByText("Moderación ocultó tu comentario."),
    ).toHaveCount(0);
  } finally {
    await coordinator.close();
    await moderator.close();
  }
});

test("moderación oculta toda la publicación desde el reporte y luego la restaura", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  const { publicationId, href } = await publishNewProposal(
    page,
    "Comunidad ocultar publicación",
  );
  const suffix = randomUUID().slice(0, 8);
  const reason = `Publicación oculta ${suffix}`;

  // La URL de comparación se toma de la página mientras todavía es pública.
  await page.goto(href);
  const compareHref = await page
    .getByRole("link", { name: "Comparar con la línea base" })
    .getAttribute("href");
  expect(compareHref).toContain(`publication`);

  await withContext(browser, baseURL, "coordinator", async (coord) => {
    await coord.goto(href);
    await expect(
      section(coord).getByRole("region", { name: "Bifurcar esta propuesta" }),
    ).toHaveCount(0);
    await expect(
      coord.getByRole("region", { name: "Bifurcar esta propuesta" }),
    ).toBeVisible();
    const report = section(coord).locator("details.community-report");
    await report.getByText("Reportar esta propuesta").click();
    await report
      .getByLabel("Motivo")
      .selectOption({ label: "Información falsa" });
    await report.getByRole("button", { name: "Enviar reporte" }).click();
    await expect(
      successStatus(coord, "Reporte enviado a moderación."),
    ).toBeVisible();
  });

  await withContext(browser, baseURL, "moderator", async (mod) => {
    await mod.goto("/es/moderation");
    const card = moderationCards(mod)
      .filter({
        has: mod.locator(`a[href$="/publications/${publicationId}#community"]`),
      })
      .first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("Propuesta publicada");
    await expect(card).toContainText("Motivo del reporte: Información falsa");
    await card
      .getByLabel("Motivo de la decisión (lo ve la persona autora)", {
        exact: true,
      })
      .fill(reason);
    await card.getByRole("button", { name: "Ocultar", exact: true }).click();
    await expect(successStatus(mod, "Contenido ocultado.")).toBeVisible();

    const anon = await anonymousPage(browser, baseURL);
    try {
      const response = await anon.page.goto(href);
      expect(response!.status()).toBe(404);
      await expect(
        anon.page.getByRole("heading", {
          level: 1,
          name: "Esta publicación no está disponible",
        }),
      ).toBeVisible();
      const comments = await api(anon.page, commentPath(publicationId));
      expect(comments.status).toBe(404);
      const detail = await api(
        anon.page,
        `/api/v1/publications/${publicationId}`,
      );
      expect(detail.status).toBe(404);
      await anon.page.goto(compareHref!);
      await expect(
        anon.page.getByRole("heading", {
          level: 1,
          name: "No encontramos una de las revisiones",
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await anon.close();
    }

    await withContext(browser, baseURL, "coordinator", async (coord) => {
      const fork = await api(coord, "/api/v1/branches", {
        method: "POST",
        key: randomUUID(),
        body: { sourcePublicationId: publicationId, title: "Copia oculta" },
      });
      expect(fork.status).toBe(404);
      expect(fork.body!.code).toBe("publication_not_found");
      await coord.goto(href);
      await expect(
        coord.getByRole("region", { name: "Bifurcar esta propuesta" }),
      ).toHaveCount(0);
    });

    // Restaurar desde «Contenido oculto».
    await mod.reload();
    const restoreCard = mod
      .locator("section[aria-labelledby=hidden-title]:visible .moderation-card")
      .filter({ hasText: `Motivo: ${reason}` });
    await expect(restoreCard).toHaveCount(1);
    await restoreCard
      .getByLabel("Motivo de la decisión (lo ve la persona autora)", {
        exact: true,
      })
      .fill(`Restaurada ${suffix}`);
    await restoreCard
      .getByRole("button", { name: "Restaurar", exact: true })
      .click();
    await expect(successStatus(mod, "Contenido restaurado.")).toBeVisible();

    const anonBack = await anonymousPage(browser, baseURL);
    try {
      const response = await anonBack.page.goto(href);
      expect(response!.status()).toBe(200);
      await expect(section(anonBack.page)).toBeVisible();
      const comments = await api(anonBack.page, commentPath(publicationId));
      expect(comments.status).toBe(200);
      await anonBack.page.goto(compareHref!);
      await expect(
        anonBack.page.getByRole("heading", {
          level: 1,
          name: "No encontramos una de las revisiones",
          exact: true,
        }),
      ).toHaveCount(0);
    } finally {
      await anonBack.close();
    }
    await withContext(browser, baseURL, "coordinator", async (coord) => {
      await coord.goto(href);
      await expect(
        coord.getByRole("region", { name: "Bifurcar esta propuesta" }),
      ).toBeVisible();
    });
  });
});

test("permisos: una persona sin rol de moderación no ve ni usa la moderación", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page);
  await page.goto("/es/moderation");
  await expect(
    page.getByRole("heading", { level: 1, name: "Moderación" }),
  ).toBeVisible();
  await expect(
    page.getByText("Tu cuenta no modera ningún sitio", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: /^Reportes abiertos/ }),
  ).toHaveCount(0);
  await expect(page.locator(".moderation-card")).toHaveCount(0);

  for (const path of [
    `/api/v1/moderation/reports?site=${SITE_ID}`,
    `/api/v1/moderation/hidden?site=${SITE_ID}`,
    `/api/v1/moderation/targets/comment/${randomUUID()}`,
  ]) {
    const result = await api(page, path);
    expect(result.status, path).toBe(404);
    expect(result.body!.requestId).toEqual(expect.any(String));
  }
  const action = await api(page, "/api/v1/moderation/actions", {
    method: "POST",
    key: randomUUID(),
    body: {
      targetKind: "comment",
      targetId: randomUUID(),
      action: "hide",
      reason: "Sin permiso",
    },
  });
  expect(action.status).toBe(404);

  const anon = await anonymousPage(browser, baseURL);
  try {
    const reports = await api(
      anon.page,
      `/api/v1/moderation/reports?site=${SITE_ID}`,
    );
    expect(reports.status).toBe(401);
    expect(reports.body!.code).toBe("authentication_required");
    const anonAction = await api(anon.page, "/api/v1/moderation/actions", {
      method: "POST",
      key: randomUUID(),
      body: {
        targetKind: "comment",
        targetId: randomUUID(),
        action: "hide",
        reason: "Anónimo",
      },
    });
    expect(anonAction.status).toBe(401);
    await anon.page.goto("/es/moderation");
    await expect(anon.page).toHaveURL(/\/es\/auth\/sign-in\?/);
  } finally {
    await anon.close();
  }
});

test("matriz de la API de comentarios y reportes", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await signIn(page);
  const first = await publishNewProposal(page, "Comunidad API");
  const second = await publishNewProposal(page, "Comunidad API ajena");
  const foreignFeature = (
    await api(page, `/api/v1/publications/${second.publicationId}`)
  ).body!.data.features[0].id as string;
  expect(foreignFeature).toMatch(/^[0-9a-f-]{36}$/);
  const ownFeature = (
    await api(page, `/api/v1/publications/${first.publicationId}`)
  ).body!.data.features[0].id as string;
  const id = first.publicationId;

  // Sin sesión: 401.
  const anon = await anonymousPage(browser, baseURL);
  try {
    const unauth = await postComment(anon.page, id, { body: "Hola" });
    expect(unauth.status).toBe(401);
    expect(unauth.body!.code).toBe("authentication_required");
    expect(unauth.body!.requestId).toEqual(expect.any(String));
    // La lista es pública y no revela datos de cuenta.
    const list = await api(anon.page, commentPath(id));
    expect(list.status).toBe(200);
    expect(list.body!.data.items).toEqual([]);
    const support = await api(anon.page, `/api/v1/publications/${id}/support`);
    expect(support.body!.data).toEqual({ count: 0, supported: null });
  } finally {
    await anon.close();
  }

  // Sin Origin: 403 (APIRequestContext no envía Origin).
  const noOrigin = await page.request.post(commentPath(id), {
    headers: { "Idempotency-Key": randomUUID() },
    data: { body: "Hola" },
  });
  expect(noOrigin.status()).toBe(403);
  expect((await noOrigin.json()).code).toBe("origin_not_allowed");
  const noOriginDelete = await page.request.delete(
    `/api/v1/comments/${randomUUID()}`,
  );
  expect(noOriginDelete.status()).toBe(403);

  // Cuerpos inválidos: 422 invalid_comment.
  for (const body of [
    { body: "" },
    { body: "   " },
    { body: "a".repeat(1001) },
    { body: "con\u0007control" },
    { body: "hola", extra: true },
  ]) {
    const result = await postComment(page, id, body);
    expect(result.status, JSON.stringify(body).slice(0, 40)).toBe(422);
    expect(result.body!.code).toBe("invalid_comment");
  }
  const tooLongOk = await postComment(page, id, { body: "a".repeat(1000) });
  expect(tooLongOk.status).toBe(201);

  // Ancla ajena: 422 invalid_anchor; ancla propia: 201.
  const foreign = await postComment(page, id, {
    body: "Ancla ajena",
    featureId: foreignFeature,
  });
  expect(foreign.status).toBe(422);
  expect(foreign.body!.code).toBe("invalid_anchor");
  const unknown = await postComment(page, id, {
    body: "Ancla inexistente",
    featureId: randomUUID(),
  });
  expect(unknown.status).toBe(422);
  expect(unknown.body!.code).toBe("invalid_anchor");
  const own = await postComment(page, id, {
    body: "Ancla propia",
    featureId: ownFeature,
  });
  expect(own.status).toBe(201);
  expect(own.body!.data.featureId).toBe(ownFeature);

  // Publicación inexistente o id inválido.
  const missing = await postComment(page, randomUUID(), { body: "Hola" });
  expect(missing.status).toBe(404);
  expect(missing.body!.code).toBe("publication_not_found");
  const badId = await postComment(page, "no-es-uuid", { body: "Hola" });
  expect(badId.status).toBe(404);

  // Idempotencia.
  const key = randomUUID();
  const body = { body: `Idempotente ${randomUUID().slice(0, 8)}` };
  const created = await postComment(page, id, body, key);
  expect(created.status).toBe(201);
  const commentId = created.body!.data.commentId as string;
  const replay = await postComment(page, id, body, key);
  expect(replay.status).toBe(201);
  expect(replay.body!.data.commentId).toBe(commentId);
  const conflict = await postComment(page, id, { body: "Otro texto" }, key);
  expect(conflict.status).toBe(409);
  expect(conflict.body!.code).toBe("idempotency_conflict");
  const listed = await api(page, commentPath(id));
  const items = listed.body!.data.items as {
    commentId: string;
    mine: boolean;
  }[];
  expect(items.filter((item) => item.commentId === commentId)).toHaveLength(1);
  expect(items.find((item) => item.commentId === commentId)!.mine).toBe(true);
  // Paginación con cursor.
  const pageOne = await api(page, `${commentPath(id)}?limit=2`);
  expect(pageOne.status).toBe(200);
  expect(pageOne.body!.data.items).toHaveLength(2);
  expect(typeof pageOne.body!.data.nextCursor).toBe("string");
  const pageTwo = await api(
    page,
    `${commentPath(id)}?limit=2&cursor=${encodeURIComponent(pageOne.body!.data.nextCursor)}`,
  );
  expect(pageTwo.status).toBe(200);
  const seen = new Set(
    [...pageOne.body!.data.items, ...pageTwo.body!.data.items].map(
      (item: { commentId: string }) => item.commentId,
    ),
  );
  expect(seen.size).toBe(
    pageOne.body!.data.items.length + pageTwo.body!.data.items.length,
  );
  const badCursor = await api(page, `${commentPath(id)}?cursor=basura`);
  expect(badCursor.status).toBe(400);
  expect(badCursor.body!.code).toBe("invalid_cursor");
  const badLimit = await api(page, `${commentPath(id)}?limit=51`);
  expect(badLimit.status).toBe(400);
  expect(badLimit.body!.code).toBe("invalid_limit");

  // Otra cuenta: reporta dos veces y no puede retirar el comentario ajeno.
  await withContext(browser, baseURL, "coordinator", async (coord) => {
    const report = {
      targetKind: "comment",
      targetId: commentId,
      reason: "spam",
      note: "Nota de prueba",
    };
    const firstReport = await api(coord, "/api/v1/reports", {
      method: "POST",
      key: randomUUID(),
      body: report,
    });
    expect(firstReport.status).toBe(201);
    expect(firstReport.body!.data).toMatchObject({
      state: "open",
      duplicate: false,
    });
    const secondReport = await api(coord, "/api/v1/reports", {
      method: "POST",
      key: randomUUID(),
      body: report,
    });
    expect(secondReport.status).toBe(200);
    expect(secondReport.body!.data.reportId).toBe(
      firstReport.body!.data.reportId,
    );
    expect(secondReport.body!.data.duplicate).toBe(true);
    const invalidReport = await api(coord, "/api/v1/reports", {
      method: "POST",
      key: randomUUID(),
      body: { ...report, reason: "otro" },
    });
    expect(invalidReport.status).toBe(422);
    expect(invalidReport.body!.code).toBe("invalid_report");
    const missingTarget = await api(coord, "/api/v1/reports", {
      method: "POST",
      key: randomUUID(),
      body: { ...report, targetId: randomUUID() },
    });
    expect(missingTarget.status).toBe(404);

    const foreignRetract = await api(coord, `/api/v1/comments/${commentId}`, {
      method: "DELETE",
    });
    expect(foreignRetract.status).toBe(404);
    // La lista de la otra cuenta no marca el comentario como suyo.
    const view = await api(coord, commentPath(id));
    const seenByOther = (
      view.body!.data.items as { commentId: string; mine: boolean }[]
    ).find((item) => item.commentId === commentId)!;
    expect(seenByOther.mine).toBe(false);
  });

  // La propia persona retira dos veces y obtiene el mismo instante.
  const retract = await api(page, `/api/v1/comments/${commentId}`, {
    method: "DELETE",
  });
  expect(retract.status).toBe(200);
  const retractedAt = retract.body!.data.retractedAt;
  expect(typeof retractedAt).toBe("string");
  const retractAgain = await api(page, `/api/v1/comments/${commentId}`, {
    method: "DELETE",
  });
  expect(retractAgain.status).toBe(200);
  expect(retractAgain.body!.data.retractedAt).toBe(retractedAt);
  const afterRetract = await api(page, commentPath(id));
  expect(
    (afterRetract.body!.data.items as { commentId: string }[]).some(
      (item) => item.commentId === commentId,
    ),
  ).toBe(false);
  const unknownRetract = await api(page, `/api/v1/comments/${randomUUID()}`, {
    method: "DELETE",
  });
  expect(unknownRetract.status).toBe(404);
});

test("límite de uso: 12 comentarios en paralelo dan 10 × 201 y 2 × 429", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Una sola ejecución: el límite es por hora y por cuenta, y ambos proyectos comparten cuentas.",
  );
  test.setTimeout(180_000);
  // La cuenta de moderación solo se usa aquí para comentar, así que no choca con los
  // demás tests que limpian a participante y coordinación en paralelo.
  clearRateWindows(["moderator"]);
  try {
    await signIn(page, "participant");
    const { publicationId } = await publishNewProposal(
      page,
      "Comunidad límite",
    );
    await withContext(browser, baseURL, "moderator", async (mod) => {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_unused, index) =>
          rawApi(mod, commentPath(publicationId), {
            method: "POST",
            key: randomUUID(),
            body: { body: `Ráfaga ${index} ${randomUUID().slice(0, 8)}` },
          }),
        ),
      );
      const statuses = results.map((result) => result.status).sort();
      expect(statuses.filter((status) => status === 201)).toHaveLength(10);
      expect(statuses.filter((status) => status === 429)).toHaveLength(2);
      for (const limited of results.filter((result) => result.status === 429)) {
        expect(limited.body!.code).toBe("rate_limited");
        expect(limited.body!.requestId).toEqual(expect.any(String));
        const header = limited.headers["retry-after"];
        expect(header).toMatch(/^\d+$/);
        expect(Number(header)).toBeGreaterThanOrEqual(1);
        expect(limited.body!.details.retryAfterSeconds).toBe(Number(header));
        expect(limited.headers["cache-control"]).toBe("no-store");
      }
      // La interfaz muestra el aviso de espera en vez de un error genérico.
      await mod.goto(`/es/publications/${publicationId}`);
      await section(mod).getByLabel("Tu comentario").fill("Una más");
      await section(mod)
        .getByRole("button", { name: "Publicar comentario", exact: true })
        .click();
      await expect(errorStatus(mod)).toContainText(
        "Hiciste muchas acciones seguidas. Inténtalo de nuevo en",
      );
    });
  } finally {
    clearRateWindows(["moderator"]);
  }
});

test("texto plano: HTML y Markdown se muestran literales y se conservan los saltos de línea", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let dialogs = 0;
  page.on("dialog", (dialog) => {
    dialogs += 1;
    void dialog.dismiss();
  });
  await signIn(page);
  const { href } = await publishNewProposal(page, "Comunidad XSS");
  await page.goto(href);
  const first = "<img src=x onerror=alert(1)>";
  const second = "**bold** y <script>alert(2)</script>";
  await postCommentFromForm(page, `${first}\n${second}`);
  const item = commentItems(page).filter({ hasText: "onerror=alert(1)" });
  await expect(item).toHaveCount(1);
  await expect(commentItems(page).locator("img")).toHaveCount(0);
  await expect(commentItems(page).locator("script")).toHaveCount(0);
  await expect(
    commentItems(page).locator("strong", { hasText: "bold" }),
  ).toHaveCount(0);
  const text = await item.locator("p.community-body").innerText();
  expect(text).toBe(`${first}\n${second}`);
  const white = await item
    .locator("p.community-body")
    .evaluate((element) => getComputedStyle(element).whiteSpace);
  expect(white).toMatch(/pre/);
  // El HTML del documento escapa los signos, no hay elementos inyectados.
  expect(await page.locator("section#community img[src='x']").count()).toBe(0);
  await page.reload();
  await expect(
    commentItems(page).filter({ hasText: "onerror=alert(1)" }),
  ).toHaveCount(1);
  expect(dialogs).toBe(0);
});

test("accesibilidad: sección de comunidad y panel de moderación, 360 px y teclado", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page);
  const { publicationId, href } = await publishNewProposal(
    page,
    "Comunidad a11y",
  );
  const overflow = (target: Page) =>
    target.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
  const serious = async (target: Page, include: string) => {
    const results = await new AxeBuilder({ page: target })
      .include(include)
      .analyze();
    return results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    );
  };

  // Otro comentario con un reporte abierto para que ambas pantallas tengan contenido.
  const suffix = randomUUID().slice(0, 8);
  await withContext(browser, baseURL, "coordinator", async (coord) => {
    await coord.setViewportSize({ width: 360, height: 800 });
    await coord.goto(href);
    const posted = await postComment(coord, publicationId, {
      body: `Comentario a11y ${suffix}`,
    });
    expect(posted.status).toBe(201);
  });
  const commentId = (await api(page, commentPath(publicationId))).body!.data
    .items[0].commentId as string;
  const reported = await api(page, "/api/v1/reports", {
    method: "POST",
    key: randomUUID(),
    body: { targetKind: "comment", targetId: commentId, reason: "other" },
  });
  expect(reported.status).toBe(201);

  await page.goto(href);
  await expect(commentItem(page, `Comentario a11y ${suffix}`)).toBeVisible();
  await section(page).getByText("Reportar este comentario").first().click();
  expect(await serious(page, "#community")).toEqual([]);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // Teclado: desde el título de la sección se llega al comentario y se envía sin ratón.
  const keyboardBody = `Comentario con teclado ${suffix}`;
  await section(page)
    .getByRole("heading", { level: 2, name: "Comunidad" })
    .click();
  let reachedTextarea = false;
  for (let step = 0; step < 40 && !reachedTextarea; step += 1) {
    await page.keyboard.press("Tab");
    reachedTextarea = await page.evaluate(
      () => document.activeElement?.id === "comment-body",
    );
  }
  expect(reachedTextarea).toBe(true);
  await expect(page.locator("#comment-body")).toBeFocused();
  await page.keyboard.type(keyboardBody);
  await page.keyboard.press("Tab");
  await expect(page.locator("#comment-anchor")).toBeFocused();
  await page.keyboard.press("Tab");
  const submit = section(page).getByRole("button", {
    name: "Publicar comentario",
    exact: true,
  });
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(successStatus(page, "Comentario publicado.")).toBeVisible();
  await expect(commentItem(page, keyboardBody)).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await withContext(browser, baseURL, "moderator", async (mod) => {
    await mod.setViewportSize({ width: 360, height: 800 });
    await mod.goto("/es/moderation");
    await expect(
      mod.getByRole("heading", { level: 1, name: "Moderación" }),
    ).toBeVisible();
    await expect(
      moderationCards(mod).filter({ hasText: `Comentario a11y ${suffix}` }),
    ).toHaveCount(1);
    expect(await serious(mod, "#moderation-main")).toEqual([]);
    expect(await overflow(mod)).toBeLessThanOrEqual(0);
    // Cierra el reporte para no dejar la cola sucia en ejecuciones repetidas.
    const card = moderationCards(mod).filter({
      hasText: `Comentario a11y ${suffix}`,
    });
    await card
      .getByLabel("Por qué se descarta", { exact: true })
      .fill("Prueba de accesibilidad");
    await card.getByRole("button", { name: "Descartar reporte" }).click();
    await expect(successStatus(mod, "Reporte descartado.")).toBeVisible();
  });
});

test("la ruta en inglés muestra la comunidad en inglés", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  const { publicationId } = await publishNewProposal(page, "Comunidad English");
  await page.goto(`/en/publications/${publicationId}`);
  const community = section(page);
  await expect(
    community.getByRole("heading", { level: 2, name: "Community" }),
  ).toBeVisible();
  await expect(community).toContainText(
    "Nobody has supported this proposal yet.",
  );
  await expect(
    community.getByRole("button", {
      name: "Support this proposal",
      exact: true,
    }),
  ).toBeVisible();
  await expect(community.getByLabel("Your comment")).toBeVisible();
  await expect(
    community.getByRole("button", { name: "Post comment", exact: true }),
  ).toBeVisible();
  await expect(community).toContainText("Report this proposal");
  await expect(
    page.getByRole("heading", { name: "Comunidad", exact: true }),
  ).toHaveCount(0);
  await community.getByLabel("Your comment").fill("English comment");
  await community
    .getByRole("button", { name: "Post comment", exact: true })
    .click();
  await expect(
    page.locator("p.editor-status[role=status]:visible", {
      hasText: "Comment posted.",
    }),
  ).toBeVisible();
  await expect(
    community.getByRole("button", { name: "Retract my comment" }),
  ).toBeVisible();
});
