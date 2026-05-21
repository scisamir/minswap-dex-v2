use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, Credential, Inline, Script, VerificationKey}
use cardano/assets.{PolicyId}
use cardano/transaction.{Input, Output, Transaction}
use purrfluid/purrfluid_types.{
  WhitelistMembership, WhitelistNode, WhitelistProof,
}
use utils.{bytearray_lt, expect_inline_datum}

validator purrfluid_transfer(
  programmable_logic_base: Credential,
  token_policy: PolicyId,
  whitelist_policy: PolicyId,
) {
  withdraw(
    proofs: List<WhitelistProof>,
    _account: Credential,
    self: Transaction,
  ) {
    let input_hashes =
      collect_input_hashes(self.inputs, programmable_logic_base, token_policy)

    let output_hashes =
      collect_output_hashes(self.outputs, programmable_logic_base, token_policy)

    let remaining_proofs =
      check_whitelist(
        input_hashes,
        proofs,
        self.reference_inputs,
        whitelist_policy,
      )

    let remaining_proofs =
      check_whitelist(
        output_hashes,
        remaining_proofs,
        self.reference_inputs,
        whitelist_policy,
      )

    when remaining_proofs is {
      [] -> True
      _ -> fail
    }
  }

  else(_) {
    fail
  }
}

fn collect_input_hashes(
  inputs: List<Input>,
  programmable_logic_base: Credential,
  token_policy: PolicyId,
) -> List<ByteArray> {
  list.foldr(
    inputs,
    [],
    fn(input, hashes) {
      let output = input.output

      if output.address.payment_credential == programmable_logic_base && has_token_policy(
        output,
        token_policy,
      ) {
        [output_stake_hash(output), ..hashes]
      } else {
        hashes
      }
    },
  )
}

fn collect_output_hashes(
  outputs: List<Output>,
  programmable_logic_base: Credential,
  token_policy: PolicyId,
) -> List<ByteArray> {
  list.foldr(
    outputs,
    [],
    fn(output, hashes) {
      if output.address.payment_credential == programmable_logic_base && has_token_policy(
        output,
        token_policy,
      ) {
        [output_stake_hash(output), ..hashes]
      } else {
        hashes
      }
    },
  )
}

fn check_whitelist(
  hashes: List<ByteArray>,
  proofs: List<WhitelistProof>,
  reference_inputs: List<Input>,
  whitelist_policy: PolicyId,
) -> List<WhitelistProof> {
  when hashes is {
    [] -> proofs
    [hash, ..tail] -> {
      expect [proof, ..rest] = proofs
      expect is_whitelisted(hash, proof, reference_inputs, whitelist_policy)

      check_whitelist(tail, rest, reference_inputs, whitelist_policy)
    }
  }
}

fn is_whitelisted(
  hash: ByteArray,
  proof: WhitelistProof,
  reference_inputs: List<Input>,
  whitelist_policy: PolicyId,
) -> Bool {
  let WhitelistMembership { node_idx } = proof
  expect Some(ref_input) = list.at(reference_inputs, node_idx)

  let node = validate_whitelist_node(ref_input.output, whitelist_policy)

  node.key == hash
}

fn validate_whitelist_node(
  output: Output,
  whitelist_policy: PolicyId,
) -> WhitelistNode {
  let whitelist_address = Address(Script(whitelist_policy), None)

  expect output.address == whitelist_address
  expect None = output.reference_script

  expect [Pair(actual_policy, node_tokens)] =
    assets.to_dict(output.value) |> dict.expect_tail() |> dict.to_pairs()

  expect actual_policy == whitelist_policy
  expect [Pair(token_name, 1)] = dict.to_pairs(node_tokens)

  expect node: WhitelistNode = expect_inline_datum(output)

  expect token_name == node.key
  expect bytearray_lt(node.key, node.next)

  node
}

fn output_stake_hash(output: Output) -> ByteArray {
  expect Some(Inline(stake_cred)) = output.address.stake_credential

  when stake_cred is {
    VerificationKey(hash) -> hash
    Script(hash) -> hash
  }
}

fn has_token_policy(output: Output, policy: PolicyId) -> Bool {
  !(assets.tokens(output.value, policy) |> dict.is_empty)
}
