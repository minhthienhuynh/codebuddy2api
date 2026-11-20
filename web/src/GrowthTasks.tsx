import { t as translate } from "./i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, list, object, text, type Credential, type RecordValue } from "./api";
import { jobResponse, useJobPolling, type Job } from "./jobs";
import s from "./ui.module.scss";

type GrowthTask = {
  task_code: string;
  title: string;
  description: string;
  credit: number;
  energy: number;
  locked: boolean;
  accept_status: string;
  target: number;
  current: number;
  claimable: boolean;
  claimed: boolean;
  group: string;
  automatable: boolean;
};

type GrowthView = {
  supported: boolean;
  auto_growth: boolean;
  growth_auto: Record<string, boolean>;
  tasks: GrowthTask[];
  message?: string;
  stale?: boolean;
};

const groupLabel = (group: string) => {
  if (group === "behavior") return translate("tasks.growth.behavior");
  if (group === "chat") return translate("tasks.growth.chat");
  if (group === "miniprogram") return translate("tasks.growth.miniprogram");
  return translate("tasks.growth.otherGroup");
};

/** Every account's growth job; runs are server-side, so they survive closing the drawer. */
export function useGrowthJobs() {
  const load = useCallback(
    async () => list(object((await api.get("/growth-jobs")).data).jobs).map(jobResponse),
    [],
  );
  const { jobs, accept } = useJobPolling(load, () => {});
  const start = useCallback(
    async (identity: string, code?: string) => {
      const base = `/credentials/${encodeURIComponent(identity)}/growth-tasks`;
      const response = code
        ? await api.post(`${base}/auto`, { task_code: code })
        : await api.post(`${base}/auto-all`, {});
      accept([jobResponse(response.data)]);
    },
    [accept],
  );
  const byAccount = (identity: string) => jobs.find((job) => job.key === `growth:${identity}`);
  return { jobs, start, byAccount };
}

/** Banner text for the task a growth job is running now. */
export function describeGrowth(item: RecordValue): string {
  return translate("tasks.growth.execute", { title: text(item.title ?? item.task_code) });
}

function summary(job: Job): string {
  const results = job.results;
  if (!results.length) return translate("tasks.growth.noExecutable");
  if (job.meta.kind === "single")
    return text(results[0].message) || translate("tasks.growth.executed");
  const failed = results.filter((row) => row.ok !== true);
  return (
    translate("tasks.growth.summary", {
      count: results.length,
      claimed: results.filter((row) => row.claimed === true).length,
    }) +
    (failed.length
      ? translate("tasks.growth.uncompleted", {
          items: failed
            .map((row) => `${text(row.title ?? row.task_code)}（${text(row.message)}）`)
            .join("，"),
        })
      : "")
  );
}

