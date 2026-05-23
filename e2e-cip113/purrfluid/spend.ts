/**
 * spend.ts — Step 3
 *
 * Transfers PurrFluid tokens from wallet1's smart wallet to a recipient's smart wallet.
 * Attaches whitelist membership proofs as reference inputs.
 *
 * Prerequisites: Step 1, Step 1a, Step 1b, and Step 2 complete
 */

import {
  MeshTxBuilder,
  applyParamsToScript,
  deserializeDatum,
  stringToHex,
  byteString,
  conStr,
  conStr0,
  integer,
  list,
} from "@meshsdk/core";

import {
  blockchainProvider,
  wallet1,
  wallet1VK,
  wallet1Collateral,
} from "../setup.js";

import {
  TOKEN_POLICY_ID,
  TOKEN_ASSET_NAME,
  globalRewardAddr,
  baseCbor,
  wallet1SmartAddr,
  getSmartAddr,
  whitelistPolicyId,
  whitelistSpendAddr,
  transferLogicCbor,
  transferLogicHash,
  transferLogicRewardAddr,
  registrySpendAddr,
  protocolParamsPolicyId,
  NETWORK_ID,
  getValidator,
  validateConfig,
} from "./config.js";

validateConfig();

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — change RECIPIENT_STAKE_KEY to send to another wallet
// ─────────────────────────────────────────────────────────────────────────────

const SEND_AMOUNT = "10";
const RECIPIENT_STAKE_KEY = wallet1VK; // loopback by default

const senderSmartAddr = wallet1SmartAddr;
const recipientSmartAddr = getSmartAddr(RECIPIENT_STAKE_KEY);
const tokenUnit = TOKEN_POLICY_ID + TOKEN_ASSET_NAME;
const globalCbor = applyParamsToScript(
  getValidator("programmable_logic_global.programmable_logic_global.withdraw"),
  [byteString(protocolParamsPolicyId)],
  "JSON"
);

console.log("=== Step 3: Transfer PurrFluid Tokens ===");
console.log("transferLogicRewardAddr:", transferLogicRewardAddr);
console.log("senderSmartAddr:        ", senderSmartAddr);
console.log("recipientSmartAddr:     ", recipientSmartAddr);
console.log("whitelistSpendAddr:     ", whitelistSpendAddr);
// ─────────────────────────────────────────────────────────────────────────────
// Find registry node for this token
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n=== Registry ===");
const registryUtxos =
  await blockchainProvider.fetchAddressUTxOs(registrySpendAddr);
let registryNodeUtxo: (typeof registryUtxos)[0] | null = null;

for (const utxo of registryUtxos) {
  if (!utxo.output.plutusData) continue;
  try {
    const datum = deserializeDatum(utxo.output.plutusData);
    if ((datum?.fields?.[0]?.bytes ?? "") === TOKEN_POLICY_ID) {
      registryNodeUtxo = utxo;
      console.log(
        `✅ Registry node: ${utxo.input.txHash}#${utxo.input.outputIndex}`
      );
      break;
    }
  } catch {
    continue;
  }
}

if (!registryNodeUtxo)
  throw new Error(`Registry node not found for policy: ${TOKEN_POLICY_ID}`);

const registryDatum = deserializeDatum(registryNodeUtxo.output.plutusData!);
const registryTransferHash =
  registryDatum?.fields?.[2]?.fields?.[0]?.bytes ?? "";
const registryThirdPartyHash =
  registryDatum?.fields?.[3]?.fields?.[0]?.bytes ?? "";

console.log("Registry transfer hash:   ", registryTransferHash);
console.log("Registry third-party hash:", registryThirdPartyHash);
console.log("Local transfer hash:      ", transferLogicHash);

if (registryTransferHash && registryTransferHash !== transferLogicHash) {
  throw new Error(
    `Config mismatch: registry transfer hash is ${registryTransferHash}, but local transferLogicHash is ${transferLogicHash}. ` +
      `Use the same whitelist policy that was active when this token was registered, or re-register a fresh token entry with the new transfer logic.`
  );
}

// Find live protocol params UTxO instead of using a stale hardcoded reference
const protocolParamsUnit =
  protocolParamsPolicyId + stringToHex("ProtocolParams");
const protocolParamsAddresses =
  await blockchainProvider.fetchAssetAddresses(protocolParamsUnit);
if (!protocolParamsAddresses.length) {
  throw new Error(
    `ProtocolParams asset not found on chain. Unit: ${protocolParamsUnit}`
  );
}
const protocolParamsAddressUtxos = await blockchainProvider.fetchAddressUTxOs(
  protocolParamsAddresses[0].address
);
const protocolParamsUtxo = protocolParamsAddressUtxos.find((u) =>
  u.output.amount.some((a) => a.unit === protocolParamsUnit)
);
if (!protocolParamsUtxo) throw new Error("ProtocolParams UTxO not found");

