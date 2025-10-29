# KipuBankV3

A capped Ethereum custodial bank with Uniswap V4 integration that allows users to deposit ETH, USDC, or any supported ERC20 token. Arbitrary tokens are automatically swapped to USDC for unified accounting and simplified bank cap enforcement.

## Overview

KipuBankV3 extends the original KipuBank concept with multi-token support and automated token swapping via Uniswap V4. The contract maintains strict limits on total holdings and per-transaction withdrawals, uses Chainlink oracles for accurate USD valuations, and implements comprehensive security measures including reentrancy protection and oracle hygiene checks.

### Key Features

- **Multi-Token Support**: Accept ETH, USDC, or any whitelisted ERC20 token
- **Automatic Token Swapping**: Arbitrary tokens are automatically converted to USDC via Uniswap V4
- **Unified USD Accounting**: All deposits tracked in USD (8 decimals) using Chainlink price feeds
- **Bank Cap Enforcement**: Total bank balance never exceeds configured USD limit
- **Per-Transaction Limits**: Configurable withdrawal limits in both USD and native token amounts
- **Oracle Hygiene**: Stale price detection and invalid data rejection
- **Access Control**: Role-based admin functions for token management
- **ERC-7528 Compliance**: Canonical ETH address handling

## Architecture

### Core Components

#### Smart Contracts

- **KipuBankV3.sol**: Main bank contract with deposit/withdraw logic and Uniswap integration
- **MockUSDC.sol**: ERC20 USDC token with 6 decimals (testing)
- **MockERC20.sol**: Generic ERC20 with configurable decimals (testing)
- **MockUniversalRouter.sol**: Simplified Uniswap V4 router with configurable exchange rates (testing)
- **MockV3Aggregator.sol**: Chainlink price feed oracle (testing)

#### Design Decisions

**Why USDC as Base Currency?**
- Simplifies accounting by converting all tokens to single denomination
- Enables precise bank cap enforcement in USD terms
- Reduces complexity of multi-token balance tracking
- USDC is widely available and highly liquid on Uniswap

**Why Mock Uniswap V4?**
- Uniswap V4 not yet deployed on most testnets
- Mock implementation allows development and testing
- Real Uniswap V4 integration can be swapped in when available
- Mock provides configurable exchange rates for testing scenarios

**Single-Hop Swaps Only**
- Simplified implementation for exam requirements
- Reduced gas costs
- Lower attack surface
- Sufficient for most common token pairs

### Token Flow

```
User deposits arbitrary token (e.g., DAI)
    ↓
Transfer token to KipuBankV3
    ↓
Approve UniversalRouter
    ↓
Execute swap: DAI → USDC
    ↓
Check bank cap with new USDC amount
    ↓
Credit user's USDC balance
    ↓
Emit events (TokenSwapped, Deposit)
```

## Deployment

### Local Development

1. **Start local blockchain**
   ```bash
   yarn chain
   ```

2. **Deploy contracts** (in new terminal)
   ```bash
   yarn deploy
   ```

   This deploys:
   - MockV3Aggregator (ETH/USD) - $2,000 per ETH
   - MockUSDC - 6 decimals
   - MockV3Aggregator (USDC/USD) - $1.00 per USDC
   - MockDAI - 18 decimals, 1:1 exchange rate with USDC
   - MockLINK - 18 decimals, 15:1 exchange rate with USDC
   - MockUniversalRouter - with configured exchange rates
   - KipuBankV3 - with $1M cap, $10K per-tx withdraw limit

3. **Run tests**
   ```bash
   cd packages/hardhat
   yarn test
   ```

4. **Start frontend** (optional)
   ```bash
   yarn start
   ```
   Visit http://localhost:3000/debug to interact with contracts

### Sepolia Testnet Deployment

1. **Set up environment**
   ```bash
   cd packages/hardhat
   yarn account:generate  # or yarn account:import
   ```

2. **Fund deployer account** with Sepolia ETH from faucet

3. **Deploy to Sepolia**
   ```bash
   yarn deploy --network sepolia
   ```

