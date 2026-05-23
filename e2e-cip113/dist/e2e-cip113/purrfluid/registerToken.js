/**
 * registerToken.ts — Step 2
 *
 * Registers the issuance_mint policy in the on-chain CIP-113 token registry
 * and mints the initial PurrFluid supply to wallet1's smart wallet.
 *
 * Prerequisites:
 *   - deployWhitelist.ts completed
 *   - insertWhitelist.ts completed
 *   - registerStake.ts completed
 */
import { BlockfrostProvider, MeshTxBuilder, deserializeDatum, stringToHex, byteString, conStr0, conStr1, integer, } from "@meshsdk/core";
import { DEFAULT_V3_COST_MODEL_LIST } from "@meshsdk/common";
import { blockchainProvider, wallet1, wallet1VK, wallet1Collateral, } from "../setup.js";
import { TOKEN_POLICY_ID, TOKEN_ASSET_NAME, TOKEN_SUPPLY, registryMintPolicyId, issuanceScriptHash, issuanceCbor, issuancePolicyId, registryMintCbor, registrySpendCbor, transferLogicHash, adminContractCbor, adminContractHash, adminContractRewardAddr, wallet1SmartAddr, NETWORK_ID, protocolParamsPolicyId, validateConfig, } from "./config.js";
validateConfig();
const blockfrostId = process.env.BLOCKFROST_ID;
const txProvider = blockfrostId
    ? new BlockfrostProvider(blockfrostId)
    : blockchainProvider;
const useLivePlutusV3CostModel = async () => {
    if (!blockfrostId)
        return;
    const network = blockfrostId.slice(0, 7);
    const response = await fetch(`https://cardano-${network}.blockfrost.io/api/v0/epochs/latest/parameters`, { headers: { project_id: blockfrostId } });
    if (!response.ok) {
        throw new Error(`Could not fetch current protocol params from Blockfrost: ${response.status}`);
    }
    const params = (await response.json());
    const plutusV3CostModel = params.cost_models?.PlutusV3;
    if (!plutusV3CostModel) {
        throw new Error("Blockfrost protocol params did not include PlutusV3 cost model");
    }
    const values = Object.values(plutusV3CostModel).map(Number);
    DEFAULT_V3_COST_MODEL_LIST.splice(0, DEFAULT_V3_COST_MODEL_LIST.length, ...values);
    console.log("PlutusV3 cost model:   ", `${values.length} params`);
};
await useLivePlutusV3CostModel();
console.log("=== Step 2: Register Token + Mint Supply ===");
console.log("TOKEN_POLICY_ID:      ", TOKEN_POLICY_ID);
console.log("issuancePolicyId:     ", issuancePolicyId);
console.log("adminContractHash:    ", adminContractHash);
console.log("registryMintPolicyId: ", registryMintPolicyId);
// ─────────────────────────────────────────────────────────────────────────────
// 1. Find registry_spend address from on-chain head node
//    The head node holds a token with just registryMintPolicyId (empty asset name).
//    Its address IS the registry_spend address.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nFinding registry head node...");
const headNodeAddresses = await txProvider.fetchAssetAddresses(registryMintPolicyId);
if (!headNodeAddresses?.length)
    throw new Error("Registry head node not found — check registryMintPolicyId");
const registrySpendAddr = headNodeAddresses[0].address;
console.log("Registry spend address:", registrySpendAddr);
// ─────────────────────────────────────────────────────────────────────────────
// 2. Fetch IssuanceCborHex UTxO (reference input for registry_mint)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nFetching IssuanceCborHex UTxO...");
const issuanceCborHexTokenName = Buffer.from("IssuanceCborHex").toString("hex");
const issuanceCborHexUnit = issuanceScriptHash + issuanceCborHexTokenName;
const issuanceCborHexAddresses = await txProvider.fetchAssetAddresses(issuanceCborHexUnit);
if (!issuanceCborHexAddresses?.length)
    throw new Error(`IssuanceCborHex asset not found on chain. Unit: ${issuanceCborHexUnit}`);
