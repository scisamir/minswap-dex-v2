/**
 * config.ts — Shared config for all CIP-113 deployment steps
 *
 * Flow:
 *   Step 1:  deployWhitelist.ts  → initializes the PurrFluid whitelist
 *   Step 1a: insertWhitelist.ts  → whitelists wallet1
 *   Step 1b: registerStake.ts    → registers transferLogic + adminContract stake creds
 *   Step 2:  registerToken.ts    → registers token and mints PurrFluid supply
 *   Step 3:  spend.ts            → transfers PurrFluid tokens between smart wallets
 */

import {
  applyParamsToScript,
  resolveScriptHash,
  serializeRewardAddress,
  serializePlutusScript,
  serializeAddressObj,
  scriptAddress,
  byteString,
  conStr0,
  conStr1,
  integer,
  type PlutusScript,
  stringToHex,
} from "@meshsdk/core";

import { wallet1VK, wallet1SK, NETWORK_ID } from "../setup.js";

export { NETWORK_ID };

// Base CIP-113 validators
const { default: baseBlueprint } = await import(
  "../../cip113-programmable-tokens/plutus.json",
  { with: { type: "json" } }
);

// PurrFluid validators
const { default: purrfluidBlueprint } = await import(
  "../../purrfluid-contracts/plutus.json",
  { with: { type: "json" } }
);

export { baseBlueprint, purrfluidBlueprint };

// Keep old name temporarily so existing scripts don't break yet.
export const blueprint = baseBlueprint;

export const getBaseValidator = (title: string): string => {
  const v = (baseBlueprint.validators as any[]).find((x) => x.title === title);
  if (!v) throw new Error(`Base validator not found: ${title}`);
  return v.compiledCode as string;
};

export const getPurrfluidValidator = (title: string): string => {
  const v = (purrfluidBlueprint.validators as any[]).find(
    (x) => x.title === title
  );
  if (!v) throw new Error(`PurrFluid validator not found: ${title}`);
  return v.compiledCode as string;
};

// Keep old helper temporarily. We'll migrate callers gradually.
export const getValidator = getBaseValidator;

// ─────────────────────────────────────────────────────────────────────────────
// WHITELIST SEED — set before deployWhitelist.ts
// ─────────────────────────────────────────────────────────────────────────────

export const WHITELIST_SEED_TX_HASH =
  "175590ef834a406774e889032e5996a208c67a575688c1414e5b4049d8eb4efd";
export const WHITELIST_SEED_TX_INDEX = 2;

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN CONFIG — TOKEN_POLICY_ID is derived from issuancePolicyId below
// ─────────────────────────────────────────────────────────────────────────────

export const TOKEN_ASSET_NAME = stringToHex("purrfluid");
export const TOKEN_SUPPLY = 100_000;

// ─────────────────────────────────────────────────────────────────────────────
// DEPLOYED PROTOCOL — hardcoded from protocolBoostrap.json
// These are on-chain. Do NOT recompute — use hashes directly.
// ─────────────────────────────────────────────────────────────────────────────

// protocolParams
export const protocolParamsPolicyId =
  "872cf2039513edce5e075f50d64091c8b2820fa85b4466c78bf14c16";
export const protocolParamsTxHash =
  "76884b2a51661740e4b962f4df22afc7193925f0c36aa170d820a7c2f55ad396";
export const protocolParamsTxIndex = 0;

// programmable_logic_global
export const globalHash =
  "5db48c6383a98a53ca163e58c0f8c9dbc932d65ba070daff97851282";
export const globalRewardAddr = serializeRewardAddress(
  globalHash,
  true,
  NETWORK_ID
);

// programmable_logic_base
export const baseHash =
  "f2182b00a37bd746e20575c9af01ab31312213514cd31e872e0a2a3e";

// issuance_cbor_hex_mint
export const issuanceScriptHash =
  "40fc248b95c0b23a4c40524dd1b0a41d6c13225c6fa9867a4d44c94d";

// registry_mint (directoryMint)
export const registryMintPolicyId =
  "defddf7a98b92de4aa68f995d0e235ae21afd7a4757797ec6c27bafd";
export const directoryMintTxHash =
  "76884b2a51661740e4b962f4df22afc7193925f0c36aa170d820a7c2f55ad396";
export const directoryMintTxIndex = 0;

// registry_spend (directorySpend)
export const directorySpendHash =
  "e227ef2a34e5ec0f6c739b649daf50552912e60bb380aa3c5a4e4772";
export const registrySpendAddr = serializeAddressObj(
  scriptAddress(directorySpendHash),
  NETWORK_ID
);

// Reference inputs for base and global scripts (already on-chain as ref scripts)
export const programmableBaseRefInput = {
  txHash: "61fae36e28a62a65496907c9660da9cf5d27fa0e9054a04581e1d8a087fbd93e",
  outputIndex: 3,
};
export const programmableGlobalRefInput = {
  txHash: "61fae36e28a62a65496907c9660da9cf5d27fa0e9054a04581e1d8a087fbd93e",
  outputIndex: 4,
};

// ─────────────────────────────────────────────────────────────────────────────
// BASE SCRIPT — recomputed for smart wallet address derivation only
// ─────────────────────────────────────────────────────────────────────────────

