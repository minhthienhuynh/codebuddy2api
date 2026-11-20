import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { OAuth } from "../OAuth";
import { Trial } from "../Trial";
import { TravelSummary } from "../Travel";
import { Buddy, buddyConfirmation } from "../Buddy";
import { GrowthTasks, describeGrowth, useGrowthJobs } from "../GrowthTasks";
import { JobBanner, ProgressBanner } from "../jobs";
import { BalanceExpiry, CreditsPanel } from "../CreditsPanel";
import { dateLabel, tokenExpiry } from "../credits";
import {
  api,
  compact,
  credentialResponse,
  errorMessage,
  list,
  metric,
  number,
  object,
  text,
  useResource,
  type Credential,
} from "../api";
import {
  Badge,
  DataValue,
  Drawer,
  DrawerPresence,
  Empty,
  ErrorNotice,
  Fields,
  Icon,
  RefreshIcon,
  SegmentThumb,
  PageTitle,
  Panel,
  ResourceState,
  profileLabel,
} from "../components";
import {
  MAX_REFRESH_TOKENS,
  REFRESH_PROFILES,
  parseRefreshTokens,
  prepareImports,
  type ImportResult,
  type RefreshProfile,
} from "../imports";
import { downloadFilename } from "../downloads";
import s from "../ui.module.scss";
import { SearchInput, Select } from "../fields";
import { t as translate, formatDate, currentLanguage, localizeMessage } from "../i18n";
import { popoverHost, usePopover } from "../popover";
import { clearToasts, notify } from "../toast";

function expiry(value: unknown) {
  return typeof value === "number" ? formatDate(value) : text(value);
}

const lastErrorLabels: Record<string, string> = {
  http_401: "上游 401（登录态被拒）",
  http_403: "上游 403（无权限）",
  restricted: "官方限制（11140）",
  credential_error: "凭证同步失败（详见操作结果）",
};

const healthLabels: Record<string, string> = {
  ready: "就绪",
  disabled: "人工停用",
  auto_disabled: "自动禁用",
  restricted: "被官方限制",
  circuit_open: "认证熔断",
  expired: "已过期",
  error: "错误",
};

const healthKeyMap: Record<string, string> = {
  ready: "credentials.health.ready",
  disabled: "credentials.health.disabled",
  auto_disabled: "credentials.health.autoDisabled",
  restricted: "credentials.health.restricted",
  circuit_open: "credentials.health.circuitOpen",
  expired: "credentials.health.expired",
  error: "credentials.health.error",
};
const lastErrorKeyMap: Record<string, string> = {
  http_401: "credentials.lastError.http401",
  http_403: "credentials.lastError.http403",
  restricted: "credentials.lastError.restricted",
  credential_error: "credentials.lastError.credentialError",
};
function lastErrorLabel(value: unknown) {
  const key = text(value);
  const k = lastErrorKeyMap[key];
  if (k) return translate(k);
  if (currentLanguage() === "en") return key.replaceAll("_", " ");
  return lastErrorLabels[key] ?? key;
}
function healthLabel(value: unknown) {
  const key = text(value);
  const k = healthKeyMap[key];
  if (k) return translate(k);
  if (currentLanguage() === "en") return key.replaceAll("_", " ");
  return healthLabels[key] ?? key;
}

function prettyErrorJson(value: unknown) {
  const raw = text(value);
  if (raw === "") return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Last upstream error; hover (desktop) or tap (mobile) opens the recorded JSON. Click pins it open. */
function LastErrorJson({ code, at, body }: { code: unknown; at: unknown; body: unknown }) {
  const json = prettyErrorJson(body);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const leaveTimer = useRef<number | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const tip = useRef<HTMLDivElement | null>(null);
  const open = pinned || hovered;
  const close = useCallback(() => {
    setPinned(false);
    setHovered(false);
  }, []);
  const placement = usePopover(open, close, trigger, tip, "start");
  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    },
    [],
  );
  // A short grace period bridges the gap between the trigger and the portaled tip.
  const scheduleClose = () => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHovered(false), 160);
  };
  const holdOpen = () => {
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    setHovered(true);
  };
  const hoverProps = {
    onPointerEnter: (event: { pointerType: string }) => {
      if (event.pointerType === "mouse") holdOpen();
    },
    onPointerLeave: (event: { pointerType: string }) => {
      if (event.pointerType === "mouse") scheduleClose();
    },
  };
  const label = (
    <>
      {translate("credentials.recentError", { label: text(lastErrorLabel(code)) })}
      {number(at) !== null ? ` · ${expiry(at)}` : ""}
    </>
  );
  if (json === "") return <small>{label}</small>;
  return (
    <>
      <small>
        <button
          ref={trigger}
          type="button"
          className={s.errorJsonTrigger}
          aria-expanded={open}
          /* Touch toggles purely via the pin: hover only tracks mouse pointers,
             so a tap never strands `hovered` open. */
          onClick={() => {
            setPinned((value) => !value);
          }}
          {...hoverProps}
        >
          {label}
        </button>
      </small>
      {open &&
        createPortal(
          <div
            ref={tip}
            className={s.errorJsonTip}
            style={
              placement ? { top: placement.top, left: placement.left } : { visibility: "hidden" }
            }
            {...hoverProps}
          >
            {json}
          </div>,
          popoverHost(trigger.current),
        )}
    </>
  );
}

export { safeOAuthUrl } from "../OAuth";

function boundModels(credential: Credential): string[] {
  return Array.isArray(credential.bindings)
    ? credential.bindings.filter((id): id is string => typeof id === "string")
    : [];
}

function ImportDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [tab, setTab] = useState<"file" | "token">("file");
  const [results, setResults] = useState<ImportResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<RefreshProfile>("cn-work");
  const [input, setInput] = useState("");
  const parsed = parseRefreshTokens(input);
  const tooMany = parsed.tokens.length > MAX_REFRESH_TOKENS;
  const switchTab = (next: "file" | "token") => {
    if (busy) return;
    setTab(next);
    setResults([]);
    setError(null);
  };
  const importFiles = (files: File[]) => {
    setBusy(true);
    setError(null);
    setResults([]);
    void prepareImports(files)
      .then(async (batch) => {
        setResults(batch.results);
        if (!batch.files.length) return;
        const response = await api.post<unknown>("/credentials/upload", {
          files: batch.files,
          replace: false,
        });
        const server = list(object(response.data).results).map((item) => {
          if (typeof item.name !== "string" || typeof item.ok !== "boolean")
            throw new Error(translate("credentials.error.missingNameOk"));
          return {
            name: item.name,
            ok: item.ok,
            ...(item.error ? { error: text(item.error) } : {}),
          };
        });
        setResults([...batch.results, ...server]);
        if (server.some((item) => item.ok)) onDone();
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };
  const importTokens = () => {
    if (busy || !parsed.tokens.length || tooMany) return;
    setBusy(true);
    setError(null);
    setResults([]);
    void api
      .post<unknown>("/credentials/refresh-import", {
        profile,
        refresh_tokens: parsed.tokens,
      })
      .then((response) => {
        const server = list(object(response.data).results).map((item) => {
          if (typeof item.name !== "string" || typeof item.ok !== "boolean")
            throw new Error(translate("credentials.error.missingNameOk"));
          return {
            name: item.name,
            ok: item.ok,
            ...(item.error ? { error: text(item.error) } : {}),
          };
        });
        setResults(server);
        if (server.some((item) => item.ok)) onDone();
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };
  return (
    <Drawer title={translate("credentials.import.title")} onClose={onClose} dismissDisabled={busy}>
      <div className={s.tabs} role="tablist" aria-label={translate("credentials.import.tabs")}>
        <SegmentThumb />
        {(
          [
            ["file", translate("credentials.import.file")],
            ["token", translate("credentials.import.token")],
          ] as ["file" | "token", string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? s.selectedTab : ""}
            onClick={() => switchTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "file" ? (
        <>
          <p className={s.note}>{translate("credentials.import.fileHelp")}</p>
          <label className={s.upload}>
            {translate("credentials.import.selectFile")}
            <input
              type="file"
              accept=".info,.zip"
              multiple
              disabled={busy}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) importFiles(files);
              }}
            />
          </label>
          {busy && <p role="status">{translate("credentials.import.uploading")}</p>}
        </>
      ) : (
        <>
          <p className={s.note}>{translate("credentials.import.tokenHelp")}</p>
          <label className={s.field}>
            {translate("values.endpoint")}
            <Select
              value={profile}
              disabled={busy}
              onChange={(value) => setProfile(value as RefreshProfile)}
            >
              {REFRESH_PROFILES.map((item) => (
                <option key={item.value} value={item.value}>
                  {profileLabel(item.value)} ({item.value})
                </option>
              ))}
            </Select>
          </label>
          <label className={s.field}>
            {translate("credentials.refreshToken")}
            <textarea
              value={input}
              rows={8}
              spellCheck={false}
              disabled={busy}
              placeholder={translate("credentials.import.tokenPlaceholder")}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>
          <p className={s.note}>
            {translate("credentials.import.recognizedTokens", {
              count: parsed.tokens.length,
              max: MAX_REFRESH_TOKENS,
            })}
            {parsed.rejected
              ? translate("credentials.import.rejectedLines", { count: parsed.rejected })
              : ""}
            .
          </p>
          <button
            type="button"
            disabled={busy || !parsed.tokens.length || tooMany}
            onClick={importTokens}
          >
            {busy
              ? translate("credentials.import.refreshing")
              : translate("credentials.import.submitButton", { count: parsed.tokens.length })}
          </button>
        </>
      )}
      <ErrorNotice message={error} />
      {results.map((r, i) => (
        <div className={s.importResult} key={i}>
          <Badge tone={r.ok ? "good" : "bad"}>
            {r.ok
              ? translate("credentials.import.imported")
              : translate("credentials.import.notImported")}
          </Badge>
          <strong>{r.name}</strong>
          {r.error && <p>{r.error}</p>}
        </div>
      ))}
    </Drawer>
  );
}

type MaintenanceAction =
  | "refresh"
  | "checkin"
  | "sync"
  | "travel"
  | "travel-status"
  | "daily-chat"
  | "reset-cooldown";
function maintenanceLabel(action: MaintenanceAction): string {
  switch (action) {
    case "refresh":
      return translate("credentials.actions.refreshToken");
    case "checkin":
      return translate("credentials.actions.checkin");
    case "sync":
      return translate("credentials.actions.syncBalance");
    case "travel":
      return translate("credentials.actions.travelDispatch");
    case "travel-status":
      return translate("credentials.actions.travelStatus");
    case "daily-chat":
      return translate("credentials.actions.dailyChat");
    case "reset-cooldown":
      return translate("credentials.actions.clearCooldown");
  }
}
function batchLabel(action: MaintenanceAction): string | undefined {
  if (action === "sync") return translate("credentials.actions.syncAll");
  if (action === "checkin") return translate("credentials.actions.batchCheckin");
  return undefined;
}
const SHOWN_RESULTS = 5;

function outcomeOf(r: Record<string, unknown>): { label: string; complete: boolean } {
  const travel = r.travel && typeof r.travel === "object" ? object(r.travel) : null;
  if (r.ok === true && travel?.ok !== false)
    return { label: translate("credentials.tasks.completed"), complete: true };
  const partial =
    r.checkin_ok === true ||
    r.claimed === true ||
    r.departed === true ||
    r.buddy_claimed === true ||
    r.agreement_accepted === true ||
    travel?.claimed === true ||
    travel?.departed === true;
  return {
    label: partial
      ? translate("credentials.tasks.partial")
      : r.skipped
        ? translate("credentials.tasks.skipped")
        : translate("credentials.tasks.uncompleted"),
    complete: false,
  };
}

/**
 * Report a maintenance run as a toast: a batch lists only the accounts that did not finish,
 * a single account always shows its own result.
 */
function notifyMaintenance(title: string, results: Record<string, unknown>[]) {
  const rows = results.map((r) => ({ r, ...outcomeOf(r) }));
  const shown = results.length === 1 ? rows : rows.filter((row) => !row.complete);
  const counts = [
    translate("credentials.tasks.completed"),
    translate("credentials.tasks.partial"),
    translate("credentials.tasks.skipped"),
    translate("credentials.tasks.uncompleted"),
  ]
    .map((label) => [label, rows.filter((row) => row.label === label).length] as const)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(" · ");
  notify({
    key: "maintenance",
    tone: shown.every((row) => row.complete) ? "good" : "warn",
    title,
    body: (
      <>
        {results.length > 1 && <span>{counts}</span>}
        {shown.length > 0 && (
          <ul className={s.toastRows}>
            {shown.slice(0, SHOWN_RESULTS).map(({ r, label, complete }, i) => (
              <li key={i}>
                <strong>{text(r.name)}</strong>
                <Badge tone={complete ? "good" : "warn"}>{label}</Badge>
                <span>{localizeMessage(text(r.message))}</span>
                <TravelSummary
                  trip={
                    r.travel && typeof r.travel === "object"
                      ? object(r.travel)
                      : r.action === "travel" || r.action === "travel-status"
                        ? r
                        : null
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {shown.length > SHOWN_RESULTS && (
          <span>
            {translate("credentials.card.moreUncompleted", { count: shown.length - SHOWN_RESULTS })}
          </span>
        )}
      </>
    ),
  });
}

type ChannelKey = "all" | "cn" | "intl" | "enterprise";
type ViewMode = "cards" | "list";
type StatusFilter = "all" | "ready" | "issue" | "disabled";
type DetailTab = "overview" | "credits" | "tasks" | "cooldowns" | "raw";

const PAGE_SIZES = [10, 20, 50, 100, 500, 1000, 2000] as const;
const PAGE_SIZE_KEY = "codebuddy2api.credPageSize";
const VIEW_MODE_KEY = "codebuddy2api.credView";

function savedPageSize(): number {
  try {
    const raw = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(raw) ? raw : 20;
  } catch {
    return 20;
  }
}

function savedViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}

function isEnterprise(c: Credential): boolean {
  if (c.enterprise === true || Boolean(c.enterpriseName)) return true;
  if (c.credits && typeof c.credits === "object" && object(c.credits).enterprise === true)
    return true;
  return false;
}

function channelOf(c: Credential): Exclude<ChannelKey, "all"> {
  if (isEnterprise(c)) return "enterprise";
  if (text(c.profile).startsWith("intl") || c.region === "intl") return "intl";
  return "cn";
}

function MoreMenu({
  label,
  title = translate("credentials.actions.more"),
  children,
}: {
  label?: string;
  title?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const placement = usePopover(open, close, trigger, menu, "end");
  return (
    <div className={s.moreMenu}>
      <button
        ref={trigger}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      >
        {title}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className={s.moreMenuList}
            role="menu"
            style={
              placement ? { top: placement.top, left: placement.left } : { visibility: "hidden" }
            }
            onClick={close}
          >
            {children}
          </div>,
          popoverHost(trigger.current),
        )}
    </div>
  );
}

export function Credentials() {
  const resource = useResource("/credentials", credentialResponse);
  const [selected, setSelected] = useState<string[]>([]);
  const [drawer, setDrawer] = useState<"oauth" | "import" | "export" | null>(null);
  const [detail, setDetail] = useState<{ credential: Credential; tab: DetailTab } | null>(null);
  const [detailLogs, setDetailLogs] = useState<Record<string, unknown>[] | null>(null);
  const [deleting, setDeleting] = useState<Credential | null>(null);
  const [trialTarget, setTrialTarget] = useState<Credential | null>(null);
  const [buddyTarget, setBuddyTarget] = useState<{
    credential: Credential;
    result: Record<string, unknown>;
    confirmation: ReturnType<typeof buddyConfirmation>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openDetail = (credential: Credential, tab: DetailTab = "overview") => {
    setDetail({ credential, tab });
  };
  const liveDetail = detail
    ? (resource.data?.find((item) => item.id === detail.credential.id) ?? detail.credential)
    : null;
  useEffect(() => {
    if (!liveDetail || detail?.tab !== "overview") return;
    let cancelled = false;
    const credKey = text(liveDetail.account_key ?? liveDetail.id);
    void api
      .get(`/logs?credential=${encodeURIComponent(credKey)}&limit=8`)
      .then((res) => {
        if (cancelled) return;
        const items = object(res.data).items;
        setDetailLogs(Array.isArray(items) ? list(items) : []);
      })
      .catch(() => {
        if (!cancelled) setDetailLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [liveDetail, detail?.tab]);
  // The maintenance action in flight: `action:account`, or `action:*` for every account.
  const [running, setRunning] = useState<{ key: string; title: string } | null>(null);
  const maintain = (action: MaintenanceAction, credential?: Credential) => {
    if (busy) return;
    const title = credential
      ? `${maintenanceLabel(action)} · ${credential.name ?? credential.id}`
      : (batchLabel(action) ?? maintenanceLabel(action));
    setBusy(true);
    setRunning({ key: `${action}:${credential?.id ?? "*"}`, title });
    setError(null);
    const path = credential
      ? `/credentials/${encodeURIComponent(credential.id)}/${action}`
      : `/${action}`;
    void api
      .post(path, undefined, { timeout: 300000 })
      .then(({ data }) => {
        const results = list(object(data).results, translate("credentials.error.resultsContext"));
        if (
          !results.length ||
          results.some((r) => typeof r.ok !== "boolean" || typeof r.message !== "string")
        )
          throw new Error(translate("credentials.error.incompleteBatch"));
        for (const r of results)
          if (r.travel !== undefined)
            object(r.travel, translate("credentials.error.travelContext"));
        notifyMaintenance(title, results);
        if (action === "travel" && credential) {
          if (results.length !== 1 || results[0].id !== credential.id)
            throw new Error(translate("credentials.error.travelUnconfirmed"));
          if (results[0].buddy_confirmation !== undefined)
            setBuddyTarget({
              credential,
              result: results[0],
              confirmation: buddyConfirmation(results[0].buddy_confirmation),
            });
        }
      })
      .catch((err: unknown) => {
        const sep = currentLanguage() === "en" ? "; " : "；";
        setError(`${errorMessage(err)}${sep}${translate("credentials.error.batchFailedNote")}`);
      })
      .finally(() => {
        setBusy(false);
        setRunning(null);
        resource.reload();
      });
  };
  const oauthDone = useCallback(() => {
    setDrawer(null);
    notify({ tone: "good", title: translate("credentials.notify.authComplete") });
    resource.reload();
  }, [resource.reload]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void action()
      .then(() => {
        resource.reload();
        setDeleting(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };
  const releaseRestriction = (credential: Credential) => {
    run(async () => {
      const response = await api.patch(`/credentials/${encodeURIComponent(credential.id)}`, {
        enabled: true,
      });
      const saved = object(response.data);
      if (saved.id !== credential.id || saved.enabled !== true || !Number.isInteger(saved.revision))
        throw new Error(translate("credentials.error.restrictionUnconfirmed"));
      notify({
        key: "restriction",
        tone: "good",
        title: translate("credentials.notify.restrictionLifted"),
        body: <span>{translate("credentials.card.authRejoin")}</span>,
      });
    });
  };
  const preference = (
    credential: Credential,
    field: "auto_checkin" | "auto_travel" | "auto_daily_chat" | "auto_growth",
    enabled: boolean,
  ) => {
    run(async () => {
      const response = await api.patch(`/credentials/${encodeURIComponent(credential.id)}`, {
        [field]: enabled,
      });
      const saved = object(response.data);
      if (
        saved.id !== credential.id ||
        saved[field] !== enabled ||
        !Number.isInteger(saved.revision)
      )
        throw new Error(translate("credentials.error.settingsUnconfirmed"));
      const label =
        field === "auto_checkin"
          ? translate("values.auto_checkin")
          : field === "auto_travel"
            ? translate("values.auto_travel")
            : field === "auto_growth"
              ? translate("tasks.growth.autoBackfill")
              : translate("values.auto_daily_chat");
      notify({
        key: "preference",
        tone: "good",
        title: translate("credentials.notify.toggled", {
          label,
          state: enabled
            ? translate("credentials.notify.turnedOn")
            : translate("credentials.notify.turnedOff"),
        }),
        body: <span>{translate("credentials.card.settingsHint")}</span>,
      });
    });
  };
  const [channel, setChannel] = useState<ChannelKey>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>(savedViewMode);
  const [pageSize, setPageSize] = useState<number>(savedPageSize);
  const [page, setPage] = useState(1);
  const chooseView = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      /* ignore */
    }
  };
  const choosePageSize = (next: number) => {
    setPageSize(next);
    setPage(1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(next));
    } catch {
      /* ignore */
    }
  };
  const allItems = resource.data ?? [];
  const isReady = (c: Credential) => {
    const until = number(c.fail_until);
    const cooling = until !== null && Math.ceil(until - now / 1000) > 0;
    return c.enabled !== false && !cooling && c.health === "ready";
  };
  const filtered = allItems.filter((c) => {
    if (channel !== "all" && channelOf(c) !== channel) return false;
    if (statusFilter === "ready" && !isReady(c)) return false;
    if (statusFilter === "disabled" && c.enabled !== false) return false;
    if (statusFilter === "issue" && (c.enabled === false || isReady(c))) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.nickname, c.uid, c.enterpriseName, profileLabel(text(c.profile))]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const liveSelected = selected.filter((id) => allItems.some((c) => c.id === id));
  const growthJobs = useGrowthJobs();
  const accountName = (identity: string) => {
    const credential = allItems.find((c) => c.id === identity);
    return credential?.name ?? credential?.nickname ?? identity.slice(0, 8);
  };
  const growthBanner = (job: ReturnType<typeof growthJobs.byAccount>) =>
    job?.status === "running" ? (
      <JobBanner
        key={job.key}
        title={translate("tasks.growth.planTitle", {
          name: text(accountName(text(job.meta.account))),
        })}
        job={job}
        describe={describeGrowth}
      />
    ) : null;
  const channelDefs: [ChannelKey, string, string][] = [
    ["all", translate("credentials.channelAll"), translate("credentials.channelAllDesc")],
    ["cn", translate("credentials.channelCn"), translate("credentials.channelCnDesc")],
    ["intl", translate("credentials.channelIntl"), translate("credentials.channelIntlDesc")],
    [
      "enterprise",
      translate("credentials.channelEnterprise"),
      translate("credentials.channelEnterpriseDesc"),
    ],
  ];
  const renderSyncIcon = (c: Credential) => (
    <button
      type="button"
      className={s.iconBtn}
      disabled={busy || c.enabled !== true}
      aria-label={`${translate("credentials.actions.syncBalance")} ${c.name ?? c.id}`}
      title={translate("credentials.actions.syncBalance")}
      onClick={() => maintain("sync", c)}
    >
      <RefreshIcon spinning={running?.key === `sync:${c.id}` || running?.key === "sync:*"} />
    </button>
  );
  const renderActions = (c: Credential) => {
    const enabledTasks = [
      c.auto_checkin === true && translate("credentials.badge.checkin"),
      c.travel_supported === true &&
        c.auto_travel === true &&
        translate("credentials.badge.travel"),
      c.daily_chat_supported === true &&
        c.auto_daily_chat === true &&
        translate("credentials.badge.dailyChat"),
    ].filter(Boolean);
    return (
      <div className={s.rowActions}>
        <button onClick={() => openDetail(c, "overview")}>
          {translate("credentials.actions.detail")}
        </button>
        <button
          aria-label={`${translate("credentials.actions.tasksConfig")} ${c.name ?? c.id}`}
          onClick={() => openDetail(c, "tasks")}
        >
          {translate("credentials.actions.tasksConfig")}
          {enabledTasks.length ? ` (${enabledTasks.length})` : ""}
        </button>
        <MoreMenu label={translate("credentials.moreMenu", { name: c.name ?? c.id })}>
          <button
            disabled={busy || c.enabled !== true}
            aria-label={`${translate("credentials.actions.refreshToken")} ${c.name ?? c.id}`}
            onClick={() => maintain("refresh", c)}
          >
            {translate("credentials.actions.refreshToken")}
          </button>
          <button
            disabled={busy || c.enabled !== true}
            aria-label={`${translate("credentials.actions.checkin")} ${c.name ?? c.id}`}
            onClick={() => maintain("checkin", c)}
          >
            {c.auto_travel === true
              ? translate("credentials.actions.checkinAndTravel")
              : translate("credentials.actions.checkin")}
          </button>
          {/* Not gated on displayed cooldowns or on enablement: a reset that failed
            to persist must stay retryable, and a disabled account can still hold
            a stale cooldown worth clearing. */}
          <button
            disabled={busy}
            aria-label={`${translate("credentials.actions.clearCooldown")} ${c.name ?? c.id}`}
            onClick={() => maintain("reset-cooldown", c)}
          >
            {translate("credentials.actions.clearCooldown")}
          </button>
          {c.restricted === true && (
            <button
              disabled={busy}
              aria-label={`${translate("credentials.actions.liftRestriction")} ${c.name ?? c.id}`}
              onClick={() => releaseRestriction(c)}
            >
              {translate("credentials.actions.reappeal")}
            </button>
          )}
          {c.trial_supported === true && (
            <button
              disabled={busy || c.enabled !== true}
              aria-label={`${translate("credentials.actions.claimTrial")} ${c.name ?? c.id}`}
              onClick={() => setTrialTarget(c)}
            >
              {translate("credentials.actions.claimTrial")}
            </button>
          )}
          {c.daily_chat_supported === true && (
            <button
              disabled={busy || c.enabled !== true}
              aria-label={`${translate("credentials.actions.dailyChat")} ${c.name ?? c.id}`}
              onClick={() => maintain("daily-chat", c)}
            >
              {translate("credentials.actions.dailyChat")}
            </button>
          )}
          {c.travel_supported === true && (
            <>
              <button
                disabled={busy || c.enabled !== true}
                aria-label={`${translate("credentials.actions.travelStatus")} ${c.name ?? c.id}`}
                onClick={() => maintain("travel-status", c)}
              >
                {translate("credentials.actions.travelStatus")}
              </button>
              <button
                disabled={busy || c.enabled !== true}
                aria-label={`${translate("credentials.actions.travelDispatch")} ${c.name ?? c.id}`}
                onClick={() => maintain("travel", c)}
              >
                {translate("credentials.actions.travelDispatch")}
              </button>
            </>
          )}
        </MoreMenu>
        <button className={s.textDanger} disabled={!c.name || busy} onClick={() => setDeleting(c)}>
          {translate("credentials.actions.delete")}
        </button>
      </div>
    );
  };
  const renderEnableSwitch = (c: Credential) => (
    <label className={s.enableSwitch}>
      <input
        type="checkbox"
        role="switch"
        aria-label={`${translate("credentials.actions.toggleStatus")} ${c.name ?? c.id}`}
        checked={c.enabled === true}
        disabled={busy || typeof c.enabled !== "boolean"}
        onChange={() =>
          run(() =>
            api.patch(`/credentials/${encodeURIComponent(c.id)}`, {
              enabled: !c.enabled,
            }),
          )
        }
      />
      <span>
        {c.enabled === true
          ? translate("values.boolean.enabled")
          : c.enabled === false
            ? translate("values.boolean.disabled")
            : translate("values.unknown")}
      </span>
    </label>
  );
  const renderHealthBadge = (c: Credential) => {
    const disabled = c.enabled === false;
    const until = number(c.fail_until);
    const restrictedUntil = number(c.restricted_until);
    const restrictedRemaining =
      restrictedUntil === null ? null : Math.max(0, Math.ceil(restrictedUntil - now / 1000));
    const remaining = disabled
      ? null
      : until === null
        ? null
        : Math.max(0, Math.ceil(until - now / 1000));
    const label =
      c.restricted === true
        ? restrictedRemaining !== null && restrictedRemaining > 0
          ? `${healthLabel("restricted")} ${restrictedRemaining}s`
          : healthLabel("restricted")
        : disabled
          ? c.auto_disabled
            ? healthLabel("auto_disabled")
            : healthLabel("disabled")
          : remaining !== null && remaining > 0
            ? `${healthLabel("circuit_open")} ${remaining}s`
            : c.health === "ready"
              ? translate("credentials.health.readyBadge")
              : healthLabel(c.health);
    return (
      <Badge
        tone={
          c.restricted === true || (remaining !== null && remaining > 0)
            ? "bad"
            : c.health === "ready"
              ? "good"
              : "warn"
        }
      >
        {label}
      </Badge>
    );
  };
  const renderSyncAndCatalog = (c: Credential) => {
    const cooldowns = Array.isArray(c.cooldowns) ? list(c.cooldowns) : null;
    const trip = c.travel && typeof c.travel === "object" ? object(c.travel) : null;
    const tokenAt = tokenExpiry(c);
    return (
      <>
        <strong>
          {c.catalog_ready === true
            ? translate("credentials.status.catalogReady")
            : c.sync_pending === true
              ? translate("credentials.status.catalogSyncing")
              : translate("credentials.status.catalogPending")}
        </strong>
        <div className={s.credSyncTags}>
          <small>
            {c.token_expired === true
              ? translate("credentials.status.tokenExpired")
              : typeof c.sync_error === "string" && c.sync_error !== ""
                ? translate("credentials.status.syncError")
                : translate("credentials.status.syncNormal")}
          </small>
          {c.token_expired !== true && tokenAt !== null && (
            <small>
              {translate("credentials.card.tokenUntil", { date: dateLabel(tokenAt, now / 1000) })}
            </small>
          )}
          {cooldowns ? (
            cooldowns.length ? (
              cooldowns.map((cooldown, i) => (
                <small key={i}>
                  {text(cooldown.model)} ·{" "}
                  {number(cooldown.until) !== null
                    ? `${Math.max(0, Math.ceil(Number(cooldown.until) - now / 1000))}s`
                    : text(cooldown.remaining_seconds)}
                </small>
              ))
            ) : (
              <Badge>{translate("credentials.card.noCooldown")}</Badge>
            )
          ) : c.model_cooldowns ? (
            <DataValue value={c.model_cooldowns} />
          ) : null}
        </div>
        {c.last_error_code != null && (
          <LastErrorJson code={c.last_error_code} at={c.last_failure_at} body={c.last_error_body} />
        )}
        {typeof c.sync_error === "string" && c.sync_error !== "" && (
          <small>
            {translate("credentials.card.failReason", {
              error: localizeMessage(text(c.sync_error)),
            })}
          </small>
        )}
        {c.travel_supported === true && trip && <TravelSummary trip={trip} />}
      </>
    );
  };
  const renderUsageBlock = (c: Credential, compactTable = false) => {
    const stats = c.usage_stats && typeof c.usage_stats === "object" ? object(c.usage_stats) : null;
    const reqs = number(stats?.requests) ?? 0;
    const rate = number(stats?.success_rate);
    const totalTokens = number(stats?.total_tokens);
    const cacheTokens = number(stats?.cache_read_tokens);
    const credit = number(stats?.credit);
    const avgMs = number(stats?.avg_duration_ms);
    if (compactTable) {
      return (
        <div className={s.tableUsage}>
          <div>
            <span>{translate("credentials.card.requests")}</span>
            <strong>{compact(reqs)}</strong>
          </div>
          <div>
            <span>{translate("credentials.card.successRate")}</span>
            <strong>{rate !== null ? `${(rate * 100).toFixed(1)}%` : "—"}</strong>
          </div>
          <div>
            <span>Token</span>
            <strong>{totalTokens !== null ? compact(totalTokens) : "—"}</strong>
          </div>
          <div>
            <span>Credit</span>
            <strong>{credit !== null ? metric(credit) : "—"}</strong>
          </div>
        </div>
      );
    }
    return (
      <div className={s.credUsageBox}>
        <div>
          <span>{translate("credentials.card.totalRequests")}</span>
          <strong>{compact(reqs)}</strong>
          <small>
            {rate !== null
              ? translate("credentials.card.successRate", { rate: (rate * 100).toFixed(1) })
              : translate("credentials.card.noRequestRecords")}
          </small>
        </div>
        <div>
          <span>{translate("credentials.card.totalTokens")}</span>
          <strong>{totalTokens !== null ? compact(totalTokens) : "0"}</strong>
          <small>
            {translate("credentials.card.cacheTokens", {
              tokens: cacheTokens !== null ? compact(cacheTokens) : "0",
            })}
          </small>
        </div>
        <div>
          <span>{translate("credentials.card.creditUsage")}</span>
          <strong>{credit !== null ? metric(credit) : "0"}</strong>
          <small>
            {avgMs !== null
              ? translate("credentials.card.avgDuration", { sec: (avgMs / 1000).toFixed(1) })
              : translate("credentials.card.durationNone")}
          </small>
        </div>
        <div>
          <span>{translate("credentials.card.lastCall")}</span>
          <strong>{stats?.last_model ? text(stats.last_model) : "—"}</strong>
          <small>
            {stats?.last_request_at !== undefined
              ? expiry(stats.last_request_at)
              : translate("credentials.card.noCalls")}
          </small>
        </div>
      </div>
    );
  };
  const renderAutomationPanel = (c: Credential) => {
    const checkin = c.checkin && typeof c.checkin === "object" ? object(c.checkin) : null;
    const trip = c.travel && typeof c.travel === "object" ? object(c.travel) : null;
    const dailyChat =
      c.daily_chat && typeof c.daily_chat === "object" ? object(c.daily_chat) : null;
    return (
      <div className={s.credCardTasks}>
        <div className={s.credTaskRow}>
          <label className={s.check}>
            <input
              type="checkbox"
              role="switch"
              aria-label={`${translate("credentials.auto.checkin")} ${c.name ?? c.id}`}
              checked={c.auto_checkin === true}
              disabled={busy || typeof c.auto_checkin !== "boolean"}
              onChange={(e) => preference(c, "auto_checkin", e.target.checked)}
            />
            {translate("values.auto_checkin")}
          </label>
          <small>
            {translate("credentials.card.lastCheckin", {
              date: checkin?.date ? ` (${text(checkin.date)})` : "",
              msg: checkin
                ? localizeMessage(text(checkin.message))
                : translate("credentials.card.notQueried"),
            })}
          </small>
        </div>
        <div className={s.credTaskRow}>
          <label className={s.check}>
            <input
              type="checkbox"
              role="switch"
              aria-label={`${translate("credentials.auto.travel")} ${c.name ?? c.id}`}
              checked={c.auto_travel === true}
              disabled={busy || c.travel_supported !== true || typeof c.auto_travel !== "boolean"}
              onChange={(e) => preference(c, "auto_travel", e.target.checked)}
            />
            {translate("values.auto_travel")}
          </label>
          <small>
            {c.travel_supported === true
              ? trip
                ? translate("credentials.lastTripWithMsg", {
                    msg: localizeMessage(text(trip.message)),
                  })
                : translate("credentials.notQueried")
              : isEnterprise(c)
                ? translate("credentials.enterpriseNoTravel")
                : translate("credentials.travelCnOnly")}
          </small>
        </div>
        <div className={s.credTaskRow}>
          <label className={s.check}>
            <input
              type="checkbox"
              role="switch"
              aria-label={`${translate("credentials.auto.dailyChat")} ${c.name ?? c.id}`}
              checked={c.auto_daily_chat === true}
              disabled={
                busy || c.daily_chat_supported !== true || typeof c.auto_daily_chat !== "boolean"
              }
              onChange={(e) => preference(c, "auto_daily_chat", e.target.checked)}
            />
            {translate("credentials.auto.dailyChat")}
          </label>
          <small>
            {c.daily_chat_supported === true
              ? dailyChat
                ? translate("credentials.dailyChatWithMsg", {
                    msg: localizeMessage(text(dailyChat.message)),
                  })
                : translate("credentials.notExecuted")
              : translate("credentials.dailyChatIntlOnly")}
          </small>
        </div>
        {dailyChat?.acp_usage != null && (
          <small>
            {translate("credentials.card.chatCost", { cost: text(dailyChat.acp_usage) })}
          </small>
        )}
        {trip?.stale === true && <small>{translate("credentials.card.tripStaleHint")}</small>}
        {c.travel_supported === true && <TravelSummary trip={trip} />}
        {c.enabled === false && <small>{translate("credentials.card.disabledTaskHint")}</small>}
        {c.trial_supported === true && c.trial != null && (
          <small>
            {translate("credentials.card.trialMsg", {
              msg: localizeMessage(text(object(c.trial).message)),
            })}
          </small>
        )}
        {c.growth_supported === true && (
          <>
            <small>
              <strong>{translate("credentials.card.growthTitle")}</strong>
              {translate("credentials.card.growthHint")}
            </small>
            <GrowthTasks
              credential={c}
              busy={busy}
              onPreference={preference}
              selectedIds={liveSelected}
              job={growthJobs.byAccount(c.id)}
              onRun={(code) => growthJobs.start(c.id, code)}
            />
          </>
        )}
      </div>
    );
  };
  return (
    <>
      <PageTitle
        title={translate("credentials.credManagement")}
        actions={
          <>
            <button
              onClick={() => {
                clearToasts();
                resource.reload();
              }}
            >
              <RefreshIcon spinning={resource.refreshing} />
              {translate("common.refreshList")}
            </button>
            <button disabled={busy} onClick={() => maintain("sync")}>
              {translate("credentials.actions.syncAll")}
            </button>
            <MoreMenu
              label={translate("credentials.batch.more")}
              title={translate("credentials.batch.more")}
            >
              <button disabled={busy} onClick={() => maintain("checkin")}>
                {translate("credentials.actions.batchCheckin")}
              </button>
              <button onClick={() => setDrawer("import")}>
                {translate("credentials.batch.importFile")}
              </button>
              <button disabled={!liveSelected.length} onClick={() => setDrawer("export")}>
                {translate("credentials.batch.exportSelected", { count: liveSelected.length })}
              </button>
            </MoreMenu>
            <button className={s.primary} onClick={() => setDrawer("oauth")}>
              <Icon name="key" />
              {translate("credentials.actions.addCred")}
            </button>
          </>
        }
      />
      {!detail && running && (
        <ProgressBanner title={running.title}>
          <small>{translate("credentials.busySubmitting")}</small>
        </ProgressBanner>
      )}
      {growthJobs.jobs.map(growthBanner)}
      <ResourceState {...resource} />
      {!detail && <ErrorNotice message={error} />}
      {resource.data && (
        <div
          className={s.channelTrack}
          role="group"
          aria-label={translate("credentials.filter.channelTrack")}
        >
          <SegmentThumb />
          {channelDefs.map(([key, label, hint]) => {
            const group = key === "all" ? allItems : allItems.filter((c) => channelOf(c) === key);
            const ready = group.filter(isReady).length;
            let totalCredits = 0;
            let hasNumeric = false;
            let unlimited = 0;
            for (const item of group) {
              const bal =
                item.credits && typeof item.credits === "object" ? object(item.credits) : null;
              if (bal?.unlimited && bal?.enterprise) {
                unlimited += 1;
                continue;
              }
              const val = number(bal?.credits ?? bal?.remaining);
              if (val !== null) {
                totalCredits += val;
                hasNumeric = true;
              }
            }
            const active = channel === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                className={active ? s.channelActive : ""}
                title={
                  hasNumeric
                    ? `${translate("credentials.groupSummary", { count: group.length, credits: metric(totalCredits) })}${unlimited ? translate("credentials.unlimitedSuffix", { count: unlimited }) : ""}`
                    : `${translate("credentials.accountsCount", { count: group.length })} · ${hint}`
                }
                onClick={() => {
                  setChannel(active && key !== "all" ? "all" : key);
                  setPage(1);
                }}
              >
                <span>{label}</span>
                <strong>
                  {hasNumeric
                    ? compact(totalCredits)
                    : unlimited > 0
                      ? translate("credits.panel.infinite")
                      : "—"}
                </strong>
                <small>
                  {translate("credentials.card.readyCount", { ready, total: group.length })}
                </small>
              </button>
            );
          })}
        </div>
      )}
      <Panel
        title={translate("credentials.credAccounts")}
        hint={
          resource.data
            ? filtered.length === allItems.length
              ? translate("credentials.accountsCount", { count: allItems.length })
              : translate("credentials.filteredAccountsCount", {
                  filtered: filtered.length,
                  total: allItems.length,
                })
            : translate("credentials.waitingList")
        }
      >
        <div className={s.credFilterBar}>
          <div className={s.credFilterLeft}>
            <label className={s.check}>
              <input
                aria-label={translate("credentials.select.all")}
                type="checkbox"
                checked={allItems.length > 0 && liveSelected.length === allItems.length}
                onChange={(e) => setSelected(e.target.checked ? allItems.map((c) => c.id) : [])}
              />
              {translate("credentials.actions.selectAll")}
            </label>
            <SearchInput
              className={s.credSearch}
              aria-label={translate("credentials.search.placeholder")}
              placeholder={translate("credentials.search.placeholder")}
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(1);
              }}
            />
            <div
              className={s.statusPills}
              role="group"
              aria-label={translate("credentials.filter.statusPills")}
            >
              <SegmentThumb />
              {(
                [
                  ["all", translate("credentials.status.all")],
                  ["ready", translate("credentials.health.ready")],
                  ["issue", translate("credentials.status.issue")],
                  ["disabled", translate("credentials.health.disabled")],
                ] as [StatusFilter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={statusFilter === key}
                  className={statusFilter === key ? s.pillActive : ""}
                  onClick={() => {
                    setStatusFilter(key);
                    setPage(1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {liveSelected.length > 0 && (
              <button onClick={() => setDrawer("export")}>
                {translate("credentials.batch.exportSelected", { count: liveSelected.length })}
              </button>
            )}
          </div>
          <div
            className={s.viewSwitch}
            role="group"
            aria-label={translate("credentials.filter.viewSwitch")}
          >
            <SegmentThumb />
            <button
              type="button"
              aria-pressed={view === "cards"}
              className={view === "cards" ? s.viewActive : ""}
              onClick={() => chooseView("cards")}
            >
              {translate("credentials.view.card")}
            </button>
            <button
              type="button"
              aria-pressed={view === "list"}
              className={view === "list" ? s.viewActive : ""}
              onClick={() => chooseView("list")}
            >
              {translate("credentials.view.list")}
            </button>
          </div>
        </div>
        {resource.data &&
          (filtered.length ? (
            <>
              {view === "cards" ? (
                <div
                  className={s.credCardGrid}
                  role="table"
                  aria-label={translate("credentials.cardTable")}
                >
                  {paged.map((c) => {
                    const balance =
                      c.credits && typeof c.credits === "object" ? object(c.credits) : null;
                    return (
                      <article key={c.id} className={s.credCard} role="row">
                        <div className={s.credCardHead}>
                          <div className={s.credCardTitle}>
                            <input
                              aria-label={translate("credentials.select.one", {
                                name: c.name ?? c.id,
                              })}
                              type="checkbox"
                              checked={liveSelected.includes(c.id)}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, c.id]
                                    : selected.filter((id) => id !== c.id),
                                )
                              }
                            />
                            <div>
                              <strong>{c.name ?? translate("credentials.card.unnamedCred")}</strong>
                              <small>
                                {isEnterprise(c)
                                  ? translate("credentials.card.enterpriseBadge", {
                                      profile: profileLabel(text(c.profile)),
                                    })
                                  : profileLabel(text(c.profile))}{" "}
                                · {text(c.nickname ?? c.uid)}
                              </small>
                            </div>
                          </div>
                          <div className={s.credCardBadges}>
                            {renderHealthBadge(c)}
                            {renderEnableSwitch(c)}
                          </div>
                        </div>
                        <div className={s.credCardStats}>
                          <div>
                            <div className={s.credStatHead}>
                              <span>{translate("credentials.card.thCredits")}</span>
                              {renderSyncIcon(c)}
                            </div>
                            <strong role="cell">
                              {balance
                                ? balance.unlimited && balance.enterprise
                                  ? translate("values.unlimited")
                                  : metric(balance.credits ?? balance.remaining)
                                : translate("values.unknown")}
                            </strong>
                            <BalanceExpiry credits={balance} now={now / 1000} />
                          </div>
                          <div>
                            <span>{translate("credentials.card.thSync")}</span>
                            {renderSyncAndCatalog(c)}
                          </div>
                        </div>
                        {renderUsageBlock(c)}
                        <div className={s.credCardFoot}>{renderActions(c)}</div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className={s.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th></th>
                        <th>{translate("credentials.card.thCred")}</th>
                        <th>{translate("credentials.card.thSync")}</th>
                        <th>{translate("credentials.card.thCredits")}</th>
                        <th>{translate("credentials.card.thUsage")}</th>
                        <th>{translate("credentials.card.thAuth")}</th>
                        <th>{translate("credentials.card.thActions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.map((c) => {
                        const balance =
                          c.credits && typeof c.credits === "object" ? object(c.credits) : null;
                        return (
                          <tr key={c.id}>
                            <td>
                              <input
                                aria-label={translate("credentials.select.one", {
                                  name: c.name ?? c.id,
                                })}
                                type="checkbox"
                                checked={liveSelected.includes(c.id)}
                                onChange={(e) =>
                                  setSelected(
                                    e.target.checked
                                      ? [...selected, c.id]
                                      : selected.filter((id) => id !== c.id),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <strong>{c.name ?? translate("credentials.card.unnamedCred")}</strong>
                              <small>
                                {isEnterprise(c)
                                  ? translate("credentials.card.enterpriseBadge", {
                                      profile: profileLabel(text(c.profile)),
                                    })
                                  : profileLabel(text(c.profile))}{" "}
                                · {text(c.nickname ?? c.uid)}
                              </small>
                            </td>
                            <td>{renderSyncAndCatalog(c)}</td>
                            <td>
                              <div className={s.credStatHead}>
                                <strong>
                                  {balance
                                    ? balance.unlimited && balance.enterprise
                                      ? translate("values.unlimited")
                                      : metric(balance.credits ?? balance.remaining)
                                    : translate("values.unknown")}
                                </strong>
                                {renderSyncIcon(c)}
                              </div>
                              <BalanceExpiry credits={balance} now={now / 1000} />
                            </td>
                            <td>{renderUsageBlock(c, true)}</td>
                            <td>
                              <div className={s.credCardBadges}>
                                {renderHealthBadge(c)}
                                {renderEnableSwitch(c)}
                              </div>
                            </td>
                            <td>{renderActions(c)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className={s.credPager}>
                <span>
                  {translate("credentials.pageSummary", {
                    from: (safePage - 1) * pageSize + 1,
                    to: Math.min(filtered.length, safePage * pageSize),
                    total: filtered.length,
                  })}
                </span>
                <div className={s.credPagerRight}>
                  <Select
                    aria-label={translate("credentials.perPage")}
                    value={pageSize}
                    onChange={(value) => choosePageSize(Number(value))}
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {translate("credentials.card.perPageOption", { count: n })}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage(Math.max(1, safePage - 1))}
                  >
                    {translate("credentials.actions.prevPage")}
                  </button>
                  <span>
                    {translate("credentials.pageOf", { page: safePage, total: totalPages })}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                  >
                    {translate("credentials.actions.nextPage")}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <Empty
              title={
                allItems.length
                  ? translate("credentials.empty.noMatch")
                  : translate("credentials.empty.noCreds")
              }
            >
              {allItems.length
                ? translate("credentials.emptyFilterHint")
                : translate("credentials.emptyAddHint")}
            </Empty>
          ))}
      </Panel>
      <DrawerPresence>
        {buddyTarget && (
          <Buddy
            key={buddyTarget.credential.id}
            credential={buddyTarget.credential}
            initial={buddyTarget.result}
            confirmation={buddyTarget.confirmation}
            onClose={() => setBuddyTarget(null)}
            onDone={(result) => {
              notifyMaintenance(
                translate("credentials.firstBuddyAndDispatch", {
                  name: buddyTarget.credential.name ?? buddyTarget.credential.id,
                }),
                [result],
              );
              resource.reload();
            }}
          />
        )}
      </DrawerPresence>
      <DrawerPresence>
        {trialTarget && (
          <Trial
            credential={trialTarget}
            onClose={() => setTrialTarget(null)}
            onDone={resource.reload}
          />
        )}
      </DrawerPresence>
      <DrawerPresence>
        {drawer === "oauth" && <OAuth onClose={() => setDrawer(null)} onDone={oauthDone} />}
      </DrawerPresence>
      <DrawerPresence>
        {drawer === "import" && (
          <ImportDrawer onClose={() => setDrawer(null)} onDone={resource.reload} />
        )}
      </DrawerPresence>
      <DrawerPresence>
        {detail && liveDetail && (
          <Drawer
            title={translate("credentials.detail.title", {
              name: liveDetail.name ?? liveDetail.id,
            })}
            onClose={() => setDetail(null)}
          >
            {running && (
              <ProgressBanner title={running.title}>
                <small>{translate("credentials.busySubmitting")}</small>
              </ProgressBanner>
            )}
            {growthBanner(growthJobs.byAccount(liveDetail.id))}
            <ErrorNotice message={error} />
            <div className={s.detailBar}>
              <div className={s.credCardBadges}>
                {renderHealthBadge(liveDetail)}
                {renderEnableSwitch(liveDetail)}
              </div>
              <div className={s.rowActions}>
                {renderSyncIcon(liveDetail)}
                <button
                  disabled={busy || liveDetail.enabled !== true}
                  onClick={() => maintain("refresh", liveDetail)}
                >
                  {translate("credentials.actions.refreshToken")}
                </button>
              </div>
            </div>
            <div
              className={s.tabs}
              role="tablist"
              aria-label={translate("credentials.detailSections")}
            >
              <SegmentThumb />
              {(
                [
                  ["overview", translate("credentials.detail.overviewReq")],
                  ["credits", translate("credentials.detail.officialCredits")],
                  ["tasks", translate("credentials.detail.autoConfig")],
                  ["cooldowns", translate("credentials.detail.bindingsCooldowns")],
                  ["raw", translate("credentials.detail.rawDiag")],
                ] as [DetailTab, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={detail.tab === key}
                  className={detail.tab === key ? s.selectedTab : ""}
                  onClick={() => setDetail({ credential: liveDetail, tab: key })}
                >
                  {label}
                </button>
              ))}
            </div>
            {detail.tab === "overview" && (
              <>
                <Panel title={translate("credentials.tabs.overview")}>
                  <div className={s.panelBody}>{renderUsageBlock(liveDetail)}</div>
                </Panel>
                <Panel title={translate("credentials.tabs.catalog")}>
                  <div className={s.panelBody}>{renderSyncAndCatalog(liveDetail)}</div>
                </Panel>
                <Panel title={translate("credentials.tabs.logs")}>
                  <div className={s.panelBody}>
                    {detailLogs === null ? (
                      <small>{translate("credentials.detail.loadingRequests")}</small>
                    ) : detailLogs.length ? (
                      <div className={s.tableWrap}>
                        <table>
                          <thead>
                            <tr>
                              <th>{translate("credentials.detail.thTime")}</th>
                              <th>{translate("credentials.detail.thModel")}</th>
                              <th>{translate("credentials.detail.thStatus")}</th>
                              <th>Token</th>
                              <th>Credit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailLogs.map((log, i) => (
                              <tr key={typeof log.id === "string" ? log.id : i}>
                                <td>{expiry(log.started_at)}</td>
                                <td>{text(log.public_model ?? log.model)}</td>
                                <td>
                                  <Badge tone={log.outcome === "success" ? "good" : "warn"}>
                                    {text(log.status_code ?? log.outcome)}
                                  </Badge>
                                </td>
                                <td>{compact(log.total_tokens)}</td>
                                <td>{metric(log.credit)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty title={translate("credentials.empty.noRequests")} />
                    )}
                  </div>
                </Panel>
              </>
            )}
            {detail.tab === "credits" && <CreditsPanel credential={liveDetail} now={now / 1000} />}
            {detail.tab === "tasks" && (
              <Panel title={translate("credentials.tabs.tasks")}>
                <div className={s.panelBody}>
                  <p className={s.storageSubtle}>{translate("credentials.card.autoTasksDesc")}</p>
                  {renderAutomationPanel(liveDetail)}
                  <div className={s.rowActions}>
                    <button
                      disabled={busy || liveDetail.enabled !== true}
                      onClick={() => maintain("checkin", liveDetail)}
                    >
                      {liveDetail.auto_travel === true
                        ? translate("credentials.actions.checkinAndTravel")
                        : translate("credentials.actions.checkin")}
                    </button>
                    {liveDetail.travel_supported === true && (
                      <>
                        <button
                          disabled={busy || liveDetail.enabled !== true}
                          onClick={() => maintain("travel-status", liveDetail)}
                        >
                          {translate("credentials.actions.travelStatus")}
                        </button>
                        <button
                          disabled={busy || liveDetail.enabled !== true}
                          onClick={() => maintain("travel", liveDetail)}
                        >
                          {translate("credentials.actions.travelDispatch")}
                        </button>
                      </>
                    )}
                    {liveDetail.daily_chat_supported === true && (
                      <button
                        disabled={busy || liveDetail.enabled !== true}
                        onClick={() => maintain("daily-chat", liveDetail)}
                      >
                        {translate("credentials.actions.dailyChat")}
                      </button>
                    )}
                    {liveDetail.trial_supported === true && (
                      <button
                        disabled={busy || liveDetail.enabled !== true}
                        onClick={() => setTrialTarget(liveDetail)}
                      >
                        {translate("credentials.actions.claimTrial")}
                      </button>
                    )}
                  </div>
                </div>
              </Panel>
            )}
            {detail.tab === "cooldowns" && (
              <Panel title={translate("credentials.tabs.bindings")}>
                <div className={s.panelBody}>
                  <div className={s.details}>
                    <div>
                      <span>{translate("credentials.card.boundModelRules")}</span>
                      <strong>
                        {Array.isArray(liveDetail.bindings) && liveDetail.bindings.length
                          ? liveDetail.bindings
                              .map(text)
                              .join(currentLanguage() === "en" ? ", " : "、")
                          : translate("credentials.card.noExclusiveBinding")}
                      </strong>
                    </div>
                  </div>
                  <div className={s.rowActions}>
                    <button disabled={busy} onClick={() => maintain("reset-cooldown", liveDetail)}>
                      {translate("credentials.detail.clearAllCooldowns")}
                    </button>
                  </div>
                </div>
              </Panel>
            )}
            {detail.tab === "raw" && <Fields data={liveDetail} />}
          </Drawer>
        )}
      </DrawerPresence>
      <DrawerPresence>
        {deleting && (
          <Drawer
            title={translate("credentials.delete.title")}
            onClose={() => setDeleting(null)}
            dismissDisabled={busy}
          >
            <div className={s.warning}>
              {translate("credentials.delete.desc", { name: deleting.name ?? deleting.id })}
              {deleting.bindings === undefined ? (
                translate("credentials.delete.unreferenced")
              ) : boundModels(deleting).length ? (
                <>
                  {translate("credentials.delete.referenced", {
                    models: boundModels(deleting).join(", "),
                  })}
                </>
              ) : (
                translate("credentials.delete.unreferenced")
              )}
            </div>
            <ErrorNotice message={error} />
            <button
              className={s.danger}
              disabled={busy}
              onClick={() =>
                run(() =>
                  api.delete(
                    `/credentials/${encodeURIComponent(deleting.name!)}${
                      boundModels(deleting).length ? "?unbind=1" : ""
                    }`,
                  ),
                )
              }
            >
              {boundModels(deleting).length
                ? translate("credentials.delete.unbindAndDelete")
                : translate("credentials.delete.confirmDelete")}
            </button>
          </Drawer>
        )}
      </DrawerPresence>
      <DrawerPresence>
        {drawer === "export" && (
          <Drawer
            title={translate("credentials.export.title")}
            onClose={() => setDrawer(null)}
            dismissDisabled={busy}
          >
            <div className={s.warning}>
              <Icon name="alert" />
              <div>
                <strong>{translate("credentials.export.warning")}</strong>
                <p>{translate("credentials.export.desc", { count: liveSelected.length })}</p>
              </div>
            </div>
            <ErrorNotice message={error} />
            <button
              className={s.danger}
              disabled={busy || !liveSelected.length}
              onClick={() => {
                setBusy(true);
                setError(null);
                void api
                  .post<Blob>(
                    "/credentials/export",
                    { ids: liveSelected, confirm: true },
                    { responseType: "blob" },
                  )
                  .then((response) => {
                    if (!response.data.size)
                      throw new Error(translate("credentials.error.exportEmpty"));
                    const type = String(response.headers["content-type"] ?? "");
                    if (type.includes("json") || type.includes("html"))
                      throw new Error(translate("credentials.error.exportNotAttachment"));
                    const url = URL.createObjectURL(response.data);
                    const link = document.createElement("a");
                    link.href = url;
                    const header = String(response.headers["content-disposition"] ?? "");
                    link.download = downloadFilename(
                      header,
                      liveSelected.length === 1 ? "credential.info" : "credentials.zip",
                    );
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    setDrawer(null);
                  })
                  .catch((err: unknown) => setError(errorMessage(err)))
                  .finally(() => setBusy(false));
              }}
            >
              {translate("credentials.export.confirmButton")}
            </button>
          </Drawer>
        )}
      </DrawerPresence>
    </>
  );
}