// ─────────────────────────────────────────────────────────────────────────────
// Select UTxOs from sender smart wallet
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n=== Smart Wallet UTxOs ===");
const smartWalletUtxos =
  await blockchainProvider.fetchAddressUTxOs(senderSmartAddr);
if (!smartWalletUtxos.length)
  throw new Error(`No UTxOs at sender smart wallet: ${senderSmartAddr}`);

const sendAmountBN = BigInt(SEND_AMOUNT);
let selectedUtxos: typeof smartWalletUtxos = [];
let selectedBalance = BigInt(0);

for (const utxo of smartWalletUtxos) {
  const qty = utxo.output.amount.find((a) => a.unit === tokenUnit)?.quantity;
  if (!qty) continue;
  selectedUtxos.push(utxo);
  selectedBalance += BigInt(qty);
  if (selectedBalance >= sendAmountBN) break;
}

if (selectedBalance < sendAmountBN)
  throw new Error(
    `Insufficient balance. Have ${selectedBalance}, need ${sendAmountBN}`
  );

const changeAmount = selectedBalance - sendAmountBN;
console.log(
  `Selected ${selectedUtxos.length} UTxO(s), balance=${selectedBalance}, change=${changeAmount}`
);

// ─────────────────────────────────────────────────────────────────────────────
// Find whitelist membership proofs for all programmable inputs and outputs
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n=== Whitelist Proofs ===");
const whitelistUtxos =
  await blockchainProvider.fetchAddressUTxOs(whitelistSpendAddr);
console.log(`Found ${whitelistUtxos.length} whitelist node(s)`);

const proofKeys = [
  ...selectedUtxos.map(() => wallet1VK),
  RECIPIENT_STAKE_KEY,
  ...(changeAmount > BigInt(0) ? [wallet1VK] : []),
];

type ProofEntry = {
  key: string;
  whitelistUtxo: (typeof whitelistUtxos)[0];
};

const proofs: ProofEntry[] = [];

for (const keyHash of proofKeys) {
  const membershipNode = whitelistUtxos.find((wlUtxo) => {
    if (!wlUtxo.output.plutusData) return false;
    try {
      const hasWhitelistToken = wlUtxo.output.amount.some(
        (a) => a.unit === whitelistPolicyId + keyHash && a.quantity === "1"
      );
      if (!hasWhitelistToken) return false;

      const datum = deserializeDatum(wlUtxo.output.plutusData);
      const key = datum?.fields?.[0]?.bytes ?? "";
      return key === keyHash;
    } catch {
      return false;
    }
  });

  if (!membershipNode)
    throw new Error(
      `No whitelist membership node for key hash: ${keyHash}\n` +
        `whitelistSpendAddr: ${whitelistSpendAddr}`
    );

  proofs.push({ key: keyHash, whitelistUtxo: membershipNode });
  console.log(
    `Proof node for ${keyHash}: ${membershipNode.input.txHash.slice(0, 8)}...#${membershipNode.input.outputIndex}`
  );
}

