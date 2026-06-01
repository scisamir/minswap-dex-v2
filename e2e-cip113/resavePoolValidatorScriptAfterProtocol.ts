import {
  applyCborEncoding,
  MeshTxBuilder,
  resolveTxHash,
  serializePlutusScript,
  stringToHex,
} from "@meshsdk/core";

import {
  blockchainProvider,
  poolScriptTxHash,
  poolScriptTxIndex,
  poolValidatorScript,
  wallet1,
  wallet1Address,
  wallet1Collateral,
  wallet1Utxos,
} from "./setup.js";
import { NETWORK_ID, protocolParamsPolicyId } from "./purrfluid/config.js";

const refHolderScript = applyCborEncoding(
  "5857010100323232323225333002323232323253330073370e900118041baa00113233224a060160026016601800260126ea800458c024c02800cc020008c01c008c01c004c010dd50008a4c26cacae6955ceaab9e5742ae89"
);
const refHolderAddress = serializePlutusScript(
  {
    code: refHolderScript,
    version: "V3",
  },
  undefined,
  NETWORK_ID
).address;

const startNonce = Number(process.env.START_NONCE ?? "0");
const maxAttempts = Number(process.env.MAX_ATTEMPTS ?? "50");
const shouldSubmit = process.env.SUBMIT === "1";

const compareTxHash = (left: string, right: string) =>
  left.toLowerCase().localeCompare(right.toLowerCase());

const lovelaceOf = (utxo: (typeof wallet1Utxos)[number]) =>
  BigInt(
    utxo.output.amount.find((asset) => asset.unit === "lovelace")?.quantity ??
      "0"
  );

const isSameUtxo = (
  left: (typeof wallet1Utxos)[number],
  right: (typeof wallet1Utxos)[number]
) =>
  left.input.txHash === right.input.txHash &&
  left.input.outputIndex === right.input.outputIndex;

const oldPoolRefUtxo = (
  await blockchainProvider.fetchUTxOs(poolScriptTxHash, poolScriptTxIndex)
)[0];

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
const protocolParamsUtxo = protocolParamsAddressUtxos.find((utxo) =>
  utxo.output.amount.some((asset) => asset.unit === protocolParamsUnit)
);
if (!protocolParamsUtxo) {
  throw new Error("ProtocolParams UTxO not found");
}
const targetHash = protocolParamsUtxo.input.txHash.toLowerCase();

if (!oldPoolRefUtxo) {
  throw new Error(
    `Current pool ref-script UTxO not found: ${poolScriptTxHash}#${poolScriptTxIndex}`
  );
}

if (oldPoolRefUtxo.output.address !== refHolderAddress) {
  throw new Error(
    `Pool ref-script UTxO is not at the expected ref holder address: ${oldPoolRefUtxo.output.address}`
  );
}

const minFundingLovelace = BigInt(
  process.env.MIN_FUNDING_LOVELACE ?? "50000000"
);
const maxFundingInputs = Number(process.env.MAX_FUNDING_INPUTS ?? "6");

const spendableWalletUtxos = wallet1Utxos
  .filter(
    (utxo) =>
      utxo.output.address === wallet1Address &&
      !isSameUtxo(utxo, wallet1Collateral) &&
      !isSameUtxo(utxo, oldPoolRefUtxo)
  )
  .sort((a, b) => {
    const aLovelace = lovelaceOf(a);
    const bLovelace = lovelaceOf(b);
    if (aLovelace !== bLovelace) return aLovelace > bLovelace ? -1 : 1;
    return a.output.amount.length - b.output.amount.length;
  });

const feeUtxos: typeof wallet1Utxos = [];
let feeTotal = 0n;
for (const utxo of spendableWalletUtxos) {
  feeUtxos.push(utxo);
  feeTotal += lovelaceOf(utxo);
  if (
    feeTotal >= minFundingLovelace ||
    feeUtxos.length >= maxFundingInputs
  ) {
    break;
  }
}

console.log(
  "ProtocolParams UTxO:",
  `${protocolParamsUtxo.input.txHash}#${protocolParamsUtxo.input.outputIndex}`
);
console.log(
  "Old pool ref script:",
  `${oldPoolRefUtxo.input.txHash}#${oldPoolRefUtxo.input.outputIndex}`
);
console.log(
  "Fee UTxOs:",
  feeUtxos.map(
    (utxo) =>
      `${utxo.input.txHash}#${utxo.input.outputIndex}:${lovelaceOf(
        utxo
      )} assets=${utxo.output.amount.length}`
  )
);
console.log(
  "Fee UTxO total:",
  feeTotal.toString(),
  "target:",
  minFundingLovelace.toString()
);
if (feeTotal < minFundingLovelace) {
  console.warn(
    `Warning: selected funding UTxOs are below target. Increase MAX_FUNDING_INPUTS or add a larger wallet UTxO if selection still fails.`
  );
}
console.log("Submit:", shouldSubmit ? "yes" : "no");

for (let nonce = startNonce; nonce < startNonce + maxAttempts; nonce += 1) {
  const builder = new MeshTxBuilder({
    fetcher: blockchainProvider,
    submitter: blockchainProvider,
  });
  builder.setNetwork("mainnet");

  let tx = builder
    .txOut(refHolderAddress, [])
    .txOutReferenceScript(poolValidatorScript, "V3")
    .metadataValue(674, {
      purpose: "purrfluid_pool_ref_after_protocol",
      nonce,
    })
    .changeAddress(wallet1Address);

  for (const utxo of feeUtxos) {
    tx = tx.txIn(
      utxo.input.txHash,
      utxo.input.outputIndex,
      utxo.output.amount,
      utxo.output.address,
      utxo.output.scriptRef ? utxo.output.scriptRef.length / 2 : 0
    );
  }

  const unsignedTx = await tx
    .txInCollateral(
      wallet1Collateral.input.txHash,
      wallet1Collateral.input.outputIndex,
      wallet1Collateral.output.amount,
      wallet1Collateral.output.address
    )
    .complete();

  const txHash = resolveTxHash(unsignedTx);
  const isAfterProtocolParams = compareTxHash(txHash, targetHash) > 0;
  console.log(
    `nonce=${nonce} txHash=${txHash} ${
      isAfterProtocolParams ? "OK" : "too early"
    }`
  );

  if (!isAfterProtocolParams) continue;

  if (!shouldSubmit) {
    console.log("\nCandidate found but not submitted.");
    console.log(
      `To submit this exact nonce, run: SUBMIT=1 START_NONCE=${nonce} MAX_ATTEMPTS=1 node ./dist/e2e-cip113/resavePoolValidatorScriptAfterProtocol.js`
    );
    process.exit(0);
  }

  const signedTx = await wallet1.signTx(unsignedTx);
  const submittedTxHash = await wallet1.submitTx(signedTx);

  console.log("\nNew pool ref script submitted!");
  console.log("poolScriptTxHash:", submittedTxHash);
  console.log("poolScriptTxIndex:", 0);
  console.log(
    "\nUpdate setup.ts with these values, then rerun batching_buy_order.ts."
  );
  process.exit(0);
}

throw new Error(
  `No candidate tx hash after ProtocolParams found in ${maxAttempts} attempts. Increase MAX_ATTEMPTS.`
);
