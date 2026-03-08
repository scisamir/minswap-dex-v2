import { maestroKey, maestroNetwork, protocolParamsPolicyId, registryPolicyId, registrySpendScriptHash, issuanceCborHexPolicyId, } from "@/config/mesh";
import { MaestroProvider, MeshTxBuilder, deserializeAddress, resolveScriptHash, serializeRewardAddress, serializePlutusScript, applyParamsToScript, byteString, conStr, conStr0, conStr1, deserializeDatum, integer, list, stringToHex, } from "@meshsdk/core";
import blueprint from "@/config/plutus.json";
import freezeBlueprint from "@/config/freeze-and-seize-plutus.json";
import javaFesBlueprint from "@/config/java-standard-fes.json";
import { FluidMeshError, FluidMeshErrorCode, FluidMeshSuccessCode, createSuccessResult, createErrorResult, } from "./errors";
import { getCollateral } from "@/lib/FluidMesh/utils";
// Blacklist sentinel constants
const BLACKLIST_HEAD_KEY = ""; // empty bytes = head sentinel
const BLACKLIST_TAIL_KEY = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"; // 28 bytes of ff = tail sentinel
/**
 * FluidMesh – CIP-113 v0.3.0 blockchain interactions
 *
 * Architecture:
 *  - Protocol layer (shared): programmable_logic_global + programmable_logic_base
 *  - Per-token layer (freeze-and-seize substandard):
 *      blacklist_mint, blacklist_spend, issuer_admin_contract, transfer.withdraw
 *  - Per-token minting policy: issuance_mint(progLogicBaseHash, adminContractHash)
 *  - Smart receiver address: payment=progLogicBase, staking=userStakeKeyHash
 */
