use aiken/collection/dict
use aiken/collection/list
use aiken/primitive/bytearray
use cardano/address.{Credential, Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use types.{
  WhitelistInit, WhitelistInsert, WhitelistNode, WhitelistRedeemer,
  WhitelistRemove, origin_key, sentinel_next_key,
}
use utils.{
  bytearray_lt, expect_inline_datum, has_currency_symbol, tx_signed,
  validate_whitelist_node,
}

validator purrfluid_whitelist(
  seed_ref: OutputReference,
  manager_cred: Credential,
) {
  mint(redeemer: WhitelistRedeemer, policy_id: PolicyId, self: Transaction) {
    when redeemer is {
      WhitelistInit -> {
        expect
          list.any(
            self.inputs,
            fn(input) { input.output_reference == seed_ref },
          )

        expect tx_signed(manager_cred, self)

        expect [node_output] =
          list.filter(
            self.outputs,
            fn(output) { has_currency_symbol(output.value, policy_id) },
          )

        let node = validate_whitelist_node(node_output, policy_id)

        and {
          (validate_single_mint(self.mint, policy_id) == origin_key)?,
          (node.key == origin_key)?,
          (node.next == sentinel_next_key)?,
        }
      }

      WhitelistInsert { key } -> {
        expect bytearray.length(key) == 28

        expect tx_signed(manager_cred, self)

        expect [covering_input] =
          list.filter(
            self.inputs,
            fn(input) { has_currency_symbol(input.output.value, policy_id) },
          )

        expect covering_node: WhitelistNode =
          expect_inline_datum(covering_input.output)

        expect bytearray_lt(covering_node.key, key)
        expect bytearray_lt(key, covering_node.next)

        expect [out1,
          out2] =
          list.filter(
            self.outputs,
            fn(output) { has_currency_symbol(output.value, policy_id) },
          )

        let node1 = validate_whitelist_node(out1, policy_id)
        let node2 = validate_whitelist_node(out2, policy_id)

        let updated_ok =
          node1.key == covering_node.key && node1.next == key && node2.key == key && node2.next == covering_node.next

        let reversed_ok =
          node2.key == covering_node.key && node2.next == key && node1.key == key && node1.next == covering_node.next

        and {
          (validate_single_mint(self.mint, policy_id) == key)?,
          (updated_ok || reversed_ok)?,
        }
      }

      WhitelistRemove { key } -> {
        expect bytearray.length(key) == 28

        expect tx_signed(manager_cred, self)

        expect [input1,
          input2] =
          list.filter(
            self.inputs,
            fn(input) { has_currency_symbol(input.output.value, policy_id) },
          )

        expect node1: WhitelistNode = expect_inline_datum(input1.output)
        expect node2: WhitelistNode = expect_inline_datum(input2.output)

        expect [out] =
          list.filter(
            self.outputs,
            fn(output) { has_currency_symbol(output.value, policy_id) },
          )

        let output_node = validate_whitelist_node(out, policy_id)

        let remove_first =
          node1.key == key && node2.next == key && output_node.key == node2.key && output_node.next == node1.next

        let remove_second =
          node2.key == key && node1.next == key && output_node.key == node1.key && output_node.next == node2.next

        and {
          validate_single_burn(self.mint, policy_id, key)?,
          (remove_first || remove_second)?,
        }
      }
    }
  }

  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(own_input) =
      list.find(self.inputs, fn(input) { input.output_reference == own_ref })

    expect Script(own_hash) = own_input.output.address.payment_credential

    assets.to_dict(self.mint) |> dict.has_key(own_hash)
  }

  else(_) {
    fail
  }
}

fn validate_single_mint(mint: assets.Value, policy_id: PolicyId) -> ByteArray {
  expect [Pair(asset_name, 1)] =
    assets.tokens(mint, policy_id) |> dict.to_pairs()
  asset_name
}

fn validate_single_burn(
  mint: assets.Value,
  policy_id: PolicyId,
  key: ByteArray,
) -> Bool {
  expect [Pair(asset_name, -1)] =
    assets.tokens(mint, policy_id) |> dict.to_pairs()
  asset_name == key
}
