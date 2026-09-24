import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const accounts = {
  admin: { email: required("E2E_ADMIN_EMAIL"), password: required("E2E_ADMIN_PASSWORD"), home: "/admin", role: "ADMIN" },
  manager: { email: required("E2E_MANAGER_EMAIL"), password: required("E2E_MANAGER_PASSWORD"), home: "/manager", role: "MANAGER" },
  teacher: { email: required("E2E_TEACHER_EMAIL"), password: required("E2E_TEACHER_PASSWORD"), home: "/teacher", role: "TEACHER" },
  parent: { email: required("E2E_PARENT_EMAIL"), password: required("E2E_PARENT_PASSWORD"), home: "/parent", role: "PARENT" },
  student: { email: required("E2E_STUDENT_EMAIL"), password: required("E2E_STUDENT_PASSWORD"), home: "/student", role: "STUDENT" },
} as const;

const roleLabels: Record<(typeof accounts)[keyof typeof accounts]["role"], string> = {
  ADMIN: "Адміністратор",
  MANAGER: "Менеджер",
  TEACHER: "Викладач",
  PARENT: "Батьки",
  STUDENT: "Учень",
};

function base32Decode(input: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of input.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function totp(secret: string, time = Date.now()) {
  const counter = Math.floor(time / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

async function login(page: Page, account: (typeof accounts)[keyof typeof accounts]) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Пароль").fill(account.password);
  await page.getByRole("button", { name: "Увійти" }).click();
}

async function expectHome(page: Page, account: (typeof accounts)[keyof typeof accounts]) {
  await expect(page).toHaveURL(new RegExp(`${account.home.replace("/", "\\/")}$`));
  await expect(page.getByText(account.email, { exact: false })).toBeVisible();
  await expect(page.getByText(roleLabels[account.role], { exact: true })).toBeVisible();
  await expect(page.locator(".error")).toHaveCount(0);
}

test.describe.serial("role beta smoke", () => {
  test("Admin completes first-time MFA and reaches dashboard", async ({ page }) => {
    const account = accounts.admin;
    await login(page, account);
    await expect(page).toHaveURL(/\/mfa\?setup=1$/);
    const secret = (await page.locator(".secret-code").textContent())?.trim();
    expect(secret).toBeTruthy();
    await page.getByLabel("Код").fill(totp(secret!));
    await page.getByRole("button", { name: "Підтвердити" }).click();
    await expect(page.getByRole("heading", { name: "Збережіть recovery-коди" })).toBeVisible();
    await page.getByRole("button", { name: "Я зберіг коди" }).click();
    await expectHome(page, account);
    await expect(page.getByRole("heading", { name: "Стан школи" })).toBeVisible();
  });

  test("Manager reaches operational dashboard and cannot open admin settings", async ({ page }) => {
    const account = accounts.manager;
    await login(page, account);
    await expectHome(page, account);
    await expect(page.getByRole("heading", { name: "Головна менеджера" })).toBeVisible();
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/manager$/);
    await page.goto("/manager/payments");
    await expect(page.getByRole("heading", { name: "Оплати" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Звірка з платіжними провайдерами" })).toBeVisible();
    await expect(page.getByText("Невирішених подій немає.", { exact: true })).toBeVisible();
  });

  test("Teacher reaches schedule and students workspace", async ({ page }) => {
    const account = accounts.teacher;
    await login(page, account);
    await expectHome(page, account);
    await expect(page.getByRole("heading", { name: "Розклад" })).toBeVisible();
    await page.getByRole("link", { name: "Учні" }).first().click();
    await expect(page).toHaveURL(/\/teacher\/students$/);
    await expect(page.getByText("Student E2E", { exact: false })).toBeVisible();
    await expect(page.getByText("E2E Mathematics", { exact: true })).toBeVisible();
    await expect(page.locator(".error")).toHaveCount(0);
  });

  test("Parent sees linked student and learning navigation", async ({ page }) => {
    const account = accounts.parent;
    await login(page, account);
    await expectHome(page, account);
    await expect(page.getByText("Student E2E", { exact: false })).toBeVisible();
    await page.getByRole("link", { name: "Навчання" }).first().click();
    await expect(page).toHaveURL(/\/parent\/learning$/);
    await expect(page.getByText("E2E Mathematics", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Оплати" }).first().click();
    await expect(page).toHaveURL(/\/parent\/payments$/);
    await expect(page.getByText(/Онлайн-оплата:/)).toBeVisible();
    await expect(page.getByLabel("Спосіб оплати")).toBeVisible();
    await expect(page.locator(".error")).toHaveCount(0);
  });

  test("Student sees own enrollment and journal navigation", async ({ page }) => {
    const account = accounts.student;
    await login(page, account);
    await expectHome(page, account);
    await expect(page.getByText("E2E Mathematics", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Журнал" }).first().click();
    await expect(page).toHaveURL(/\/student\/journal$/);
    await expect(page.getByText("E2E Mathematics", { exact: true })).toBeVisible();
    await expect(page.locator(".error")).toHaveCount(0);
  });
});
