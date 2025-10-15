import { deserializeDatum } from "@meshsdk/core";
import { blockchainProvider, poolValidatorAddress } from "../setup.js";

const poolUtxos = (await blockchainProvider.fetchAddressUTxOs(poolValidatorAddress));
const poolUtxo = poolUtxos[0];

const poolUtxoPlutusData = poolUtxo.output.plutusData;
if (!poolUtxoPlutusData) throw new Error('pool utxo lacks datum!');

const poolUtxoDatum = deserializeDatum(poolUtxoPlutusData);

let poolUtxoDatumString = '';

poolUtxoDatumString += poolUtxoDatum.fields[0];

console.log(poolUtxoDatumString);
