import { useCallback, useEffect, useId, useRef, useState } from "react";
import { t as translate } from "../i18n";
import {
  api,
  catalogScanResponse,
  credentialResponse,
  errorMessage,
  list,
  modelResponse,
  number,
  object,
  text,
  useResource,
  type CatalogScan,
  type Credential,
  type ModelRule,
  type RecordValue,
} from "../api";
import {
  Badge,
  DataValue,
  Drawer,
  DrawerPresence,
  Empty,
  ErrorNotice,
  Icon,
  RefreshIcon,
  PageTitle,
  Panel,
  ResourceState,
  profileLabel,
} from "../components";
import {
  CapabilityChips,
  EffortChips,
  ModelMetadata,
  SpecValue,
  effortSummary,
  formatRate,
  modelDisplayName,
  modelSearchText,
  rateOf,
  specRange,
} from "../modelMetadata";
import {
  OutputProbeNote,
  RateOverrideFields,
  describeProbe,
  formatEstimate,
  measuredNote,
  rateDetails,
  rateSource,
  useOutputProbes,
  useRateProbeJob,
  type RateProbeControl,
  type RateSource,
} from "../modelRates";
import { JobBanner, ProgressBanner, type Job } from "../jobs";
import s from "../ui.module.scss";
import { SearchInput, Select } from "../fields";
import { clearToasts, notify } from "../toast";
import { useT } from "../i18n";
const t = translate;
export const profiles = ["cn-cli", "cn-work", "intl-cli", "intl-work"];
const mediaKindLabels: Record<string, string> = {
  image: translate("models.media.image"),
  edit: translate("models.media.edit"),
  video: translate("models.media.video"),
};
const validId = (id: string) => /^[A-Za-z0-9_.:/@-]{1,160}$/.test(id) && ![".", ".."].includes(id);
export function validateRule(
  rule: ModelRule,
  models: ModelRule[],
  translate: (key: string) => string = t,
): string | null {
  if (!rule.public_id.trim()) return translate("models.valid.idRequired");
  if (rule.public_id !== rule.public_id.trim() || /\s/.test(rule.public_id))
    return translate("models.valid.idWhitespace");
  if (!validId(rule.public_id)) return translate("models.valid.idPattern");
  if (!validId(rule.upstream_id ?? rule.id)) return translate("models.valid.upstreamRequired");
  if (rule.routes) {
    if (!rule.routes.length) return translate("models.routes.invalidEmpty");
    const routeIds = new Set<string>();
    let hasWeight = false;
    let hasPositive = false;
    for (const route of rule.routes) {
      if (!validId(route.upstream_id) || routeIds.has(route.upstream_id))
        return translate("models.routes.invalidId");
      routeIds.add(route.upstream_id);
      if (route.weight !== null) {
        hasWeight = true;
        if (!Number.isFinite(route.weight) || route.weight < 0 || route.weight > 1000)
          return translate("models.routes.invalidWeight");
        if (route.weight > 0) hasPositive = true;
      }
    }
    if (hasWeight && !hasPositive) return translate("models.routes.invalidPositive");
  }
  if (
    models.some(
      (m) => m.id !== rule.id && (m.id === rule.public_id || m.public_id === rule.public_id),
    )
  )
    return translate("models.valid.conflict");
  if (rule.credential_ids.length && (rule.region || rule.profile))
    return translate("models.valid.scopeConflict");
  if (rule.region && !["cn", "intl"].includes(rule.region))
    return translate("models.valid.regionInvalid");
  if (rule.profile && !profiles.includes(rule.profile))
    return translate("models.valid.profileInvalid");
  if (rule.region && rule.profile && !rule.profile.startsWith(`${rule.region}-`))
    return translate("models.valid.mismatch");
  return null;
}
type Mode = "auto" | "accounts" | "region" | "legacy";
function bindingMode(rule: ModelRule): Mode {
  if (rule.credential_ids.length) return rule.region || rule.profile ? "legacy" : "accounts";
  return rule.region || rule.profile ? "region" : "auto";
}
type Preview = { candidates: RecordValue[]; excluded: RecordValue[] } & Pick<
  ModelRule,
  "capabilities" | "limits" | "metadata_by_profile"
