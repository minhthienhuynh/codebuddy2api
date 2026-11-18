import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { chooseLanguage, LanguageProvider, serverPreference, translate, useT } from "./i18n";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

function ProbeText() {
  const t = useT();
  return (
    <>
      <span data-testid="probe">{t("nav.overview")}</span>
      <span data-testid="interp">{t("logs.attemptN", { n: 3 })}</span>
    </>
  );
}
function Probe() {
  return (
    <LanguageProvider>
      <ProbeText />
    </LanguageProvider>
  );
}

describe("i18n", () => {
  it("follows the browser language by default and persists explicit choices", () => {
    render(<Probe />);
    // jsdom reports en-US, so the system preference resolves to English.
    expect(screen.getByTestId("probe").textContent).toBe("Overview");
    act(() => chooseLanguage("zh"));
    expect(screen.getByTestId("probe").textContent).toBe("概览");
    expect(screen.getByTestId("interp").textContent).toBe("尝试 3");
    expect(localStorage.getItem("codebuddy2api.lang")).toBe("zh");
    act(() => chooseLanguage("en"));
    expect(screen.getByTestId("probe").textContent).toBe("Overview");
    expect(localStorage.getItem("codebuddy2api.lang")).toBe("en");
    act(() => chooseLanguage("system"));
    expect(screen.getByTestId("probe").textContent).toBe("Overview");
    expect(localStorage.getItem("codebuddy2api.lang")).toBe("system");
  });
  it("syncs document title and html lang attribute dynamically with language changes", () => {
    document.title = "";
    render(
      <LanguageProvider>
        <ProbeText />
      </LanguageProvider>,
    );
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("CodeBuddy · Management Console");

    act(() => chooseLanguage("zh"));
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.title).toBe("CodeBuddy · 管理控制台");

    act(() => chooseLanguage("en"));
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("CodeBuddy · Management Console");
    act(() => chooseLanguage("system"));
  });
  it("localizes appearance drawer button title reactively", async () => {
    const { Appearance } = await import("./appearance");
    render(
      <LanguageProvider>
        <Appearance />
      </LanguageProvider>,
    );
    act(() => chooseLanguage("zh"));
    expect(screen.getByRole("button", { name: "外观设置" })).toBeTruthy();
    act(() => chooseLanguage("en"));
    expect(screen.getByRole("button", { name: "Appearance Settings" })).toBeTruthy();
    act(() => chooseLanguage("system"));
  });
  it("falls back to the key itself when an entry is missing", () => {
    expect(translate("missing.key.entirely")).toBe("missing.key.entirely");
  });
  it("translates settings schema keys in both languages", () => {
    act(() => chooseLanguage("en"));
    expect(translate("settings.schema.host")).toBe("Host Address");
    expect(translate("settings.schema.audit_retention_days")).toBe("Audit Retention Days");
    act(() => chooseLanguage("zh"));
    expect(translate("settings.schema.host")).toBe("监听地址");
    expect(translate("settings.schema.audit_retention_days")).toBe("审计明细保留天数");
    act(() => chooseLanguage("system"));
  });
  it("cycles the interface language with the header toggle", async () => {
    const { LanguageToggle } = await import("./appearance");
    render(
      <LanguageProvider>
        <LanguageToggle />
        <ProbeText />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("Overview");
    fireEvent.click(screen.getByRole("button", { name: /^Language: System/ }));
    expect(localStorage.getItem("codebuddy2api.lang")).toBe("zh");
    expect(screen.getByTestId("probe").textContent).toBe("概览");
    fireEvent.click(screen.getByRole("button", { name: /^界面语言：中文/ }));
    expect(localStorage.getItem("codebuddy2api.lang")).toBe("en");
    expect(screen.getByRole("button", { name: /^Language: English/ }).textContent).toBe("EN");
    fireEvent.click(screen.getByRole("button", { name: /^Language: English/ }));
    expect(localStorage.getItem("codebuddy2api.lang")).toBe("system");
    expect(screen.getByTestId("probe").textContent).toBe("Overview");
  });
});

describe("stored language preference", () => {
  it("maps stored values onto UI preferences", () => {
    expect(serverPreference("zh")).toBe("zh");
    expect(serverPreference("en")).toBe("en");
    expect(serverPreference("auto")).toBe("system");
    expect(serverPreference(undefined)).toBe("system");
    expect(serverPreference("klingon")).toBe("system");
  });
});
