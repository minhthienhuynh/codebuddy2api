import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Credentials } from "./pages/Credentials";
import { api, useResource } from "./api";
import { chooseLanguage, LanguageProvider } from "./i18n";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  useResource: vi.fn(),
}));

function media() {
  const targets = new Map<string, EventTarget>();
  const values = new Map<string, boolean>();
  vi.stubGlobal("matchMedia", (query: string) => {
    if (!targets.has(query)) targets.set(query, new EventTarget());
    const target = targets.get(query)!;
    return {
      get matches() {
        return values.get(query) ?? false;
      },
      media: query,
      addEventListener: (type: string, fn: EventListener) => target.addEventListener(type, fn),
      removeEventListener: (type: string, fn: EventListener) =>
        target.removeEventListener(type, fn),
      dispatchEvent: (event: Event) => target.dispatchEvent(event),
    };
  });
}

const richCredential = {
  id: "cred-1",
  name: "test-account.info",
  enabled: true,
  profile: "cn-cli",
  health: "ready",
  catalog_ready: true,
  tokens_total: 150000,
  tokens_prompt: 100000,
  tokens_completion: 50000,
  requests_total: 42,
  requests_success: 40,
  requests_failed: 2,
  last_used_at: 1700000000,
  travel_supported: true,
  auto_checkin: true,
  auto_travel: true,
  checkin: {
    date: "2026-11-24",
    message: "签到成功",
  },
  travel: {
    status: "traveling",
    location_name: "杭州西湖",
    return_time: 1700003600,
    message: "旅行中",
  },
  trial_supported: true,
  trial: {
    message: "体验积分已领取",
  },
  growth_supported: true,
  growth: {
    total_score: 100,
    today_score: 20,
    tasks: [
      { id: "task_1", title: "完成 5 次对话", status: "completed", progress: 5, total: 5 },
      { id: "task_2", title: "每日登录", status: "in_progress", progress: 0, total: 1 },
    ],
  },
  credits: {
    total: 6000,
    fetched_at: 1700000000,
    segments: [
      {
        source: "个人版基础包",
        total: 10000,
        remaining: 5000,
        expires_at: 1800000000,
      },
      {
        source: "免费体验额度",
        total: 2000,
        remaining: 1000,
        expires_at: 1800000000,
      },
    ],
  },
  bindings: ["gpt-4o", "claude-3-7-sonnet"],
  cooldowns: [{ model: "claude-3-7-sonnet", remaining_seconds: "120s" }],
  raw_diag_source: "上游限制",
  raw_diag_message: "操作成功",
};