4. **Verify contracts on Etherscan**
   ```bash
   yarn hardhat-verify --network sepolia
   ```

### Deployed Contract Addresses

#### Sepolia Testnet
- **KipuBankV3**: `[TO BE DEPLOYED]`
- **MockUSDC**: `[TO BE DEPLOYED]`
- **MockUniversalRouter**: `[TO BE DEPLOYED]`
- **MockDAI**: `[TO BE DEPLOYED]`
- **MockLINK**: `[TO BE DEPLOYED]`
- **ETH/USD Oracle**: `0x694AA1769357215DE4FAC081bf1f309aDC325306`
- **USDC/USD Oracle**: `[TO BE DEPLOYED]`

## Usage

### Depositing Tokens

#### ETH Deposits
```solidity
// Deposit 1 ETH
kipuBankV3.depositETH{value: 1 ether}();
```

#### USDC Deposits
```solidity
// Approve and deposit 1000 USDC
usdc.approve(address(kipuBankV3), 1000e6);
kipuBankV3.depositERC20(address(usdc), 1000e6);
```

#### Arbitrary Token Deposits (with automatic swap)
```solidity
// Approve and deposit 100 DAI (will be swapped to USDC)
dai.approve(address(kipuBankV3), 100e18);
kipuBankV3.depositArbitraryToken(address(dai), 100e18);

// Approve and deposit 10 LINK (will be swapped to USDC)
link.approve(address(kipuBankV3), 10e18);
kipuBankV3.depositArbitraryToken(address(link), 10e18);
```

### Withdrawing Tokens

```solidity
// Withdraw 500 USDC
kipuBankV3.withdraw(address(usdc), 500e6);

// Withdraw 0.5 ETH
kipuBankV3.withdraw(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE, 0.5 ether);
```

### Checking Balances

```solidity
// Check USDC balance
uint256 balance = kipuBankV3.checkBalance(userAddress, address(usdc));

// Check ETH balance
uint256 ethBalance = kipuBankV3.checkBalance(
    userAddress, 
    0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
);

// Check total bank balance in USD
uint256 totalUSD = kipuBankV3.totalBankBalanceUSD8(); // 8 decimals

// Check remaining capacity
uint256 remaining = kipuBankV3.remainingBankCapacityUSD8(); // 8 decimals
```

### Admin Functions

```solidity
// Register new token with price feed
kipuBankV3.registerToken(tokenAddress, priceFeedAddress);

// Add token to swap whitelist
kipuBankV3.addSupportedToken(tokenAddress);

// Remove token from swap whitelist
kipuBankV3.removeSupportedToken(tokenAddress);

// Update price feed for existing token
kipuBankV3.updatePriceFeed(tokenAddress, newPriceFeedAddress);

// Set native ETH per-tx cap (0 = no cap)
kipuBankV3.setNativePerTxCapWei(1 ether);

// Emergency fund recovery
kipuBankV3.adminRecoverFunds(userAddress, tokenAddress, newBalance, reason);
```

## Testing

The project includes comprehensive test coverage:

- **84 total tests** (100% passing)
  - 55 tests for V2 functionality (ETH deposits/withdrawals, oracles, admin functions)
  - 29 tests for Uniswap V4 integration

### Test Categories

- Configuration and setup
- Direct USDC deposits
- Arbitrary token deposits with swaps
- Bank cap enforcement after swaps
- Withdrawals after token swaps
- Admin functions
- Edge cases and error handling
- Multiple user scenarios
- V2 functionality preservation
- Reentrancy protection
- Gas optimization

### Running Tests

```bash
cd packages/hardhat

# Run all tests
yarn test

# Run specific test file
yarn test test/KippuBankV3Uniswap.ts

# Run with gas reporting
REPORT_GAS=true yarn test
```

## Security Considerations

### Oracle Security
- **Staleness Checks**: Rejects oracle data older than 1 hour
- **Data Validation**: Verifies `answeredInRound >= roundId`
- **Price Sanity**: Rejects zero or negative prices
- **Chainlink Integration**: Uses production-grade price feeds