// Deduplicate whitelist nodes
const uniqueWhitelistUtxos: typeof whitelistUtxos = [];
const seen = new Set<string>();
for (const p of proofs) {
  const k = `${p.whitelistUtxo.input.txHash}#${p.whitelistUtxo.input.outputIndex}`;
  if (!seen.has(k)) {
    seen.add(k);
    uniqueWhitelistUtxos.push(p.whitelistUtxo);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sort all reference inputs — order matters for on-chain index lookups
// ─────────────────────────────────────────────────────────────────────────────

type RefEntry = { txHash: string; outputIndex: number; label: string };

const allRefInputs: RefEntry[] = [
  ...uniqueWhitelistUtxos.map((u) => ({
    txHash: u.input.txHash,
    outputIndex: u.input.outputIndex,
    label: "whitelistNode",
  })),
  {
    txHash: protocolParamsUtxo.input.txHash,
    outputIndex: protocolParamsUtxo.input.outputIndex,
    label: "protocolParams",
  },
  {
    txHash: registryNodeUtxo.input.txHash,
    outputIndex: registryNodeUtxo.input.outputIndex,
    label: "registryNode",
  },
];

const sortedRefs = [...allRefInputs].sort((a, b) => {
  const cmp = a.txHash.toLowerCase().localeCompare(b.txHash.toLowerCase());
  return cmp !== 0 ? cmp : a.outputIndex - b.outputIndex;
});

console.log("\n=== Reference Inputs (sorted) ===");
sortedRefs.forEach((r, i) =>
  console.log(`  [${i}] ${r.label}: ${r.txHash}#${r.outputIndex}`)
);

const registryIndex = sortedRefs.findIndex(
  (r) =>
    r.txHash === registryNodeUtxo!.input.txHash &&
    r.outputIndex === registryNodeUtxo!.input.outputIndex
);
const proofIndices = proofs.map((p) =>
  sortedRefs.findIndex(
    (r) =>
      r.txHash === p.whitelistUtxo.input.txHash &&
      r.outputIndex === p.whitelistUtxo.input.outputIndex
  )
);

// ─────────────────────────────────────────────────────────────────────────────
// Redeemers
// programmable_logic_base:   conStr0([])
// programmable_logic_global: TransferAct { proofs: [RegistryProof(registryIndex)] }
// purrfluid_transfer:        List<WhitelistProof.WhitelistMembership { node_idx }>
// ─────────────────────────────────────────────────────────────────────────────

const baseRedeemer = conStr0([]);
const globalRedeemer = conStr0([
  list([conStr0([integer(registryIndex)])]), // proofs
]);
const transferRedeemer = list(
  proofIndices.map((idx) => conStr(0, [integer(idx)]))
);

console.log("\n=== Redeemers ===");
console.log("Base:    ", JSON.stringify(baseRedeemer));
console.log("Global:  ", JSON.stringify(globalRedeemer));
console.log("Transfer:", JSON.stringify(transferRedeemer));

// ─────────────────────────────────────────────────────────────────────────────
// Build transaction
// ─────────────────────────────────────────────────────────────────────────────

const walletUtxos = await wallet1.getUtxos();
const walletAddress = await wallet1.getChangeAddress();

console.log("\n=== Building Transaction ===");

const txBuilder = new MeshTxBuilder({
  fetcher: blockchainProvider,
  evaluator: blockchainProvider,
  submitter: blockchainProvider,
  verbose: true,
});

// Spend each smart wallet UTxO via programmable_logic_base (ref script)
for (const utxo of selectedUtxos) {
  txBuilder
    .spendingPlutusScriptV3()
    .txIn(utxo.input.txHash, utxo.input.outputIndex)
    .txInInlineDatumPresent()
    .txInScript(baseCbor)
    .txInRedeemerValue(baseRedeemer, "JSON");
}

// Reference inputs (sorted — whitelist proofs, protocol params, registry node)
for (const ref of sortedRefs) {
  txBuilder.readOnlyTxInReference(ref.txHash, ref.outputIndex);
}

// Recipient output
txBuilder
  .txOut(recipientSmartAddr, [
    { unit: "lovelace", quantity: "2000000" },
    { unit: tokenUnit, quantity: SEND_AMOUNT },
  ])
  .txOutInlineDatumValue(conStr0([]), "JSON");

// Change back to sender (if any)
if (changeAmount > BigInt(0)) {
  txBuilder
    .txOut(senderSmartAddr, [
      { unit: "lovelace", quantity: "2000000" },
      { unit: tokenUnit, quantity: changeAmount.toString() },
    ])
    .txOutInlineDatumValue(conStr0([]), "JSON");
}

// programmable_logic_global withdrawal (ref script)
txBuilder
  .withdrawalPlutusScriptV3()
  .withdrawal(globalRewardAddr, "0")
  .withdrawalScript(globalCbor)
  .withdrawalRedeemerValue(globalRedeemer, "JSON");

// purrfluid_transfer withdrawal (inline script)
txBuilder
  .withdrawalPlutusScriptV3()
  .withdrawal(transferLogicRewardAddr, "0")
  .withdrawalScript(transferLogicCbor)
  .withdrawalRedeemerValue(transferRedeemer, "JSON");

txBuilder
  .requiredSignerHash(wallet1VK)
  .txInCollateral(
    wallet1Collateral.input.txHash,
    wallet1Collateral.input.outputIndex
  )
  .selectUtxosFrom(walletUtxos)
  .changeAddress(walletAddress);

console.log("Completing transaction...");
txBuilder.setNetwork(NETWORK_ID === 0 ? "preview" : "mainnet");
await txBuilder.complete();

const signedTx = await wallet1.signTx(txBuilder.txHex, false);
const txHash = await wallet1.submitTx(signedTx);

console.log("\n================================");
console.log("✅ Transfer complete!");
console.log("================================");
console.log("TX Hash:", txHash);
console.log("Amount: ", SEND_AMOUNT, "PurrFluid");
console.log("From:   ", senderSmartAddr);
console.log("To:     ", recipientSmartAddr);