export const baseCbor = applyParamsToScript(
  getValidator("programmable_logic_base.programmable_logic_base.spend"),
  [conStr1([byteString(globalHash)])],
  "JSON"
);
export const baseScript = { code: baseCbor, version: "V3" } as PlutusScript;

// ─────────────────────────────────────────────────────────────────────────────
// SMART WALLET ADDRESSES
// ─────────────────────────────────────────────────────────────────────────────

export const wallet1SmartAddr = serializePlutusScript(
  baseScript,
  wallet1VK,
  NETWORK_ID,
  false
).address;

export const getSmartAddr = (stakeKeyHash: string) =>
  serializePlutusScript(baseScript, stakeKeyHash, NETWORK_ID, false).address;

export const whitelistMintCbor = applyParamsToScript(
  getPurrfluidValidator("purrfluid_whitelist.purrfluid_whitelist.mint"),
  [
    conStr0([
      byteString(WHITELIST_SEED_TX_HASH),
      integer(WHITELIST_SEED_TX_INDEX),
    ]),
    conStr0([byteString(wallet1VK)]),
  ],
  "JSON"
);
export const whitelistPolicyId = resolveScriptHash(whitelistMintCbor, "V3");

export const whitelistSpendCbor = applyParamsToScript(
  getPurrfluidValidator("purrfluid_whitelist.purrfluid_whitelist.spend"),
  [
    conStr0([
      byteString(WHITELIST_SEED_TX_HASH),
      integer(WHITELIST_SEED_TX_INDEX),
    ]),
    conStr0([byteString(wallet1VK)]),
  ],
  "JSON"
);

export const whitelistSpendScript = {
  code: whitelistSpendCbor,
  version: "V3",
} as PlutusScript;

export const whitelistSpendAddr = serializePlutusScript(
  whitelistSpendScript,
  undefined,
  NETWORK_ID,
  false
).address;

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN CONTRACT — purrfluid_issuer(VerificationKey(wallet1VK))
// ─────────────────────────────────────────────────────────────────────────────

export const adminContractCbor = applyParamsToScript(
  getPurrfluidValidator("purrfluid_issuer.purrfluid_issuer.withdraw"),
  [conStr0([byteString(wallet1VK)])],
  "JSON"
);
export const adminContractHash = resolveScriptHash(adminContractCbor, "V3");
export const adminContractRewardAddr = serializeRewardAddress(
  adminContractHash,
  true,
  NETWORK_ID
);

// ─────────────────────────────────────────────────────────────────────────────
// ISSUANCE MINT — issuance_mint(Script(baseHash), registryMintPolicyId, Script(adminContractHash), Script(globalHash))
// ─────────────────────────────────────────────────────────────────────────────

export const issuanceCbor = applyParamsToScript(
  getBaseValidator("issuance_mint.issuance_mint.mint"),
  [
    conStr1([byteString(baseHash)]),
    byteString(registryMintPolicyId),
    conStr1([byteString(adminContractHash)]),
    conStr1([byteString(globalHash)]),
  ],
  "JSON"
);
export const issuancePolicyId = resolveScriptHash(issuanceCbor, "V3");

export const TOKEN_POLICY_ID = issuancePolicyId;

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFER LOGIC — purrfluid_transfer(Script(baseHash), tokenPolicy, whitelistPolicy)
// ─────────────────────────────────────────────────────────────────────────────

export const transferLogicCbor = applyParamsToScript(
  getPurrfluidValidator("purrfluid_transfer.purrfluid_transfer.withdraw"),
  [
    conStr1([byteString(baseHash)]),
    byteString(TOKEN_POLICY_ID),
    byteString(whitelistPolicyId),
  ],
  "JSON"
);
export const transferLogicHash = resolveScriptHash(transferLogicCbor, "V3");
export const transferLogicRewardAddr = serializeRewardAddress(
  transferLogicHash,
  true,
  NETWORK_ID
);

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY MINT — registry_mint(utxo_ref, issuanceScriptHash)
// ─────────────────────────────────────────────────────────────────────────────

export const registryMintCbor = applyParamsToScript(
  getValidator("registry_mint.registry_mint.mint"),
  [
    conStr0([byteString(directoryMintTxHash), integer(directoryMintTxIndex)]),
    byteString(issuanceScriptHash),
  ],
  "JSON"
);
export const registryMintHash = resolveScriptHash(registryMintCbor, "V3");

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

export const validateConfig = () => {
  console.log("=== Config ===");
  console.log("globalHash:           ", globalHash);
  console.log("baseHash:             ", baseHash);
  console.log("adminContractHash:    ", adminContractHash);
  console.log("transferLogicHash:    ", transferLogicHash);
  console.log("issuancePolicyId:     ", issuancePolicyId);
  console.log("registryMintHash:     ", registryMintHash);
  console.log("registryMintPolicyId: ", registryMintPolicyId);
  console.log("wallet1SmartAddr:     ", wallet1SmartAddr);
  console.log("whitelistPolicyId:    ", whitelistPolicyId);
  console.log("whitelistSpendAddr:   ", whitelistSpendAddr);
  console.log("registrySpendAddr:    ", registrySpendAddr);

  if (registryMintHash !== registryMintPolicyId) {
    console.warn(
      "⚠️  WARNING: registryMintHash !== registryMintPolicyId — blueprint may not match on-chain deployment"
    );
  }
};

export { wallet1VK, wallet1SK };
