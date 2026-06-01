import { backendSocketClient } from "@/lib/backendSocketClient";

export async function getWS() {
  return backendSocketClient.connect();
}
