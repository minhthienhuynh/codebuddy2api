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
});
