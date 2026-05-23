pub const origin_key = #""

pub const sentinel_next_key =
  #"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"

pub type WhitelistNode {
  key: ByteArray,
  next: ByteArray,
}

pub type WhitelistRedeemer {
  WhitelistInit
  WhitelistInsert { key: ByteArray }
  WhitelistRemove { key: ByteArray }
}

pub type WhitelistProof {
  WhitelistMembership { node_idx: Int }
}
