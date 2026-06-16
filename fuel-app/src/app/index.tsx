import { Redirect } from "expo-router";

import { useSessionStore } from "@/stores/session";

/** Корневой роут: разводит на вход или главный экран по статусу сессии. */
export default function Index() {
  const status = useSessionStore((s) => s.status);
  if (status === "active") return <Redirect href="/main" />;
  return <Redirect href="/login" />;
}
