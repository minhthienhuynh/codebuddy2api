import { metric, type Credential, type RecordValue } from "./api";
import { Badge, Empty, Icon, Panel } from "./components";
import { t as translate, currentLanguage, localizeMessage } from "./i18n";
import {
  getCategoryLabel,
  agoLabel,
  creditBreakdown,
  dateLabel,
  untilLabel,
  type CreditCategory,
  type CreditPackage,
} from "./credits";
import s from "./ui.module.scss";

const CATEGORY_CLASS: Record<CreditCategory, string> = {
  plan: s.creditPlan,
  activity: s.creditActivity,
  welcome: s.creditWelcome,
  enterprise: s.creditEnterprise,
  other: s.creditOther,
};

function PackageRow({ pkg, now }: { pkg: CreditPackage; now: number }) {
  const filled = pkg.total > 0 ? Math.min(100, (pkg.remaining / pkg.total) * 100) : 0;
  return (
    <details className={`${s.creditPackage} ${CATEGORY_CLASS[pkg.category]}`}>
      <summary>
        <span className={s.creditPackageHead}>
          <span className={s.creditDot} aria-hidden="true" />
          <strong title={pkg.code || undefined}>{localizeMessage(pkg.label)}</strong>
          <span className={s.creditCategory}>{getCategoryLabel(pkg.category)}</span>
          <span className={s.creditAmount}>
            {metric(pkg.remaining)}
            <small> / {metric(pkg.total)}</small>
          </span>
        </span>
        <span className={s.creditTrack} aria-hidden="true">
          <i style={{ width: `${filled}%` }} />
        </span>
        <span className={s.creditMeta}>
          <small>
            {translate("credits.panel.segments", { count: pkg.segments.length })}
            {pkg.soonest === null
              ? ""
              : pkg.longTerm
                ? translate("credits.panel.expiresAt", { date: dateLabel(pkg.soonest, now) })
                : translate("credits.panel.soonestExpiry", {
                    date: dateLabel(pkg.soonest, now),
                    until: untilLabel(pkg.soonest, now),
                  })}
          </small>
          {pkg.soonRemaining > 0 && (
            <Badge tone="warn">
              {translate("credits.panel.expire7Days", { amount: metric(pkg.soonRemaining) })}
            </Badge>
          )}
          {pkg.longTerm && <Badge tone="good">{translate("credits.panel.longTermBadge")}</Badge>}
          {pkg.expiredRemaining > 0 && (
            <Badge tone="bad">
              {translate("credits.panel.expiredBadge", { amount: metric(pkg.expiredRemaining) })}
            </Badge>
          )}
          <span className={s.creditToggle}>{translate("credits.panel.details")}</span>
        </span>
      </summary>
      <div className={`${s.tableWrap} ${s.panelScroll}`}>
        <table>
          <thead>
            <tr>
              <th>{translate("credits.panel.thExpires")}</th>
              <th>{translate("credits.panel.thRemaining")}</th>
              <th>{translate("credits.panel.thTotal")}</th>
              <th>{translate("credits.panel.thUntil")}</th>
            </tr>
          </thead>
          <tbody>
            {pkg.segments.map((segment, i) => (
              <tr key={i} className={segment.state === "expired" ? s.creditExpiredRow : undefined}>
                <td>{segment.expiresAt === null ? "—" : dateLabel(segment.expiresAt, now)}</td>
                <td>{metric(segment.remaining)}</td>
                <td>{metric(segment.total)}</td>
                <td>
                  {segment.expiresAt === null ? (
                    "—"
                  ) : segment.state === "soon" || segment.state === "expired" ? (
                    <Badge tone={segment.state === "soon" ? "warn" : "bad"}>
                      {untilLabel(segment.expiresAt, now)}
                    </Badge>
                  ) : (
                    untilLabel(segment.expiresAt, now)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Balance column caption: the soonest live credit expiry, never the token expiry. */
export function BalanceExpiry({ credits, now }: { credits: RecordValue | null; now: number }) {
  // 持久化的 soonest_expiry 在两次同步之间会过期，必须和 tab 一样从各段重算。
  const b = credits ? creditBreakdown(credits, now) : null;
  return (
    <small className={s.credExpiry}>
      {!b ? (
        translate("credits.panel.notSynced")
      ) : b.unlimited ? (
        translate("credits.panel.unlimited")
      ) : b.soonest ? (
        <>
          {translate("credits.panel.recentExpiry")} <span>{dateLabel(b.soonest.at, now)}</span>
        </>
      ) : b.segmentCount > 0 && b.expired.count === b.segmentCount ? (
        translate("credits.panel.allExpired")
      ) : (
        translate("credits.panel.noExpiry")
      )}
    </small>
  );
}

/** Official credit tab: snapshot health, expiry pressure and per-package composition. */
export function CreditsPanel({ credential, now }: { credential: Credential; now: number }) {
  const syncError =
    typeof credential.sync_error === "string" && credential.sync_error
      ? credential.sync_error
      : null;
  const raw = credential.credits;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return (
      <Panel title={translate("credits.panel.overviewTitle")}>
        <div className={s.panelBody}>
          {syncError && (
            <div className={s.warning} role="status">
              <Icon name="alert" />
              <div>{translate("credits.panel.syncFailed", { error: syncError ?? "" })}</div>
            </div>
          )}
          <Empty title={translate("credits.panel.emptyTitle")}>
            {translate("credits.panel.emptyDesc")}
          </Empty>
        </div>
      </Panel>
    );
  }
  const b = creditBreakdown(raw as RecordValue, now);
  const age = b.fetchedAt === null ? null : agoLabel(b.fetchedAt, now);
  const notices = [
    syncError
      ? age
        ? translate("credits.panel.syncFailedWithSnapshot", { error: syncError, age })
        : translate("credits.panel.syncFailed", { error: syncError })
      : b.stale && age
        ? translate("credits.panel.snapshotAge", { age })
        : null,
    b.partial ? translate("credits.panel.partialNote") : null,
    b.expired.count
      ? translate("credits.panel.expiredSegmentsNote", {
          count: b.expired.count,
          amount: metric(b.expired.remaining),
        })
      : null,
  ].filter((line): line is string => line !== null);
  return (
    <>
      <Panel title={translate("credits.panel.overviewTitle")}>
        <div className={s.panelBody}>
          {notices.length > 0 && (
            <div className={s.warning} role="status">
              <Icon name="alert" />
              <div>
                {notices.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
          )}
          <div className={`${s.credUsageBox} ${s.creditTiles}`}>
            <div>
              <span>{translate("credits.panel.officialRemaining")}</span>
              <strong>{b.unlimited ? translate("credits.panel.infinite") : metric(b.total)}</strong>
              <small>
                {b.unlimited
                  ? translate("credits.panel.enterpriseUnlimitedNote")
                  : translate("credits.panel.packageSummary", {
                      packages: b.packages.length,
                      segments: b.segmentCount,
                    })}
              </small>
            </div>
            <div>
              <span>{translate("credits.panel.within7Days")}</span>
              <strong className={b.soon.remaining > 0 ? s.creditWarnValue : undefined}>
                {b.unlimited ? "—" : metric(b.soon.remaining)}
              </strong>
              <small>
                {b.soon.count
                  ? translate("credits.panel.segments", { count: b.soon.count })
                  : translate("credits.panel.none")}
              </small>
            </div>
            <div>
              <span>{translate("credits.panel.recentExpiry")}</span>
              <strong>{b.soonest ? dateLabel(b.soonest.at, now) : "—"}</strong>
              <small>
                {b.soonest
                  ? `${untilLabel(b.soonest.at, now)} · ${metric(b.soonest.remaining)}`
                  : translate("credits.panel.noExpiry")}
              </small>
            </div>
            <div>
              <span>{translate("credits.panel.syncTime")}</span>
              <strong>{age ?? translate("values.unknown")}</strong>
              <small>{b.fetchedAt === null ? "—" : dateLabel(b.fetchedAt, now)}</small>
            </div>
          </div>
          {b.categories.length > 0 && (
            <div className={s.creditMix}>
              <div
                className={s.creditMixBar}
                role="img"
                aria-label={translate("credits.panel.breakdown", {
                  summary: b.categories
                    .map((c) => `${getCategoryLabel(c.category)} ${metric(c.remaining)}`)
                    .join(currentLanguage() === "en" ? ", " : "，"),
                })}
              >
                {b.categories.map((c) => (
                  <i
                    key={c.category}
                    className={CATEGORY_CLASS[c.category]}
                    style={{ width: `${c.share * 100}%` }}
                  />
                ))}
              </div>
              <ul className={s.creditLegend}>
                {b.categories.map((c) => (
                  <li key={c.category} className={CATEGORY_CLASS[c.category]}>
                    <span className={s.creditDot} aria-hidden="true" />
                    {getCategoryLabel(c.category)}
                    <strong>{metric(c.remaining)}</strong>
                    <small>{c.share < 0.01 ? "<1%" : `${Math.round(c.share * 100)}%`}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Panel>
      {b.packages.length > 0 && (
        <Panel
          title={translate("credits.panel.packagesTitle")}
          hint={translate("credits.panel.packagesHint")}
        >
          <div className={`${s.panelBody} ${s.creditPackages}`}>
            {b.packages.map((pkg) => (
              <PackageRow key={pkg.key} pkg={pkg} now={now} />
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
