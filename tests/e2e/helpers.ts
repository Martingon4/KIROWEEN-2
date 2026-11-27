import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const SITE_ID = "8f5a6417-5f6d-4f02-a50c-76d97167db99";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiResult = { status: number; body: Record<string, any> | null };

export type TestAccount = "participant" | "coordinator" | "moderator";

export function localSupabaseDbContainer(): string {
  const config = readFileSync("supabase/config.toml", "utf8");
  const projectId = /^\s*project_id\s*=\s*"([\w-]+)"/m.exec(config)?.[1];
  if (!projectId) {
    throw new Error(
      "Falta el identificador del Supabase local en supabase/config.toml.",
    );
  }
  return `supabase_db_${projectId}`;
}

const accountVariables: Record<TestAccount, [string, string]> = {
  participant: ["FTC_PARTICIPANT_EMAIL", "FTC_PARTICIPANT_PASSWORD"],
  coordinator: ["FTC_COORDINATOR_EMAIL", "FTC_COORDINATOR_PASSWORD"],
  moderator: ["FTC_MODERATOR_EMAIL", "FTC_MODERATOR_PASSWORD"],
};

export async function signIn(page: Page, account: TestAccount = "participant") {
  const email = process.env[accountVariables[account][0]];
  const password = process.env[accountVariables[account][1]];
  test.skip(
    !email || !password,
    "Local test account credentials are not configured",
  );
  await page.goto("/es/auth/sign-in?returnTo=%2Fes");
  await page.getByLabel("Correo electrónico").fill(email!);
  await page.getByLabel("Contraseña").fill(password!);
  await page.getByRole("button", { name: "Entrar a Fork the City" }).click();
  await expect(page).toHaveURL(/\/es$/);
}

export function api(
  page: Page,
  path: string,
  init: { method?: string; key?: string; body?: unknown } = {},
): Promise<ApiResult> {
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
        body: await response.json().catch(() => null),
      };
    },
    {
      path,
      method: init.method ?? "GET",
      key: init.key,
      body: init.body,
    },
  );
}

export async function createBranch(page: Page, label: string) {
  const title = `${label} ${randomUUID().slice(0, 8)}`;
  const created = await api(page, "/api/v1/branches", {
    method: "POST",
    key: randomUUID(),
    body: { siteId: SITE_ID, title },
  });
  expect(created.status).toBe(201);
  return {
    title,
    branchId: created.body!.data.branchId as string,
    revisionId: created.body!.data.revisionId as string,
  };
}

export async function openEditor(page: Page, branchId: string) {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`/es/branches/${branchId}`);
  await expect(
    page.getByRole("heading", { name: "Agregar intervención" }),
  ).toBeVisible();
}

export const featureList = (page: Page) => page.locator(".editor-feature-list");

export async function addDefaultCanopy(page: Page) {
  await page.getByLabel("Tipo de intervención").selectOption({
    label: "Cubierta de sombra",
  });
  await page.getByRole("button", { name: "Agregar a la rama" }).click();
  await expect(featureList(page)).toContainText("Cubierta de sombra");
}
export async function revealCoordinates(page: Page) {
  const details = page.locator("details.coordinates-details");
  const isOpen = await details.evaluate(
    (node) => (node as HTMLDetailsElement).open,
  );
  if (!isOpen) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveJSProperty("open", true);
  return page.locator("#editor-coordinates");
}
