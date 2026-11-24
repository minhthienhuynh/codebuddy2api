import { t as translate, localizeMessage, currentLanguage } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage, list, object, text, type Credential } from "./api";
import { Drawer, ErrorNotice } from "./components";
import { TravelSummary } from "./Travel";
import s from "./ui.module.scss";

type Confirmation = {
  can_claim: boolean;
  revision: string;
  title: string;
  terms: string[];
  authorization: string;
};
export function buddyConfirmation(value: unknown): Confirmation {
  const data = object(value, "buddy consent");
  if (
    typeof data.can_claim !== "boolean" ||
    typeof data.revision !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.revision) ||
    typeof data.title !== "string" ||
    !data.title ||
    data.title.length > 120 ||
    !Array.isArray(data.terms) ||
    !data.terms.length ||
    data.terms.length > 12 ||
    typeof data.authorization !== "string" ||
    !data.authorization.trim() ||
    data.authorization.length > 2000 ||
    data.terms.some((term) => typeof term !== "string" || !term || term.length > 2000)
  )
    throw new Error(translate("tasks.buddy.invalidContent"));
  return data as Confirmation;
}

export function Buddy({
  credential,
  initial,
  confirmation,
  onClose,
  onDone,
}: {
  credential: Credential;
  initial: Record<string, unknown>;
  confirmation: Confirmation;
  onClose: () => void;
  onDone: (result: Record<string, unknown>) => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const confirm = async () => {
    if (controller.current || attempted || credential.enabled !== true) return;
    const abort = new AbortController();
    controller.current = abort;
    setAccepted(true);
    setBusy(true);
    setAttempted(true);
    setError(null);
    try {
      const response = await api.post(
        `/credentials/${encodeURIComponent(credential.id)}/travel`,
        { confirm_buddy: true, agreement_revision: confirmation.revision },
        { signal: abort.signal, timeout: 180000 },
      );
      const results = list(object(response.data).results, "buddy results");
      const result = results[0];
      if (
        results.length !== 1 ||
        result.id !== credential.id ||
        typeof result.ok !== "boolean" ||
        typeof result.message !== "string"
      )
        throw new Error(translate("tasks.buddy.unconfirmed"));
      if (!abort.signal.aborted) {
        setStatus(result);
        onDone(result);
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        const sep = currentLanguage() === "en" ? "; " : "；";
        setError(`${errorMessage(error)}${sep}${translate("tasks.buddy.failureNote")}`);
      }
    } finally {
      controller.current = null;
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  return (
    <Drawer title={translate("tasks.buddy.title")} onClose={onClose} dismissDisabled={busy}>
      <p>
        <strong>{credential.name ?? credential.id}</strong>
      </p>
      <p role="status">{localizeMessage(text(status.message))}</p>
      <TravelSummary trip={status} />
      <p className={s.note}>{confirmation.authorization}</p>
      <h3>{confirmation.title}</h3>
      {confirmation.terms.map((term, index) => (
        <p key={index} className={s.note}>
          {term}
        </p>
      ))}
      <p className={s.note}>
        <a
          href="https://www.workbuddy.cn/profile/growth-center"
          target="_blank"
          rel="noopener noreferrer"
        >
          {translate("tasks.buddy.viewGrowthCenter")}
        </a>
        {translate("tasks.buddy.firstTaskDesc")}
      </p>
      <label>
        <input
          type="checkbox"
          checked={accepted}
          disabled={busy || attempted || credential.enabled !== true}
          onChange={(event) => {
            if (event.target.checked) void confirm();
          }}
        />
        {translate("tasks.buddy.acceptAgreement")}
      </label>
      <ErrorNotice message={error} />
      {busy && <p role="status">{translate("tasks.buddy.busyVerifying")}</p>}
      <div className={s.actions}>
        <button disabled={busy} onClick={onClose}>
          {attempted ? translate("common.close") : translate("common.cancel")}
        </button>
      </div>
      <p className={s.note}>{translate("tasks.buddy.autoHandlingNote")}</p>
    </Drawer>
  );
}
