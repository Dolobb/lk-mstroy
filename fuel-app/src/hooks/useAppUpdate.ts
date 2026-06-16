import { useEffect, useState } from "react";
import { Linking } from "react-native";
import Constants from "expo-constants";
import { API_BASE_URL } from "../api/client";

interface VersionInfo {
  version: string;
  buildNumber: number;
  apkUrl: string;
}

interface AppUpdateState {
  available: boolean;
  apkUrl: string | null;
  dismiss: () => void;
}

// Сравниваем buildNumber (целое) — надёжнее строки "1.0.0".
function isNewer(remote: VersionInfo): boolean {
  const extraBuildNumber = (Constants.expoConfig?.extra as { buildNumber?: number } | undefined)
    ?.buildNumber;
  const localBuild = extraBuildNumber ?? Number(Constants.expoConfig?.android?.versionCode ?? 0);
  return remote.buildNumber > localBuild;
}

export function useAppUpdate(): AppUpdateState {
  const [updateInfo, setUpdateInfo] = useState<VersionInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/version`);
        if (!res.ok || cancelled) return;
        const data: VersionInfo = await res.json();
        if (isNewer(data)) setUpdateInfo(data);
      } catch {
        // Нет сети при старте — ок, баннер не показываем.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    available: !dismissed && updateInfo !== null,
    apkUrl: updateInfo?.apkUrl ?? null,
    dismiss: () => setDismissed(true),
  };
}

export function openApkUrl(apkUrl: string): void {
  void Linking.openURL(apkUrl);
}