const issuanceCborHexUtxos = await txProvider.fetchAddressUTxOs(issuanceCborHexAddresses[0].address);
const issuanceCborHexUtxo = issuanceCborHexUtxos.find((u) => u.output.amount.some((a) => a.unit === issuanceCborHexUnit));
if (!issuanceCborHexUtxo)
    throw new Error("IssuanceCborHex UTxO not found");
console.log(`IssuanceCborHex UTxO: ${issuanceCborHexUtxo.input.txHash}#${issuanceCborHexUtxo.input.outputIndex}`);
console.log("\nFetching ProtocolParams UTxO...");
const protocolParamsUnit = protocolParamsPolicyId + stringToHex("ProtocolParams");
const protocolParamsAddresses = await txProvider.fetchAssetAddresses(protocolParamsUnit);
if (!protocolParamsAddresses?.length)
    throw new Error(`ProtocolParams asset not found on chain. Unit: ${protocolParamsUnit}`);
const protocolParamsUtxos = await txProvider.fetchAddressUTxOs(protocolParamsAddresses[0].address);
const protocolParamsUtxo = protocolParamsUtxos.find((u) => u.output.amount.some((a) => a.unit === protocolParamsUnit));
if (!protocolParamsUtxo)
    throw new Error("ProtocolParams UTxO not found");
console.log(`ProtocolParams UTxO: ${protocolParamsUtxo.input.txHash}#${protocolParamsUtxo.input.outputIndex}`);
// ─────────────────────────────────────────────────────────────────────────────
// 3. Extract hashed_param from issuance_mint flat UPLC bytes
// ─────────────────────────────────────────────────────────────────────────────
if (!issuanceCborHexUtxo.output.plutusData)
    throw new Error("IssuanceCborHex UTxO has no inline datum");
const issuanceDatum = deserializeDatum(issuanceCborHexUtxo.output.plutusData);
const prefixHex = issuanceDatum?.fields?.[0]?.bytes;
const postfixHex = issuanceDatum?.fields?.[1]?.bytes;
if ((!prefixHex && prefixHex !== "") || (!postfixHex && postfixHex !== ""))
    throw new Error("Failed to decode IssuanceCborHex datum fields");
