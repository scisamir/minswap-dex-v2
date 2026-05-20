/**
 * deployBlacklist.ts — Step 1
 *
 * Deploys the freeze-and-seize blacklist by:
 *   1. Selecting first available UTxO from wallet1 as seed
 *   2. Minting the blacklist origin NFT via blacklist_mint
 *   3. Creating the origin node at blacklist_spend address
 *      with datum { key: "", next: "ffff...fff" }
 *
 * After running, copy the printed values into config.ts before running Step 2.
 */

import {
  MeshTxBuilder,
  applyParamsToScript,
  resolveScriptHash,
  serializePlutusScript,
  byteString,
  conStr0,
  conStr,
  integer,
  type PlutusScript,
} from "@meshsdk/core";

import {
  blockchainProvider,
  wallet1,
  wallet1VK,
  wallet1Collateral,
} from "../setup.js";

import { NETWORK_ID, getValidator, validateConfig } from "./config.js";

validateConfig();

// ─────────────────────────────────────────────────────────────────────────────
// Select seed UTxO — first ADA-only UTxO in wallet1
// ─────────────────────────────────────────────────────────────────────────────

const walletUtxos = await wallet1.getUtxos();
const walletAddress = await wallet1.getChangeAddress();

const seedUtxo =
  walletUtxos.find(
    (u) =>
      u.output.amount.length === 1 && u.output.amount[0].unit === "lovelace"
  ) ?? walletUtxos[0];

if (!seedUtxo) throw new Error("No UTxOs available in wallet1");

const seedTxHash = seedUtxo.input.txHash;
const seedTxIndex = seedUtxo.input.outputIndex;

console.log("=== Step 1: Deploy Blacklist ===");
console.log("Seed UTxO:", `${seedTxHash}#${seedTxIndex}`);

// ─────────────────────────────────────────────────────────────────────────────
// Build blacklist_mint — parameterized with seed UTxO + manager PKH
// ─────────────────────────────────────────────────────────────────────────────

const blacklistMintCbor = applyParamsToScript(
  getValidator("blacklist_mint.blacklist_mint.mint"),
  [
    conStr(0, [byteString(seedTxHash), integer(seedTxIndex)]), // OutputReference
    byteString(wallet1VK), // manager_pkh
  ],
  "JSON"
);
const blacklistMintHash = resolveScriptHash(blacklistMintCbor, "V3");

// Build blacklist_spend — parameterized with blacklistMintHash
const blacklistSpendCbor = applyParamsToScript(
  getValidator("blacklist_spend.blacklist_spend.spend"),
  [byteString(blacklistMintHash)],
  "JSON"
);
const blacklistSpendAddr = serializePlutusScript(
  { code: blacklistSpendCbor, version: "V3" } as PlutusScript,
  undefined,
  NETWORK_ID,
  false
).address;

console.log("blacklistMintHash: ", blacklistMintHash);
console.log("blacklistSpendAddr:", blacklistSpendAddr);

// ─────────────────────────────────────────────────────────────────────────────
// Origin node datum: { key: "", next: sentinel }
// ─────────────────────────────────────────────────────────────────────────────

const SENTINEL = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const originDatum = conStr0([byteString(""), byteString(SENTINEL)]);

// ─────────────────────────────────────────────────────────────────────────────
// Build transaction
// ─────────────────────────────────────────────────────────────────────────────

const txBuilder = new MeshTxBuilder({
  fetcher: blockchainProvider,
  evaluator: blockchainProvider,
  submitter: blockchainProvider,
  verbose: true,
});

txBuilder
  .txIn(seedTxHash, seedTxIndex)

  .mintPlutusScriptV3()
  .mint("1", blacklistMintHash, "")
  .mintingScript(blacklistMintCbor)
  .mintRedeemerValue(conStr0([]), "JSON")

  .txOut(blacklistSpendAddr, [
    { unit: "lovelace", quantity: "2000000" },
    { unit: blacklistMintHash, quantity: "1" }, // token name = "" (origin key)
  ])
  .txOutInlineDatumValue(originDatum, "JSON")

  .txInCollateral(
    wallet1Collateral.input.txHash,
    wallet1Collateral.input.outputIndex
  )
  .selectUtxosFrom(walletUtxos)
  .changeAddress(walletAddress)
  .requiredSignerHash(wallet1VK)
  .setNetwork(NETWORK_ID === 0 ? "preview" : "mainnet");

console.log("\nCompleting transaction...");
await txBuilder.complete();

const signedTx = await wallet1.signTx(txBuilder.txHex, true);
const txHash = await wallet1.submitTx(signedTx);

console.log("\n================================");
console.log("✅ Blacklist deployed!");
console.log("================================");
console.log("TX Hash:           ", txHash);
console.log("blacklistMintHash: ", blacklistMintHash);
console.log("blacklistSpendAddr:", blacklistSpendAddr);
console.log("\n👉 Copy these into config.ts:");
console.log(`   BLACKLIST_SEED_TX_HASH  = "${seedTxHash}"`);
console.log(`   BLACKLIST_SEED_TX_INDEX = ${seedTxIndex}`);
console.log(`   BLACKLIST_MINT_HASH     = "${blacklistMintHash}"`);
