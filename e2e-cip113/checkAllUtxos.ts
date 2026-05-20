import { deserializeDatum } from "@meshsdk/core";
import { authenAddress, blockchainProvider, factoryAddress, orderValidatorAddress, poolValidatorAddress } from "./setup.js";

const poolUtxos = (await blockchainProvider.fetchAddressUTxOs(poolValidatorAddress));
const orderUtxos = await blockchainProvider.fetchAddressUTxOs(orderValidatorAddress);
const globalSettingsUtxo = (await blockchainProvider.fetchAddressUTxOs(authenAddress));
const factoryUtxos = await blockchainProvider.fetchAddressUTxOs(factoryAddress);

console.log("poolUtxos:", poolUtxos, '\n');
console.log("orderUtxos:", orderUtxos, '\n');
console.log("globalSettingsUtxo:", globalSettingsUtxo, '\n');
console.log("factoryUtxos:", factoryUtxos, '\n');
console.log("orderValidatorAddress:", orderValidatorAddress);
// console.log("poolUtxos:", poolUtxos[0].input.txHash, poolUtxos[0].input.outputIndex);
// console.log("poolUtxos:", poolUtxos[0].output.amount);

// console.log("first order utxo datum:", deserializeDatum(orderUtxos[0].output.plutusData!), '\n', orderUtxos[0].output.amount, '\n');
// console.log("second order utxo datum:", deserializeDatum(orderUtxos[1].output.plutusData!), '\n', orderUtxos[1].output.amount);
// console.log("fourth order utxo datum:", deserializeDatum(orderUtxos[3].output.plutusData!), '\n', orderUtxos[3].output.amount);
