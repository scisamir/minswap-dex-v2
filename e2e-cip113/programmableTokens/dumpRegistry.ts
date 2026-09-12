import {
  MeshTxBuilder,
  deserializeAddress,
  serializeAddressObj,
  serializeRewardAddress,
  serializePlutusScript,
  applyParamsToScript,
  resolveScriptHash,
  deserializeDatum,
  scriptAddress,
  byteString,
  conStr,
  conStr0,
  conStr1,
  integer,
  list,
  type PlutusScript,
  outputReference,
} from "@meshsdk/core";

import {
  blockchainProvider,
  NETWORK_ID,
  wallet1,
  wallet1VK,
  wallet1SK,
} from "../setup.js";
import { NETWORK } from "../network.js";

if (NETWORK !== "mainnet") {
  throw new Error(
    "programmableTokens/dumpRegistry.ts only has mainnet token/protocol constants. Add network-specific constants before running it on preview or preprod."
  );
}

const { default: protocolBootstrap } = await import("./protocolBoostrap.json", {
  with: { type: "json" },
});
const { default: blueprint } = await import("./blueprint.json", {
  with: { type: "json" },
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_POLICY_ID =
  "9c2d217c6e1aaf8188bcfe9d0d7267db1289d531a76a0447737ffa5e";
const TOKEN_ASSET_NAME = "73546f6b656e"; // "sToken"
const SEND_AMOUNT = "10";
const RECIPIENT_STAKE_KEY = wallet1SK; // loopback — change to send elsewhere

// Known from on-chain registry node datum + confirmed blacklist policy
const BLACKLIST_MINT_HASH =
  "b08d2a9a0990789bdcd9e1984fdd017caad97c5baa6992fb12f3e366";
const TRANSFER_LOGIC_HASH =
  "3614b8aba748f6c18474b96657bd86a8a63f3cb83074ad8f1c1c47b6";

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Blueprint helper
// ─────────────────────────────────────────────────────────────────────────────

const getValidator = (title: string): string => {
  const v = (blueprint.validators as any[]).find((x) => x.title === title);
  if (!v) throw new Error(`Validator not found: ${title}`);
  return v.compiledCode as string;
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Protocol scripts (applyParams)
// ─────────────────────────────────────────────────────────────────────────────

const protocolParamsPolicyId = protocolBootstrap.protocolParams.scriptHash;

const globalCbor = applyParamsToScript(
  getValidator("programmable_logic_global.programmable_logic_global.withdraw"),
  [byteString(protocolParamsPolicyId)],
  "JSON"
);
const globalHash = resolveScriptHash(globalCbor, "V3");
const globalRewardAddr = serializeRewardAddress(globalHash, true, NETWORK_ID);

const baseCbor = applyParamsToScript(
  getValidator("programmable_logic_base.programmable_logic_base.spend"),
  [conStr1([byteString(globalHash)])],
  "JSON"
);
const baseHash = resolveScriptHash(baseCbor, "V3");
const baseScript = { code: baseCbor, version: "V3" } as PlutusScript;

console.log("=== Protocol Scripts ===");
console.log(
  "globalHash:",
  globalHash,
  globalHash === protocolBootstrap.programmableLogicGlobalPrams.scriptHash
    ? "✅"
    : "⚠️ MISMATCH"
);
console.log(
  "baseHash:  ",
  baseHash,
  baseHash === protocolBootstrap.programmableLogicBaseParams.scriptHash
    ? "✅"
    : "⚠️ MISMATCH"
);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Derive all addresses from known hashes
// ─────────────────────────────────────────────────────────────────────────────

// Smart wallet addresses
const senderSmartAddr = serializePlutusScript(
  baseScript,
  wallet1SK,
  NETWORK_ID,
  false
).address;
const recipientSmartAddr = serializePlutusScript(
  baseScript,
  RECIPIENT_STAKE_KEY,
  NETWORK_ID,
  false
).address;

const blacklistMintCbor = applyParamsToScript(
  getValidator("blacklist_mint.blacklist_mint.mint"),
  [
    outputReference(
      "ac05e5100bc83c020b3dd4ee19370fc4ca95c00c66910fe1614e71646ef3f885",
      0
    ),
    byteString(wallet1VK),
  ],
  "JSON"
);
const blacklistMintAddr = serializePlutusScript(
  { code: blacklistMintCbor, version: "V3" } as PlutusScript,
  undefined,
  NETWORK_ID,
  false
).address;
const sc = resolveScriptHash(blacklistMintCbor, "V3");

console.log("\n\nblacklistMintAddr:", blacklistMintAddr, "\n\n");
console.log("Script hash:", sc, "\n\n");

// blacklist_spend(BLACKLIST_MINT_HASH) → blacklist spend address
const blacklistSpendCbor = applyParamsToScript(
  getValidator("blacklist_spend.blacklist_spend.spend"),
  [byteString(BLACKLIST_MINT_HASH)],
  "JSON"
);
const blacklistSpendAddr = serializePlutusScript(
  { code: blacklistSpendCbor, version: "V3" } as PlutusScript,
  undefined,
  NETWORK_ID,
  false
).address;

console.log("\n\nblacklistSpendAddr:", blacklistSpendAddr, "\n\n");
