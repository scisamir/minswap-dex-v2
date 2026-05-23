/**
 * deployBaseProtocol.ts
 *
 * Bootstraps a fresh CIP-113 base deployment from the current
 * cip113-programmable-tokens/plutus.json.
 *
 * Run from e2e-cip113. This submits two transactions:
 * 1. bootstrap protocol state
 * 2. save base/global reference scripts
 *
 * Then it rewrites purrfluid/protocolBoostrap.json with the new on-chain hashes.
 */

import { writeFileSync } from "node:fs";

import {
  BlockfrostProvider,
  MeshTxBuilder,
  applyParamsToScript,
  byteString,
  conStr0,
  conStr1,
  integer,
  resolveScriptHash,
  serializeAddressObj,
  serializePlutusScript,
  scriptAddress,
  stringToHex,
  type PlutusScript,
} from "@meshsdk/core";
import { DEFAULT_V3_COST_MODEL_LIST } from "@meshsdk/common";

import {
  blockchainProvider,
  wallet1,
  wallet1VK,
  wallet1Collateral,
  NETWORK_ID,
} from "../setup.js";

const { default: baseBlueprint } = await import(
  "../../cip113-programmable-tokens/plutus.json",
  { with: { type: "json" } }
);

const blockfrostId = process.env.BLOCKFROST_ID;
const txProvider = blockfrostId
  ? new BlockfrostProvider(blockfrostId)
  : blockchainProvider;

const getBaseValidator = (title: string): string => {
  const validator = (baseBlueprint.validators as any[]).find(
    (v) => v.title === title
  );
  if (!validator) throw new Error(`Base validator not found: ${title}`);
  return validator.compiledCode as string;
};

const submitTx = async (label: string, signedTx: string): Promise<string> => {
  try {
    return await txProvider.submitTx(signedTx);
  } catch (error) {
    console.error(`${label} submit failed:`, error);
    throw error;
  }
};

const useLivePlutusV3CostModel = async () => {
  if (!blockfrostId) return;

  const network = blockfrostId.slice(0, 7);
  const response = await fetch(
    `https://cardano-${network}.blockfrost.io/api/v0/epochs/latest/parameters`,
    { headers: { project_id: blockfrostId } }
  );
  if (!response.ok) {
    throw new Error(
      `Could not fetch current protocol params from Blockfrost: ${response.status}`
    );
  }

  const params = (await response.json()) as {
    cost_models?: { PlutusV3?: Record<string, number> };
  };
  const plutusV3CostModel = params.cost_models?.PlutusV3;
  if (!plutusV3CostModel) {
    throw new Error("Blockfrost protocol params did not include PlutusV3 cost model");
  }

  const values = Object.values(plutusV3CostModel).map(Number);
  DEFAULT_V3_COST_MODEL_LIST.splice(
    0,
    DEFAULT_V3_COST_MODEL_LIST.length,
    ...values
  );
  console.log("PlutusV3 cost model:   ", `${values.length} params`);
};

const outputReference = (txHash: string, outputIndex: number) =>
  conStr0([byteString(txHash), integer(outputIndex)]);

const scriptCredential = (hash: string) => conStr1([byteString(hash)]);

const stripCborBytestringHeader = (hex: string): string => {
  const first = parseInt(hex.slice(0, 2), 16);
  if (first >= 0x40 && first <= 0x57) return hex.slice(2);
  if (first === 0x58) return hex.slice(4);
  if (first === 0x59) return hex.slice(6);
  if (first === 0x5a) return hex.slice(10);
  throw new Error(
    `Unexpected CBOR bytestring header: 0x${first.toString(16)}`
  );
};

