import { useState } from "react";
import { api, errorMessage, list, object, text, useResource, type RecordValue } from "../api";
import {
  Badge,
  Empty,
  ErrorNotice,
  Fields,
  RefreshIcon,
  SegmentThumb,
  PageTitle,
  Panel,
  ResourceState,
} from "../components";
import s from "../ui.module.scss";
import { Select } from "../fields";
import { AccountPanel } from "./Account";
import { t } from "../i18n";
type Setting = {
  key: string;
  value: unknown;
  stored: unknown;
  source: string;
  mode: string;
  type: string;
  label: string;
  choices?: unknown[];
  min?: number;
  max?: number;
  locked: boolean;
};
const sourceLabels: Record<string, string> = {
  cli: "命令行",
  environment: "环境变量",
  env: "环境变量",
  dotenv: ".env 文件",
  generated: "本地默认密钥",
  management: "管理界面",
  default: "默认值",
  internal: "内置",
};
const modeLabels: Record<string, string> = {
  hot: "即时生效",
  restart: "重启后生效",
  startup: "启动时设置",
  readonly: "只读",
};

function getSourceLabel(src: string): string {
  const k = "settings.source." + src;
  const tr = t(k);
  return tr !== k ? tr : (sourceLabels[src] ?? src);
}
function getModeLabel(mode: string): string {
  if (mode === "hot") return t("settings.apply.hot");
  if (mode === "restart") return t("settings.apply.restart");
  if (mode === "startup") return t("settings.mode.startup");
  if (mode === "readonly") return t("settings.mode.readonly");
  return modeLabels[mode] ?? mode;
}