/** 成长计划子栏：仅国内个人账号渲染（上游成长中心为个人 CN 专属）。 */
export function GrowthTasks({
  credential,
  busy,
  onPreference,
  selectedIds,
  job,
  onRun,
}: {
  credential: Credential;
  busy: boolean;
  onPreference: (c: Credential, field: "auto_growth", enabled: boolean) => void;
  selectedIds: string[];
  job?: Job;
  onRun: (code?: string) => Promise<void>;
}) {
  const [view, setView] = useState<GrowthView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const running = job?.status === "running";
  const currentCode = running ? job.current[0]?.item.task_code : undefined;
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const load = useCallback(async () => {
    const abort = new AbortController();
    controller.current = abort;
    setError(null);
    try {
      const response = await api.get(
        `/credentials/${encodeURIComponent(credential.id)}/growth-tasks`,
        { signal: abort.signal },
      );
      setView(object(response.data, "growth tasks") as unknown as GrowthView);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }, [credential.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // A job that finishes while the drawer is open reloads the list; one that finished
  // before it opened is only summarized, since the mount already loads fresh progress.
  const seenFinish = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!job || job.status !== "completed") {
      if (seenFinish.current === undefined) seenFinish.current = null; // Opened before it finished.
      return;
    }
    if (job.finished_at === seenFinish.current) return;
    const opened = seenFinish.current === undefined;
    seenFinish.current = job.finished_at;
    setNotice(
      opened ? translate("tasks.growth.lastExecution", { summary: summary(job) }) : summary(job),
    );
    if (!opened) void load();
  }, [job, load]);

  const run = async (code?: string) => {
    if (busy || running) return;
    setError(null);
    setNotice(null);
    seenFinish.current = job?.finished_at ?? null;
    try {
      await onRun(code);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // 串行保存：每次都基于已确认的映射合并，避免连续点击时旧映射覆盖新开关。
  const saveSwitches = async (changes: Record<string, boolean>) => {
    if (busy || saving || !view) return;
    const mapping = { ...view.growth_auto, ...changes };
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/credentials/${encodeURIComponent(credential.id)}`, {
        growth_auto: mapping,
      });
      setView({ ...view, growth_auto: mapping });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const syncToSelected = async () => {
    if (busy || !view || !selectedIds.length) return;
    setError(null);
    setNotice(null);
    try {
      for (const id of selectedIds) {
        if (id === credential.id) continue;
        for (const [code, enabled] of Object.entries(view.growth_auto)) {
          await api.post("/credentials/growth-batch", {
            ids: [id],
            task_codes: [code],
            enabled,
          });
        }
      }
      setNotice(
        translate("tasks.growth.syncedToSelected", {
          count: selectedIds.filter((id) => id !== credential.id).length,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (view?.stale === true) return <small>{translate("tasks.growth.credentialStale")}</small>;
  if (view && view.supported === false) return null; // 非 CN 个人账号：整个子栏隐藏
  if (!view) return <small>{error ? text(error) : translate("tasks.growth.loading")}</small>;

  // 无自动链的任务不展示：达标奖励仍由「自动成长补领」领取。
  const automatable = view.tasks.filter((task) => task.automatable === true);
  const groups: Record<string, GrowthTask[]> = {};
  for (const task of automatable) {
    (groups[task.group] ??= []).push(task);
  }
  // 已领取的任务不再可勾选，全选只覆盖仍可推进的任务。
  const selectable = automatable.filter((task) => !task.claimed);
  const allOn =
    selectable.length > 0 && selectable.every((task) => view.growth_auto[task.task_code] === true);

  return (
    <div className={s.credCardTasks}>
      <div className={s.credTaskRow}>
        <label className={s.check}>
          <input
            type="checkbox"
            role="switch"
            aria-label={translate("tasks.growth.autoBackfillAria", {
              name: credential.name ?? credential.id,
            })}
            checked={credential.auto_growth === true}
            disabled={busy || typeof credential.auto_growth !== "boolean"}
            onChange={(e) => onPreference(credential, "auto_growth", e.target.checked)}
          />
          {translate("tasks.growth.autoBackfill")}
        </label>
        <small>{translate("tasks.growth.backfillDesc")}</small>
      </div>
      {Object.entries(groups).map(([group, tasks]) => (
        <div key={group}>
          <small>
            <strong>{groupLabel(group)}</strong>
            {group === "chat" ? translate("tasks.growth.chatAuthWarning") : ""}
          </small>
          {tasks.map((task) => (
            <div key={task.task_code} className={s.growthTaskRow}>
              <label className={s.check}>
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={translate("tasks.growth.autoTaskAria", {
                    title: task.title,
                    name: credential.name ?? credential.id,
                  })}
                  checked={view.growth_auto[task.task_code] === true}
                  disabled={busy || saving || task.claimed}
                  onChange={(e) => saveSwitches({ [task.task_code]: e.target.checked })}
                />
                {task.title}
              </label>
              <span className={s.badge}>
                {`${task.current}/${task.target || "—"}${
                  task.credit || task.energy ? ` · +${task.credit}c +${task.energy}e` : ""
                }`}
              </span>
              {/* 提示挂在外层：禁用按钮在部分浏览器不触发悬停提示。 */}
              <span
                className={s.growthAction}
                title={
                  !task.claimed && task.locked
                    ? translate("tasks.growth.lockedDailyTip")
                    : undefined
                }
              >
                <button
                  disabled={busy || running || task.claimed || task.locked}
                  aria-label={translate("tasks.growth.oneClickAria", {
                    title: task.title,
                    name: credential.name ?? credential.id,
                  })}
                  onClick={() => run(task.task_code)}
                >
                  {task.claimed
                    ? translate("tasks.growth.claimed")
                    : task.locked
                      ? translate("tasks.growth.locked")
                      : currentCode === task.task_code
                        ? translate("tasks.growth.executing")
                        : translate("tasks.growth.oneClickComplete")}
                </button>
              </span>
            </div>
          ))}
        </div>
      ))}
      <div className={s.credTaskRow}>
        <button
          disabled={busy || saving || selectable.length === 0}
          aria-label={translate("tasks.growth.toggleAria", {
            action: allOn
              ? translate("tasks.growth.unselectAll")
              : translate("tasks.growth.selectAll"),
            name: credential.name ?? credential.id,
          })}
          onClick={() =>
            saveSwitches(Object.fromEntries(selectable.map((task) => [task.task_code, !allOn])))
          }
        >
          {allOn ? translate("tasks.growth.unselectAll") : translate("tasks.growth.selectAll")}
        </button>
        <button
          disabled={busy || saving || running}
          aria-label={translate("tasks.growth.executeAllAria", {
            name: credential.name ?? credential.id,
          })}
          onClick={() => run()}
        >
          {running
            ? translate("tasks.growth.executingProgress", {
                completed: job.completed,
                total: job.total,
              })
            : translate("tasks.growth.executeAllDesc")}
        </button>
        {selectedIds.some((id) => id !== credential.id) && (
          <button
            disabled={busy}
            aria-label={translate("tasks.growth.syncAria", {
              name: credential.name ?? credential.id,
            })}
            onClick={syncToSelected}
          >
            {translate("tasks.growth.syncToSelected", {
              count: selectedIds.filter((id) => id !== credential.id).length,
            })}
          </button>
        )}
      </div>
      {notice && <small>{text(notice)}</small>}
      {error && <small>{text(error)}</small>}
    </div>
  );
}
