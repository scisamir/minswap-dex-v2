# Contributing to this project

Thanks for considering contributing and help us on building this project!

The best way to contribute right now is to try things out and provide feedback, but we also accept contributions to the documentation and obviously to the code itself.

This document contains guidelines to help you get started and how to make sure your contribution gets accepted, making you our newest contributor!

## Communication channels

Should you have any questions or need some help in getting set up, you can use these communication channels to reach the team and get answers in a way where others can benefit from it as well:

- [CIP-113 Pull Request](https://github.com/cardano-foundation/CIPs/pull/444) - For standard-related discussions and feedback
- GitHub [Issues](../../issues) - For bug reports and implementation-specific issues

**Note:** As this implementation is based on the evolving CIP-113 standard, we encourage participation in the CIP-113 discussion while the standard is being finalized.

## Your first contribution 

Contributing to the documentation, its translation, reporting bugs or proposing features are awesome ways to get started.

Also, take a look at the tests. Making sure we have the best high quality test suite is vital for this project.

### Documentation

Documentation is available in the [README](./README.md) and in the respective component directories:
- [Aiken Smart Contracts Documentation](./src/programmable-tokens-onchain-aiken/README.md)
- [Java Off-chain Documentation](./src/programmable-tokens-offchain-java/README.md)

### Bug reports

[Submit an issue](../../issues/new) for implementation-specific bugs.

For bug reports, it's very important to explain:
* What version/commit you used
* Steps to reproduce (or steps you took)
* What behavior you saw (ideally supported by logs)
* What behavior you expected

For issues related to the CIP-113 standard itself, please use the [CIP-113 Pull Request](https://github.com/cardano-foundation/CIPs/pull/444).

### Feature ideas

Feature ideas and enhancement proposals are welcome! Since this implementation follows the CIP-113 standard, feature discussions should consider:

- **Standard-level features**: Discuss in the [CIP-113 Pull Request](https://github.com/cardano-foundation/CIPs/pull/444)
- **Implementation-specific features**: [Submit an issue](../../issues/new) in this repository

We expect a description of:
* Why you (or the user) need/want something (e.g. problem, challenge, pain, benefit)
* What this is roughly about (e.g. description of a new validator or API endpoint)

Note that we do NOT require a detailed technical description, but are much more interested in *why* a feature is needed. This also helps in understanding the relevance and ultimately the priority of such an item.

## Making changes

When contributing code, it helps to have discussed the rationale and (ideally) how something is implemented in a feature idea or bug ticket beforehand.

### Building & Testing

**Smart Contracts (Aiken):**
```bash
cd src/programmable-tokens-onchain-aiken
aiken build
aiken check  # Run all tests
```

**Off-chain (Java/Gradle):**
```bash
cd src/programmable-tokens-offchain-java
./gradlew build
./gradlew test
```

Make sure **all** tests are successful before submitting a pull request.

### Coding standards

**Java code**: Follow the [Google style guide for Java](https://google.github.io/styleguide/javaguide.html)

**Aiken code**: Follow [Aiken best practices](https://aiken-lang.org) and conventions

More importantly, check if the coding style you find is consistent and report or fix any inconsistencies by filing an issue or a pull request. Make sure to file a separate pull request for style changes.

In general regarding code style, take a look at the existing sources and make your code consistent with them.

### Creating a pull request

Thank you for contributing your changes by opening a pull request! To get something merged we usually require:
+ Description of the changes - if your commit messages are great, this is less important
+ Quality of changes is ensured - through new or updated automated tests
+ Change is related to an issue, feature (idea) or bug report - ideally discussed beforehand
+ Well-scoped - we prefer multiple PRs, rather than a big one

**Note:** This project is currently in R&D phase. As the CIP-113 standard evolves, significant changes may be required. We appreciate your understanding and flexibility during this development period.
