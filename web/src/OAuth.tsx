import { t as translate } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage, number, object, text } from "./api";
import { Drawer, ErrorNotice, Icon } from "./components";
import { useExiting } from "./presence";
import s from "./ui.module.scss";
import { Select } from "./fields";

export function safeOAuthUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error(translate("tasks.oauth.missingLink"));
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username ||
    url.password ||
    ![
      "www.codebuddy.cn",
      "www.codebuddy.ai",
      "www.workbuddy.cn",
      "www.workbuddy.ai",
      "copilot.tencent.com",
    ].includes(url.hostname)
  )
    throw new Error(translate("tasks.oauth.untrustedLink"));
  return url.href;
}
export function OAuth({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const exiting = useExiting();
  const [site, setSite] = useState("cn");
  const [login, setLogin] = useState<{ id: string; url: string; until: number } | null>(null);
  const [message, setMessage] = useState(() => translate("tasks.oauth.selectSiteHint"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (exiting) controller.current?.abort();
    return () => controller.current?.abort();
  }, [exiting]);
  useEffect(() => {
    if (!login || exiting) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() > login.until) {
        setLogin(null);
        setMessage(translate("tasks.oauth.expired"));
        return;
      }
      // Keep this bounded flow active while the official authorization tab has focus.
      try {
        const response = await api.get<unknown>("/oauth/poll", {
          params: { login_id: login.id },
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        const data = object(response.data);
        if (typeof data.done !== "boolean") throw new Error(translate("tasks.oauth.missingDone"));
        if (data.done) {
          setLogin(null);
          if (data.error) setError(text(data.error));
          else onDone();
          return;
        }
        timer = setTimeout(() => {
          void poll();
        }, 4000);
      } catch (err) {
        if (!abort.signal.aborted) {
          setError(errorMessage(err));
          setLogin(null);
          setMessage(translate("tasks.oauth.reinitiate"));
        }
      }
    };
    timer = setTimeout(() => {
      void poll();
    }, 4000);
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [login, onDone, exiting]);
  return (
    <Drawer title={translate("tasks.oauth.title")} onClose={onClose}>
      <p className={s.note}>{translate("tasks.oauth.note")}</p>
      <label className={s.field}>
        {translate("tasks.oauth.loginSite")}
        <Select value={site} disabled={!!login || busy} onChange={(value) => setSite(value)}>
          <option value="cn">{translate("tasks.oauth.siteCn")}</option>
          <option value="intl">{translate("tasks.oauth.siteIntlWork")}</option>
          <option value="intl-codebuddy">{translate("tasks.oauth.siteIntlCode")}</option>
        </Select>
      </label>
      <ErrorNotice message={error} />
      <p className={s.oauthStatus} role="status">
        {message}
      </p>
      {login ? (
        <div className={s.actions}>
          <a className={s.linkButton} href={login.url} target="_blank" rel="noopener noreferrer">
            {translate("tasks.oauth.openOfficial")} <Icon name="arrow" />
          </a>
          <button
            onClick={() => {
              setLogin(null);
              setMessage(translate("tasks.oauth.stoppedQuery"));
            }}
          >
            {translate("tasks.oauth.stopPolling")}
          </button>
        </div>
      ) : (
        <button
          className={s.primary}
          disabled={busy}
          onClick={() => {
            setError(null);
            setBusy(true);
            const request = new AbortController();
            controller.current = request;
            void api
              .post<unknown>("/oauth/start", null, { params: { site }, signal: request.signal })
              .then((res) => {
                if (request.signal.aborted) return;
                const data = object(res.data);
                if (typeof data.login_id !== "string" || !data.login_id)
                  throw new Error(translate("tasks.oauth.missingLoginId"));
                const seconds = number(data.expires_in);
                setLogin({
                  id: data.login_id,
                  url: safeOAuthUrl(data.verification_uri),
                  until: Date.now() + Math.min(seconds ?? 300, 600) * 1000,
                });
                setMessage(translate("tasks.oauth.waitingAuth"));
              })
              .catch((err: unknown) => {
                if (!request.signal.aborted) setError(errorMessage(err));
              })
              .finally(() => {
                if (!request.signal.aborted) setBusy(false);
              });
          }}
        >
          {busy ? translate("tasks.oauth.initiating") : translate("tasks.oauth.initiate")}
        </button>
      )}
    </Drawer>
  );
}