### Token Security
- **SafeERC20**: All token transfers use OpenZeppelin's SafeERC20
- **Approval Management**: Uses `forceApprove` for modern approval handling
- **Token Whitelisting**: Only admin-approved tokens can be swapped
- **Balance Verification**: Pre/post-swap balance checks

### Access Control
- **Role-Based**: Uses OpenZeppelin's AccessControl
- **Admin Functions**: Token registration, whitelist management, recovery
- **Separation of Concerns**: Users can't affect bank configuration

### Reentrancy Protection
- **Custom Guard**: Lightweight reentrancy protection on all state-changing functions
- **Checks-Effects-Interactions**: Follows CEI pattern throughout
- **No External Calls Before State Updates**: State updated before external interactions

### Bank Cap Enforcement
- **Post-Swap Validation**: Bank cap checked after swap completes
- **Automatic Refund**: USDC returned to user if cap would be exceeded
- **USD Denomination**: All caps in consistent USD terms (8 decimals)

## Trade-offs and Design Decisions

### Mock vs Real Uniswap V4
**Decision**: Use mock contracts for testing
- **Pros**: Works on any network, configurable rates, simplified testing
- **Cons**: Must update to real Uniswap when available
- **Mitigation**: Clean interface separation enables easy migration

### USDC as Base Currency
**Decision**: Convert all deposits to USDC
- **Pros**: Simplified accounting, easier cap enforcement, single denomination
- **Cons**: Exposure to USDC price fluctuations, swap costs
- **Mitigation**: USDC highly stable, users aware of conversion

### Single-Hop Swaps
**Decision**: Direct token-to-USDC swaps only
- **Pros**: Lower gas costs, reduced complexity, smaller attack surface
- **Cons**: May not have optimal rates for all token pairs
- **Mitigation**: Sufficient for common tokens, can add multi-hop later

### No Slippage Parameters
**Decision**: Mock router uses fixed rates
- **Pros**: Simplified testing, predictable outcomes
- **Cons**: Real Uniswap needs slippage protection
- **Mitigation**: Production version should add minAmountOut parameter

### 8-Decimal USD Accounting
**Decision**: Match Chainlink feed decimals
- **Pros**: No decimal conversion needed, precision preserved
- **Cons**: Different from token decimals (USDC has 6)
- **Mitigation**: Clear documentation, conversion functions

## Gas Optimization

- **Unchecked Counters**: Deposit/withdraw counts use unchecked increment
- **Immutable Variables**: USDC, router, oracles stored as immutable
- **Packed Storage**: Related state variables grouped for storage efficiency
- **Minimal External Calls**: Balance checks minimize oracle reads
- **Event Emission**: Strategic event placement for off-chain indexing

## Future Improvements

1. **Real Uniswap V4 Integration**: Replace mock with production router
2. **Multi-Hop Routing**: Support optimal paths for any token pair
3. **Slippage Protection**: Add user-configurable slippage tolerance
4. **Batch Operations**: Support multiple deposits/withdrawals in single tx
5. **Yield Generation**: Integrate with lending protocols for idle USDC
6. **NFT Receipts**: Issue NFTs as deposit receipts (ERC-721)
7. **Time Locks**: Optional withdrawal delays for security
8. **Emergency Pause**: Circuit breaker for critical issues

## Development

Built with Scaffold-ETH 2:
- **Hardhat**: Smart contract development and testing
- **TypeScript**: Type-safe development
- **OpenZeppelin**: Security-audited contract libraries
- **Chainlink**: Decentralized price oracles
- **Next.js**: Frontend framework (optional)

## License

MIT

## Contributing

This is an exam project for educational purposes. The implementation uses mock contracts for Uniswap V4 functionality as the protocol is not yet widely deployed on testnets.

## Acknowledgments

- OpenZeppelin for secure contract libraries
- Chainlink for reliable price feeds
- Uniswap for DEX protocol design
- Scaffold-ETH 2 for development framework
