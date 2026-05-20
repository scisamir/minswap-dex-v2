/**
 * registerStake.ts — Step 1b
 *
 * Registers the stake credentials for:
 *   1. freeze_and_seize_transfer (transferLogic) — needed for transfers
 *   2. example_transfer_logic (adminContract) — needed for minting + registration
 *
 * Must be run ONCE after deployBlacklist.ts (Step 1) and before mintTokens.ts (Step 2).
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
// .registerStakeCertificate(adminContractRewardAddr);

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
console.log("\nNow run mintTokens.ts (Step 2)");
