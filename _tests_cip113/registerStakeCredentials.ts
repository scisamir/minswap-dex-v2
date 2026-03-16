import {
  orderCanclValidatorRewardAddress,
  orderValidatorRewardAddress,
  poolBatchingValidatorRewardAddress,
  poolValidatorRewardAddress,
  txBuilder,
  wallet1,
  wallet1Address,
  wallet1Utxos,
} from "./setup.js";

// withdraw zero setup (register all stake cert) - Merged
const unsignedTx = await txBuilder
  // .txIn(
  //     wallet1Utxos[0].input.txHash,
  //     wallet1Utxos[0].input.outputIndex,
  //     wallet1Utxos[0].output.amount,
  //     wallet1Utxos[0].output.address,
  // )
  // .registerStakeCertificate(orderCanclValidatorRewardAddress)
  .registerStakeCertificate(orderValidatorRewardAddress)
  .registerStakeCertificate(poolValidatorRewardAddress)
  .registerStakeCertificate(poolBatchingValidatorRewardAddress)
  .selectUtxosFrom(wallet1Utxos)
  .changeAddress(wallet1Address)
  .complete();
const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);
console.log("register all stake certificate tx hash:", txHash);