const deriveIssuanceTemplate = () => {
  const issuanceCompiled = getBaseValidator(
    "issuance_mint.issuance_mint.mint"
  );
  const hashA = "11".repeat(28);
  const hashB = "22".repeat(28);

  const scriptA = stripCborBytestringHeader(
    applyParamsToScript(
      issuanceCompiled,
      [
        scriptCredential(hashA),
        byteString(hashA),
        scriptCredential(hashA),
        scriptCredential(hashA),
      ],
      "JSON"
    )
  );
  const scriptB = stripCborBytestringHeader(
    applyParamsToScript(
      issuanceCompiled,
      [
        scriptCredential(hashB),
        byteString(hashB),
        scriptCredential(hashB),
        scriptCredential(hashB),
      ],
      "JSON"
    )
  );

  if (scriptA.length !== scriptB.length) {
    throw new Error("Dummy issuance_mint scripts have different lengths");
  }

  let prefixLength = 0;
  while (
    prefixLength + 2 <= scriptA.length &&
    scriptA.slice(prefixLength, prefixLength + 2) ===
      scriptB.slice(prefixLength, prefixLength + 2)
  ) {
    prefixLength += 2;
  }

  let suffixLength = 0;
  while (
    suffixLength + 2 <= scriptA.length - prefixLength &&
    scriptA.slice(
      scriptA.length - suffixLength - 2,
      scriptA.length - suffixLength
    ) ===
      scriptB.slice(
        scriptB.length - suffixLength - 2,
        scriptB.length - suffixLength
      )
  ) {
    suffixLength += 2;
  }

  const postfixStart = scriptA.length - suffixLength;
  if (prefixLength === 0 || suffixLength === 0) {
    throw new Error("Could not derive issuance_mint prefix/postfix");
  }

  return {
    prefix: scriptA.slice(0, prefixLength),
    postfix: scriptA.slice(postfixStart),
  };
};

const SENTINEL =
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

const walletUtxos = await wallet1.getUtxos();
const walletAddress = await wallet1.getChangeAddress();
await useLivePlutusV3CostModel();

const selectableWalletUtxos = walletUtxos.filter(
  (utxo) =>
    utxo.input.txHash !== wallet1Collateral.input.txHash ||
    utxo.input.outputIndex !== wallet1Collateral.input.outputIndex
);

const seedUtxo = selectableWalletUtxos
  .filter((utxo) => utxo.output.amount.length === 1)
  .sort((a, b) => {
    const aLovelace = BigInt(a.output.amount[0]?.quantity ?? "0");
    const bLovelace = BigInt(b.output.amount[0]?.quantity ?? "0");
    return aLovelace === bLovelace ? 0 : aLovelace > bLovelace ? -1 : 1;
  })[0];

if (!seedUtxo) throw new Error("No pure ADA seed UTxO found in wallet1");

const seedTxHash = seedUtxo.input.txHash;
const seedTxIndex = seedUtxo.input.outputIndex;
const seedRef = outputReference(seedTxHash, seedTxIndex);

const alwaysFailCbor = applyParamsToScript(
  getBaseValidator("always_fail.always_fail.spend"),
  [byteString(seedTxHash)],
  "JSON"
);
const alwaysFailHash = resolveScriptHash(alwaysFailCbor, "V3");
const alwaysFailAddr = serializePlutusScript(
  { code: alwaysFailCbor, version: "V3" } as PlutusScript,
  undefined,
  NETWORK_ID,
  false
).address;

const protocolParamsMintCbor = applyParamsToScript(
  getBaseValidator("protocol_params_mint.protocol_params_mint.mint"),
  [seedRef, byteString(alwaysFailHash)],
  "JSON"
);
const protocolParamsPolicyId = resolveScriptHash(protocolParamsMintCbor, "V3");

const issuanceCborHexMintCbor = applyParamsToScript(
  getBaseValidator("issuance_cbor_hex_mint.issuance_cbor_hex_mint.mint"),
  [seedRef, byteString(alwaysFailHash)],
  "JSON"
);
const issuanceCborHexPolicyId = resolveScriptHash(
  issuanceCborHexMintCbor,
  "V3"
);

const globalCbor = applyParamsToScript(
  getBaseValidator(
    "programmable_logic_global.programmable_logic_global.withdraw"
  ),
  [byteString(protocolParamsPolicyId)],
  "JSON"
);
const globalHash = resolveScriptHash(globalCbor, "V3");

const baseCbor = applyParamsToScript(
  getBaseValidator("programmable_logic_base.programmable_logic_base.spend"),
  [scriptCredential(globalHash)],
  "JSON"
);
const baseHash = resolveScriptHash(baseCbor, "V3");

