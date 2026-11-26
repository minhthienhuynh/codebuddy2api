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

describe("localizeMessage", () => {
  it("translates backend and upstream status messages when English is active", async () => {
    const { localizeMessage } = await import("./i18n");
    act(() => chooseLanguage("en"));
    expect(localizeMessage("今日已签到")).toBe("Already checked in today");
    expect(localizeMessage("Buddy 空闲")).toBe("Buddy idle");
    expect(localizeMessage("Buddy 旅行中")).toBe("Buddy traveling");
    expect(localizeMessage("今日打卡已确认，活跃奖励由官方次日结算")).toBe(
      "Active check-in confirmed; reward settled by official next day",
    );
    expect(localizeMessage("个人版订阅套餐")).toBe("Personal Subscription Plan");
    expect(localizeMessage("同意已保存；Buddy 空闲")).toBe("Consent saved; Buddy idle");
    expect(localizeMessage("余额、目录和用量已同步")).toBe("Balance, catalog, and usage synced");
    expect(localizeMessage("同步不完整，保留上次成功数据")).toBe(
      "Sync incomplete, retaining last successful data",
    );
    expect(localizeMessage("签到成功，余额可另行同步")).toBe(
      "Check-in succeeded; balance can be synced separately",
    );
    expect(localizeMessage("签到活动未开放或已结束")).toBe(
      "Check-in activity not available or has ended",
    );
    expect(localizeMessage("当前账号不具备签到资格")).toBe(
      "Current account is not eligible for check-in",
    );
    expect(localizeMessage("活动状态未确认，未尝试领取")).toBe(
      "Activity status unconfirmed; claim not attempted",
    );
    expect(localizeMessage("签到未确认成功，请核验账号状态")).toBe(
      "Check-in not confirmed; please verify account status",
    );
    expect(localizeMessage("自动签到设置或凭证已变化，已取消未发送的领取")).toBe(
      "Auto check-in settings or credential changed; unsent claim cancelled",
    );
    expect(localizeMessage("凭证已变化，结果未写入，请刷新核验")).toBe(
      "Credential changed; result not saved, please refresh and verify",
    );
    expect(localizeMessage("尚未查询签到活动")).toBe("Check-in activity not yet queried");
    expect(localizeMessage("账号已人工停用")).toBe("Account manually disabled");
    expect(localizeMessage("已清除该账号的冷却")).toBe("Cooldown cleared for this account");
    expect(localizeMessage("该账号当前没有冷却")).toBe("No active cooldown for this account");
    expect(localizeMessage("凭证身份已变化，请刷新列表")).toBe(
      "Credential identity changed, please refresh the list",
    );
    expect(localizeMessage("Buddy 已派出，余额可另行同步")).toBe(
      "Buddy dispatched; balance can be synced separately",
    );
    expect(localizeMessage("体验积分已领取，可另行同步余额")).toBe(
      "Trial credits claimed; balance can be synced separately",
    );
    expect(localizeMessage("程序目录不可写，无法自动更新")).toBe(
      "Program directory is not writable, cannot self-update",
    );
    expect(localizeMessage("GitHub API 访问频率受限，请稍后重试")).toBe(
      "GitHub API rate limit exceeded, please retry later",
    );
    expect(localizeMessage("已有更新任务正在进行")).toBe("An update task is already in progress");
    expect(localizeMessage("超时")).toBe("Timeout");
    expect(localizeMessage("无法连接")).toBe("Connection failed");
    expect(localizeMessage("返回的不是发布包")).toBe("Not a release archive");

    expect(localizeMessage("杭州西湖")).toBe("Hangzhou West Lake");
    expect(localizeMessage("北京")).toBe("Beijing");
    expect(localizeMessage("个人版基础包")).toBe("Personal Basic Pack");
    expect(localizeMessage("运营裂变包")).toBe("Operations Growth Pack");
    expect(localizeMessage("完成 5 次对话")).toBe("Complete 5 Conversations");
    expect(localizeMessage("每日登录")).toBe("Daily Login");
    expect(localizeMessage("上游限制 11140")).toBe("Upstream restriction 11140");

    act(() => chooseLanguage("zh"));
    expect(localizeMessage("今日已签到")).toBe("今日已签到");
    expect(localizeMessage("Buddy 空闲")).toBe("Buddy 空闲");
    act(() => chooseLanguage("system"));
  });
});

describe("formatDate", () => {
  it("formats dates with locale-sensitive rules", async () => {
    const { formatDate } = await import("./i18n");
    const timestamp = 1792497600;
    act(() => chooseLanguage("en"));
    expect(formatDate(timestamp)).toBeTruthy();
    act(() => chooseLanguage("zh"));
    expect(formatDate(timestamp)).toBeTruthy();
    act(() => chooseLanguage("system"));
  });
});
