/**
 * resumeBaseProtocolRefs.ts
 *
 * Resumes purrfluid/deployBaseProtocol.ts after the bootstrap transaction
 * succeeded but the reference-script transaction failed.
 *
 * Run from e2e-cip113 after the bootstrap tx is confirmed.
 */

import { writeFileSync } from "node:fs";

import {
  BlockfrostProvider,
  MeshWallet,
  MeshTxBuilder,
  applyParamsToScript,
  byteString,
  conStr1,
  deserializeAddress,
  resolveScriptHash,
  serializePlutusScript,
  type PlutusScript,
  type UTxO,
} from "@meshsdk/core";
import dotenv from "dotenv";
import { NETWORK, NETWORK_ID, PROTOCOL_BOOTSTRAP_FILE_NAME } from "../network.js";

dotenv.config();

const { default: baseBlueprint } = await import(
  "../../cip113-programmable-tokens/plutus.json",
  { with: { type: "json" } }
);
const { default: savedProtocolBootstrap } = await import(
  `./${PROTOCOL_BOOTSTRAP_FILE_NAME}`,
  { with: { type: "json" } }
);

const blockfrostId = process.env.BLOCKFROST_ID;
if (!blockfrostId) {
  throw new Error("BLOCKFROST_ID does not exist");
}
const txProvider = new BlockfrostProvider(blockfrostId);

const wallet1Passphrase = process.env.WALLET_PASSPHRASE_ONE;
if (!wallet1Passphrase) {
  throw new Error("WALLET_PASSPHRASE_ONE does not exist");
}
const wallet1 = new MeshWallet({
  networkId: NETWORK_ID,
  fetcher: txProvider,
  submitter: txProvider,
  key: {
    type: "mnemonic",
    words: wallet1Passphrase.split(" "),
  },
});

const wallet1Address = await wallet1.getChangeAddress();
const { pubKeyHash: wallet1VK } = deserializeAddress(wallet1Address);
const wallet1Utxos = await wallet1.getUtxos();
const wallet1Collateral: UTxO = wallet1Utxos.filter(
  (utxo) =>
    Number(utxo.output.amount[0].quantity) >= 7000000 &&
    utxo.output.amount.length === 1
)[0];
if (!wallet1Collateral) {
  throw new Error("No collateral utxo found for wallet1");
}

const savedBootstrap = savedProtocolBootstrap as any;
const expectedAlwaysFailHash = savedBootstrap.alwaysFailHash as string | undefined;
const bootstrap = {
  seedTxHash: savedBootstrap.protocolParams.txInput.txHash,
  seedTxIndex: savedBootstrap.protocolParams.txInput.outputIndex,
  bootstrapTxHash: savedBootstrap.bootstrapTxHash,
  protocolParamsPolicyId: savedBootstrap.protocolParams.scriptHash,
  issuanceCborHexPolicyId: savedBootstrap.issuanceParams.scriptHash,
  globalHash: savedBootstrap.programmableLogicGlobalPrams.scriptHash,
  baseHash: savedBootstrap.programmableLogicBaseParams.scriptHash,
  registryMintPolicyId: savedBootstrap.directoryMintParams.scriptHash,
  registrySpendHash: savedBootstrap.directorySpendParams.scriptHash,
};

const getBaseValidator = (title: string): string => {
  const validator = (baseBlueprint.validators as any[]).find(
    (v) => v.title === title
  );
  if (!validator) throw new Error(`Base validator not found: ${title}`);
  return validator.compiledCode as string;
};

const scriptCredential = (hash: string) => conStr1([byteString(hash)]);