// Strip CBOR bytestring header from issuanceCbor to get raw flat bytes
function stripCborBytestringHeader(hex) {
    const first = parseInt(hex.slice(0, 2), 16);
    if (first === 0x58)
        return hex.slice(4); // 1-byte length
    if (first === 0x59)
        return hex.slice(6); // 2-byte length
    if (first === 0x5a)
        return hex.slice(10); // 4-byte length
    if (first >= 0x40 && first <= 0x57)
        return hex.slice(2); // short direct
    throw new Error(`Unexpected CBOR byte: 0x${first.toString(16)}`);
}
const flatBytes = stripCborBytestringHeader(issuanceCbor);
const hashedParam = flatBytes.slice(prefixHex.length, flatBytes.length - postfixHex.length);
console.log("hashed_param extracted:", hashedParam.slice(0, 20) + "...");
console.log("   prefix len:", prefixHex.length / 2, "bytes");
console.log("   postfix len:", postfixHex.length / 2, "bytes");
console.log("   hashed_param len:", hashedParam.length / 2, "bytes");
// ─────────────────────────────────────────────────────────────────────────────
// 4. Use checked registry scripts from config
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nUsing registry scripts from config");
// ─────────────────────────────────────────────────────────────────────────────
// 5. Find covering registry node: node.key < TOKEN_POLICY_ID < node.next
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nSearching registry for covering node...");
const registryUtxos = await txProvider.fetchAddressUTxOs(registrySpendAddr);
console.log(`Found ${registryUtxos.length} registry UTxO(s)`);
const parsedNodes = [];
for (const utxo of registryUtxos) {
    if (!utxo.output.plutusData)
        continue;
    try {
        const datum = deserializeDatum(utxo.output.plutusData);
        const key = datum?.fields?.[0]?.bytes ?? "";
        const next = datum?.fields?.[1]?.bytes ?? "";
        const lovelace = utxo.output.amount.find((a) => a.unit === "lovelace")?.quantity ??
            "2000000";
        const tokenUnit = registryMintPolicyId + key;
        const tlField = datum?.fields?.[2];
        const tptlField = datum?.fields?.[3];
        const gscField = datum?.fields?.[4];
        parsedNodes.push({
            utxo,
            node: {
                key,
                next,
                transferLogicCredential: tlField,
                thirdPartyTransferLogicCredential: tptlField,
                globalStateCs: gscField?.bytes ?? "",
                lovelace,
                tokenUnit,
            },
        });
    }
    catch {
        continue;
    }
}
// Already registered? (must be checked BEFORE looking for a covering range)
const existing = parsedNodes.find((n) => n.node.key === TOKEN_POLICY_ID);
if (existing) {
    throw new Error(`Token ${TOKEN_POLICY_ID} is already registered at ${existing.utxo.input.txHash}#${existing.utxo.input.outputIndex}`);
}
let coveringUtxo = null;
let coveringNode = null;
for (const { utxo, node } of parsedNodes) {
    if (node.key < TOKEN_POLICY_ID && TOKEN_POLICY_ID < node.next) {
        coveringUtxo = utxo;
        coveringNode = node;
        console.log(`Covering node: ${utxo.input.txHash}#${utxo.input.outputIndex}`);
        console.log(`   key:  "${node.key || "(origin)"}"`);
        console.log(`   next: "${node.next}"`);
        break;
    }
}
if (!coveringUtxo || !coveringNode) {
    const less = parsedNodes
        .map((n) => n.node.key)
        .filter((k) => k < TOKEN_POLICY_ID)
        .sort()
        .at(-1);
    const greater = parsedNodes
        .map((n) => n.node.key)
        .filter((k) => k > TOKEN_POLICY_ID)
        .sort()
        .at(0);
    throw new Error(`No covering node found for policy: ${TOKEN_POLICY_ID}. Registry may be malformed. nearestLess=${less ?? "none"}, nearestGreater=${greater ?? "none"}`);
}
// ─────────────────────────────────────────────────────────────────────────────
// 6. Build datums
//
// Updated covering node: preserve all fields, next → TOKEN_POLICY_ID
// New inserted node:
//   transfer_logic_script             = Script(transferLogicHash)
//   third_party_transfer_logic_script = Script(adminContractHash) ← reference pattern
//   global_state_cs                   = byteString("") — empty
// ─────────────────────────────────────────────────────────────────────────────
const updatedCoveringDatum = conStr0([
    byteString(coveringNode.key),
    byteString(TOKEN_POLICY_ID), // next → new node
    coveringNode.transferLogicCredential,
    coveringNode.thirdPartyTransferLogicCredential,
    byteString(coveringNode.globalStateCs),
]);
const newNodeDatum = conStr0([
    byteString(TOKEN_POLICY_ID),
    byteString(coveringNode.next),
    conStr1([byteString(transferLogicHash)]), // transfer_logic = Script(transferLogicHash)
    conStr1([byteString(adminContractHash)]), // third_party_transfer_logic = Script(adminContractHash)
    byteString(""), // global_state_cs = empty
]);
// ─────────────────────────────────────────────────────────────────────────────
// 7. Build transaction
// ─────────────────────────────────────────────────────────────────────────────
const walletUtxos = await wallet1.getUtxos();
const walletAddress = await wallet1.getChangeAddress();
const txBuilder = new MeshTxBuilder({
    fetcher: txProvider,
    evaluator: txProvider,
    submitter: txProvider,
    verbose: true,
});
// Spend the covering registry node
txBuilder
    .spendingPlutusScriptV3()
    .txIn(coveringUtxo.input.txHash, coveringUtxo.input.outputIndex)
    .txInInlineDatumPresent()
    .txInScript(registrySpendCbor)
    .txInRedeemerValue(conStr0([]), "JSON");