const registrySpendCbor = applyParamsToScript(
  getBaseValidator("registry_spend.registry_spend.spend"),
  [byteString(protocolParamsPolicyId)],
  "JSON"
);
const registrySpendHash = resolveScriptHash(registrySpendCbor, "V3");
const registrySpendAddr = serializeAddressObj(
  scriptAddress(registrySpendHash),
  NETWORK_ID
);

const registryMintCbor = applyParamsToScript(
  getBaseValidator("registry_mint.registry_mint.mint"),
  [
    seedRef,
    byteString(issuanceCborHexPolicyId),
    scriptCredential(registrySpendHash),
  ],
  "JSON"
);
const registryMintPolicyId = resolveScriptHash(registryMintCbor, "V3");

const issuanceTemplate = deriveIssuanceTemplate();

const protocolParamsDatum = conStr0([
  byteString(registryMintPolicyId),
  scriptCredential(baseHash),
]);

const issuanceCborHexDatum = conStr0([
  byteString(issuanceTemplate.prefix),
  byteString(issuanceTemplate.postfix),
]);

const originRegistryDatum = conStr0([
  byteString(""),
  byteString(SENTINEL),
  conStr0([byteString("")]),
  conStr0([byteString("")]),
  byteString(""),
]);

console.log("=== Deploy CIP-113 Base Protocol ===");
console.log("Seed UTxO:              ", `${seedTxHash}#${seedTxIndex}`);
console.log("alwaysFailHash:         ", alwaysFailHash);
console.log("protocolParamsPolicyId: ", protocolParamsPolicyId);
console.log("issuanceCborHexPolicyId:", issuanceCborHexPolicyId);
console.log("globalHash:             ", globalHash);
console.log("baseHash:               ", baseHash);
console.log("registryMintPolicyId:   ", registryMintPolicyId);
console.log("registrySpendHash:      ", registrySpendHash);
console.log("registrySpendAddr:      ", registrySpendAddr);
console.log("issuance prefix bytes:  ", issuanceTemplate.prefix.length / 2);
console.log("issuance postfix bytes: ", issuanceTemplate.postfix.length / 2);
console.log(
  "txProvider:             ",
  blockfrostId ? "Blockfrost" : "Maestro"
);

const bootstrapTxBuilder = new MeshTxBuilder({
  fetcher: txProvider,
  evaluator: txProvider,
  submitter: txProvider,
  verbose: true,
});

bootstrapTxBuilder
  .txIn(seedTxHash, seedTxIndex)

  .mintPlutusScriptV3()
  .mint("1", protocolParamsPolicyId, stringToHex("ProtocolParams"))
  .mintingScript(protocolParamsMintCbor)
  .mintRedeemerValue(conStr0([]), "JSON")

  .mintPlutusScriptV3()
  .mint("1", issuanceCborHexPolicyId, stringToHex("IssuanceCborHex"))
  .mintingScript(issuanceCborHexMintCbor)
  .mintRedeemerValue(conStr0([]), "JSON")

  .mintPlutusScriptV3()
  .mint("1", registryMintPolicyId, "")
  .mintingScript(registryMintCbor)
  .mintRedeemerValue(conStr0([]), "JSON")

  .txOut(alwaysFailAddr, [
    { unit: "lovelace", quantity: "3000000" },
    {
      unit: protocolParamsPolicyId + stringToHex("ProtocolParams"),
      quantity: "1",
    },
  ])
  .txOutInlineDatumValue(protocolParamsDatum, "JSON")

  .txOut(alwaysFailAddr, [
    { unit: "lovelace", quantity: "20000000" },
    {
      unit: issuanceCborHexPolicyId + stringToHex("IssuanceCborHex"),
      quantity: "1",
    },
  ])
  .txOutInlineDatumValue(issuanceCborHexDatum, "JSON")

  .txOut(registrySpendAddr, [
    { unit: "lovelace", quantity: "3000000" },
    { unit: registryMintPolicyId, quantity: "1" },
  ])
  .txOutInlineDatumValue(originRegistryDatum, "JSON")

  .txInCollateral(
    wallet1Collateral.input.txHash,
    wallet1Collateral.input.outputIndex
  )
  .selectUtxosFrom(selectableWalletUtxos)
  .changeAddress(walletAddress)
  .requiredSignerHash(wallet1VK)
  .setNetwork(NETWORK_ID === 0 ? "preview" : "mainnet");

