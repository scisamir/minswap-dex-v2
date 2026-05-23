/**
 * registerStake.ts — Step 1b
 *
 * Registers the stake credentials for:
 *   1. purrfluid_transfer (transferLogic) — needed for transfers
 *   2. purrfluid_issuer (adminContract) — needed for token registration
 *
 * Must be run once after deployWhitelist.ts and before registerToken.ts.
 *
 * Cost: 2 ADA deposit per credential (refundable on deregistration)
 */

import { MeshTxBuilder } from "@meshsdk/core";

import { blockchainProvider, wallet1 } from "../setup.js";

import {
  transferLogicRewardAddr,
  adminContractRewardAddr,
  NETWORK_ID,
  validateConfig,
} from "./config.js";

validateConfig();

console.log("=== Step 1b: Register Stake Credentials ===");
console.log("transferLogicRewardAddr:", transferLogicRewardAddr);
console.log("adminContractRewardAddr:", adminContractRewardAddr);

const walletUtxos = await wallet1.getUtxos();
const walletAddress = await wallet1.getChangeAddress();

const txBuilder = new MeshTxBuilder({
  fetcher: blockchainProvider,
  evaluator: blockchainProvider,
  submitter: blockchainProvider,
});

txBuilder.registerStakeCertificate(transferLogicRewardAddr);
txBuilder.registerStakeCertificate(adminContractRewardAddr);

const unsignedTx = await txBuilder
  .selectUtxosFrom(walletUtxos)
  .changeAddress(walletAddress)
  .setNetwork(NETWORK_ID === 0 ? "preview" : "mainnet")
  .complete();

const signedTx = await wallet1.signTx(unsignedTx);
const txHash = await wallet1.submitTx(signedTx);

console.log("\n================================");
console.log("Stake credentials registered!");
console.log("================================");
console.log("TX Hash:", txHash);
console.log("\nNow run registerToken.ts (Step 2)");
