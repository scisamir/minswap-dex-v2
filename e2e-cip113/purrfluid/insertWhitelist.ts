/**
 * insertWhitelist.ts - Step 1a
 *
 * Inserts a stake credential hash into the PurrFluid whitelist.
 * Set PURRFLUID_WHITELIST_KEY for DEX
 * script credentials such as poolValidatorScriptHash or orderValidatorScriptHash.
 *
 * Prerequisites:
 *   - deployWhitelist.ts completed
 */

import {
  BlockfrostProvider,
  MeshTxBuilder,
  byteString,
  conStr0,
  conStr1,
  deserializeAddress,
  deserializeDatum,
} from "@meshsdk/core";

import {
  blockchainProvider,
  wallet1,
  wallet1VK,
  wallet1Collateral,
} from "../setup.js";

import {
  NETWORK_ID,
  whitelistMintCbor,
  whitelistPolicyId,
  whitelistSpendAddr,
  whitelistSpendCbor,
  validateConfig,
} from "./config.js";

validateConfig();

const blockfrostId = process.env.BLOCKFROST_ID;
const txProvider = blockfrostId
  ? new BlockfrostProvider(blockfrostId)
  : blockchainProvider;

const TARGET_ADDRESS = process.env.WHITELIST_ADDRESS;
if (!TARGET_ADDRESS) {
  throw new Error("WHITELIST_ADDRESS does not exist!");
}

// const TARGET_KEY_HASH = process.env.PURRFLUID_WHITELIST_KEY;
// if (!TARGET_KEY_HASH) {
//   throw new Error("PURRFLUID_WHITELIST_KEY does not exist!");
// }

const { pubKeyHash: TARGET_KEY_HASH } = deserializeAddress(TARGET_ADDRESS);

if (TARGET_KEY_HASH.length !== 56) {
  throw new Error(`Whitelist key must be 28 bytes hex: ${TARGET_KEY_HASH}`);
}

const nodeTokenUnit = (key: string) => whitelistPolicyId + key;

console.log("=== Step 1a: Insert Whitelist Node ===");
console.log("targetKeyHash:      ", TARGET_KEY_HASH);
console.log("whitelistPolicyId:  ", whitelistPolicyId);
console.log("whitelistSpendAddr: ", whitelistSpendAddr);

const whitelistUtxos = await txProvider.fetchAddressUTxOs(whitelistSpendAddr);

if (!whitelistUtxos.length) {
  throw new Error("No whitelist nodes found. Run deployWhitelist.ts first.");
}

type WhitelistNode = {
  key: string;
  next: string;
  lovelace: string;
};

type ParsedWhitelistNode = {
  utxo: (typeof whitelistUtxos)[0];
  node: WhitelistNode;
};

const parsedNodes: ParsedWhitelistNode[] = [];

for (const utxo of whitelistUtxos) {
  if (!utxo.output.plutusData) continue;

  try {
    const datum = deserializeDatum(utxo.output.plutusData);
    const key = datum?.fields?.[0]?.bytes ?? "";
    const next = datum?.fields?.[1]?.bytes ?? "";

    const hasNodeToken = utxo.output.amount.some(
      (a) => a.unit === nodeTokenUnit(key) && a.quantity === "1"
    );
    if (!hasNodeToken) continue;

    const lovelace =
      utxo.output.amount.find((a) => a.unit === "lovelace")?.quantity ??
      "2000000";

    parsedNodes.push({
      utxo,
      node: { key, next, lovelace },
    });
  } catch {
    continue;
  }
}

const existing = parsedNodes.find((n) => n.node.key === TARGET_KEY_HASH);
if (existing) {
  const whitelistIndex = [...parsedNodes]
    .sort((a, b) => a.node.key.localeCompare(b.node.key))
    .findIndex((n) => n.node.key === TARGET_KEY_HASH);

  throw new Error(
    `Key is already whitelisted at ${existing.utxo.input.txHash}#${existing.utxo.input.outputIndex} (whitelist index: ${whitelistIndex})`
  );
}

let coveringUtxo: (typeof whitelistUtxos)[0] | null = null;
let coveringNode: WhitelistNode | null = null;

for (const { utxo, node } of parsedNodes) {
  if (node.key < TARGET_KEY_HASH && TARGET_KEY_HASH < node.next) {
    coveringUtxo = utxo;
    coveringNode = node;
    break;
  }
}

if (!coveringUtxo || !coveringNode) {
  throw new Error(`No covering whitelist node found for: ${TARGET_KEY_HASH}`);
}

console.log(
  `Covering node: ${coveringUtxo.input.txHash}#${coveringUtxo.input.outputIndex}`
);
console.log(
  `range: "${coveringNode.key || "(origin)"}" < target < "${coveringNode.next}"`
);

const insertRedeemer = conStr1([byteString(TARGET_KEY_HASH)]);

const updatedCoveringDatum = conStr0([
  byteString(coveringNode.key),
  byteString(TARGET_KEY_HASH),
]);

const newNodeDatum = conStr0([
  byteString(TARGET_KEY_HASH),
  byteString(coveringNode.next),
]);

const walletUtxos = await wallet1.getUtxos();
const walletAddress = await wallet1.getChangeAddress();

const txBuilder = new MeshTxBuilder({
  fetcher: txProvider,
  evaluator: txProvider,
  submitter: txProvider,
  verbose: true,
});

txBuilder
  .spendingPlutusScriptV3()
  .txIn(coveringUtxo.input.txHash, coveringUtxo.input.outputIndex)
  .txInInlineDatumPresent()
  .txInScript(whitelistSpendCbor)
  .txInRedeemerValue(insertRedeemer, "JSON");

txBuilder
  .mintPlutusScriptV3()
  .mint("1", whitelistPolicyId, TARGET_KEY_HASH)
  .mintingScript(whitelistMintCbor)
  .mintRedeemerValue(insertRedeemer, "JSON");

txBuilder
  .txOut(whitelistSpendAddr, [
    { unit: "lovelace", quantity: coveringNode.lovelace },
    { unit: nodeTokenUnit(coveringNode.key), quantity: "1" },
  ])
  .txOutInlineDatumValue(updatedCoveringDatum, "JSON");

txBuilder
  .txOut(whitelistSpendAddr, [
    { unit: "lovelace", quantity: "2000000" },
    { unit: nodeTokenUnit(TARGET_KEY_HASH), quantity: "1" },
  ])
  .txOutInlineDatumValue(newNodeDatum, "JSON");

await txBuilder
  .txInCollateral(
    wallet1Collateral.input.txHash,
    wallet1Collateral.input.outputIndex
  )
  .selectUtxosFrom(walletUtxos)
  .changeAddress(walletAddress)
  .requiredSignerHash(wallet1VK)
  .setNetwork(NETWORK_ID === 0 ? "preview" : "mainnet")
  .complete();

const signedTx = await wallet1.signTx(txBuilder.txHex, true);
const txHash = await txProvider.submitTx(signedTx);

console.log("\n================================");
console.log("Whitelist node inserted!");
console.log("================================");
console.log("TX Hash:       ", txHash);
console.log("Whitelisted key:", TARGET_KEY_HASH);
