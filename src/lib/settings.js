import { defaultGenerator } from "./generator.js";

export const defaultSettings = {
  /** Show the Keyra menu under login fields. */
  inlineMenu: true,
  /** Offer to save or update logins after signing in. */
  savePrompt: true,
  /** Copy the TOTP code after filling a login that has one. */
  autoCopyTotp: true,
  /** Hosts where saving is never offered. */
  never: [],
  generator: defaultGenerator,
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...defaultSettings, ...settings, generator: { ...defaultGenerator, ...settings?.generator } };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}
