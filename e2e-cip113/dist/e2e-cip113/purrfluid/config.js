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
import { applyParamsToScript, resolveScriptHash, serializeRewardAddress, serializePlutusScript, serializeAddressObj, scriptAddress, byteString, conStr0, conStr1, integer, stringToHex, } from "@meshsdk/core";
import { wallet1VK, wallet1SK, NETWORK_ID } from "../setup.js";
export { NETWORK_ID };
// Base CIP-113 validators
const { default: baseBlueprint } = await import("../../cip113-programmable-tokens/plutus.json", { with: { type: "json" } });
// PurrFluid validators
const { default: purrfluidBlueprint } = await import("../../purrfluid-contracts/plutus.json", { with: { type: "json" } });
const { default: protocolBootstrap } = await import("./protocolBoostrap.json", {
    with: { type: "json" },
});
export { baseBlueprint, purrfluidBlueprint };
// Keep old name temporarily so existing scripts don't break yet.
export const blueprint = baseBlueprint;
export const getBaseValidator = (title) => {
    const v = baseBlueprint.validators.find((x) => x.title === title);
    if (!v)
        throw new Error(`Base validator not found: ${title}`);
    return v.compiledCode;
};
export const getPurrfluidValidator = (title) => {
    const v = purrfluidBlueprint.validators.find((x) => x.title === title);
    if (!v)
        throw new Error(`PurrFluid validator not found: ${title}`);
    return v.compiledCode;
};
// Keep old helper temporarily. We'll migrate callers gradually.
export const getValidator = getBaseValidator;
// ─────────────────────────────────────────────────────────────────────────────
// WHITELIST SEED — set before deployWhitelist.ts
// ─────────────────────────────────────────────────────────────────────────────
export const WHITELIST_SEED_TX_HASH = "1748d195b78c3be99d6c058175b485e4587fad32f5ec0a545c67da9ff6fa228d";
export const WHITELIST_SEED_TX_INDEX = 1;
// ─────────────────────────────────────────────────────────────────────────────
// TOKEN CONFIG — TOKEN_POLICY_ID is derived from issuancePolicyId below
// ─────────────────────────────────────────────────────────────────────────────
export const TOKEN_ASSET_NAME = stringToHex("purrfluid");
export const TOKEN_SUPPLY = 100_000;
// ─────────────────────────────────────────────────────────────────────────────
// DEPLOYED PROTOCOL — loaded from protocolBoostrap.json
// These are on-chain. Do NOT recompute deployed hashes — use JSON directly.
// ─────────────────────────────────────────────────────────────────────────────
const bootstrap = protocolBootstrap;
// protocolParams
export const protocolParamsPolicyId = bootstrap.protocolParams.scriptHash;
export const protocolParamsTxHash = bootstrap.protocolParams.txInput.txHash;
export const protocolParamsTxIndex = bootstrap.protocolParams.txInput.outputIndex;
// programmable_logic_global
export const globalHash = bootstrap.programmableLogicGlobalPrams.scriptHash;
export const globalRewardAddr = serializeRewardAddress(globalHash, true, NETWORK_ID);
export const globalCbor = applyParamsToScript(getBaseValidator("programmable_logic_global.programmable_logic_global.withdraw"), [byteString(protocolParamsPolicyId)], "JSON");
export const localGlobalHash = resolveScriptHash(globalCbor, "V3");
// programmable_logic_base
export const baseHash = bootstrap.programmableLogicBaseParams.scriptHash;
// issuance_cbor_hex_mint
export const issuanceScriptHash = bootstrap.issuanceParams.scriptHash;
// registry_mint (directoryMint)
export const registryMintPolicyId = bootstrap.directoryMintParams.scriptHash;
export const directoryMintTxHash = bootstrap.directoryMintParams.txInput.txHash;
export const directoryMintTxIndex = bootstrap.directoryMintParams.txInput.outputIndex;
// registry_spend (directorySpend)
export const directorySpendHash = bootstrap.directorySpendParams.scriptHash;
export const registrySpendAddr = serializeAddressObj(scriptAddress(directorySpendHash), NETWORK_ID);
export const registrySpendCbor = applyParamsToScript(getBaseValidator("registry_spend.registry_spend.spend"), [byteString(protocolParamsPolicyId)], "JSON");
export const registrySpendHash = resolveScriptHash(registrySpendCbor, "V3");
// Reference inputs for base and global scripts (already on-chain as ref scripts)
export const programmableBaseRefInput = {
    txHash: bootstrap.programmableBaseRefInput.txHash,
    outputIndex: bootstrap.programmableBaseRefInput.outputIndex,
};
export const programmableGlobalRefInput = {
    txHash: bootstrap.programmableGlobalRefInput.txHash,
    outputIndex: bootstrap.programmableGlobalRefInput.outputIndex,
};
// ─────────────────────────────────────────────────────────────────────────────
// BASE SCRIPT — recomputed for smart wallet address derivation only
// ─────────────────────────────────────────────────────────────────────────────
export const baseCbor = applyParamsToScript(getValidator("programmable_logic_base.programmable_logic_base.spend"), [conStr1([byteString(globalHash)])], "JSON");
export const localBaseHash = resolveScriptHash(baseCbor, "V3");
export const baseScript = { code: baseCbor, version: "V3" };
// ─────────────────────────────────────────────────────────────────────────────
// SMART WALLET ADDRESSES
// ─────────────────────────────────────────────────────────────────────────────
export const wallet1SmartAddr = serializePlutusScript(baseScript, wallet1VK, NETWORK_ID, false).address;
export const getSmartAddr = (stakeKeyHash) => serializePlutusScript(baseScript, stakeKeyHash, NETWORK_ID, false).address;
export const whitelistMintCbor = applyParamsToScript(getPurrfluidValidator("purrfluid_whitelist.purrfluid_whitelist.mint"), [
    conStr0([
        byteString(WHITELIST_SEED_TX_HASH),
        integer(WHITELIST_SEED_TX_INDEX),
    ]),
    conStr0([byteString(wallet1VK)]),
], "JSON");
export const whitelistPolicyId = resolveScriptHash(whitelistMintCbor, "V3");
export const whitelistSpendCbor = applyParamsToScript(getPurrfluidValidator("purrfluid_whitelist.purrfluid_whitelist.spend"), [
    conStr0([
        byteString(WHITELIST_SEED_TX_HASH),
        integer(WHITELIST_SEED_TX_INDEX),
    ]),
    conStr0([byteString(wallet1VK)]),
], "JSON");
export const whitelistSpendScript = {
    code: whitelistSpendCbor,
    version: "V3",
};
export const whitelistSpendAddr = serializePlutusScript(whitelistSpendScript, undefined, NETWORK_ID, false).address;
// ─────────────────────────────────────────────────────────────────────────────
// ADMIN CONTRACT — purrfluid_issuer(VerificationKey(wallet1VK))
// ─────────────────────────────────────────────────────────────────────────────
export const adminContractCbor = applyParamsToScript(getPurrfluidValidator("purrfluid_issuer.purrfluid_issuer.withdraw"), [conStr0([byteString(wallet1VK)])], "JSON");
export const adminContractHash = resolveScriptHash(adminContractCbor, "V3");
export const adminContractRewardAddr = serializeRewardAddress(adminContractHash, true, NETWORK_ID);
// ─────────────────────────────────────────────────────────────────────────────
// ISSUANCE MINT — issuance_mint(Script(baseHash), registryMintPolicyId, Script(adminContractHash), Script(globalHash))
// ─────────────────────────────────────────────────────────────────────────────
export const issuanceCbor = applyParamsToScript(getBaseValidator("issuance_mint.issuance_mint.mint"), [
    conStr1([byteString(baseHash)]),
    byteString(registryMintPolicyId),
    conStr1([byteString(adminContractHash)]),
    conStr1([byteString(globalHash)]),
], "JSON");
export const issuancePolicyId = resolveScriptHash(issuanceCbor, "V3");
export const TOKEN_POLICY_ID = issuancePolicyId;
// ─────────────────────────────────────────────────────────────────────────────
// TRANSFER LOGIC — purrfluid_transfer(Script(baseHash), tokenPolicy, whitelistPolicy)
// ─────────────────────────────────────────────────────────────────────────────
export const transferLogicCbor = applyParamsToScript(getPurrfluidValidator("purrfluid_transfer.purrfluid_transfer.withdraw"), [
    conStr1([byteString(baseHash)]),
    byteString(TOKEN_POLICY_ID),
    byteString(whitelistPolicyId),
], "JSON");
export const transferLogicHash = resolveScriptHash(transferLogicCbor, "V3");
export const transferLogicRewardAddr = serializeRewardAddress(transferLogicHash, true, NETWORK_ID);
// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY MINT — registry_mint(utxo_ref, issuanceScriptHash)
// ─────────────────────────────────────────────────────────────────────────────
export const registryMintCbor = applyParamsToScript(getValidator("registry_mint.registry_mint.mint"), [
    conStr0([byteString(directoryMintTxHash), integer(directoryMintTxIndex)]),
    byteString(issuanceScriptHash),
    conStr1([byteString(directorySpendHash)]),
], "JSON");
export const registryMintHash = resolveScriptHash(registryMintCbor, "V3");
// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────
export const validateConfig = () => {
    const requireHashMatch = (label, localHash, deployedHash) => {
        if (localHash !== deployedHash) {
            throw new Error(`Config mismatch: local ${label} hash does not match deployed ${label} hash.\n` +
                `  local:    ${localHash}\n` +
                `  deployed: ${deployedHash}\n` +
                "Use the blueprint that deployed protocolBoostrap.json, or redeploy the CIP-113 base and update config.ts.");
        }
    };
    console.log("=== Config ===");
    console.log("globalHash:           ", globalHash);
    console.log("localGlobalHash:      ", localGlobalHash);
    console.log("baseHash:             ", baseHash);
    console.log("localBaseHash:        ", localBaseHash);
    console.log("adminContractHash:    ", adminContractHash);
    console.log("transferLogicHash:    ", transferLogicHash);
    console.log("issuancePolicyId:     ", issuancePolicyId);
    console.log("registryMintHash:     ", registryMintHash);
    console.log("registryMintPolicyId: ", registryMintPolicyId);
    console.log("registrySpendHash:    ", registrySpendHash);
    console.log("directorySpendHash:   ", directorySpendHash);
    console.log("wallet1SmartAddr:     ", wallet1SmartAddr);
    console.log("whitelistPolicyId:    ", whitelistPolicyId);
    console.log("whitelistSpendAddr:   ", whitelistSpendAddr);
    console.log("registrySpendAddr:    ", registrySpendAddr);
    requireHashMatch("programmable_logic_global", localGlobalHash, globalHash);
    requireHashMatch("programmable_logic_base", localBaseHash, baseHash);
    requireHashMatch("registry_mint", registryMintHash, registryMintPolicyId);
    requireHashMatch("registry_spend", registrySpendHash, directorySpendHash);
};
export { wallet1VK, wallet1SK };