console.log("\nCompleting bootstrap transaction...");
await bootstrapTxBuilder.complete();

const usedBootstrapInputs = new Set(
  (
    (bootstrapTxBuilder as any).meshTxBuilderBody.inputs as Array<{
      txIn: { txHash: string; txIndex: number };
    }>
  ).map((input) => `${input.txIn.txHash}#${input.txIn.txIndex}`)
);
const refScriptWalletUtxos = selectableWalletUtxos.filter(
  (utxo) =>
    !usedBootstrapInputs.has(`${utxo.input.txHash}#${utxo.input.outputIndex}`)
);

if (refScriptWalletUtxos.length === 0) {
  throw new Error(
    "Bootstrap transaction used every available wallet UTxO. Fund wallet1 or wait for change before saving reference scripts."
  );
}

const signedBootstrapTx = await wallet1.signTx(bootstrapTxBuilder.txHex, true);
const bootstrapTxHash = await submitTx("Bootstrap", signedBootstrapTx);

console.log("Bootstrap tx submitted: ", bootstrapTxHash);

const refScriptTxBuilder = new MeshTxBuilder({
  fetcher: txProvider,
  evaluator: txProvider,
  submitter: txProvider,
  verbose: true,
});

refScriptTxBuilder
  .txOut(alwaysFailAddr, [])
  .txOutReferenceScript(baseCbor, "V3")

  .txOut(alwaysFailAddr, [])
  .txOutReferenceScript(globalCbor, "V3")

  .txInCollateral(
    wallet1Collateral.input.txHash,
    wallet1Collateral.input.outputIndex
  )
  .selectUtxosFrom(refScriptWalletUtxos)
  .changeAddress(walletAddress)
  .requiredSignerHash(wallet1VK)
  .setNetwork(NETWORK_ID === 0 ? "preview" : "mainnet");

console.log("\nCompleting reference-script transaction...");
await refScriptTxBuilder.complete();

const signedRefScriptTx = await wallet1.signTx(refScriptTxBuilder.txHex, true);
const refScriptTxHash = await submitTx("Reference-script", signedRefScriptTx);

const protocolBootstrap = {
  protocolParams: {
    txInput: { txHash: seedTxHash, outputIndex: seedTxIndex },
    scriptHash: protocolParamsPolicyId,
  },
  programmableLogicGlobalPrams: {
    protocolParamsScriptHash: protocolParamsPolicyId,
    scriptHash: globalHash,
  },
  programmableLogicBaseParams: {
    programmableLogicGlobalScriptHash: globalHash,
    scriptHash: baseHash,
  },
  issuanceParams: {
    txInput: { txHash: seedTxHash, outputIndex: seedTxIndex },
    scriptHash: issuanceCborHexPolicyId,
  },
  directoryMintParams: {
    txInput: { txHash: seedTxHash, outputIndex: seedTxIndex },
    issuanceScriptHash: issuanceCborHexPolicyId,
    registrySpendScriptHash: registrySpendHash,
    scriptHash: registryMintPolicyId,
  },
  directorySpendParams: {
    protocolParamsPolicyId,
    scriptHash: registrySpendHash,
  },
  programmableBaseRefInput: {
    txHash: refScriptTxHash,
    outputIndex: 0,
  },
  programmableGlobalRefInput: {
    txHash: refScriptTxHash,
    outputIndex: 1,
  },
  bootstrapTxHash,
  txHash: refScriptTxHash,
};

writeFileSync(
  "purrfluid/protocolBoostrap.json",
  `${JSON.stringify(protocolBootstrap, null, 2)}\n`
);

console.log("\n================================");
console.log("CIP-113 base protocol deployed");
console.log("================================");
console.log("Bootstrap TX Hash:      ", bootstrapTxHash);
console.log("Reference TX Hash:      ", refScriptTxHash);
console.log("protocolBoostrap.json updated");
console.log("\nNext: recompile and run config validateConfig().");
