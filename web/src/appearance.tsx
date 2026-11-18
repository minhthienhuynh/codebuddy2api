import { useEffect, useState } from "react";
import { create } from "zustand";
import { api, object } from "./api";
import { Drawer, DrawerPresence, Icon } from "./components";
import { chooseLanguage, languagePreference, useT, type LangPref } from "./i18n";
import s from "./ui.module.scss";
import "./theme.scss";

export type Mode = "system" | "light" | "dark";
export type Palette = "green" | "blue" | "rose" | "amber";
const key = "codebuddy.appearance";
const modes: Mode[] = ["system", "light", "dark"];
const palettes: Palette[] = ["green", "blue", "rose", "amber"];
export function parseAppearance(raw: string | null): { mode: Mode; palette: Palette } {
  try {
    const value = JSON.parse(raw ?? "null") as { mode?: Mode; palette?: Palette } | null;
    return {
      mode: modes.includes(value?.mode as Mode) ? value!.mode! : "system",
      palette: palettes.includes(value?.palette as Palette) ? value!.palette! : "green",
    };
  } catch {
    return { mode: "system", palette: "green" };
  }
}
function savedAppearance() {
  try {
    return parseAppearance(localStorage.getItem(key));
  } catch {
    return parseAppearance(null);
  }
}
export const useAppearance = create(() => ({ ...savedAppearance(), dark: false, persisted: true }));
export function initializeAppearance() {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const apply = () => {
    const { mode, palette } = useAppearance.getState();
    const dark = mode === "dark" || (mode === "system" && !!media?.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.palette = palette;
    if (dark !== useAppearance.getState().dark) useAppearance.setState({ dark });
  };
  apply();
  media?.addEventListener("change", apply);
  const unsubscribe = useAppearance.subscribe(apply);
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null)
      useAppearance.setState({ ...savedAppearance(), persisted: true });
  };
  window.addEventListener("storage", storage);
  return () => {
    media?.removeEventListener("change", apply);
    unsubscribe();
    window.removeEventListener("storage", storage);
  };
}
export function chooseAppearance(value: Partial<{ mode: Mode; palette: Palette }>) {
  const next = {
    mode: useAppearance.getState().mode,
    palette: useAppearance.getState().palette,
    ...value,
  };
  let persisted = true;
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    persisted = false;
  }
  useAppearance.setState({ ...next, persisted });
}
const LANGUAGE_CYCLE: LangPref[] = ["system", "zh", "en"];
/** Save through the API as well, so the CLI and other browsers share the choice. */
function persistLanguage(value: LangPref) {
  void api
    .get<unknown>("/settings")
    .then((response) =>
      api.patch("/settings", {
        values: { language: value === "system" ? "auto" : value },
        revision: object(response.data).revision,
      }),
    )
    .catch(() => undefined);
}
/** One click moves to the next interface language: system, Chinese, English. */
export function LanguageToggle() {
  const t = useT();
  const [pref, setPref] = useState(languagePreference);
  const name = { system: t("appearance.lang.system"), zh: "中文", en: "English" }[pref];
  const label = t("appearance.languageIs", { lang: name });
  return (
    <button
      type="button"
      className={s.appearanceButton}
      aria-label={label}
      title={label}
      onClick={() => {
        const next = LANGUAGE_CYCLE[(LANGUAGE_CYCLE.indexOf(pref) + 1) % LANGUAGE_CYCLE.length]!;
        chooseLanguage(next);
        setPref(next);
        persistLanguage(next);
      }}
    >
      {pref === "system" ? (
        <Icon name="globe" />
      ) : (
        <span className={s.langGlyph}>{pref === "zh" ? "中" : "EN"}</span>
      )}
    </button>
  );
}
export function Appearance() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { mode, palette, dark, persisted } = useAppearance();
  useEffect(initializeAppearance, []);
  return (
    <>
      <button
        className={s.appearanceButton}
        aria-label={t("appearance.drawerTitle")}
        title={t("appearance.drawerTitle")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="appearance" />
      </button>
      <DrawerPresence>
        {open && (
          <Drawer
            title={t("appearance.drawerTitle")}
            className={s.appearanceDrawer}
            onClose={() => setOpen(false)}
          >
            <fieldset className={s.appearanceChoices}>
              <legend>{t("appearance.displayMode")}</legend>
              {(
                [
                  ["system", t("appearance.mode.system"), "system"],
                  ["light", t("appearance.mode.light"), "sun"],
                  ["dark", t("appearance.mode.dark"), "moon"],
                ] as const
              ).map(([value, label, icon]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="appearance-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => chooseAppearance({ mode: value })}
                  />
                  <Icon name={icon} />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className={s.paletteChoices} disabled={dark}>
              <legend>{t("appearance.lightPalette")}</legend>
              {(
                [
                  ["green", t("appearance.palette.green"), "#6c9852"],
                  ["blue", t("appearance.palette.blue"), "#527cab"],
                  ["rose", t("appearance.palette.rose"), "#aa617b"],
                  ["amber", t("appearance.palette.amber"), "#a7804b"],
                ] as const
              ).map(([value, label, color]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="appearance-palette"
                    value={value}
                    checked={palette === value}
                    onChange={() => chooseAppearance({ palette: value })}
                  />
                  <span style={{ background: color }} />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <p className={s.note}>
              {dark ? t("appearance.darkFixedNote") : t("appearance.lightOnlyNote")}
            </p>
            {!persisted && <p role="status">{t("appearance.notPersisted")}</p>}
          </Drawer>
        )}
      </DrawerPresence>
    </>
  );
}
