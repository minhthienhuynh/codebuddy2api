import { t as translate, localizeMessage } from "./i18n";
import { DataValue } from "./values";

export function TravelSummary({ trip }: { trip: Record<string, unknown> | null }) {
  if (!trip) return null;
  const remaining = trip.remaining_seconds;
  const minutes =
    trip.state === "traveling" &&
    trip.stale !== true &&
    typeof remaining === "number" &&
    Number.isFinite(remaining) &&
    remaining >= 0
      ? Math.ceil(remaining / 60)
      : null;
  const knownInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value);
  return (
    <>
      {typeof trip.location_name === "string" && trip.location_name && (
        <small>{translate("tasks.travel.location", { name: localizeMessage(trip.location_name) })}</small>
      )}
      {minutes !== null && (
        <small>
          {translate("tasks.travel.timeLeft")}
          {minutes === 0
            ? translate("tasks.travel.arrivedNotice")
            : minutes >= 60
              ? translate("tasks.travel.hoursMins", {
                  hours: Math.floor(minutes / 60),
                  mins: minutes % 60,
                })
              : translate("tasks.travel.mins", { mins: minutes })}
        </small>
      )}
      {trip.claimed === true && trip.claimed_credit == null && (
        <small>{translate("tasks.travel.claimNoAmount")}</small>
      )}
      {trip.departure_pending === true && (
        <small>{translate("tasks.travel.departurePending")}</small>
      )}
      {trip.claim_pending === true && <small>{translate("tasks.travel.claimPending")}</small>}
      {trip.buddy_consent_accepted === true && (
        <small>{translate("tasks.travel.consentSaved")}</small>
      )}
      {trip.buddy_task_chat_sent === true && <small>{translate("tasks.travel.chatSent")}</small>}
      {trip.buddy_task_completed === true && (
        <small>{translate("values.buddy_task_completed")}</small>
      )}
      {trip.buddy_claimed === true && <small>{translate("values.buddy_claimed")}</small>}
      {trip.agreement_accepted === true && <small>{translate("values.agreement_accepted")}</small>}
      {trip.auto_accept_buddy === true && (
        <small>{translate("tasks.travel.autoAcceptEnabled")}</small>
      )}
      {typeof trip.retry_at === "number" && Number.isFinite(trip.retry_at) && (
        <small>
          {translate("tasks.travel.retryBackoffTo")}
          <DataValue name="retry_at" value={trip.retry_at} />
        </small>
      )}
      {typeof trip.phase === "string" && (
        <small>
          {translate("tasks.travel.phaseLabel")}
          <DataValue name="phase" value={trip.phase} />
          {typeof trip.error_kind === "string" && (
            <>
              {" · "}
              <DataValue name="error_kind" value={trip.error_kind} />
            </>
          )}
          {knownInteger(trip.http_status) && ` · HTTP ${trip.http_status}`}
          {knownInteger(trip.code) && ` · ${translate("tasks.travel.businessCode")} ${trip.code}`}
        </small>
      )}
    </>
  );
}
