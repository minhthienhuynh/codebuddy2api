import { useEffect, useRef, useState } from "react";
import { api, credentialResponse, errorMessage, list, object, type Credential } from "./api";
import { Badge, Drawer, ErrorNotice } from "./components";
import { t as translate, formatDate, currentLanguage } from "./i18n";
import s from "./ui.module.scss";

type TrialResult = {
  ok: boolean;
  can_claim: boolean;
  state: string;
  message: string;
  status?: number | null;
  code?: number | null;
  retry_at?: number | null;
  claimed?: boolean;
  upstream_already?: boolean;
};
function result(value: unknown): TrialResult {
  const row = object(value, "trial result");
  if (
    typeof row.ok !== "boolean" ||
    typeof row.can_claim !== "boolean" ||
    typeof row.state !== "string" ||
    typeof row.message !== "string"
  )
    throw new Error(translate("tasks.trial.incompleteResult"));
  for (const key of ["status", "code", "retry_at"])
    if (
      row[key] !== undefined &&
      row[key] !== null &&
      (typeof row[key] !== "number" || !Number.isFinite(row[key]))
    )
      throw new Error(translate("tasks.trial.incompleteResult"));
  return row as TrialResult;
}
const unknownStatus = (): TrialResult => ({
  ok: false,
  can_claim: false,
  state: "unknown",
  message: translate("tasks.trial.refreshStatusFirst"),
});
export function Trial({
  credential,
  onClose,
  onDone,
}: {
  credential: Credential;
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<TrialResult>(unknownStatus);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"claim" | "status" | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      setStatus(result(credential.trial));
    } catch (error) {
      setError(errorMessage(error));
    }
    return () => controller.current?.abort();
  }, [credential]);
  const execute = async (claim: boolean) => {
    if (controller.current || (claim && !status.can_claim)) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(claim ? "claim" : "status");
    setError(null);
    if (claim) setStatus((old) => ({ ...old, can_claim: false }));
    try {
      if (claim) {
        const response = await api.post(
          `/credentials/${encodeURIComponent(credential.id)}/trial`,
          undefined,
          { signal: abort.signal, timeout: 45000 },
        );
        const rows = list(object(response.data).results, "claim results");
        if (rows.length !== 1 || rows[0].id !== credential.id)
          throw new Error(translate("tasks.trial.unconfirmed"));
        if (!abort.signal.aborted) setStatus(result(rows[0]));
      } else {
        const response = await api.get("/credentials", { signal: abort.signal });
        const row = credentialResponse(response.data).find((row) => row.id === credential.id);
        if (!row || row.trial_supported !== true || row.enabled !== true)
          throw new Error(translate("tasks.trial.accountStale"));
        if (!abort.signal.aborted) setStatus(result(row.trial));
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        setStatus((old) => ({ ...old, can_claim: false }));
        const sep = currentLanguage() === "en" ? "; " : "；";
        setError(`${errorMessage(error)}${sep}${translate("tasks.trial.failureNote")}`);
      }
    } finally {
      controller.current = null;
      if (!abort.signal.aborted) {
        setBusy(null);
        onDone();
      }
    }
  };
  const failed = !status.ok && !["available", "unknown"].includes(status.state);
  return (
    <Drawer
      title={translate("tasks.trial.title")}
      onClose={onClose}
      dismissDisabled={busy !== null}
    >
      <p>
        <strong>{credential.name ?? credential.id}</strong> · {translate("values.profile.intlWork")}
      </p>
      <p className={s.note}>{translate("tasks.trial.note")}</p>
      <div role="status" aria-live="polite">
        <Badge tone={status.ok ? "good" : failed ? "warn" : "neutral"}>
          {status.claimed || status.upstream_already
            ? translate("tasks.trial.statusRecordedUnsaved")
            : status.ok
              ? translate("tasks.trial.statusClaimed")
              : translate("tasks.trial.statusUnconfirmed")}
        </Badge>
        {!failed && <p>{status.message}</p>}
        {busy && (
          <p>
            {busy === "claim"
              ? translate("tasks.trial.busyClaiming")
              : translate("tasks.trial.busyReading")}
          </p>
        )}
      </div>
      <ErrorNotice message={error ?? (failed ? status.message : null)} />
      {(status.status != null || status.code != null) && (
        <p className={s.note}>
          {translate("tasks.trial.httpStatus")}
          {status.status ?? translate("tasks.trial.notReceived")} ·{" "}
          {translate("tasks.trial.officialCode")}
          {status.code ?? translate("values.unknown")}
        </p>
      )}
      {!status.can_claim && status.retry_at != null && (
        <p className={s.note}>
          {translate("tasks.trial.earliestManualRetry")}
          {formatDate(status.retry_at)}
        </p>
      )}
      <div className={s.actions}>
        <button
          className={s.primary}
          disabled={busy !== null || !status.can_claim || credential.enabled !== true}
          onClick={() => void execute(true)}
        >
          {translate("tasks.trial.confirmClaim")}
        </button>
        <button disabled={busy !== null} onClick={() => void execute(false)}>
          {translate("tasks.trial.refreshStatus")}
        </button>
      </div>
      <p className={s.note}>{translate("tasks.trial.footerNote")}</p>
    </Drawer>
  );
}