class FluidMesh {
    blockchainProvider;
    networkId;
    constructor() {
        this.blockchainProvider = new MaestroProvider({
            network: maestroNetwork,
            apiKey: maestroKey,
        });
        this.networkId = maestroNetwork === "Preview" ? 0 : 1;
    }
    getProvider() {
        return this.blockchainProvider;
    }
    getNetworkId() {
        return this.networkId;
    }
    getTxBuilder() {
        return new MeshTxBuilder({
            fetcher: this.blockchainProvider,
            evaluator: this.blockchainProvider,
            submitter: this.blockchainProvider,
            verbose: true,
        });
    }
    // ─── Script helpers ────────────────────────────────────────────────────────
    findValidator(title) {
        const v = blueprint.validators.find((v) => v.title === title);
        if (!v)
            throw new Error(`Validator not found: ${title}`);
        return v.compiledCode;
    }
    findFreezeValidator(title) {
        const v = freezeBlueprint.validators.find((v) => v.title === title);
        if (!v)
            throw new Error(`Freeze validator not found: ${title}`);
        return v.compiledCode;
    }
    buildScriptData(cbor, withAddress = false, stakeKeyHash) {
        const policyHash = resolveScriptHash(cbor, "V3");
        const rewardAddress = serializeRewardAddress(policyHash, true, this.networkId);
        const script = { code: cbor, version: "V3" };
        const scriptAddr = serializePlutusScript(script, stakeKeyHash, this.networkId, false).address;
        return {
            scriptCbor: cbor,
            scriptAddr,
            policyHash,
            rewardAddress,
            ...(withAddress ? { address: scriptAddr } : {}),
        };
    }
    // ─── Protocol scripts (computed from protocolParamsPolicyId) ───────────────
    getProtocolScripts() {
        if (!protocolParamsPolicyId) {
            throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "NEXT_PUBLIC_PROTOCOL_PARAMS_POLICY_ID is not set");
        }
        // programmable_logic_global(protocol_params_cs)
        const globalCbor = applyParamsToScript(this.findValidator("programmable_logic_global.programmable_logic_global.withdraw"), 
        // scriptHash() encodes as a bare ByteArray (PolicyId) in Aiken
        [byteString(protocolParamsPolicyId)], "JSON");
        const globalHash = resolveScriptHash(globalCbor, "V3");
        const globalRewardAddr = serializeRewardAddress(globalHash, true, this.networkId);
        // programmable_logic_base(Script(globalHash))
        const baseCbor = applyParamsToScript(this.findValidator("programmable_logic_base.programmable_logic_base.spend"), [conStr1([byteString(globalHash)])], "JSON");
        const baseHash = resolveScriptHash(baseCbor, "V3");
        const baseScript = { code: baseCbor, version: "V3" };
        const baseAddr = serializePlutusScript(baseScript, undefined, this.networkId, false).address;
        return {
            programmableLogicGlobal: {
                scriptCbor: globalCbor,
                scriptAddr: "",
                policyHash: globalHash,
                rewardAddress: globalRewardAddr,
            },
            programmableLogicBase: {
                scriptCbor: baseCbor,
                scriptAddr: baseAddr,
                address: baseAddr,
                policyHash: baseHash,
                rewardAddress: "",
            },
        };
    }
    // ─── Freeze-and-seize substandard scripts ──────────────────────────────────
    getFreezeAndSeizeScripts(seedTxHash, seedTxIndex, adminPkh, progLogicBaseHash) {
        // blacklist_mint(utxo_ref, manager_pkh)
        const blacklistMintCbor = applyParamsToScript(this.findFreezeValidator("blacklist_mint.blacklist_mint.mint"), [
            conStr(0, [byteString(seedTxHash), integer(seedTxIndex)]),
            byteString(adminPkh),
        ], "JSON");
        const blacklistMintHash = resolveScriptHash(blacklistMintCbor, "V3");
        const blacklistMintRewardAddr = serializeRewardAddress(blacklistMintHash, true, this.networkId);
        // blacklist_spend(blacklist_cs)
        const blacklistSpendCbor = applyParamsToScript(this.findFreezeValidator("blacklist_spend.blacklist_spend.spend"), [byteString(blacklistMintHash)], "JSON");
        const blacklistSpendHash = resolveScriptHash(blacklistSpendCbor, "V3");
        const blacklistSpendScript = {
            code: blacklistSpendCbor,
            version: "V3",
        };
        const blacklistSpendAddr = serializePlutusScript(blacklistSpendScript, undefined, this.networkId, false).address;
        // issuer_admin_contract(VerificationKey(adminPkh))
        const adminContractCbor = applyParamsToScript(this.findFreezeValidator("example_transfer_logic.issuer_admin_contract.withdraw"), [conStr0([byteString(adminPkh)])], // VerificationKey(adminPkh)
        "JSON");
        const adminContractHash = resolveScriptHash(adminContractCbor, "V3");
        const adminContractRewardAddr = serializeRewardAddress(adminContractHash, true, this.networkId);
        // transfer.withdraw(Script(progLogicBaseHash), blacklistMintHash)
        const transferLogicCbor = applyParamsToScript(this.findFreezeValidator("example_transfer_logic.transfer.withdraw"), [
            conStr1([byteString(progLogicBaseHash)]), // Script(progLogicBaseHash)
            byteString(blacklistMintHash), // blacklist_node_cs
        ], "JSON");
        const transferLogicHash = resolveScriptHash(transferLogicCbor, "V3");
        const transferLogicRewardAddr = serializeRewardAddress(transferLogicHash, true, this.networkId);
        return {
            blacklistMint: {
                scriptCbor: blacklistMintCbor,
                scriptAddr: "",
                policyHash: blacklistMintHash,
                rewardAddress: blacklistMintRewardAddr,
            },
            blacklistSpend: {
                scriptCbor: blacklistSpendCbor,
                scriptAddr: blacklistSpendAddr,
                address: blacklistSpendAddr,
                policyHash: blacklistSpendHash,
                rewardAddress: "",
            },
            issuerAdminContract: {
                scriptCbor: adminContractCbor,
                scriptAddr: "",
                policyHash: adminContractHash,
                rewardAddress: adminContractRewardAddr,
            },
            transferLogic: {
                scriptCbor: transferLogicCbor,
                scriptAddr: "",
                policyHash: transferLogicHash,
                rewardAddress: transferLogicRewardAddr,
            },
        };
    }
    // ─── issuance_mint script ──────────────────────────────────────────────────
    getIssuanceMintScript(progLogicBaseHash, adminContractHash) {
        // issuance_mint(Script(progLogicBaseHash), Script(adminContractHash))
        const cbor = applyParamsToScript(this.findValidator("issuance_mint.issuance_mint.mint"), [
            conStr1([byteString(progLogicBaseHash)]),
            conStr1([byteString(adminContractHash)]),
        ], "JSON");
        const policyHash = resolveScriptHash(cbor, "V3");
        const rewardAddress = serializeRewardAddress(policyHash, true, this.networkId);
        return { scriptCbor: cbor, scriptAddr: "", policyHash, rewardAddress };
    }
    // ─── Smart receiver address ────────────────────────────────────────────────
    /**
     * Smart receiver address for a user.
     * Payment = programmable_logic_base script hash
     * Staking = user's stake key hash (KeyHash)
     */
    getSmartReceiverAddress(progLogicBaseCbor, stakeKeyHash) {
        const script = { code: progLogicBaseCbor, version: "V3" };
        return serializePlutusScript(script, stakeKeyHash, this.networkId, false)
            .address;
    }
    // ─── Stake key hash ────────────────────────────────────────────────────────
    async getStakeKeyHash(wallet) {
        const rewardAddresses = await wallet.getRewardAddresses();
        if (!rewardAddresses || rewardAddresses.length === 0) {
            throw new FluidMeshError(FluidMeshErrorCode.WALLET_NOT_CONNECTED, "Wallet has no stake/reward address");
        }
        // For a reward address, pubKeyHash is the stake key hash
        return deserializeAddress(rewardAddresses[0]).pubKeyHash;
    }
    // ─── Create policy data ────────────────────────────────────────────────────
    async createPolicyData(config, wallet) {
        const walletAddress = await wallet.getChangeAddress();
        const adminPkh = deserializeAddress(walletAddress).pubKeyHash;
        const adminStakeKeyHash = await this.getStakeKeyHash(wallet);
        // Pick seed UTxO (first wallet UTxO) for blacklist one-shot policy
        const utxos = await wallet.getUtxos();
        if (!utxos || utxos.length === 0) {
            throw new FluidMeshError(FluidMeshErrorCode.INSUFFICIENT_FUNDS, "Wallet has no UTxOs to use as seed");
        }
        const seedUtxo = utxos[0];
        const seedUtxoRef = {
            txHash: seedUtxo.input.txHash,
            outputIndex: seedUtxo.input.outputIndex,
        };
        // Protocol layer
        const protocol = this.getProtocolScripts();
        const progLogicBaseHash = protocol.programmableLogicBase.policyHash;
        // Freeze-and-seize scripts
        const freezeAndSeize = this.getFreezeAndSeizeScripts(seedUtxoRef.txHash, seedUtxoRef.outputIndex, adminPkh, progLogicBaseHash);
        // issuance_mint
        const issuanceMint = this.getIssuanceMintScript(progLogicBaseHash, freezeAndSeize.issuerAdminContract.policyHash);
        // Token name hex
        const tokenNameHex = stringToHex(config.tokenName);
        // Smart receiver address (admin's)
        const smartReceiverAddress = this.getSmartReceiverAddress(protocol.programmableLogicBase.scriptCbor, adminStakeKeyHash);
        return {
            tokenName: config.tokenName,
            tokenNameHex,
            adminPkh,
            adminStakeKeyHash,
            seedUtxoRef,
            protocol,
            freezeAndSeize,
            issuanceMint,
            smartReceiverAddress,
        };
    }
    // ─── Deploy (initialize blacklist + register stake cert) ──────────────────
    async deployPolicy(wallet, policyData) {
        try {
            const walletAddress = await wallet.getChangeAddress();
            const utxos = await wallet.getUtxos();
            const collateral = await getCollateral(wallet, walletAddress);
            // Check if the two withdrawal-script stake certs are already registered.
            // issuer_admin_contract and transfer_logic are withdrawal validators that
            // need stake cert registration before they can be used in transactions.
            // (issuance_mint is a minting policy and does NOT need stake registration.)
            const isAdminContractRegistered = await this.isStakeCredentialRegistered(policyData.freezeAndSeize.issuerAdminContract.rewardAddress);
            const isTransferLogicRegistered = await this.isStakeCredentialRegistered(policyData.freezeAndSeize.transferLogic.rewardAddress);
            console.log("Deploying policy with data:", policyData);
            console.log("Is issuerAdminContract registered:", isAdminContractRegistered);
            console.log("Is transferLogic registered:", isTransferLogicRegistered);
            const txBuilder = this.getTxBuilder();
            // Blacklist initialization – origin node only.
            // validate_blacklist_init requires exactly 1 minted token (name="") and 1 output.
            // The tail sentinel ("ff...ff") is the `next` pointer value, NOT a separate UTxO.
            // origin node datum: { key: '', next: TAIL_KEY }
            const originNodeDatum = conStr0([
                byteString(BLACKLIST_HEAD_KEY),
                byteString(BLACKLIST_TAIL_KEY),
            ]);
            // BlacklistRedeemer::Init = conStr0([])
            const blacklistInitRedeemer = conStr0([]);
            // Seed UTxO input (required for one-shot blacklist_mint)
            const { txHash: seedTxHash, outputIndex: seedTxIndex } = policyData.seedUtxoRef;
            // Consume the seed UTxO
            txBuilder.txIn(seedTxHash, seedTxIndex);
            // Mint exactly one origin node token (name = "" = origin_node_tn)
            txBuilder
                .mintPlutusScriptV3()
                .mint("1", policyData.freezeAndSeize.blacklistMint.policyHash, BLACKLIST_HEAD_KEY)
                .mintingScript(policyData.freezeAndSeize.blacklistMint.scriptCbor)
                .mintRedeemerValue(blacklistInitRedeemer, "JSON");
            // Send the single origin node to blacklist_spend address
            txBuilder
                .txOut(policyData.freezeAndSeize.blacklistSpend.address, [
                { unit: "lovelace", quantity: "2000000" },
                {
                    unit: policyData.freezeAndSeize.blacklistMint.policyHash +
                        BLACKLIST_HEAD_KEY,
                    quantity: "1",
                },
            ])
                .txOutInlineDatumValue(originNodeDatum, "JSON");
            // Register withdrawal-script stake certificates for any that aren't yet registered.
            // Both issuer_admin_contract and transfer_logic are withdrawal validators.
            if (!isAdminContractRegistered) {
                txBuilder.registerStakeCertificate(policyData.freezeAndSeize.issuerAdminContract.rewardAddress);
            }
            if (!isTransferLogicRegistered) {
                txBuilder.registerStakeCertificate(policyData.freezeAndSeize.transferLogic.rewardAddress);
            }
            await txBuilder
                .requiredSignerHash(policyData.adminPkh)
                .txInCollateral(collateral.txHash, collateral.outputIndex)
                .selectUtxosFrom(utxos)
                .changeAddress(walletAddress)
                .setNetwork(maestroNetwork)
                .complete();
            const unsignedTx = txBuilder.txHex;
            const signedTx = await wallet.signTx(unsignedTx, true);
            const txHash = await wallet.submitTx(signedTx);
            return createSuccessResult({ txHash, successCode: FluidMeshSuccessCode.DEPLOYMENT_SUCCESS }, FluidMeshSuccessCode.DEPLOYMENT_SUCCESS);
        }
        catch (error) {
            console.error("Error deploying policy:", error);
            return createErrorResult(FluidMeshError.fromError(error));
        }
    }
    async isStakeCredentialRegistered(rewardAddress) {
        try {
            const info = await this.blockchainProvider.fetchAccountInfo(rewardAddress);
            return info !== null && info !== undefined;
        }
        catch {
            return false;
        }
    }
    /**
     * Check whether a policy's issuance_mint script is already registered in the
     * on-chain CIP-113 token registry (i.e. a registry node with key == policyHash exists).
     */
    async isRegisteredInRegistry(policyData) {
        try {
            // Derive registry_spend address from the on-chain head node UTxO (avoids
            // blueprint CBOR mismatch with the deployed registry_spend script).
            const headNodeUtxo = await this.findUtxoHoldingAsset(registryPolicyId);
            if (!headNodeUtxo)
                return false;
            const registrySpendAddr = headNodeUtxo.output.address;
            const utxos = await this.blockchainProvider.fetchAddressUTxOs(registrySpendAddr);
            const insertKey = policyData.issuanceMint.policyHash;
            for (const utxo of utxos) {
                if (!utxo.output.plutusData)
                    continue;
                const node = this.decodeRegistryNodeDatum(utxo.output.plutusData);
                if (node && node.key === insertKey)
                    return true;
            }
            return false;
        }
        catch {
            return false;
        }
    }
    // ─── Mint tokens ──────────────────────────────────────────────────────────
    async mintPolicy(wallet, policyData, quantity, metadata, recipientAllocations) {
        try {
            const walletAddress = await wallet.getChangeAddress();
            const utxos = await wallet.getUtxos();
            const collateral = await getCollateral(wallet, walletAddress);
            const allocations = recipientAllocations && recipientAllocations.length > 0
                ? recipientAllocations
                : null;
            const totalAllocated = allocations
                ? allocations.reduce((acc, curr) => acc + BigInt(curr.quantity), BigInt(0))
                : BigInt(0);
            if (totalAllocated > BigInt(quantity)) {
                throw new FluidMeshError(FluidMeshErrorCode.ALLOCATIONS_EXCEED_TOTAL, "Total allocations exceed minting quantity");
            }
            const remainingForMinter = BigInt(quantity) - totalAllocated;
            // Build metadata initial_allocations
            const initialAllocations = [];
            if (allocations) {
                for (const alloc of allocations) {
                    const stakeHash = await this.getStakeKeyHashFromAddress(alloc.address);
                    const recipientSmartAddr = this.getSmartReceiverAddress(policyData.protocol.programmableLogicBase.scriptCbor, stakeHash);
                    initialAllocations.push({
                        label: `Allocation to ${alloc.address.slice(0, 12)}...`,
                        address: recipientSmartAddr.match(/.{1,64}/g) || [],
                        amount: parseInt(alloc.quantity),
                    });
                }
            }
            if (remainingForMinter > 0) {
                initialAllocations.push({
                    label: "Minter allocation",
                    address: policyData.smartReceiverAddress.match(/.{1,64}/g) || [],
                    amount: Number(remainingForMinter),
                });
            }
            const rwaMetadata = {
                fragma_rwa_v1: {
                    policy: policyData.issuanceMint.policyHash,
                    assetName: policyData.tokenNameHex,
                    rule_script_policy_hash: policyData.freezeAndSeize.transferLogic.policyHash,
                    asset_ref_id: metadata.asset_ref_id,
                    attestation_sha256: metadata.attestation_sha256,
                    mapping: metadata.mapping,
                    tokenomics: {
                        total_supply: Number(quantity),
                        decimals: 1,
                        minting_policy_hash: policyData.issuanceMint.policyHash,
                        admin_pkh: metadata.admin_pkh.map((addr) => deserializeAddress(addr).pubKeyHash),
                        initial_allocations: initialAllocations,
                    },
                },
            };
            const txBuilder = this.getTxBuilder();
            // Outputs: send to each recipient's smart receiver address
            if (allocations) {
                for (const alloc of allocations) {
                    const stakeHash = await this.getStakeKeyHashFromAddress(alloc.address);
                    const recipientSmartAddr = this.getSmartReceiverAddress(policyData.protocol.programmableLogicBase.scriptCbor, stakeHash);
                    txBuilder
                        .txOut(recipientSmartAddr, [
                        { unit: "lovelace", quantity: "2000000" },
                        {
                            unit: policyData.issuanceMint.policyHash + policyData.tokenNameHex,
                            quantity: alloc.quantity,
                        },
                    ])
                        .txOutInlineDatumValue(conStr0([]), "JSON");
                }
            }
            if (remainingForMinter > 0) {
                txBuilder
                    .txOut(policyData.smartReceiverAddress, [
                    { unit: "lovelace", quantity: "2000000" },
                    {
                        unit: policyData.issuanceMint.policyHash + policyData.tokenNameHex,
                        quantity: remainingForMinter.toString(),
                    },
                ])
                    .txOutInlineDatumValue(conStr0([]), "JSON");
            }
            // issuer_admin_contract withdraw-zero (authorizes the mint)
            // Redeemer: any value (validator only checks admin sig via permitted_cred)
            txBuilder
                .withdrawalPlutusScriptV3()
                .withdrawal(policyData.freezeAndSeize.issuerAdminContract.rewardAddress, "0")
                .withdrawalScript(policyData.freezeAndSeize.issuerAdminContract.scriptCbor)
                .withdrawalRedeemerValue(integer(0), "JSON");
            // issuance_mint – redeemer: Mint(Script(adminContractHash))
            // = conStr0([conStr1([byteString(adminContractHash)])])
            const mintRedeemer = conStr0([
                conStr1([
                    byteString(policyData.freezeAndSeize.issuerAdminContract.policyHash),
                ]),
            ]);
            txBuilder
                .mintPlutusScriptV3()
                .mint(quantity, policyData.issuanceMint.policyHash, policyData.tokenNameHex)
                .mintingScript(policyData.issuanceMint.scriptCbor)
                .mintRedeemerValue(mintRedeemer, "JSON")
                //     .metadataValue(777, rwaMetadata)
                .requiredSignerHash(policyData.adminPkh)
                .txInCollateral(collateral.txHash, collateral.outputIndex)
                .selectUtxosFrom(utxos)
                .changeAddress(walletAddress)
                .setNetwork(maestroNetwork);
            await txBuilder.complete();
            const unsignedTx = txBuilder.txHex;
            const signedTx = await wallet.signTx(unsignedTx, true);
            const txHash = await wallet.submitTx(signedTx);
            return createSuccessResult({ txHash }, FluidMeshSuccessCode.MINTING_SUCCESS);
        }
        catch (error) {
            console.error("Error minting tokens:", error);
            return createErrorResult(FluidMeshError.fromError(error));
        }
    }
    // ─── Transfer tokens ──────────────────────────────────────────────────────
    async transferCIP113Tokens(wallet, policyData, recipients, utxosToSpend, currentBalance) {
        try {
            const walletAddress = await wallet.getChangeAddress();
            const utxos = await wallet.getUtxos();
            const collateral = await getCollateral(wallet, walletAddress);
            // Stake key hash is the sender's staking credential —
            // used both as the required signer and to find the blacklist non-membership proof.
            const rewardAddresses = await wallet.getRewardAddresses();
            const senderStakeKeyHash = deserializeAddress(rewardAddresses[0]).pubKeyHash;
            const totalSend = recipients.reduce((acc, r) => acc + BigInt(r.amount), BigInt(0));
            const changeAmount = BigInt(currentBalance) - totalSend;
            if (changeAmount < 0) {
                throw new FluidMeshError(FluidMeshErrorCode.INSUFFICIENT_FUNDS, "Insufficient balance for transfer");
            }
            // ── Protocol params + registry node (reference inputs) ────────────────────
            const protocolParamsTokenUnit = protocolParamsPolicyId + stringToHex("ProtocolParams");
            const protocolParamsUtxo = await this.findUtxoHoldingAsset(protocolParamsTokenUnit);
            if (!protocolParamsUtxo)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "ProtocolParams UTxO not found");
            const registryNodeUnit = registryPolicyId + policyData.issuanceMint.policyHash;
            const registryNodeUtxo = await this.findUtxoHoldingAsset(registryNodeUnit);
            if (!registryNodeUtxo)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, `Registry node not found for policy ${policyData.issuanceMint.policyHash}`);
            // ── Read on-chain transfer logic hash from registry datum ───────────────
            // Registry datum = Constr0([key, next, Script(transferLogicHash), Script(tptlHash), globalStateCs])
            // Script credential = Constr1([bytes(hash)])
            const rawRegistryDatum = registryNodeUtxo.output.plutusData;
            if (!rawRegistryDatum)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "Registry node UTxO has no datum");
            const registryDatumParsed = deserializeDatum(rawRegistryDatum);
            const onChainTransferLogicHash = registryDatumParsed?.fields?.[2]?.fields?.[0]?.bytes;
            if (!onChainTransferLogicHash)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "Could not parse transfer logic hash from registry datum");
            // ── Match FES scripts against on-chain hash ──────────────────────────────
            // Try all combinations of (blacklist_mint source) × (transfer_logic source).
            // This handles tokens deployed by our frontend (freeze-and-seize-plutus.json)
            // and tokens deployed by the Java backend (java-standard-fes.json).
            const progLogicBaseHash = resolveScriptHash(policyData.protocol.programmableLogicBase.scriptCbor, "V3");
            const mintParams = [
                conStr(0, [
                    byteString(policyData.seedUtxoRef.txHash),
                    integer(policyData.seedUtxoRef.outputIndex),
                ]),
                byteString(policyData.adminPkh),
            ];
            const findValidator = (bp, title) => bp.validators.find((v) => v.title === title)
                ?.compiledCode;
            const bpCandidates = [
                // Our FES blueprint (tokens deployed by this frontend)
                {
                    mintRaw: findValidator(freezeBlueprint, "blacklist_mint.blacklist_mint.mint"),
                    transferRaw: findValidator(freezeBlueprint, "example_transfer_logic.transfer.withdraw"),
                    spendRaw: findValidator(freezeBlueprint, "blacklist_spend.blacklist_spend.spend"),
                },
                // Java standard blueprint (tokens deployed by the Java backend)
                {
                    mintRaw: findValidator(javaFesBlueprint, "blacklist_mint.blacklist_mint.mint"),
                    transferRaw: findValidator(javaFesBlueprint, "example_transfer_logic.freeze_and_seize_transfer.withdraw"),
                    spendRaw: findValidator(javaFesBlueprint, "blacklist_spend.blacklist_spend.spend"),
                },
                // Cross: Java blacklist_mint + FES transfer (fallback)
                {
                    mintRaw: findValidator(javaFesBlueprint, "blacklist_mint.blacklist_mint.mint"),
                    transferRaw: findValidator(freezeBlueprint, "example_transfer_logic.transfer.withdraw"),
                    spendRaw: findValidator(javaFesBlueprint, "blacklist_spend.blacklist_spend.spend"),
                },
                // Cross: FES blacklist_mint + Java transfer (fallback)
                {
                    mintRaw: findValidator(freezeBlueprint, "blacklist_mint.blacklist_mint.mint"),
                    transferRaw: findValidator(javaFesBlueprint, "example_transfer_logic.freeze_and_seize_transfer.withdraw"),
                    spendRaw: findValidator(freezeBlueprint, "blacklist_spend.blacklist_spend.spend"),
                },
            ];
            let transferLogicCbor = "";
            let transferLogicRewardAddr = "";
            let blacklistSpendAddress = "";
            for (const bp of bpCandidates) {
                const blMintCbor = applyParamsToScript(bp.mintRaw, mintParams, "JSON");
                const blMintHash = resolveScriptHash(blMintCbor, "V3");
                const tlCbor = applyParamsToScript(bp.transferRaw, [conStr1([byteString(progLogicBaseHash)]), byteString(blMintHash)], "JSON");
                const tlHash = resolveScriptHash(tlCbor, "V3");
                if (tlHash === onChainTransferLogicHash) {
                    transferLogicCbor = tlCbor;
                    transferLogicRewardAddr = serializeRewardAddress(tlHash, true, this.networkId);
                    const blSpendCbor = applyParamsToScript(bp.spendRaw, [byteString(blMintHash)], "JSON");
                    blacklistSpendAddress = serializePlutusScript({ code: blSpendCbor, version: "V3" }, undefined, this.networkId, false).address;
                    break;
                }
            }
            if (!transferLogicCbor)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, `Could not match on-chain transfer logic hash ${onChainTransferLogicHash} to any known blueprint`);
            // ── Blacklist non-membership proofs (one per spending UTxO) ───────────────
            // Fetch all blacklist nodes and find the one that covers senderStakeKeyHash,
            // i.e. node.key < senderStakeKeyHash < node.next  (lexicographic ByteArray order)
            const blacklistUtxos = await this.blockchainProvider.fetchAddressUTxOs(blacklistSpendAddress);
            const proofs = [];
            for (const utxoRef of utxosToSpend) {
                const proof = blacklistUtxos.find((blUtxo) => {
                    if (!blUtxo.output.plutusData)
                        return false;
                    const datum = deserializeDatum(blUtxo.output.plutusData);
                    if (!datum?.fields || datum.fields.length < 2)
                        return false;
                    const key = datum.fields[0]?.bytes ?? "";
                    const next = datum.fields[1]?.bytes ?? "";
                    return key < senderStakeKeyHash && senderStakeKeyHash < next;
                });
                if (!proof) {
                    throw new FluidMeshError(FluidMeshErrorCode.INVALID_ALLOCATION, "Could not find blacklist non-membership proof – sender may be blacklisted");
                }
                proofs.push({ spendingUtxoRef: utxoRef, blacklistUtxo: proof });
            }
            // Deduplicate blacklist UTxOs (same node may cover multiple spending inputs)
            const uniqueBlacklistUtxos = [];
            const seen = new Set();
            for (const p of proofs) {
                const key = `${p.blacklistUtxo.input.txHash}#${p.blacklistUtxo.input.outputIndex}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueBlacklistUtxos.push(p.blacklistUtxo);
                }
            }
            const allRefInputs = [
                ...uniqueBlacklistUtxos.map((u) => ({
                    txHash: u.input.txHash,
                    outputIndex: u.input.outputIndex,
                })),
                {
                    txHash: protocolParamsUtxo.input.txHash,
                    outputIndex: protocolParamsUtxo.input.outputIndex,
                },
                {
                    txHash: registryNodeUtxo.input.txHash,
                    outputIndex: registryNodeUtxo.input.outputIndex,
                },
            ];
            const sortedRefInputs = allRefInputs.slice().sort((a, b) => {
                const cmp = a.txHash
                    .toLowerCase()
                    .localeCompare(b.txHash.toLowerCase());
                return cmp !== 0 ? cmp : a.outputIndex - b.outputIndex;
            });
            // Proof index = position of each blacklist UTxO in the sorted reference inputs list
            const proofIndices = proofs.map((p) => sortedRefInputs.findIndex((ri) => ri.txHash === p.blacklistUtxo.input.txHash &&
                ri.outputIndex === p.blacklistUtxo.input.outputIndex));
            // Registry index in sorted reference inputs
            const registryIndex = sortedRefInputs.findIndex((ri) => ri.txHash === registryNodeUtxo.input.txHash &&
                ri.outputIndex === registryNodeUtxo.input.outputIndex);
            // ── Redeemers ─────────────────────────────────────────────────────────────
            // Global: TransferAct { proofs: [TokenExists { node_idx: registryIndex }] }
            const registryProof = conStr0([integer(registryIndex)]);
            const transferActRedeemer = conStr0([list([registryProof])]);
            // FES transfer: List<NonmembershipProof { node_idx }> — one per spending input
            const fesRedeemer = list(proofIndices.map((idx) => conStr(0, [integer(idx)])));
            // ── Build transaction ──────────────────────────────────────────────────────
            const txBuilder = this.getTxBuilder();
            // Spend UTxOs from programmable_logic_base address
            for (const utxoRef of utxosToSpend) {
                const [txHash, indexStr] = utxoRef.split("#");
                txBuilder
                    .spendingPlutusScript("V3")
                    .txIn(txHash, parseInt(indexStr, 10))
                    .txInInlineDatumPresent()
                    .txInScript(policyData.protocol.programmableLogicBase.scriptCbor)
                    .txInRedeemerValue(conStr0([]), "JSON");
            }
            // Reference inputs in sorted order
            for (const ref of sortedRefInputs) {
                txBuilder.readOnlyTxInReference(ref.txHash, ref.outputIndex);
            }
            // Outputs to each recipient's smart address
            for (const recipient of recipients) {
                const stakeHash = await this.getStakeKeyHashFromAddress(recipient.address);
                const recipientSmartAddr = this.getSmartReceiverAddress(policyData.protocol.programmableLogicBase.scriptCbor, stakeHash);
                txBuilder
                    .txOut(recipientSmartAddr, [
                    { unit: "lovelace", quantity: "1300000" },
                    {
                        unit: policyData.issuanceMint.policyHash + policyData.tokenNameHex,
                        quantity: recipient.amount,
                    },
                ])
                    .txOutInlineDatumValue(conStr0([]), "JSON");
            }
            // Change back to sender's smart address
            if (changeAmount > 0) {
                txBuilder
                    .txOut(policyData.smartReceiverAddress, [
                    { unit: "lovelace", quantity: "1300000" },
                    {
                        unit: policyData.issuanceMint.policyHash + policyData.tokenNameHex,
                        quantity: changeAmount.toString(),
                    },
                ])
                    .txOutInlineDatumValue(conStr0([]), "JSON");
            }
            // Withdrawals: global first, then FES transfer logic
            txBuilder
                .withdrawalPlutusScriptV3()
                .withdrawal(policyData.protocol.programmableLogicGlobal.rewardAddress, "0")
                .withdrawalScript(policyData.protocol.programmableLogicGlobal.scriptCbor)
                .withdrawalRedeemerValue(transferActRedeemer, "JSON")
                .withdrawalPlutusScriptV3()
                .withdrawal(transferLogicRewardAddr, "0")
                .withdrawalScript(transferLogicCbor)
                .withdrawalRedeemerValue(fesRedeemer, "JSON")
                .requiredSignerHash(senderStakeKeyHash)
                .txInCollateral(collateral.txHash, collateral.outputIndex)
                .selectUtxosFrom(utxos)
                .changeAddress(walletAddress)
                .setNetwork(maestroNetwork);
            await txBuilder.complete();
            const unsignedTx = txBuilder.txHex;
            const signedTx = await wallet.signTx(unsignedTx, true);
            const txHash = await wallet.submitTx(signedTx);
            return createSuccessResult({ txHash }, FluidMeshSuccessCode.MINTING_SUCCESS);
        }
        catch (error) {
            console.error("Error transferring tokens:", error);
            return createErrorResult(FluidMeshError.fromError(error));
        }
    }
    // ─── Burn tokens ──────────────────────────────────────────────────────────
    async burnCIP113Tokens(wallet, policyData, amount, utxosToSpend, currentBalance) {
        try {
            const walletAddress = await wallet.getChangeAddress();
            const utxos = await wallet.getUtxos();
            const signerPkh = deserializeAddress(walletAddress).pubKeyHash;
            const collateral = await getCollateral(wallet, walletAddress);
            const changeAmount = BigInt(currentBalance) - BigInt(amount);
            const txBuilder = this.getTxBuilder();
            // Spend UTxOs from progLogicBase address
            for (const utxoRef of utxosToSpend) {
                const [txHash, indexStr] = utxoRef.split("#");
                txBuilder
                    .spendingPlutusScript("V3")
                    .txIn(txHash, parseInt(indexStr, 10))
                    .txInInlineDatumPresent()
                    .txInScript(policyData.protocol.programmableLogicBase.scriptCbor)
                    .txInRedeemerValue(conStr0([]), "JSON");
            }
            // Return change to smart address
            if (changeAmount > 0) {
                txBuilder
                    .txOut(policyData.smartReceiverAddress, [
                    { unit: "lovelace", quantity: "2000000" },
                    {
                        unit: policyData.issuanceMint.policyHash + policyData.tokenNameHex,
                        quantity: changeAmount.toString(),
                    },
                ])
                    .txOutInlineDatumValue(conStr0([]), "JSON");
            }
            // issuer_admin_contract withdraw-zero (admin authorization for burn)
            txBuilder
                .withdrawalPlutusScriptV3()
                .withdrawal(policyData.freezeAndSeize.issuerAdminContract.rewardAddress, "0")
                .withdrawalScript(policyData.freezeAndSeize.issuerAdminContract.scriptCbor)
                .withdrawalRedeemerValue(integer(0), "JSON");
            // issuance_mint burn redeemer: Burn = conStr1([])
            txBuilder
                .mintPlutusScriptV3()
                .mint(`-${amount}`, policyData.issuanceMint.policyHash, policyData.tokenNameHex)
                .mintingScript(policyData.issuanceMint.scriptCbor)
                .mintRedeemerValue(conStr1([]), "JSON");
            // programmable_logic_global withdraw-zero
            txBuilder
                .withdrawalPlutusScriptV3()
                .withdrawal(policyData.protocol.programmableLogicGlobal.rewardAddress, "0")
                .withdrawalScript(policyData.protocol.programmableLogicGlobal.scriptCbor)
                .withdrawalRedeemerValue(conStr0([[]]), "JSON") // ThirdPartyAct placeholder
                .requiredSignerHash(signerPkh)
                .txInCollateral(collateral.txHash, collateral.outputIndex)
                .selectUtxosFrom(utxos)
                .changeAddress(walletAddress)
                .setNetwork(maestroNetwork);
            await txBuilder.complete();
            const unsignedTx = txBuilder.txHex;
            const signedTx = await wallet.signTx(unsignedTx, true);
            const txHash = await wallet.submitTx(signedTx);
            return createSuccessResult({ txHash }, FluidMeshSuccessCode.MINTING_SUCCESS);
        }
        catch (error) {
            console.error("Error burning tokens:", error);
            return createErrorResult(FluidMeshError.fromError(error));
        }
    }
    // ─── Freeze address (insert into blacklist) ────────────────────────────────
    async freezeAddress(wallet, policyData, targetAddress) {
        try {
            const walletAddress = await wallet.getChangeAddress();
            const utxos = await wallet.getUtxos();
            const collateral = await getCollateral(wallet, walletAddress);
            // The key to insert = payment key hash of target address
            const targetPkh = deserializeAddress(targetAddress).pubKeyHash;
            // Find covering node in blacklist (node where node.key < targetPkh <= node.next)
            // For simplicity, fetch all blacklist UTxOs and find the right covering node
            const blacklistUtxos = await this.blockchainProvider.fetchAddressUTxOs(policyData.freezeAndSeize.blacklistSpend.address);
            const coveringNode = this.findCoveringNode(blacklistUtxos, targetPkh);
            if (!coveringNode) {
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_ALLOCATION, "Could not find covering blacklist node for address");
            }
            // BlacklistRedeemer::Insert = conStr1([key, new_next])
            const insertRedeemer = conStr1([
                byteString(targetPkh),
                byteString(coveringNode.next),
            ]);
            const txBuilder = this.getTxBuilder();
            // Spend the covering node
            txBuilder
                .spendingPlutusScript("V3")
                .txIn(coveringNode.utxoHash, coveringNode.utxoIndex)
                .txInInlineDatumPresent()
                .txInScript(policyData.freezeAndSeize.blacklistSpend.scriptCbor)
                .txInRedeemerValue(conStr0([]), "JSON");
            // Updated covering node: same key, next = targetPkh
            const updatedCoveringDatum = conStr0([
                byteString(coveringNode.key),
                byteString(targetPkh),
            ]);
            txBuilder
                .txOut(policyData.freezeAndSeize.blacklistSpend.address, [
                { unit: "lovelace", quantity: "2000000" },
                {
                    unit: policyData.freezeAndSeize.blacklistMint.policyHash +
                        coveringNode.key,
                    quantity: "1",
                },
            ])
                .txOutInlineDatumValue(updatedCoveringDatum, "JSON");
            // New node for targetPkh
            const newNodeDatum = conStr0([
                byteString(targetPkh),
                byteString(coveringNode.next),
            ]);
            txBuilder
                .txOut(policyData.freezeAndSeize.blacklistSpend.address, [
                { unit: "lovelace", quantity: "2000000" },
                {
                    unit: policyData.freezeAndSeize.blacklistMint.policyHash + targetPkh,
                    quantity: "1",
                },
            ])
                .txOutInlineDatumValue(newNodeDatum, "JSON");
            // Mint the new blacklist node token
            txBuilder
                .mintPlutusScriptV3()
                .mint("1", policyData.freezeAndSeize.blacklistMint.policyHash, targetPkh)
                .mintingScript(policyData.freezeAndSeize.blacklistMint.scriptCbor)
                .mintRedeemerValue(insertRedeemer, "JSON");
            await txBuilder
                .requiredSignerHash(policyData.adminPkh)
                .txInCollateral(collateral.txHash, collateral.outputIndex)
                .selectUtxosFrom(utxos)
                .changeAddress(walletAddress)
                .setNetwork(maestroNetwork)
                .complete();
            const unsignedTx = txBuilder.txHex;
            const signedTx = await wallet.signTx(unsignedTx, true);
            const txHash = await wallet.submitTx(signedTx);
            return createSuccessResult({ txHash }, FluidMeshSuccessCode.MINTING_SUCCESS);
        }
        catch (error) {
            console.error("Error freezing address:", error);
            return createErrorResult(FluidMeshError.fromError(error));
        }
    }
    // ─── Seize tokens (admin transfer out of frozen address) ──────────────────
    async seizeTokens(wallet, policyData, frozenAddress, seizeAmount) {
        try {
            const walletAddress = await wallet.getChangeAddress();
            const utxos = await wallet.getUtxos();
            const collateral = await getCollateral(wallet, walletAddress);
            const frozenStakeHash = await this.getStakeKeyHashFromAddress(frozenAddress);
            const frozenSmartAddr = this.getSmartReceiverAddress(policyData.protocol.programmableLogicBase.scriptCbor, frozenStakeHash);
            // Fetch frozen UTxOs
            const frozenUtxos = await this.blockchainProvider.fetchAddressUTxOs(frozenSmartAddr);
            const tokenUnit = policyData.issuanceMint.policyHash + policyData.tokenNameHex;
            const selected = this.selectTokenUtxos(frozenUtxos, tokenUnit, seizeAmount);
            if (!selected) {
                throw new FluidMeshError(FluidMeshErrorCode.INSUFFICIENT_FUNDS, "Insufficient frozen tokens to seize");
            }
            const txBuilder = this.getTxBuilder();
            // Spend frozen UTxOs
            for (const utxo of selected.utxos) {
                txBuilder
                    .spendingPlutusScript("V3")
                    .txIn(utxo.input.txHash, utxo.input.outputIndex)
                    .txInInlineDatumPresent()
                    .txInScript(policyData.protocol.programmableLogicBase.scriptCbor)
                    .txInRedeemerValue(conStr0([]), "JSON");
            }
            // Send seized tokens to admin's smart receiver address
            txBuilder
                .txOut(policyData.smartReceiverAddress, [
                { unit: "lovelace", quantity: "2000000" },
                { unit: tokenUnit, quantity: seizeAmount },
            ])
                .txOutInlineDatumValue(conStr0([]), "JSON");
            // Return change to frozen address if any
            const changeAmount = BigInt(selected.balance) - BigInt(seizeAmount);
            if (changeAmount > 0) {
                txBuilder
                    .txOut(frozenSmartAddr, [
                    { unit: "lovelace", quantity: "2000000" },
                    { unit: tokenUnit, quantity: changeAmount.toString() },
                ])
                    .txOutInlineDatumValue(conStr0([]), "JSON");
            }
            // issuer_admin_contract withdraw-zero (admin auth for seize)
            txBuilder
                .withdrawalPlutusScriptV3()
                .withdrawal(policyData.freezeAndSeize.issuerAdminContract.rewardAddress, "0")
                .withdrawalScript(policyData.freezeAndSeize.issuerAdminContract.scriptCbor)
                .withdrawalRedeemerValue(integer(0), "JSON");
            // programmable_logic_global – ThirdPartyAct
            // ThirdPartyAct { registry_node_idx, input_idxs, outputs_start_idx, length }
            // For simplicity using conStr1 with placeholder indices – production would compute these
            const thirdPartyAct = conStr1([
                integer(0), // registry_node_idx
                [integer(0)], // input_idxs
                integer(0), // outputs_start_idx
                integer(selected.utxos.length), // length
            ]);
            txBuilder
                .withdrawalPlutusScriptV3()
                .withdrawal(policyData.protocol.programmableLogicGlobal.rewardAddress, "0")
                .withdrawalScript(policyData.protocol.programmableLogicGlobal.scriptCbor)
                .withdrawalRedeemerValue(thirdPartyAct, "JSON")
                .requiredSignerHash(policyData.adminPkh)
                .txInCollateral(collateral.txHash, collateral.outputIndex)
                .selectUtxosFrom(utxos)
                .changeAddress(walletAddress)
                .setNetwork(maestroNetwork);
            await txBuilder.complete();
            const unsignedTx = txBuilder.txHex;
            const signedTx = await wallet.signTx(unsignedTx, true);
            const txHash = await wallet.submitTx(signedTx);
            return createSuccessResult({ txHash }, FluidMeshSuccessCode.MINTING_SUCCESS);
        }
        catch (error) {
            console.error("Error seizing tokens:", error);
            return createErrorResult(FluidMeshError.fromError(error));
        }
    }
    // ─── CBOR datum helpers ────────────────────────────────────────────────────
    /** Decode a CBOR bytearray at a given hex string offset.
     * Handles: 0x40, 0x41..0x57, 0x58, 0x59, 0x5a, 0x5f (indefinite-length)
     */
    decodeCborByteArray(hex, offset) {
        if (offset >= hex.length)
            return null;
        const first = parseInt(hex.slice(offset, offset + 2), 16);
        if (first === 0x40) {
            return { value: "", newOffset: offset + 2 };
        }
        else if (first >= 0x41 && first <= 0x57) {
            const len = first - 0x40;
            return {
                value: hex.slice(offset + 2, offset + 2 + len * 2),
                newOffset: offset + 2 + len * 2,
            };
        }
        else if (first === 0x58) {
            const len = parseInt(hex.slice(offset + 2, offset + 4), 16);
            return {
                value: hex.slice(offset + 4, offset + 4 + len * 2),
                newOffset: offset + 4 + len * 2,
            };
        }
        else if (first === 0x59) {
            const len = (parseInt(hex.slice(offset + 2, offset + 4), 16) << 8) |
                parseInt(hex.slice(offset + 4, offset + 6), 16);
            return {
                value: hex.slice(offset + 6, offset + 6 + len * 2),
                newOffset: offset + 6 + len * 2,
            };
        }
        else if (first === 0x5a) {
            const len = (parseInt(hex.slice(offset + 2, offset + 4), 16) << 24) |
                (parseInt(hex.slice(offset + 4, offset + 6), 16) << 16) |
                (parseInt(hex.slice(offset + 6, offset + 8), 16) << 8) |
                parseInt(hex.slice(offset + 8, offset + 10), 16);
            return {
                value: hex.slice(offset + 10, offset + 10 + len * 2),
                newOffset: offset + 10 + len * 2,
            };
        }
        else if (first === 0x5f) {
            // Indefinite-length bytestring: read definite-length chunks until 0xff break code.
            // The on-chain IssuanceCborHex datum encodes the large prefix ByteArray this way.
            let result = "";
            let pos = offset + 2; // skip the 0x5f marker
            while (pos < hex.length) {
                const next = parseInt(hex.slice(pos, pos + 2), 16);
                if (next === 0xff) {
                    return { value: result, newOffset: pos + 2 };
                }
                const chunk = this.decodeCborByteArray(hex, pos);
                if (!chunk)
                    return null;
                result += chunk.value;
                pos = chunk.newOffset;
            }
            return null; // unterminated indefinite bytestring
        }
        return null;
    }
    /** Decode a CBOR Plutus Credential (Constr0=VerificationKey | Constr1=Script with one ByteArray field). */
    decodeCborCredential(hex, offset) {
        if (offset >= hex.length || hex.slice(offset, offset + 2) !== "d8")
            return null;
        const tag = parseInt(hex.slice(offset + 2, offset + 4), 16);
        offset += 4;
        const constructor = tag - 121; // 121→0 (VerificationKey), 122→1 (Script)
        if (constructor !== 0 && constructor !== 1)
            return null;
        const arrayByte = parseInt(hex.slice(offset, offset + 2), 16);
        if (arrayByte === 0x9f) {
            // indefinite array: ff = end
            offset += 2;
            const hash = this.decodeCborByteArray(hex, offset);
            if (!hash)
                return null;
            offset = hash.newOffset;
            if (parseInt(hex.slice(offset, offset + 2), 16) !== 0xff)
                return null;
            offset += 2;
            return {
                constructor: constructor,
                hash: hash.value,
                newOffset: offset,
            };
        }
        else if (arrayByte === 0x81) {
            // 1-element definite array
            offset += 2;
            const hash = this.decodeCborByteArray(hex, offset);
            if (!hash)
                return null;
            return {
                constructor: constructor,
                hash: hash.value,
                newOffset: hash.newOffset,
            };
        }
        return null;
    }
    /** Decode a full RegistryNode datum from its inline CBOR hex. */
    decodeRegistryNodeDatum(datumHex) {
        try {
            // RegistryNode is Constr(0, [key, next, tl, tptl, gsc]) → d879 + array
            if (!datumHex.startsWith("d879"))
                return null;
            let offset = 4;
            const arrayByte = parseInt(datumHex.slice(offset, offset + 2), 16);
            if (arrayByte === 0x9f)
                offset += 2;
            else if (arrayByte >= 0x80 && arrayByte <= 0x9f)
                offset += 2;
            else
                return null;
            const key = this.decodeCborByteArray(datumHex, offset);
            if (!key)
                return null;
            const next = this.decodeCborByteArray(datumHex, key.newOffset);
            if (!next)
                return null;
            const tl = this.decodeCborCredential(datumHex, next.newOffset);
            if (!tl)
                return null;
            const tptl = this.decodeCborCredential(datumHex, tl.newOffset);
            if (!tptl)
                return null;
            const gsc = this.decodeCborByteArray(datumHex, tptl.newOffset);
            if (!gsc)
                return null;
            return {
                key: key.value,
                next: next.value,
                transferLogicConstructor: tl.constructor,
                transferLogicHash: tl.hash,
                thirdPartyTransferLogicConstructor: tptl.constructor,
                thirdPartyTransferLogicHash: tptl.hash,
                globalStateCs: gsc.value,
            };
        }
        catch {
            return null;
        }
    }
    /** Decode IssuanceCborHex datum { prefix_cbor_hex, postfix_cbor_hex } from CBOR hex. */
    decodeIssuanceCborHexDatum(datumHex) {
        try {
            if (!datumHex.startsWith("d879"))
                return null;
            let offset = 4;
            const arrayByte = parseInt(datumHex.slice(offset, offset + 2), 16);
            if (arrayByte === 0x9f)
                offset += 2;
            else if (arrayByte >= 0x80 && arrayByte <= 0x9f)
                offset += 2;
            else
                return null;
            const prefix = this.decodeCborByteArray(datumHex, offset);
            if (!prefix)
                return null;
            const postfix = this.decodeCborByteArray(datumHex, prefix.newOffset);
            if (!postfix)
                return null;
            return { prefix: prefix.value, postfix: postfix.value };
        }
        catch {
            return null;
        }
    }
    /** Find the covering registry node for a given insert key (28-byte policy ID as hex). */
    async findRegistryCoveringNode(registrySpendAddr, insertKey) {
        const utxos = await this.blockchainProvider.fetchAddressUTxOs(registrySpendAddr);
        console.log(`[FluidMesh] findRegistryCoveringNode addr=${registrySpendAddr} utxos=${utxos.length} insertKey=${insertKey}`);
        for (const utxo of utxos) {
            if (!utxo.output.plutusData) {
                console.log(`[FluidMesh]   UTxO ${utxo.input.txHash}#${utxo.input.outputIndex}: no plutusData`);
                continue;
            }
            const node = this.decodeRegistryNodeDatum(utxo.output.plutusData);
            if (!node) {
                console.log(`[FluidMesh]   UTxO ${utxo.input.txHash}#${utxo.input.outputIndex}: datum decode FAILED, raw=${utxo.output.plutusData.slice(0, 80)}...`);
                continue;
            }
            // Covering condition: node.key < insertKey < node.next (bytewise via hex string comparison)
            const covers = node.key < insertKey && insertKey < node.next;
            console.log(`[FluidMesh]   Node key="${node.key.slice(0, 8) || "<empty>"}" next="${node.next.slice(0, 8) || "<empty>"}" covers=${covers}`);
            if (covers) {
                return { node, utxo };
            }
        }
        return null;
    }
    /**
     * Find the single UTxO that holds a specific asset by querying the asset's
     * holder addresses via Maestro, then fetching UTxOs at that address.
     *
     * This avoids having to know the exact address (e.g. always_fail is nonce-
     * parameterised, so its address is not predictable from the blueprint alone).
     */
    async findUtxoHoldingAsset(assetUnit) {
        const addresses = await this.blockchainProvider.fetchAssetAddresses(assetUnit);
        if (addresses.length === 0)
            return null;
        const utxos = await this.blockchainProvider.fetchAddressUTxOs(addresses[0].address);
        return (utxos.find((u) => u.output.amount.some((a) => a.unit === assetUnit)) ??
            null);
    }
    // ─── Register policy in registry ──────────────────────────────────────────
    /**
     * Register a newly deployed issuance policy in the CIP-113 token registry.
     *
     * Executes a registry_mint RegistryInsert transaction that:
     *  1. Takes a reference input: ProtocolParams UTxO (for registry_spend)
     *  2. Takes a reference input: IssuanceCborHex UTxO (for registry_mint validation)
     *  3. Spends the covering registry node (via registry_spend)
     *  4. Mints 1 new registry node token (via registry_mint, RegistryInsert redeemer)
     *  5. Also mints `quantity` issuance tokens (required by is_programmable_token_registration)
     *  6. Outputs the updated covering node + new node at the registry_spend address
     *  7. Outputs the minted issuance tokens to the admin's smart receiver address
     */
    async registerInRegistry(wallet, policyData, quantity) {
        try {
            if (!registryPolicyId)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "NEXT_PUBLIC_REGISTRY_POLICY_ID is not set");
            if (!issuanceCborHexPolicyId)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "NEXT_PUBLIC_ISSUANCE_CBOR_HEX_POLICY_ID is not set");
            const walletAddress = await wallet.getChangeAddress();
            const utxos = await wallet.getUtxos();
            const collateral = await getCollateral(wallet, walletAddress);
            // ── 1. Find registry_spend address from on-chain head node ────────────────
            // The local blueprint CBOR may differ from the deployed script (parameter
            // encoding mismatch). Instead, locate the head-node NFT on-chain and read
            // its address directly — that is always the registry_spend address.
            const headNodeUtxo = await this.findUtxoHoldingAsset(registryPolicyId);
            if (!headNodeUtxo)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "Registry head node not found on-chain – check NEXT_PUBLIC_REGISTRY_POLICY_ID or registry may not be initialized");
            const registrySpendAddr = headNodeUtxo.output.address;
            // ── 2 & 3. Fetch reference UTxOs by asset unit ───────────────────────────
            // always_fail is nonce-parameterised, so its address is unknown to us.
            // Instead we locate each reference NFT directly via its known asset unit.
            const issuanceCborHexTokenUnit = issuanceCborHexPolicyId + stringToHex("IssuanceCborHex");
            const issuanceCborHexUtxo = await this.findUtxoHoldingAsset(issuanceCborHexTokenUnit);
            if (!issuanceCborHexUtxo)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "IssuanceCborHex UTxO not found on chain – check NEXT_PUBLIC_ISSUANCE_CBOR_HEX_POLICY_ID");
            const protocolParamsTokenUnit = protocolParamsPolicyId + stringToHex("ProtocolParams");
            const protocolParamsUtxo = await this.findUtxoHoldingAsset(protocolParamsTokenUnit);
            if (!protocolParamsUtxo)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "ProtocolParams UTxO not found on chain – check NEXT_PUBLIC_PROTOCOL_PARAMS_POLICY_ID");
            // ── 4. Decode IssuanceCborHex datum → prefix / postfix ───────────────────
            if (!issuanceCborHexUtxo.output.plutusData)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "IssuanceCborHex UTxO has no inline datum");
            const issuanceDatum = this.decodeIssuanceCborHexDatum(issuanceCborHexUtxo.output.plutusData);
            if (!issuanceDatum)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "Failed to decode IssuanceCborHex datum");
            // ── 5. Compute hashed_param ───────────────────────────────────────────────
            // MeshSDK's applyParamsToScript returns CBOR(flat_bytes) — a CBOR bytestring
            // wrapping the raw flat-encoded UPLC program.
            // The Cardano ledger hashes V3 scripts as: blake2b_224(0x03 || flat_bytes)
            // On-chain apply_hashed_parameter (utils.ak) prepends #"03" itself, so:
            //   blake2b_224(0x03 || prefix || hashed_param || postfix) == policyHash
            //   → prefix || hashed_param || postfix = flat_bytes  (NOT CBOR(flat_bytes))
            // We must strip the CBOR bytestring header to obtain flat_bytes first.
            const cborUnwrapped = this.decodeCborByteArray(policyData.issuanceMint.scriptCbor, 0);
            if (!cborUnwrapped)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "Failed to unwrap CBOR bytestring header from issuance_mint scriptCbor");
            const scriptBodyHex = cborUnwrapped.value; // flat UPLC bytes (no CBOR wrapper)
            const { prefix: prefixHex, postfix: postfixHex } = issuanceDatum;
            if (scriptBodyHex.length <= prefixHex.length + postfixHex.length)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "issuance_mint flat bytes shorter than prefix + postfix – cannot extract hashed_param");
            const hashedParam = scriptBodyHex.slice(prefixHex.length, scriptBodyHex.length - postfixHex.length);
            // ── 6. Fetch registry_mint + registry_spend CBOR from Maestro ─────────────
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const scriptResp = await this.blockchainProvider.get(`scripts/${registryPolicyId}`);
            const registryMintCbor = scriptResp?.data?.bytes ??
                scriptResp?.script?.bytes ??
                scriptResp?.bytes;
            if (!registryMintCbor)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "Could not fetch registry_mint script CBOR from Maestro – check NEXT_PUBLIC_REGISTRY_POLICY_ID");
            if (!registrySpendScriptHash)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "NEXT_PUBLIC_REGISTRY_SPEND_SCRIPT_HASH is not set");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const spendResp = await this.blockchainProvider.get(`scripts/${registrySpendScriptHash}`);
            const registrySpendCbor = spendResp?.data?.bytes ?? spendResp?.script?.bytes ?? spendResp?.bytes;
            if (!registrySpendCbor)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, "Could not fetch registry_spend script CBOR from Maestro – check NEXT_PUBLIC_REGISTRY_SPEND_SCRIPT_HASH");
            // ── 7. Find the covering registry node ────────────────────────────────────
            const insertKey = policyData.issuanceMint.policyHash; // 28-byte hex = 56 chars
            const covering = await this.findRegistryCoveringNode(registrySpendAddr, insertKey);
            if (!covering)
                throw new FluidMeshError(FluidMeshErrorCode.INVALID_CONFIGURATION, `No covering registry node found for key ${insertKey} – registry may not be initialised`);
            const { node: coveringNode, utxo: coveringUtxo } = covering;
            // ── 8. Build updated covering node datum (all fields preserved, next→insertKey) ──
            const coveringTlCred = coveringNode.transferLogicConstructor === 0
                ? conStr0([byteString(coveringNode.transferLogicHash)])
                : conStr1([byteString(coveringNode.transferLogicHash)]);
            const coveringTptlCred = coveringNode.thirdPartyTransferLogicConstructor === 0
                ? conStr0([byteString(coveringNode.thirdPartyTransferLogicHash)])
                : conStr1([byteString(coveringNode.thirdPartyTransferLogicHash)]);
            const updatedCoveringDatum = conStr0([
                byteString(coveringNode.key),
                byteString(insertKey), // next updated to insertKey
                coveringTlCred,
                coveringTptlCred,
                byteString(coveringNode.globalStateCs),
            ]);
            // ── 9. Build new inserted registry node datum ─────────────────────────────
            const insertedNodeDatum = conStr0([
                byteString(insertKey),
                byteString(coveringNode.next), // next = what covering had
                conStr1([
                    byteString(policyData.freezeAndSeize.transferLogic.policyHash),
                ]),
                conStr1([
                    byteString(policyData.freezeAndSeize.issuerAdminContract.policyHash),
                ]),
                byteString(""), // global_state_cs: empty
            ]);
            // ── 10. Determine covering node ADA + token unit ──────────────────────────
            const coveringNodeLovelace = coveringUtxo.output.amount.find((a) => a.unit === "lovelace")
                ?.quantity ?? "2000000";
            // Registry node token name == node.key ('' for origin node → unit = policyId alone)
            const coveringNodeTokenUnit = registryPolicyId + coveringNode.key;
            // ── 11. Build transaction ─────────────────────────────────────────────────
            const txBuilder = this.getTxBuilder();
            // Spend the covering registry node (registry_spend validates via protocol params ref input)
            txBuilder
                .spendingPlutusScript("V3")
                .txIn(coveringUtxo.input.txHash, coveringUtxo.input.outputIndex)
                .txInInlineDatumPresent()
                .txInScript(registrySpendCbor)
                .txInRedeemerValue(conStr0([]), "JSON");
            // Reference inputs (not spent)
            txBuilder
                .readOnlyTxInReference(protocolParamsUtxo.input.txHash, protocolParamsUtxo.input.outputIndex)
                .readOnlyTxInReference(issuanceCborHexUtxo.input.txHash, issuanceCborHexUtxo.input.outputIndex);
            // ── issuance_mint requires its output to be tx output[0] ─────────────────
            // The issuance_mint validator checks list.head(self.outputs) for the
            // programmable_logic_base payment credential + inline stake credential.
            // Registry node outputs do NOT have the registry NFT as far as issuance_mint
            // is concerned, so putting the issuance output first is safe for registry_mint
            // (which uses list.any() to find its two node outputs regardless of position).
            // Output 0: minted issuance tokens to admin's smart receiver address
            txBuilder
                .txOut(policyData.smartReceiverAddress, [
                { unit: "lovelace", quantity: "2000000" },
                {
                    unit: policyData.issuanceMint.policyHash + policyData.tokenNameHex,
                    quantity,
                },
            ])
                .txOutInlineDatumValue(conStr0([]), "JSON");
            // Output 1: updated covering node (next → insertKey)
            txBuilder
                .txOut(registrySpendAddr, [
                { unit: "lovelace", quantity: coveringNodeLovelace },
                { unit: coveringNodeTokenUnit, quantity: "1" },
            ])
                .txOutInlineDatumValue(updatedCoveringDatum, "JSON");
            // Output 2: new inserted registry node
            txBuilder
                .txOut(registrySpendAddr, [
                { unit: "lovelace", quantity: "2000000" },
                { unit: registryPolicyId + insertKey, quantity: "1" },
            ])
                .txOutInlineDatumValue(insertedNodeDatum, "JSON");
            // Mint: registry node token (RegistryInsert redeemer = conStr1([key, hashed_param]))
            txBuilder
                .mintPlutusScriptV3()
                .mint("1", registryPolicyId, insertKey)
                .mintingScript(registryMintCbor)
                .mintRedeemerValue(conStr1([byteString(insertKey), byteString(hashedParam)]), "JSON");
            // Mint: issuance tokens (required by is_programmable_token_registration check in registry_mint)
            txBuilder
                .mintPlutusScriptV3()
                .mint(quantity, policyData.issuanceMint.policyHash, policyData.tokenNameHex)
                .mintingScript(policyData.issuanceMint.scriptCbor)
                .mintRedeemerValue(conStr0([
                conStr1([
                    byteString(policyData.freezeAndSeize.issuerAdminContract.policyHash),
                ]),
            ]), "JSON");
            // Withdrawal: issuer_admin_contract (authorises issuance_mint)
            txBuilder
                .withdrawalPlutusScriptV3()
                .withdrawal(policyData.freezeAndSeize.issuerAdminContract.rewardAddress, "0")
                .withdrawalScript(policyData.freezeAndSeize.issuerAdminContract.scriptCbor)
                .withdrawalRedeemerValue(integer(0), "JSON");
            await txBuilder
                .requiredSignerHash(policyData.adminPkh)
                .txInCollateral(collateral.txHash, collateral.outputIndex)
                .selectUtxosFrom(utxos)
                .changeAddress(walletAddress)
                .setNetwork(maestroNetwork)
                .complete();
            const unsignedTx = txBuilder.txHex;
            const signedTx = await wallet.signTx(unsignedTx, true);
            const txHash = await wallet.submitTx(signedTx);
            return createSuccessResult({ txHash }, FluidMeshSuccessCode.MINTING_SUCCESS);
        }
        catch (error) {
            console.error("Error registering policy in registry:", error);
            return createErrorResult(FluidMeshError.fromError(error));
        }
    }
    // ─── Token queries ─────────────────────────────────────────────────────────
    async getCIP113TokensForAddress(smartReceiverAddress) {
        try {
            const utxos = await this.blockchainProvider.fetchAddressUTxOs(smartReceiverAddress);
            const tokens = [];
            for (const utxo of utxos) {
                for (const asset of utxo.output.amount) {
                    if (asset.unit === "lovelace")
                        continue;
                    const policyId = asset.unit.slice(0, 56);
                    const assetName = asset.unit.slice(56);
                    tokens.push({
                        unit: asset.unit,
                        quantity: asset.quantity,
                        policyId,
                        assetName,
                        assetNameDecoded: this.hexToString(assetName),
                        utxoHash: utxo.input.txHash,
                        utxoIndex: utxo.input.outputIndex,
                    });
                }
            }
            return createSuccessResult(tokens, FluidMeshSuccessCode.MINTING_SUCCESS);
        }
        catch (error) {
            return createErrorResult(FluidMeshError.fromError(error));
        }
    }
    /**
     * Get all CIP-113 tokens for a wallet.
     * In v0.3.0, all policies share the same payment credential (progLogicBase),
     * so one address lookup covers all policies for a user.
     */
    async getAllCIP113TokensForWallet(wallet, policies) {
        try {
            if (policies.length === 0) {
                return createSuccessResult(new Map(), FluidMeshSuccessCode.MINTING_SUCCESS);
            }
            const stakeKeyHash = await this.getStakeKeyHash(wallet);
            // All policies share the same progLogicBase – always use the canonical CBOR from config
            const protocol = this.getProtocolScripts();
            const smartAddr = this.getSmartReceiverAddress(protocol.programmableLogicBase.scriptCbor, stakeKeyHash);
            const allTokensResult = await this.getCIP113TokensForAddress(smartAddr);
            if (!allTokensResult.success || !allTokensResult.data) {
                return createSuccessResult(new Map(), FluidMeshSuccessCode.MINTING_SUCCESS);
            }
            const resultMap = new Map();
            for (const policy of policies) {
                const policyTokens = allTokensResult.data.filter((t) => t.policyId === policy.policyId);
                if (policyTokens.length > 0) {
                    resultMap.set(policy.policyId, {
                        tokens: policyTokens.map((t) => ({
                            unit: t.unit,
                            quantity: t.quantity,
                            assetName: t.assetName,
                            assetNameDecoded: t.assetNameDecoded,
                            utxoHash: t.utxoHash,
                            utxoIndex: t.utxoIndex,
                        })),
                        tokenName: policy.tokenName,
                    });
                }
            }
            return createSuccessResult(resultMap, FluidMeshSuccessCode.MINTING_SUCCESS);
        }
        catch (error) {
            return createErrorResult(FluidMeshError.fromError(error));
        }
    }
    // ─── UTxO selection ────────────────────────────────────────────────────────
    selectUtxoForTransfer(tokens, amount) {
        const amountBN = BigInt(amount);
        const sorted = [...tokens].sort((a, b) => Number(BigInt(b.quantity) - BigInt(a.quantity)));
        for (const t of sorted) {
            if (BigInt(t.quantity) >= amountBN) {
                return { utxos: [`${t.utxoHash}#${t.utxoIndex}`], balance: t.quantity };
            }
        }
        const selected = [];
        let total = BigInt(0);
        for (const t of sorted) {
            selected.push(`${t.utxoHash}#${t.utxoIndex}`);
            total += BigInt(t.quantity);
            if (total >= amountBN)
                return { utxos: selected, balance: total.toString() };
        }
        return null;
    }
    // ─── Helpers ───────────────────────────────────────────────────────────────
    hexToString(hex) {
        try {
            if (!hex)
                return "";
            return Buffer.from(hex, "hex").toString("utf8");
        }
        catch {
            return hex;
        }
    }
    /**
     * Get stake key hash from a base address.
     * For reward/stake-only addresses, pubKeyHash gives the stake key.
     * For base addresses with a stake key, we use the wallet reward address path instead.
     */
    async getStakeKeyHashFromAddress(address) {
        // Try to extract stakeCredentialHash from the address
        const parsed = deserializeAddress(address);
        // In Mesh SDK, stakeCredentialHash is available if the address is a base address
        if (parsed.stakeCredentialHash) {
            return parsed.stakeCredentialHash;
        }
        // Fallback: treat address as stake address and use pubKeyHash
        return parsed.pubKeyHash;
    }
    findCoveringNode(utxos, targetKey) {
        for (const utxo of utxos) {
            if (!utxo.output.plutusData)
                continue;
            try {
                // BlacklistNode datum is Constr(0, [key_bytes, next_bytes]) = CBOR hex
                // Decode using the same CBOR helpers used for RegistryNode
                const datumHex = utxo.output.plutusData;
                if (!datumHex.startsWith("d879"))
                    continue;
                let offset = 4;
                const arrayByte = parseInt(datumHex.slice(offset, offset + 2), 16);
                if (arrayByte === 0x9f)
                    offset += 2;
                else if (arrayByte >= 0x80 && arrayByte <= 0x9f)
                    offset += 2;
                else
                    continue;
                const keyResult = this.decodeCborByteArray(datumHex, offset);
                if (!keyResult)
                    continue;
                const nextResult = this.decodeCborByteArray(datumHex, keyResult.newOffset);
                if (!nextResult)
                    continue;
                const key = keyResult.value;
                const next = nextResult.value;
                // Covering: key < targetKey < next (strict; key="" covers everything initially)
                if (key < targetKey && targetKey < next) {
                    return {
                        key,
                        next,
                        utxoHash: utxo.input.txHash,
                        utxoIndex: utxo.input.outputIndex,
                    };
                }
            }
            catch {
                continue;
            }
        }
        return null;
    }
    selectTokenUtxos(utxos, tokenUnit, amount) {
        const amountBN = BigInt(amount);
        const selected = [];
        let total = BigInt(0);
        for (const utxo of utxos) {
            const asset = utxo.output.amount.find((a) => a.unit === tokenUnit);
            if (!asset)
                continue;
            selected.push(utxo);
            total += BigInt(asset.quantity);
            if (total >= amountBN)
                return { utxos: selected, balance: total.toString() };
        }
        return null;
    }
}
export default FluidMesh;
export const getFluidMesh = () => new FluidMesh();
