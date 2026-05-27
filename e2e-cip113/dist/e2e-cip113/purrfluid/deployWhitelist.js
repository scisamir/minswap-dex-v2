/**
 * deployWhitelist.ts — Step 1
 *
 * Initializes the PurrFluid whitelist by:
 *   1. Consuming the configured seed UTxO from wallet1
 *   2. Minting the whitelist origin NFT via purrfluid_whitelist
 *   3. Creating the origin node at the whitelist script address
 *      with datum { key: "", next: "ffff...fff" }
 *
 * Before running, set WHITELIST_SEED_TX_HASH/INDEX in config.ts.
 */
import { BlockfrostProvider, MeshTxBuilder, byteString, conStr0, } from "@meshsdk/core";
import { blockchainProvider, wallet1, wallet1VK, wallet1Collateral, } from "../setup.js";
import { NETWORK_ID, WHITELIST_SEED_TX_HASH, WHITELIST_SEED_TX_INDEX, whitelistMintCbor, whitelistPolicyId, whitelistSpendAddr, validateConfig, } from "./config.js";
validateConfig();
const blockfrostId = process.env.BLOCKFROST_ID;
const txProvider = blockfrostId
    ? new BlockfrostProvider(blockfrostId)
    : blockchainProvider;
// ─────────────────────────────────────────────────────────────────────────────
// Use configured seed UTxO — must match whitelistMintCbor params in config.ts
// ─────────────────────────────────────────────────────────────────────────────
const walletUtxos = await wallet1.getUtxos();
const walletAddress = await wallet1.getChangeAddress();
const seedTxHash = WHITELIST_SEED_TX_HASH;
const seedTxIndex = WHITELIST_SEED_TX_INDEX;
const seedUtxo = walletUtxos.find((u) => u.input.txHash === seedTxHash && u.input.outputIndex === seedTxIndex);
if (!seedUtxo)
    throw new Error(`Configured whitelist seed UTxO not found in wallet1: ${seedTxHash}#${seedTxIndex}`);
console.log("=== Step 1: Init PurrFluid Whitelist ===");
console.log("Seed UTxO:", `${seedTxHash}#${seedTxIndex}`);
console.log("whitelistPolicyId: ", whitelistPolicyId);
console.log("whitelistSpendAddr:", whitelistSpendAddr);
// ─────────────────────────────────────────────────────────────────────────────
// Origin node datum: { key: "", next: sentinel }
// ─────────────────────────────────────────────────────────────────────────────
const SENTINEL = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const originDatum = conStr0([byteString(""), byteString(SENTINEL)]);
// ─────────────────────────────────────────────────────────────────────────────
// Build transaction
// ─────────────────────────────────────────────────────────────────────────────
const txBuilder = new MeshTxBuilder({
    fetcher: txProvider,
    evaluator: txProvider,
    submitter: txProvider,
    verbose: true,
});
txBuilder
    .txIn(seedTxHash, seedTxIndex)
    .mintPlutusScriptV3()
    .mint("1", whitelistPolicyId, "")
    .mintingScript(whitelistMintCbor)
    .mintRedeemerValue(conStr0([]), "JSON")
    .txOut(whitelistSpendAddr, [
    { unit: "lovelace", quantity: "2000000" },
    { unit: whitelistPolicyId, quantity: "1" }, // token name = "" (origin key)
])
    .txOutInlineDatumValue(originDatum, "JSON")
    .txInCollateral(wallet1Collateral.input.txHash, wallet1Collateral.input.outputIndex)
    .selectUtxosFrom(walletUtxos)
    .changeAddress(walletAddress)
    .requiredSignerHash(wallet1VK)
    .setNetwork(NETWORK_ID === 0 ? "preview" : "mainnet");
console.log("\nCompleting transaction...");
await txBuilder.complete();
const signedTx = await wallet1.signTx(txBuilder.txHex, true);
const txHash = await txProvider.submitTx(signedTx);
console.log("\n================================");
console.log("Whitelist initialized!");
console.log("================================");
console.log("TX Hash:           ", txHash);
console.log("whitelistPolicyId: ", whitelistPolicyId);
console.log("whitelistSpendAddr:", whitelistSpendAddr);
console.log("\nConfigured whitelist values:");
console.log(`   WHITELIST_SEED_TX_HASH = "${seedTxHash}"`);
console.log(`   WHITELIST_SEED_TX_INDEX = ${seedTxIndex}`);
