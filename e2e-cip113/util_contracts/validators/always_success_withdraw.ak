use cardano/address.{Credential}
use cardano/transaction.{Transaction}

validator always_success {
  withdraw(_redeemer: Data, _account: Credential, _self: Transaction) {
    True
  }

  else(_) {
    fail
  }
}