describe("Credentials details modal i18n", () => {
  beforeEach(() => {
    media();
    act(() => chooseLanguage("en"));
    vi.mocked(useResource).mockReturnValue({
      data: [richCredential],
      reload: vi.fn(),
      loading: false,
      refreshing: false,
      error: null,
    });
    vi.spyOn(api, "get").mockImplementation(async (path: string) => {
      if (path.startsWith("/logs")) {
        return { data: { items: [] } };
      }
      if (path.includes("growth-tasks")) {
        return {
          data: {
            supported: true,
            auto_growth: true,
            growth_auto: {},
            tasks: [
              {
                task_code: "tc_1",
                title: "完成 5 次对话",
                description: "在 WorkBuddy 对话 5 次",
                credit: 10,
                energy: 5,
                locked: false,
                accept_status: "in_progress",
                target: 5,
                current: 3,
                claimable: false,
                claimed: false,
                group: "chat",
                automatable: true,
              },
              {
                task_code: "tc_2",
                title: "每日登录",
                description: "每天打开客户端并登录",
                credit: 5,
                energy: 2,
                locked: false,
                accept_status: "completed",
                target: 1,
                current: 1,
                claimable: false,
                claimed: true,
                group: "behavior",
                automatable: true,
              },
            ],
          },
        };
      }
      if (path === "/growth-jobs") {
        return { data: { jobs: [] } };
      }
      return { data: {} };
    });
  });

  afterEach(() => {
    act(() => chooseLanguage("system"));
    vi.restoreAllMocks();
  });

  it("contains zero Chinese characters across all 5 detail tabs in English mode", async () => {
    render(
      <LanguageProvider>
        <Credentials />
      </LanguageProvider>,
    );

    // Open Details drawer
    const detailsBtn = screen.getByRole("button", { name: /Details|详情/i });
    await act(async () => {
      fireEvent.click(detailsBtn);
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();

    const findChinese = (el: HTMLElement) => {
      const text = el.textContent ?? "";
      return text.match(/[\u4e00-\u9fff]/g) ?? [];
    };

    // Tab 1: Overview & Requests
    const overviewTab = within(dialog).getByRole("tab", { name: "Overview & Requests" });
    await act(async () => {
      fireEvent.click(overviewTab);
    });
    expect(findChinese(dialog)).toEqual([]);

    // Tab 2: Official Quota
    const creditsTab = within(dialog).getByRole("tab", { name: "Official Quota" });
    await act(async () => {
      fireEvent.click(creditsTab);
    });
    expect(findChinese(dialog)).toEqual([]);

    // Tab 3: Automation
    const tasksTab = within(dialog).getByRole("tab", { name: "Automation" });
    await act(async () => {
      fireEvent.click(tasksTab);
    });
    expect(findChinese(dialog)).toEqual([]);

    // Tab 4: Bindings & Cooldowns
    const cooldownsTab = within(dialog).getByRole("tab", { name: "Bindings & Cooldowns" });
    await act(async () => {
      fireEvent.click(cooldownsTab);
    });
    expect(findChinese(dialog)).toEqual([]);

    // Tab 5: Raw Diagnostics
    const rawTab = within(dialog).getByRole("tab", { name: "Raw Diagnostics" });
    await act(async () => {
      fireEvent.click(rawTab);
    });
    expect(findChinese(dialog)).toEqual([]);
  });

  it("contains zero Chinese characters in Trial sub-drawer in English mode", async () => {
    render(
      <LanguageProvider>
        <Credentials />
      </LanguageProvider>,
    );

    // Open Details drawer
    const detailsBtn = screen.getByRole("button", { name: /Details|详情/i });
    await act(async () => {
      fireEvent.click(detailsBtn);
    });

    const dialog = screen.getByRole("dialog");

    // Go to Automation tab
    const tasksTab = within(dialog).getByRole("tab", { name: "Automation" });
    await act(async () => {
      fireEvent.click(tasksTab);
    });

    // Click Claim Trial Credits button
    const claimTrialBtn = within(dialog).getByRole("button", { name: "Claim Trial Credits" });
    await act(async () => {
      fireEvent.click(claimTrialBtn);
    });

    // Sub-drawer for trial
    const dialogs = screen.getAllByRole("dialog");
    const trialDrawer = dialogs[dialogs.length - 1];
    expect(trialDrawer).toBeTruthy();

    const text = trialDrawer.textContent ?? "";
    const chinese = text.match(/[\u4e00-\u9fff]/g) ?? [];
    expect(chinese).toEqual([]);
  });

  it("contains zero Chinese in Raw Diagnostics for real-world uninitialized and error credentials in English mode", async () => {
    const rawFjordCred = {
      healthy: true,
      in_flight: 0,
      max_in_flight: 0,
      model_cooldowns: {},
      sticky_sessions: 0,
      uid: "300001",
      account_key: "9ca6df8fdfd73cca38a0bebc3e67e26f59039704ce38c2c5b0534d378f96d4ee",
      site: "domestic",
      profile: "cn-cli",
      region: "cn",
      product: "cli",
      nickname: "Fjord",
      enterpriseName: "Fjord Studio",
      enterprise: true,
      token_expires_at: 1795545822290,
      token_expired: false,
      last_refresh_time: 0,
      id: "cred-real-1",
      name: "fjord.info",
      enabled: true,
      health: "ready",
      auto_disabled: false,
      restricted: false,
      restricted_until: null,
      auto_checkin: true,
      checkin: {
        state: "unknown",
        message: "尚未查询签到活动",
      },
      auto_travel: false,
      travel_supported: false,
      travel: {
        state: "unknown",
        message: "尚未查询旅行状态",
      },
      trial_supported: false,
      trial: {
        ok: false,
        can_claim: false,
        state: "not_applicable",
        message: "仅支持国际 WorkBuddy 账号，国内账号及国际 CodeBuddy 不适用",
      },
      daily_chat_supported: false,
      auto_daily_chat: false,
      daily_chat: {
        state: "available",
        message: "今日尚未打卡，可手动向官方申请每日活跃奖励",
        day: null,
      },
      growth_supported: false,
      auto_growth: false,
      growth_auto: {},
      fail_until: 0,
      cooldown_until: 0,
      cooldown_remaining: 0,
      last_error_code: "http_401",
      last_failure_at: 1700000000,
      last_error_body: "上游限制",
      sync_error: "连接官方失败或响应中断，请检查服务器网络、DNS 和代理；勿立即重复申请",
      cooldowns: [],
      credits: null,
      sync_pending: true,
      catalog_ready: false,
      bindings: [],
    };

    vi.mocked(useResource).mockReturnValue({
      data: [rawFjordCred],
      reload: vi.fn(),
      loading: false,
      refreshing: false,
      error: null,
    });

    render(
      <LanguageProvider>
        <Credentials />
      </LanguageProvider>,
    );

    const detailsBtn = screen.getByRole("button", { name: /Details|详情/i });
    await act(async () => {
      fireEvent.click(detailsBtn);
    });

    const dialog = screen.getByRole("dialog");
    const rawTab = within(dialog).getByRole("tab", { name: "Raw Diagnostics" });
    await act(async () => {
      fireEvent.click(rawTab);
    });

    const text = dialog.textContent ?? "";
    const chinese = text.match(/[\u4e00-\u9fff]/g) ?? [];
    expect(chinese).toEqual([]);
  });
});