function displayValue(value: unknown) {
  return typeof value === "boolean"
    ? value
      ? t("credentials.notify.turnedOn")
      : t("credentials.notify.turnedOff")
    : text(value);
}
function normalize(value: unknown): {
  revision: number;
  items: Setting[];
  audit: RecordValue;
  session: RecordValue;
} {
  const d = object(value);
  if (typeof d.revision !== "number") throw new Error("设置响应缺少 revision");
  const items = list(d.items).map((item) => {
    if (
      typeof item.key !== "string" ||
      typeof item.locked !== "boolean" ||
      typeof item.type !== "string" ||
      typeof item.source !== "string" ||
      typeof item.mode !== "string" ||
      !("value" in item) ||
      !("stored" in item)
    )
      throw new Error("设置 schema 字段不完整");
    return {
      key: item.key,
      value: item.value,
      stored: item.stored,
      source: item.source,
      mode: item.mode,
      type: item.type,
      label: typeof item.label === "string" ? item.label : item.key,
      locked: item.locked,
      choices: Array.isArray(item.choices) ? item.choices : undefined,
      min: typeof item.min === "number" ? item.min : undefined,
      max: typeof item.max === "number" ? item.max : undefined,
    };
  });
  return {
    revision: d.revision,
    items,
    audit: object(d.audit, "审计状态"),
    session: object(d.session ?? {}, "会话存储状态"),
  };
}
type SettingsGroup = [string, string, Setting[]];
function SettingsTabs({
  groups,
  tab,
  onChange,
}: {
  groups: SettingsGroup[];
  tab: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div className={s.tabs} role="tablist" aria-label={t("settings.groups")}>
      <SegmentThumb />
      {groups.map(([key, label, rows]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          className={tab === key ? s.selectedTab : ""}
          onClick={() => onChange(key)}
        >
          {label}（{rows.length}）
        </button>
      ))}
      <button
        type="button"
        role="tab"
        aria-selected={tab === "account"}
        className={tab === "account" ? s.selectedTab : ""}
        onClick={() => onChange("account")}
      >
        {t("account.title")}
      </button>
    </div>
  );
}
function SettingsForm({
  data,
  reload,
}: {
  data: ReturnType<typeof normalize>;
  reload: () => void;
}) {
  const [values, setValues] = useState<RecordValue>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const groups: SettingsGroup[] = [
    ["editable", t("settings.tab.editable"), []],
    ["external", t("settings.tab.external"), []],
    ["system", t("settings.tab.system"), []],
  ];
  for (const item of data.items) {
    if (item.key === "model_guard" || item.key === "model_capability_guard") continue;
    if (!item.locked) groups[0][2].push(item);
    else if (["cli", "environment", "env", "dotenv"].includes(item.source)) groups[1][2].push(item);
    else groups[2][2].push(item);
  }
  const [tab, setTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested === "account" || groups.some(([key]) => key === requested)) return requested!;
    return groups[0][2].length ? "editable" : "external";
  });
  const changeTab = (next: string) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "account") url.searchParams.set("tab", "account");
    else url.searchParams.delete("tab");
    window.history.replaceState({}, "", url);
  };
  if (tab === "account")
    return (
      <>
        <SettingsTabs groups={groups} tab={tab} onChange={changeTab} />
        <AccountPanel />
      </>
    );
  const visible = groups.find(([key]) => key === tab)?.[2] ?? [];
  const emptyTitles: Record<string, string> = {
    editable: t("settings.empty.editable"),
    external: t("settings.empty.external"),
    system: t("settings.empty.system"),
  };
  const count = Object.keys(values).length;
  const update = (item: Setting, value: unknown) => {
    setSaved(false);
    setValues((old) => {
      const next = { ...old };
      if (value === (item.stored ?? item.value)) delete next[item.key];
      else next[item.key] = value;
      return next;
    });
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void api
          .patch("/settings", { revision: data.revision, values })
          .then(() => {
            setValues({});
            setSaved(true);
            reload();
          })
          .catch((err: unknown) => setError(errorMessage(err)))
          .finally(() => setBusy(false));
      }}
    >
      <SettingsTabs groups={groups} tab={tab} onChange={changeTab} />
      <Panel title={t("settings.itemsPanel")}>
        {!visible.length && <Empty title={emptyTitles[tab]} />}
        {visible.map((item) => {
          const value = Object.hasOwn(values, item.key)
            ? values[item.key]
            : (item.stored ?? item.value);
          const knownType = [
            "boolean",
            "bool",
            "integer",
            "int",
            "number",
            "float",
            "string",
            "str",
          ].includes(item.type);
          const numeric = ["integer", "int", "number", "float"].includes(item.type);
          const boolean = ["boolean", "bool"].includes(item.type);
          const concealed = item.locked && ["secret", "paths", "path"].includes(item.type);
          const pendingValue =
            item.stored !== null && item.stored !== undefined && item.stored !== item.value;
          return (
            <div className={s.setting} key={item.key}>
              <div className={s.settingDescription}>
                <strong title={item.key}>{item.label}</strong>
                {item.key === "model_capability_guard" && (
                  <small>{t("models.guard.capabilityHelp")}</small>
                )}
                <div className={s.actions}>
                  <Badge>{getSourceLabel(item.source)}</Badge>
                  <Badge tone={item.mode === "hot" ? "good" : "warn"}>
                    {getModeLabel(item.mode)}
                  </Badge>
                  {item.locked && item.source !== "internal" && (
                    <Badge tone="warn">{t("settings.tab.external")}</Badge>
                  )}
                </div>
                {!concealed && (item.locked || pendingValue) && (
                  <small>{t("settings.activeValue", { val: displayValue(item.value) })}</small>
                )}
                {!concealed && pendingValue && (
                  <small>{t("settings.savedValue", { val: displayValue(item.stored) })}</small>
                )}
              </div>
              <div className={s.settingControl}>
                {item.locked ? (
                  item.source !== "internal" && <p className={s.note}>{t("settings.lockedNote")}</p>
                ) : !knownType && !item.choices ? (
                  <p className={s.note}>{t("settings.unsupportedNote")}</p>
                ) : (
                  <label className={s.field}>
                    <span className={s.srOnly}>{item.label}</span>
                    {item.choices ? (
                      <Select
                        value={JSON.stringify(value)}
                        onChange={(value) => update(item, JSON.parse(value) as unknown)}
                      >
                        {!item.choices.some(
                          (choice) => JSON.stringify(choice) === JSON.stringify(value),
                        ) && (
                          <option value={JSON.stringify(value)} disabled>
                            {text(value)}
                          </option>
                        )}
                        {item.choices.map((choice) => (
                          <option value={JSON.stringify(choice)} key={JSON.stringify(choice)}>
                            {text(choice)}
                          </option>
                        ))}
                      </Select>
                    ) : boolean ? (
                      <span className={s.check}>
                        <input
                          type="checkbox"
                          checked={value === true}
                          onChange={(e) => update(item, e.target.checked)}
                        />
                        {value === true
                          ? t("credentials.notify.turnedOn")
                          : t("credentials.notify.turnedOff")}
                      </span>
                    ) : (
                      <input
                        type={numeric ? "number" : "text"}
                        value={value === null || value === undefined ? "" : text(value)}
                        min={item.min}
                        max={item.max}
                        step={["int", "integer"].includes(item.type) ? 1 : "any"}
                        required={numeric}
                        onChange={(e) =>
                          update(
                            item,
                            numeric
                              ? e.target.value === ""
                                ? ""
                                : Number(e.target.value)
                              : e.target.value,
                          )
                        }
                      />
                    )}
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </Panel>
      <div className={s.saveBar}>
        <span>
          {count
            ? t("settings.save.pendingCount", { count })
            : saved
              ? t("settings.save.saved")
              : t("settings.save.noChanges")}
        </span>
        <button className={s.primary} disabled={!count || busy}>
          {busy ? t("settings.save.saving") : t("settings.save.saveChanges")}
        </button>
      </div>
      <ErrorNotice message={error} />
      {data.session.degraded === true && (
        <Panel title={t("settings.session.title")}>
          <Badge tone="bad">{t("settings.session.revocationDegraded")}</Badge>
          <p>{t("settings.session.degradedWarning")}</p>
          <details className={s.chartData}>
            <summary>{t("settings.session.viewDetails")}</summary>
            <Fields data={data.session} />
          </details>
        </Panel>
      )}
    </form>
  );
}
export function Settings() {
  const resource = useResource("/settings", normalize);
  return (
    <>
      <PageTitle
        title={t("settings.title")}
        actions={
          <button onClick={resource.reload}>
            <RefreshIcon spinning={resource.refreshing} />
            {t("settings.reload")}
          </button>
        }
      />
      <ResourceState {...resource} />
      {resource.data && <SettingsForm data={resource.data} reload={resource.reload} />}
    </>
  );
}
