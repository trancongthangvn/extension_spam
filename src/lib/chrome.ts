import type { TabStatsResponse } from '@/types/extension';

export function hasChromeExtensionApi(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    Boolean(chrome.storage?.local) &&
    Boolean(chrome.tabs)
  );
}

export async function storageGet<T extends Record<string, unknown>>(defaults: T): Promise<T> {
  if (!hasChromeExtensionApi()) return defaults;
  return new Promise((resolve) => {
    chrome.storage.local.get(defaults, (result) => {
      resolve(result as T);
    });
  });
}

export async function storageSet(values: Record<string, unknown>): Promise<void> {
  if (!hasChromeExtensionApi()) return;
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => resolve());
  });
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  if (!hasChromeExtensionApi()) return undefined;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function sendActiveTabMessage(
  payload: Record<string, unknown>
): Promise<TabStatsResponse | undefined> {
  if (!hasChromeExtensionApi()) return undefined;
  try {
    const tab = await getActiveTab();
    if (!tab?.id) return undefined;
    return await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id!, payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        resolve(response as TabStatsResponse | undefined);
      });
    });
  } catch {
    return undefined;
  }
}

export function openNewTab(url: string): void {
  if (hasChromeExtensionApi()) {
    chrome.tabs.create({ url });
  } else if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