// Reference inputs
txBuilder
    .readOnlyTxInReference(protocolParamsUtxo.input.txHash, protocolParamsUtxo.input.outputIndex)
    .readOnlyTxInReference(issuanceCborHexUtxo.input.txHash, issuanceCborHexUtxo.input.outputIndex);
// OUTPUT 0: issuance tokens to smart wallet (issuance_mint checks outputs[0])
txBuilder
    .txOut(wallet1SmartAddr, [
    { unit: "lovelace", quantity: "2000000" },
    {
        unit: issuancePolicyId + TOKEN_ASSET_NAME,
        quantity: String(TOKEN_SUPPLY),
    },
])
    .txOutInlineDatumValue(conStr0([]), "JSON");
// OUTPUT 1: updated covering node (next → TOKEN_POLICY_ID)
txBuilder
    .txOut(registrySpendAddr, [
    { unit: "lovelace", quantity: coveringNode.lovelace },
    { unit: coveringNode.tokenUnit, quantity: "1" },
])
    .txOutInlineDatumValue(updatedCoveringDatum, "JSON");
// OUTPUT 2: new inserted registry node
txBuilder
    .txOut(registrySpendAddr, [
    { unit: "lovelace", quantity: "2000000" },
    { unit: registryMintPolicyId + TOKEN_POLICY_ID, quantity: "1" },
])
    .txOutInlineDatumValue(newNodeDatum, "JSON");
// Mint 1: registry node NFT
txBuilder
    .mintPlutusScriptV3()
    .mint("1", registryMintPolicyId, TOKEN_POLICY_ID)
    .mintingScript(registryMintCbor)
    .mintRedeemerValue(conStr1([byteString(TOKEN_POLICY_ID), byteString(hashedParam)]), "JSON");
// Mint 2: issuance tokens (required by is_programmable_token_registration in registry_mint)
txBuilder
    .mintPlutusScriptV3()
    .mint(String(TOKEN_SUPPLY), issuancePolicyId, TOKEN_ASSET_NAME)
    .mintingScript(issuanceCbor)
    .mintRedeemerValue(conStr0([conStr1([byteString(adminContractHash)]), conStr1([integer(2)])]), "JSON");
// Withdrawal: issuer_admin_contract (authorizes issuance_mint)
txBuilder
    .withdrawalPlutusScriptV3()
    .withdrawal(adminContractRewardAddr, "0")
    .withdrawalScript(adminContractCbor)
    .withdrawalRedeemerValue(integer(0), "JSON");
await txBuilder
    .txInCollateral(wallet1Collateral.input.txHash, wallet1Collateral.input.outputIndex)
    .selectUtxosFrom(walletUtxos)
    .changeAddress(walletAddress)
    .requiredSignerHash(wallet1VK)
    .setNetwork(NETWORK_ID === 0 ? "preview" : "mainnet")
    .complete();
if (process.env.PURRFLUID_DRY_RUN === "1") {
    console.log("\nDry run complete — transaction evaluated successfully.");
    process.exit(0);
}
const signedTx = await wallet1.signTx(txBuilder.txHex, true);
const txHash = await txProvider.submitTx(signedTx);
console.log("\n================================");
console.log("Token registered!");
console.log("================================");
console.log("TX Hash:           ", txHash);
console.log("TOKEN_POLICY_ID:   ", TOKEN_POLICY_ID);
console.log("transferLogicHash: ", transferLogicHash);
console.log("adminContractHash: ", adminContractHash);
console.log("\nStep 2 complete — run spend.ts next");