>;
function RoutePreview({ preview }: { preview: Preview }) {
  return (
    <Panel
      title={t("models.routePreview.title")}
      hint={t("models.routePreview.hint", {
        candidates: preview.candidates.length,
        excluded: preview.excluded.length,
      })}
    >
      <div className={s.routePreview}>
        {!preview.candidates.length && (
          <p className={s.note}>{t("models.routePreview.noCandidatesNote")}</p>
        )}
        {[
          ...preview.candidates.map((row) => ({ row, allowed: true })),
          ...preview.excluded.map((row) => ({ row, allowed: false })),
        ].map(({ row, allowed }, i) => (
          <div className={s.routeCandidate} key={i}>
            <div>
              <strong>
                {typeof row.name === "string" ? row.name : t("models.routePreview.unnamedAccount")}
              </strong>
              <small>
                {typeof row.profile === "string"
                  ? profileLabel(row.profile)
                  : t("models.routePreview.productUnknown")}
              </small>
            </div>
            <Badge tone={allowed ? "good" : "warn"}>
              {allowed
                ? t("models.routePreview.candidate")
                : typeof row.reason === "string"
                  ? row.reason
                  : t("models.routePreview.unavailable")}
            </Badge>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RateCell({ model }: { model: ModelRule }) {
  const rate = rateOf(model.credits);
  const details = rateDetails(model);
  const perProfile =
    model.credits_by_profile &&
    typeof model.credits_by_profile === "object" &&
    !Array.isArray(model.credits_by_profile)
      ? Object.entries(model.credits_by_profile)
      : [];
  // The headline rate comes from the cheapest product; its provenance decides the label.
  const headline = perProfile.find(([, price]) => rateOf(price) === rate)?.[0];
  const source = headline ? rateSource(details[headline]) : "declared";
  const unpriced = Object.entries(details).find(
    ([, detail]) => rateSource(detail) === "measured" && detail.measured?.rate == null,
  );
  if (rate === null) {
    if (unpriced)
      return (
        <div className={s.rateStack} title={measuredNote(unpriced[1])}>
          <span className={`${s.rateChip} ${s.rateMeasured}`}>
            {translate("models.rates.measuredPending")}
          </span>
        </div>
      );
    return (
      <>
        <DataValue value={model.credits} />
        <small className={s.specNote}>{translate("models.rates.profileUnknown")}</small>
      </>
    );
  }
  const rows = perProfile.filter(
    ([profile, price]) =>
      perProfile.length > 1 || rateOf(price) !== rate || rateSource(details[profile]) !== source,
  );
  const label = (value: number, kind: RateSource) =>
    kind === "measured"
      ? translate("models.rates.measuredWithVal", { val: formatEstimate(value) })
      : kind === "manual"
        ? translate("models.rates.manualWithVal", { val: formatEstimate(value) })
        : value === 0
          ? translate("models.rates.free0x")
          : formatRate(value);
  return (
    <div className={s.rateStack}>
      <span
        className={
          source === "measured"
            ? `${s.rateChip} ${s.rateMeasured}`
            : rate === 0
              ? `${s.rateChip} ${s.rateFree}`
              : s.rateChip
        }
        title={
          source === "measured" && headline
            ? measuredNote(details[headline])
            : source === "manual"
              ? translate("models.rates.manualTooltip")
              : undefined
        }
      >
        {label(rate, source)}
      </span>
      {rows.map(([profile, price]) => {
        const value = rateOf(price);
        const kind = rateSource(details[profile]);
        return (
          <small
            className={s.rateProfile}
            key={profile}
            title={kind === "measured" ? measuredNote(details[profile]) : undefined}
          >
            {profileLabel(profile)}{" "}
            {value === null ? translate("values.unknown") : label(value, kind)}
          </small>
        );
      })}
      {unpriced && headline !== unpriced[0] && (
        <small className={s.rateProfile} title={measuredNote(unpriced[1])}>
          {profileLabel(unpriced[0])} {translate("models.rates.measuredPending")}
        </small>
      )}
    </div>
  );
}
export function ModelEditor({
  model,
  models,
  credentials,
  revision,
  onClose,
  onSaved,
  rateProbe,
  creating = false,
}: {
  model: ModelRule;
  models: ModelRule[];
  credentials: Credential[] | null;
  revision: number;
  onClose: () => void;
  onSaved: () => void;
  rateProbe?: RateProbeControl;
  creating?: boolean;
}) {
  const t = useT();
  const [rule, setRule] = useState({
    ...model,
    upstream_id: model.upstream_id ?? model.id,
    routes: model.routes?.map((route) => ({ ...route })),
    region:
      model.region ||
      (!model.credential_ids.length && profiles.includes(model.profile)
        ? model.profile.split("-")[0]
        : ""),
  });
  const [mode, setMode] = useState<Mode>(() => bindingMode(model));
  const [routesTouched, setRoutesTouched] = useState(
    () => model.routes?.some((route) => route.source === "manual") ?? false,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const request = useRef<AbortController | null>(null);
  const suggestions = useId();
  useEffect(() => () => request.current?.abort(), []);
  const update = <K extends keyof ModelRule>(key: K, value: ModelRule[K]) => {
    setRule((old) => ({ ...old, [key]: value }));
    if (key === "routes") setRoutesTouched(true);
    setPreview(null);
  };
  const chooseMode = (next: Mode) => {
    setMode(next);
    setPreview(null);
    setError(null);
    setRule((old) => ({
      ...old,
      credential_ids: next === "accounts" ? old.credential_ids : [],
      region:
        next === "region" ? old.region || (old.profile.startsWith("intl-") ? "intl" : "cn") : "",
      profile: next === "region" ? old.profile : "",
    }));
  };
  const run = (save: boolean) => {
    const invalid =
      validateRule(rule, models, t) ??
      (mode === "accounts" && !rule.credential_ids.length
        ? t("models.form.selectAccountRequired")
        : null);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    const payload = {
      revision,
      public_id: rule.public_id,
      upstream_id: rule.upstream_id,
      ...(routesTouched && rule.routes?.length ? { routes: rule.routes } : {}),
      enabled: rule.enabled,
      keep_original: rule.keep_original,
      region: rule.region || null,
      profile: rule.profile || null,
      credential_ids: rule.credential_ids,
      credits_override: rule.credits_override ?? {},
    };
    const path = creating ? "/models" : `/models/${encodeURIComponent(model.id)}`;
    const config = { signal: controller.signal };
    void (
      save
        ? creating
          ? api.post(path, payload, config)
          : api.put(path, payload, config)
        : api.post(`${path}/preview`, payload, config)
    )
      .then((response) => {
        if (controller.signal.aborted) return;
        if (save) {
          const result = object(response.data);
          if (!Number.isInteger(result.revision) || Number(result.revision) <= revision)
            throw new Error("后端未确认模型保存，请刷新后核验");
          onSaved();
          onClose();
        } else {
          const data = object(response.data);
          setPreview({
            candidates: list(data.candidates),
            excluded: list(data.excluded),
            capabilities: data.capabilities,
            limits: data.limits,
            metadata_by_profile: data.metadata_by_profile,
          });
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
  };
  return (
    <Drawer
      title={creating ? translate("models.drawer.addTitle") : translate("models.drawer.editTitle")}
      onClose={onClose}
      dismissDisabled={busy}
    >
      <p className={s.note}>{t("models.form.idDescription")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(true);
        }}
      >
        <fieldset className={s.formFields} disabled={busy}>
          <div className={s.formGrid}>
            <label className={s.field}>
              {t("values.public_id")}
              <input
                value={rule.public_id}
                required
                maxLength={160}
                placeholder={translate("models.drawer.publicIdPlaceholder")}
                onChange={(e) => update("public_id", e.target.value)}
              />
            </label>
            <label className={s.field}>
              {t("values.upstream_id")}
              <input
                value={rule.upstream_id}
                required
                maxLength={160}
                list={suggestions}
                placeholder={translate("models.drawer.upstreamIdPlaceholder")}
                onChange={(e) => update("upstream_id", e.target.value)}
              />
            </label>
            <datalist id={suggestions}>
              {[...new Set(models.map((m) => m.upstream_id ?? m.id))].map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </div>
          <fieldset className={s.fieldset}>
            <legend>{t("models.routes.title")}</legend>
            <p>{t("models.routes.help")}</p>
            {(rule.routes?.length ?? 0) > 0 && (
              <div className={s.routePreview}>
                {rule.routes?.map((route, index) => (
                  <div className={s.routeCandidate} key={`${route.upstream_id}-${index}`}>
                    <input
                      value={route.upstream_id}
                      list={suggestions}
                      placeholder={translate("models.drawer.upstreamIdPlaceholder")}
                      onChange={(e) =>
                        update(
                          "routes",
                          (rule.routes ?? []).map((item, i) =>
                            i === index ? { ...item, upstream_id: e.target.value } : item,
                          ),
                        )
                      }
                    />
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      step="any"
                      value={route.weight ?? ""}
                      placeholder={t("models.routes.weight")}
                      onChange={(e) =>
                        update(
                          "routes",
                          (rule.routes ?? []).map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  weight: e.target.value === "" ? null : Number(e.target.value),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                    <label className={s.check}>
                      <input
                        type="checkbox"
                        checked={route.enabled}
                        onChange={(e) =>
                          update(
                            "routes",
                            (rule.routes ?? []).map((item, i) =>
                              i === index ? { ...item, enabled: e.target.checked } : item,
                            ),
                          )
                        }
                      />
                      {t("models.routes.enabled")}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        update(
                          "routes",
                          (rule.routes ?? []).filter((_, i) => i !== index),
                        )
                      }
                    >
                      {t("models.routes.remove")}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() =>
                update(
                  "routes",
                  (rule.routes?.length ?? 0)
                    ? [
                        ...(rule.routes ?? []),
                        {
                          upstream_id: rule.upstream_id,
                          weight: null,
                          enabled: true,
                          source: "manual",
                        },
                      ]
                    : [
                        {
                          upstream_id: rule.upstream_id,
                          weight: null,
                          enabled: true,
                          source: "manual",
                        },
                      ],
                )
              }
            >
              {t("models.routes.add")}
            </button>
          </fieldset>
          <div className={s.actions}>
            <label className={s.check}>
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => update("enabled", e.target.checked)}
              />
              {translate("models.drawer.enableModel")}
            </label>
            {!creating && !model.custom && (
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={rule.keep_original}
                  onChange={(e) => update("keep_original", e.target.checked)}
                />
                {translate("models.drawer.keepOriginal")}
              </label>
            )}
          </div>
          <fieldset className={s.fieldset}>
            <legend>{translate("models.drawer.routeMode")}</legend>
            <div className={s.routeModes}>
              {(
                [
                  ["auto", t("models.binding.auto"), t("models.binding.autoDesc")],
                  ["accounts", t("models.binding.accounts"), t("models.binding.accountsDesc")],
                  ["region", t("models.binding.region"), t("models.binding.regionDesc")],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  className={`${s.modeOption} ${mode === value ? s.modeSelected : ""}`}
                  key={value}
                >
                  <input
                    type="radio"
                    name={`route-${suggestions}`}
                    value={value}
                    checked={mode === value}
                    onChange={() => chooseMode(value)}
                  />
                  <span>
                    <strong>{label}</strong>
                    <small>{hint}</small>
                  </span>
                </label>
              ))}
            </div>
            <p>{t("models.binding.switchNote")}</p>
          </fieldset>
          {mode === "legacy" && (
            <div className={s.warning}>{t("models.binding.legacyWarning")}</div>
          )}
          {mode === "region" && (
            <div className={s.formGrid}>
              <label className={s.field}>
                {t("values.region")}
                <Select
                  value={rule.region || (rule.profile.startsWith("intl-") ? "intl" : "cn")}
                  onChange={(value) => {
                    const region = value;
                    setRule((old) => ({
                      ...old,
                      region,
                      profile: old.profile.startsWith(`${region}-`) ? old.profile : "",
                    }));
                    setPreview(null);
                  }}
                >
                  <option value="cn">{translate("tasks.oauth.siteCn")}</option>
                  <option value="intl">{translate("tasks.oauth.siteIntl")}</option>
                </Select>
              </label>
              <label className={s.field}>
                {t("values.profile")}
                <Select value={rule.profile} onChange={(value) => update("profile", value)}>
                  <option value="">{translate("models.drawer.anyProfile")}</option>
                  {profiles
                    .filter((p) => !rule.region || p.startsWith(`${rule.region}-`))
                    .map((p) => (
                      <option key={p} value={p}>
                        {profileLabel(p)}
                      </option>
                    ))}
                </Select>
              </label>
            </div>
          )}
          {mode === "accounts" && (
            <fieldset className={s.fieldset}>
              <legend>{translate("models.drawer.specifyCreds")}</legend>
              {credentials === null ? (
                <p>{t("models.binding.unloadedNote")}</p>
              ) : !credentials.length ? (
                <p>{t("models.binding.noAccountsNote")}</p>
              ) : (
                credentials.map((c) => (
                  <label className={s.accountChoice} key={c.id}>
                    <input
                      type="checkbox"
                      checked={rule.credential_ids.includes(c.id)}
                      onChange={(e) =>
                        update(
                          "credential_ids",
                          e.target.checked
                            ? [...rule.credential_ids, c.id]
                            : rule.credential_ids.filter((id) => id !== c.id),
                        )
                      }
                    />
                    <span>
                      <strong>{c.name ?? c.id}</strong>
                      <small>
                        {typeof c.profile === "string"
                          ? profileLabel(c.profile)
                          : t("models.routePreview.productUnknown")}
                      </small>
                    </span>
                    {c.enabled === false && <Badge tone="warn">{t("models.badge.disabled")}</Badge>}
                  </label>
                ))
              )}
              {rule.credential_ids
                .filter((id) => !credentials?.some((c) => c.id === id))
                .map((id) => (
                  <label className={s.check} key={id}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        update(
                          "credential_ids",
                          rule.credential_ids.filter((v) => v !== id),
                        )
                      }
                    />
                    {id} · {t("models.binding.notInList")}
                  </label>
                ))}
            </fieldset>
          )}
          {!creating && !model.custom && (
            <RateOverrideFields
              model={model}
              value={rule.credits_override ?? {}}
              onChange={(next) => update("credits_override", next)}
              probe={rateProbe}
              disabled={busy}
            />
          )}
        </fieldset>
        <ErrorNotice message={error} />
        <div className={s.actions}>
          <button type="button" disabled={busy} onClick={() => run(false)}>
            {translate("models.drawer.previewCandidateRoutes")}
          </button>
          <button className={s.primary} disabled={busy}>
            {busy
              ? translate("models.drawer.processing")
              : creating
                ? translate("models.drawer.createModel")
                : translate("models.drawer.saveRule")}
          </button>
        </div>
      </form>
      {preview && (
        <>
          <RoutePreview preview={preview} />
          <ModelMetadata model={preview} />
        </>
      )}
    </Drawer>
  );
}
const emptyRule: ModelRule = {
  id: "",
  public_id: "",
  upstream_id: "",
  enabled: true,
  keep_original: false,
  region: "",
  profile: "",
  credential_ids: [],
};
type SortKey = "catalog" | "rate" | "context" | "output" | "name";
type CatalogFilter = { region: string; capability: string; effort: string; price: string };
const emptyFilter: CatalogFilter = { region: "", capability: "", effort: "", price: "" };
const EFFORT_FILTERS = ["low", "medium", "high", "xhigh", "max"];
function rateValue(model: ModelRule): number {
  return rateOf(model.credits) ?? Number.POSITIVE_INFINITY;
}
function sortModels(list: ModelRule[], key: SortKey): ModelRule[] {
  if (key === "catalog") return list;
  const out = list.slice();
  const widest = (model: ModelRule, kind: "input" | "output") =>
    specRange(model, kind === "input" ? "maxInputTokens" : "maxOutputTokens").at(-1) ?? 0;
  if (key === "rate") out.sort((a, b) => rateValue(a) - rateValue(b));
  else if (key === "context") out.sort((a, b) => widest(b, "input") - widest(a, "input"));
  else if (key === "output") out.sort((a, b) => widest(b, "output") - widest(a, "output"));
  else out.sort((a, b) => a.public_id.localeCompare(b.public_id));
  return out;
}
function modelHasRegion(model: ModelRule, region: "cn" | "intl"): boolean {
  if (model.region) return model.region === region;
  if (model.profile) return model.profile.startsWith(`${region}-`);
  const declarations = model.metadata_by_profile;
  if (!declarations || typeof declarations !== "object" || Array.isArray(declarations))
    return false;
  return Object.keys(declarations).some((profile) => profile.startsWith(`${region}-`));
}

function matchesCatalog(model: ModelRule, query: string, filter: CatalogFilter): boolean {
  if (query) {
    const text = modelSearchText(model);
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.every((term) => text.includes(term))) return false;
  }
  if (filter.region) {
    if (filter.region === "auto") {
      if (bindingMode(model) !== "auto") return false;
    } else if (!modelHasRegion(model, filter.region as "cn" | "intl")) return false;
  }
  if (filter.capability === "media_image") {
    if (!model.media_kinds?.some((kind) => kind === "image" || kind === "edit")) return false;
  } else if (filter.capability === "media_video") {
    if (!model.media_kinds?.includes("video")) return false;
  } else if (filter.capability) {
    const declared =
      model.capabilities && typeof model.capabilities === "object"
        ? (model.capabilities as RecordValue)
        : {};
    if (declared[filter.capability] !== "supported") return false;
  }
  if (filter.effort) {
    const efforts = effortSummary(model);
    if (filter.effort === "off" ? !efforts.closable : !efforts.options.includes(filter.effort))
      return false;
  }
  if (filter.price === "free" && rateOf(model.credits) !== 0) return false;
  if (filter.price === "paid" && (rateOf(model.credits) ?? 0) <= 0) return false;
  return true;
}
function rateProbeTitle(job: Job) {
  return job.meta.scope === "all"
    ? translate("models.actions.probeAllRates")
    : translate("models.actions.probeScopeRates", { scope: text(job.meta.scope) });
}
function notifyRateProbe(job: Job) {
  notify({
    key: "rate-probe",
    tone: (number(job.meta.failed) ?? 0) > 0 ? "warn" : "good",
    title: translate("models.actions.probeCompleted", { title: rateProbeTitle(job) }),
    body: (
      <span>
        {job.total
          ? translate("models.actions.probeStats", {
              billed: text(job.meta.billed),
              free: text(job.meta.free),
              failed: text(job.meta.failed),
            })
          : translate("models.actions.noFreeModels")}
      </span>
    ),
  });
}
const scanSummary = (scan: CatalogScan) =>
  translate("models.actions.scanStats", {
    success: scan.success,
    failed: scan.failed,
    differences: scan.differences,
  });
function notifyScan(scan: CatalogScan) {
  const versions = Object.entries(scan.profiles)
    .filter(([, row]) => row.distinct > 1)
    .map(
      ([name, row]) =>
        `${name}：${translate("models.actions.catalogVersions", { count: row.distinct })}`,
    )
    .join("；");
  const failed = scan.status === "failed";
  notify({
    key: "scan",
    tone: failed ? "bad" : scan.failed > 0 ? "warn" : "good",
    title: failed
      ? translate("models.actions.scanFailed")
      : translate("models.actions.scanCompleted"),
    body: (
      <>
        <span>{scanSummary(scan)}</span>
        {failed && scan.error && <span>{scan.error}</span>}
        {versions && <span>{versions}</span>}
        {(failed || scan.failed > 0) && (
          <span>{translate("models.actions.failedKeepLastNote")}</span>
        )}
      </>
    ),
  });
}
export function Models() {
  const resource = useResource("/models", modelResponse, { cache: true });
  const credentials = useResource("/credentials", credentialResponse, { cache: true });
  const [query, setQuery] = useState("");
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const detailed = resource.data?.models.find((model) => model.id === detailsId);
  const [editing, setEditing] = useState<ModelRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [editorRevision, setEditorRevision] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<ModelRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<CatalogScan | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const outputProbes = useOutputProbes();
  const rateJob = useRateProbeJob((job) => {
    resource.reload();
    notifyRateProbe(job);
  });
  // Only a scan this page watched finish raises a toast; a reload does not repeat an old one.
  const scanRunning = useRef(false);
  const loadScan = useCallback(() => {
    void api
      .get("/models/scan")
      .then((response) => {
        const next = catalogScanResponse(response.data);
        setScan(next);
        // A scan that just finished may have refreshed the catalog list.
        if (next.status === "completed" || next.status === "failed") resource.reload();
        if (next.status !== "running" && scanRunning.current) notifyScan(next);
        scanRunning.current = next.status === "running";
      })
      .catch(() => {
        // 被动状态轮询失败不升级为页面错误；提交扫描的失败才提示。
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    loadScan(); // An in-progress scan survives page reloads.
  }, [loadScan]);
  useEffect(() => {
    if (scan?.status !== "running") return;
    const timer = setInterval(loadScan, 2000);
    return () => clearInterval(timer);
  }, [scan?.status, loadScan]);
  const startScan = () => {
    if (scanBusy) return;
    setScanBusy(true);
    setError(null);
    void api
      .post("/models/scan")
      .then((response) => {
        const next = catalogScanResponse(response.data);
        scanRunning.current = next.status === "running";
        setScan(next);
        resource.reload();
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setScanBusy(false));
  };
  const toggleGuard = (key: "model_guard" | "model_capability_guard", next: boolean) => {
    if (!resource.data || busy) return;
    setBusy(true);
    setError(null);
    void api
      .patch("/settings", {
        revision: resource.data.revision,
        values: { [key]: next },
      })
      .then(() => {
        notify({
          key: "guard",
          tone: "good",
          title: `${key === "model_guard" ? translate("models.guard.modelGuard") : translate("models.guard.capabilityGuard")}${next ? translate("models.guard.enabled") : translate("models.guard.disabled")}`,
          body:
            key === "model_capability_guard" && !next ? (
              <span>{translate("models.guard.capabilityHelp")}</span>
            ) : undefined,
        });
        resource.reload();
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };
  const [filter, setFilter] = useState<CatalogFilter>(emptyFilter);
  const [sort, setSort] = useState<SortKey>("catalog");
  const filtering = Boolean(
    query || filter.region || filter.capability || filter.effort || filter.price,
  );
  const matched = resource.data?.models.filter((m) => matchesCatalog(m, query, filter));
  const rows = matched && sortModels(matched, sort);
  return (
    <>
      <PageTitle
        title={translate("models.page.title")}
        description={translate("models.page.desc")}
        actions={
          <>
            <button
              onClick={() => {
                clearToasts();
                resource.reload();
                credentials.reload();
              }}
            >
              <RefreshIcon spinning={resource.refreshing || credentials.refreshing} />
              {translate("models.actions.refresh")}
            </button>
            <button
              disabled={rateJob.job?.status === "running"}
              onClick={() => rateJob.start()}
              title={translate("models.actions.probeRatesHover")}
            >
              <RefreshIcon spinning={rateJob.job?.status === "running"} />
              {rateJob.job?.status === "running"
                ? translate("models.actions.probing", {
                    completed: rateJob.job.completed,
                    total: rateJob.job.total,
                  })
                : translate("models.actions.probeRates")}
            </button>
            <button
              disabled={scanBusy || scan?.status === "running"}
              onClick={startScan}
              title={translate("models.actions.scanAllHover")}
            >
              <RefreshIcon spinning={scanBusy || scan?.status === "running"} />
              {scan?.status === "running"
                ? translate("models.actions.scanning", {
                    completed: scan.completed,
                    total: scan.total,
                  })
                : translate("models.actions.scanAll")}
            </button>
            <button
              className={s.primary}
              disabled={!resource.data}
              onClick={() => {
                setEditorRevision(resource.data?.revision ?? null);
                setCreating(true);
              }}
            >
              <Icon name="plus" />
              {translate("models.actions.addModel")}
            </button>
          </>
        }
      />
      <ResourceState {...resource} />
      <ErrorNotice message={error} />
      <ErrorNotice message={rateJob.error} />
      {rateJob.job?.status === "running" && (
        <JobBanner title={rateProbeTitle(rateJob.job)} job={rateJob.job} describe={describeProbe} />
      )}
      <ErrorNotice message={credentials.error} retry={credentials.reload} />
      {scan?.status === "running" && (
        <ProgressBanner
          title={translate("models.banner.scanAll")}
          completed={scan.completed}
          total={scan.total}
        >
          <small>{scanSummary(scan)}</small>
        </ProgressBanner>
      )}
      <Panel
        title={translate("models.title")}
        hint={
          resource.data
            ? filtering && rows
              ? translate("models.searchMatched", {
                  count: rows.length,
                  total: resource.data.models.length,
                })
              : translate("models.totalModels", { total: resource.data.models.length })
            : undefined
        }
      >
        <div className={s.toolbar}>
          <SearchInput
            aria-label={translate("models.search.label")}
            placeholder={translate("models.search.placeholder")}
            value={query}
            onChange={setQuery}
          />
          <div className={s.filterBar}>
            <Select
              aria-label={translate("models.filter.region")}
              value={filter.region}
              onChange={(value) => setFilter({ ...filter, region: value })}
            >
              <option value="">{translate("models.filter.allRegions")}</option>
              <option value="auto">{translate("models.filter.auto")}</option>
              <option value="cn">{translate("models.filter.cn")}</option>
              <option value="intl">{translate("models.filter.intl")}</option>
            </Select>
            <Select
              aria-label={translate("models.filter.capabilities")}
              value={filter.capability}
              onChange={(value) => setFilter({ ...filter, capability: value })}
            >
              <option value="">{translate("models.filter.allCapabilities")}</option>
              <option value="media_image">{translate("models.filter.mediaImage")}</option>
              <option value="media_video">{translate("models.filter.mediaVideo")}</option>
              <option value="images">{translate("models.filter.images")}</option>
              <option value="tools">{translate("models.filter.tools")}</option>
              <option value="reasoning">{translate("models.filter.reasoning")}</option>
            </Select>
            <Select
              aria-label={translate("models.filter.efforts")}
              value={filter.effort}
              onChange={(value) => setFilter({ ...filter, effort: value })}
            >
              <option value="">{translate("models.filter.allEfforts")}</option>
              <option value="off">{translate("models.filter.canDisable")}</option>
              {EFFORT_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <Select
              aria-label={translate("models.filter.price")}
              value={filter.price}
              onChange={(value) => setFilter({ ...filter, price: value })}
            >
              <option value="">{translate("models.filter.allPrices")}</option>
              <option value="free">{translate("models.filter.free")}</option>
              <option value="paid">{translate("models.filter.paid")}</option>
            </Select>
            <Select
              aria-label={translate("models.filter.sort")}
              value={sort}
              onChange={(value) => setSort(value as SortKey)}
            >
              <option value="catalog">{translate("models.sort.catalog")}</option>
              <option value="rate">{translate("models.sort.rate")}</option>
              <option value="context">{translate("models.sort.context")}</option>
              <option value="output">{translate("models.sort.output")}</option>
              <option value="name">{translate("models.sort.name")}</option>
            </Select>
            {filtering && (
              <button
                onClick={() => {
                  setQuery("");
                  setFilter(emptyFilter);
                  setSort("catalog");
                }}
              >
                {translate("models.filter.reset")}
              </button>
            )}
            <label className={s.enableSwitch}>
              <input
                type="checkbox"
                role="switch"
                aria-label={translate("models.guard.label")}
                checked={resource.data?.model_guard !== false}
                disabled={busy || !resource.data || resource.data.model_guard_locked === true}
                onChange={(e) => toggleGuard("model_guard", e.target.checked)}
              />
              <span>
                {translate("models.guard.status", {
                  state:
                    resource.data?.model_guard === false
                      ? translate("credentials.notify.turnedOff")
                      : translate("credentials.notify.turnedOn"),
                })}
              </span>
            </label>
            <label className={s.enableSwitch}>
              <input
                type="checkbox"
                role="switch"
                aria-label={translate("models.preflight.label")}
                checked={resource.data?.model_capability_guard !== false}
                disabled={
                  busy ||
                  !resource.data ||
                  resource.data.model_capability_guard === undefined ||
                  resource.data.model_capability_guard_locked === true
                }
                onChange={(e) => toggleGuard("model_capability_guard", e.target.checked)}
              />
              <span>
                {translate("models.guard.capabilityCheck")}：
                {resource.data?.model_capability_guard === undefined
                  ? translate("values.unknown")
                  : resource.data.model_capability_guard
                    ? translate("common.enabled")
                    : translate("common.disabled")}
              </span>
            </label>
          </div>
        </div>
        {rows &&
          (rows.length ? (
            <div className={s.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>{translate("models.table.thId")}</th>
                    <th>{translate("models.table.thRate")}</th>
                    <th>{translate("models.table.thCaps")}</th>
                    <th>{translate("models.table.thContext")}</th>
                    <th>{translate("models.table.thOutput")}</th>
                    <th>{translate("models.table.thEffort")}</th>
                    <th>{translate("models.table.thBoundary")}</th>
                    <th>{translate("models.table.thActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <div className={s.modelCell}>
                          <div className={s.modelIdLine}>
                            <strong className={s.modelName}>{m.public_id}</strong>
                            {!m.enabled && (
                              <Badge tone="neutral">{translate("models.badge.disabled")}</Badge>
                            )}
                            {m.custom && <Badge>{translate("models.badge.custom")}</Badge>}
                            {m.media_kinds?.map((kind) => (
                              <Badge key={kind} tone="neutral">
                                {mediaKindLabels[kind] ?? kind}
                              </Badge>
                            ))}
                            {m.embedding && (
                              <Badge tone="neutral">{translate("models.badge.embedding")}</Badge>
                            )}
                            {m.rerank && (
                              <Badge tone="neutral">{translate("models.badge.rerank")}</Badge>
                            )}
                            {m.available === false && m.enabled && (
                              <Badge tone="warn">{translate("models.badge.noCandidates")}</Badge>
                            )}
                          </div>
                          <small className={s.mono}>{m.upstream_id ?? m.id}</small>
                          {modelDisplayName(m) && <small>{modelDisplayName(m)}</small>}
                          {m.routes && m.routes.length > 1 && (
                            <div
                              className={s.routeSummary}
                              aria-label={translate("models.routeSummary")}
                            >
                              <span className={s.routeSummaryLabel}>
                                {translate("models.route")}
                              </span>
                              {m.routes.map((route) => (
                                <span
                                  className={`${s.routePill} ${route.enabled ? "" : s.routeDisabled}`}
                                  key={`${route.source}-${route.upstream_id}`}
                                  title={`${route.source} · ${route.enabled ? translate("common.enabled") : translate("common.disabled")}`}
                                >
                                  {route.upstream_id}
                                  {route.weight !== null ? ` · ${route.weight}` : ""}
                                </span>
                              ))}
                            </div>
                          )}
                          {m.keep_original && (
                            <small>{translate("models.keepOriginalId", { id: m.id })}</small>
                          )}
                        </div>
                      </td>
                      <td>
                        <RateCell model={m} />
                      </td>
                      <td className={s.capCell}>
                        <CapabilityChips model={m} />
                      </td>
                      <td className={s.specCell}>
                        <SpecValue model={m} kind="input" />
                      </td>
                      <td className={s.specCell}>
                        <SpecValue model={m} kind="output" />
                        <OutputProbeNote
                          probe={outputProbes[m.public_id] ?? outputProbes[m.upstream_id ?? m.id]}
                        />
                      </td>
                      <td>
                        <EffortChips model={m} />
                      </td>
                      <td>
                        {m.credential_ids.length
                          ? translate("models.binding.accountsCount", {
                              count: m.credential_ids.length,
                            })
                          : m.region
                            ? profileLabel(m.region)
                            : translate("models.binding.auto")}
                        <small>
                          {m.profile
                            ? profileLabel(m.profile)
                            : m.credential_ids.length
                              ? translate("models.binding.strictNoFallback")
                              : translate("models.binding.byCapability")}
                        </small>
                        {bindingMode(m) === "legacy" && (
                          <Badge tone="warn">{translate("models.binding.legacyBadge")}</Badge>
                        )}
                      </td>
                      <td>
                        <div className={s.rowActions}>
                          <button onClick={() => setDetailsId(m.id)}>
                            {translate("models.card.details")}
                          </button>
                          <button
                            onClick={() => {
                              setEditorRevision(resource.data?.revision ?? null);
                              setEditing(m);
                            }}
                          >
                            {translate("models.card.editRule")}
                          </button>
                          {m.custom && (
                            <button
                              className={s.textDanger}
                              onClick={() => {
                                setDeleting(m);
                                setError(null);
                              }}
                            >
                              {translate("common.delete")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title={query ? translate("models.emptyFiltered") : translate("models.empty")}>
              {translate("models.emptyHint")}
            </Empty>
          ))}
      </Panel>
      <DrawerPresence>
        {detailed && (
          <Drawer
            title={translate("models.detail.title", { id: detailed.public_id })}
            onClose={() => setDetailsId(null)}
          >
            <ModelMetadata model={detailed} />
          </Drawer>
        )}
      </DrawerPresence>
      <DrawerPresence>
        {(editing || creating) && resource.data && (
          <ModelEditor
            model={editing ?? emptyRule}
            creating={creating}
            models={resource.data.models}
            credentials={credentials.data}
            revision={editorRevision ?? resource.data.revision}
            onClose={() => {
              setEditing(null);
              setCreating(false);
              setEditorRevision(null);
            }}
            onSaved={resource.reload}
            rateProbe={rateJob}
          />
        )}
      </DrawerPresence>
      <DrawerPresence>
        {deleting && resource.data && (
          <Drawer
            title={translate("models.delete.title")}
            onClose={() => setDeleting(null)}
            dismissDisabled={busy}
          >
            <p className={s.warning}>
              {translate("models.delete.desc", { id: deleting.public_id })}
            </p>
            <ErrorNotice message={error} />
            <button
              className={s.danger}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void api
                  .delete(`/models/${encodeURIComponent(deleting.id)}`, {
                    data: { revision: resource.data!.revision },
                  })
                  .then((response) => {
                    if (object(response.data).ok !== true)
                      throw new Error("后端未确认删除，请刷新后核验");
                    setDeleting(null);
                    resource.reload();
                  })
                  .catch((err: unknown) => setError(errorMessage(err)))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? translate("models.delete.deleting") : translate("models.delete.confirm")}
            </button>
          </Drawer>
        )}
      </DrawerPresence>
    </>
  );
}
