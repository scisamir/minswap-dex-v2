import { SLOT_CONFIG_NETWORK } from "@meshsdk/core";
import dotenv from "dotenv";

dotenv.config();

const networks = ["preview", "preprod", "mainnet"] as const;

export type Network = (typeof networks)[number];

const readNetwork = (fallback: Network): Network => {
  const raw = process.env.NETWORK;
  const value = raw?.trim().toLowerCase() || fallback;

  if ((networks as readonly string[]).includes(value)) {
    return value as Network;
  }

  throw new Error(
    `Unsupported NETWORK "${raw}". Use preview, preprod, or mainnet.`
  );
};

export const NETWORK = readNetwork("mainnet");
export const NETWORK_ID: 0 | 1 = NETWORK === "mainnet" ? 1 : 0;
export const getNetworkEnv = (name: string): string | undefined =>
  process.env[`${name}_${NETWORK.toUpperCase()}`] ?? process.env[name];
export const MAESTRO_NETWORK =
  NETWORK === "mainnet"
    ? "Mainnet"
    : NETWORK === "preprod"
      ? "Preprod"
      : "Preview";
export const SLOT_CONFIG = SLOT_CONFIG_NETWORK[NETWORK];
export const PROTOCOL_BOOTSTRAP_FILE_NAME =
  NETWORK === "mainnet"
    ? "protocolBoostrap.json"
    : `protocolBoostrap-${NETWORK}.json`;
