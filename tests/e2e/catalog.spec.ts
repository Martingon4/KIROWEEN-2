import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("redirects to Spanish and exposes the offline pilot catalog", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/es$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Una plaza real",
  );
  await expect(page.getByText("Vista local sin teselas")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Alternativa disponible sin mapa" }),
  ).toBeVisible();
});

test("switches to English and keeps document language accurate", async ({
  page,
}) => {
  await page.goto("/es");
  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "One real square",
  );
});

test("has no serious automated accessibility findings", async ({ page }) => {
  await page.goto("/es");
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(serious).toEqual([]);
});

test("fits a 360 pixel viewport without page overflow", async ({ page }) => {
  await page.goto("/es");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("loads the local MapLibre enhancement with keyboard focus", async ({
  page,
}) => {
  await page.goto("/es");
  await expect(page.locator("[data-map-state]")).toHaveAttribute(
    "data-map-state",
    "ready",
  );
  const map = page.getByRole("region", {
    name: /dos intervenciones hipotéticas/i,
  });
  await expect(map).toBeVisible();
  await map.focus();
  await expect(map).toBeFocused();
});

test("preserves the schematic when interactive map startup is unavailable", async ({
  page,
}) => {
  await page.goto("/es?map=fallback");
  await expect(page.locator("[data-map-state]")).toHaveAttribute(
    "data-map-state",
    "fallback",
  );
  await expect(
    page.getByRole("img", { name: /dos intervenciones hipotéticas/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/geometría local y la lista siguen disponibles/i),
  ).toBeVisible();
});

test("returns an authenticated participant to the initiating locale route", async ({
  page,
  context,
}) => {
  const email = process.env.FTC_PARTICIPANT_EMAIL;
  const password = process.env.FTC_PARTICIPANT_PASSWORD;
  test.skip(
    !email || !password,
    "Local test account credentials are not configured",
  );

  await page.goto("/en/auth/sign-in?returnTo=%2Fen");
  await page.getByLabel("Email address").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Enter Fork the City" }).click();

  await expect(page).toHaveURL(/\/en$/);
  expect(
    (await context.cookies()).some(({ name }) => name.startsWith("sb-")),
  ).toBe(true);
});

test("shows a plain error without revealing authentication details", async ({
  page,
}) => {
  await page.goto("/es/auth/sign-in");
  await page.getByLabel("Correo electrónico").fill("missing@example.test");
  await page.getByLabel("Contraseña").fill("incorrect-password");
  await page.getByRole("button", { name: "Entrar a Fork the City" }).click();

  await expect(page.locator(".form-error")).toContainText(
    "No pudimos verificar esos datos",
  );
  await expect(page).toHaveURL(/error=invalid_credentials/);
});

test("creates one private branch for an idempotent authenticated request", async ({
  page,
}, testInfo) => {
  const email = process.env.FTC_PARTICIPANT_EMAIL;
  const password = process.env.FTC_PARTICIPANT_PASSWORD;
  test.skip(
    !email || !password,
    "Local test account credentials are not configured",
  );

  await page.goto("/es/auth/sign-in?returnTo=%2Fes");
  await page.getByLabel("Correo electrónico").fill(email!);
  await page.getByLabel("Contraseña").fill(password!);
  await page.getByRole("button", { name: "Entrar a Fork the City" }).click();
  await expect(page).toHaveURL(/\/es$/);

  const key = `e2e-branch-${testInfo.project.name}`;
  const create = (title: string) =>
    page.evaluate(
      async ({ requestKey, branchTitle }) => {
        const response = await fetch("/api/v1/branches", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": requestKey,
          },
          body: JSON.stringify({
            siteId: "8f5a6417-5f6d-4f02-a50c-76d97167db99",
            title: branchTitle,
          }),
        });
        return { status: response.status, body: await response.json() };
      },
      { requestKey: key, branchTitle: title },
    );

  const first = await create("Alternativa de sombra E2E");
  const repeated = await create("Alternativa de sombra E2E");
  const conflict = await create("Otro contenido con la misma clave");

  expect(first.status).toBe(201);
  expect(repeated.status).toBe(201);
  expect(repeated.body.data.branchId).toBe(first.body.data.branchId);
  expect(conflict.status).toBe(409);
  expect(conflict.body.code).toBe("idempotency_conflict");
});

test("creates a private branch through the keyboard-operable form", async ({
  page,
}, testInfo) => {
  const email = process.env.FTC_PARTICIPANT_EMAIL;
  const password = process.env.FTC_PARTICIPANT_PASSWORD;
  test.skip(
    !email || !password,
    "Local test account credentials are not configured",
  );

  await page.goto("/es/branches");
  await expect(page).toHaveURL(/\/es\/auth\/sign-in/);
  await page.getByLabel("Correo electrónico").fill(email!);
  await page.getByLabel("Contraseña").fill(password!);
  await page.getByRole("button", { name: "Entrar a Fork the City" }).click();
  await expect(page).toHaveURL(/\/es\/branches$/);

  const title = `Rama formulario ${testInfo.project.name} ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Nombre de la alternativa").fill(title);
  await page.getByRole("button", { name: "Crear rama privada" }).click();

  await expect(page.getByRole("status")).toContainText("Rama privada creada");
  await expect(page.getByText(title)).toBeVisible();
});