const assertHash = (label: string, actual: string, expected: string) => {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: derived ${actual}, expected ${expected}`);
  }
};

const alwaysFailCbor = applyParamsToScript(
  getBaseValidator("always_fail.always_fail.spend"),
  [byteString(bootstrap.seedTxHash)],
  "JSON"
);
const alwaysFailHash = resolveScriptHash(alwaysFailCbor, "V3");
if (expectedAlwaysFailHash) {
  assertHash("alwaysFailHash", alwaysFailHash, expectedAlwaysFailHash);
}

const alwaysFailAddr = serializePlutusScript(
  { code: alwaysFailCbor, version: "V3" } as PlutusScript,
  undefined,
  NETWORK_ID,
  false
).address;

const globalCbor = applyParamsToScript(
  getBaseValidator("programmable_logic_global.programmable_logic_global.withdraw"),
  [byteString(bootstrap.protocolParamsPolicyId)],
  "JSON"
);
const globalHash = resolveScriptHash(globalCbor, "V3");
assertHash("globalHash", globalHash, bootstrap.globalHash);

const baseCbor = applyParamsToScript(
  getBaseValidator("programmable_logic_base.programmable_logic_base.spend"),
  [scriptCredential(bootstrap.globalHash)],
  "JSON"
);
const baseHash = resolveScriptHash(baseCbor, "V3");
assertHash("baseHash", baseHash, bootstrap.baseHash);

const walletUtxos = wallet1Utxos;
const walletAddress = await wallet1.getChangeAddress();

const selectableWalletUtxos = walletUtxos.filter((utxo) => {
  const isCollateral =
    utxo.input.txHash === wallet1Collateral.input.txHash &&
    utxo.input.outputIndex === wallet1Collateral.input.outputIndex;
  const isSpentSeed =
    utxo.input.txHash === bootstrap.seedTxHash &&
    utxo.input.outputIndex === bootstrap.seedTxIndex;
  return !isCollateral && !isSpentSeed;
});

const selectableLovelace = selectableWalletUtxos.reduce(
  (total, utxo) =>
    total +
    BigInt(
      utxo.output.amount.find((asset) => asset.unit === "lovelace")?.quantity ??
        "0"
    ),
  0n
);

console.log("=== Resume CIP-113 Base Reference Scripts ===");
console.log("Bootstrap tx hash: ", bootstrap.bootstrapTxHash);
console.log("alwaysFailAddr:    ", alwaysFailAddr);
console.log("baseHash:          ", baseHash);
console.log("globalHash:        ", globalHash);
console.log("available UTxOs:   ", selectableWalletUtxos.length);
console.log("available lovelace:", selectableLovelace.toString());

if (!selectableWalletUtxos.length) {
  throw new Error(
    "No selectable wallet UTxOs found. Wait for bootstrap change/funding to confirm."
  );
}

const txBuilder = new MeshTxBuilder({
  fetcher: txProvider,
  evaluator: txProvider,
  submitter: txProvider,
  verbose: true,
});

txBuilder
  .txOut(alwaysFailAddr, [])
  .txOutReferenceScript(baseCbor, "V3")

  .txOut(alwaysFailAddr, [])
  .txOutReferenceScript(globalCbor, "V3")

  .txInCollateral(
    wallet1Collateral.input.txHash,
    wallet1Collateral.input.outputIndex
  )
  .selectUtxosFrom(selectableWalletUtxos)
  .changeAddress(walletAddress)
  .requiredSignerHash(wallet1VK)
  .setNetwork(NETWORK);

console.log("\nCompleting reference-script transaction...");
await txBuilder.complete();

if (process.env.PURRFLUID_DRY_RUN === "1") {
  console.log("\nDry run complete - reference-script transaction built.");
  process.exit(0);
}

const signedTx = await wallet1.signTx(txBuilder.txHex, true);
const refScriptTxHash = await txProvider.submitTx(signedTx);

const protocolBootstrap = {
  protocolParams: {
    txInput: {
      txHash: bootstrap.seedTxHash,
      outputIndex: bootstrap.seedTxIndex,
    },
    scriptHash: bootstrap.protocolParamsPolicyId,
  },
  programmableLogicGlobalPrams: {
    protocolParamsScriptHash: bootstrap.protocolParamsPolicyId,
    scriptHash: bootstrap.globalHash,
  },
  programmableLogicBaseParams: {
    programmableLogicGlobalScriptHash: bootstrap.globalHash,
    scriptHash: bootstrap.baseHash,
  },
  issuanceParams: {
    txInput: {
      txHash: bootstrap.seedTxHash,
      outputIndex: bootstrap.seedTxIndex,
    },
    scriptHash: bootstrap.issuanceCborHexPolicyId,
  },
  directoryMintParams: {
    txInput: {
      txHash: bootstrap.seedTxHash,
      outputIndex: bootstrap.seedTxIndex,
    },
    issuanceScriptHash: bootstrap.issuanceCborHexPolicyId,
    registrySpendScriptHash: bootstrap.registrySpendHash,
    scriptHash: bootstrap.registryMintPolicyId,
  },
  directorySpendParams: {
    protocolParamsPolicyId: bootstrap.protocolParamsPolicyId,
    scriptHash: bootstrap.registrySpendHash,
  },
  programmableBaseRefInput: {
    txHash: refScriptTxHash,
    outputIndex: 0,
  },
  programmableGlobalRefInput: {
    txHash: refScriptTxHash,
    outputIndex: 1,
  },
  bootstrapTxHash: bootstrap.bootstrapTxHash,
  txHash: refScriptTxHash,
};

const protocolBootstrapPath = `purrfluid/${PROTOCOL_BOOTSTRAP_FILE_NAME}`;
writeFileSync(protocolBootstrapPath, `${JSON.stringify(protocolBootstrap, null, 2)}\n`);

console.log("\n================================");
console.log("Reference scripts deployed");
console.log("================================");
console.log("Reference TX Hash:", refScriptTxHash);
console.log(`${PROTOCOL_BOOTSTRAP_FILE_NAME} updated`);
