# KippuBankV3 Security and Compliance Fixes

## Overview
This document summarizes all the critical security and compliance fixes implemented in KippuBankV3.sol based on the security review feedback. All fixes have been thoroughly tested with comprehensive test suites.

## Critical Fixes Implemented

### 1. **USD Accounting Units Bug (MUST-FIX)**
**Problem**: Mixed 6-decimal and 8-decimal USD accounting causing inconsistencies.

**Solution**:
- Changed all USD accounting to use **8 decimals** (matching Chainlink feeds)
- Renamed variables: `BANK_CAP_USDC` → `BANK_CAP_USD8`, `MAX_WITHDRAW_PER_TX_USDC` → `MAX_WITHDRAW_PER_TX_USD8`, `totalBankBalanceUSDC` → `totalBankBalanceUSD8`
- Updated events: `amountInUSDC` → `amountInUSD8`
- Removed `/1e2` division in `_convertToUSD8()` function
- All calculations now use consistent 8-decimal USD values

**Impact**: Eliminates accounting inconsistencies and ensures proper USD value tracking.

### 2. **ERC-7528 ETH Address Compliance (MUST-FIX)**
**Problem**: Used non-standard `address(1)` for ETH pseudo-address.

**Solution**:
- Replaced `ETH_ADDRESS = address(1)` with `ETH_ALIAS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`
- Added `_canonicalizeToken()` function to normalize `address(0)` and `ETH_ALIAS` to canonical form
- Updated all internal storage and event emissions to use canonical ETH alias
- All user-facing functions accept flexible input (address(0) or ETH_ALIAS) but normalize internally

**Impact**: Full ERC-7528 compliance for ETH handling.

### 3. **Native Per-Tx Cap Missing (V1 Feature)**
**Problem**: Only USD-based withdrawal limits, no native wei caps for ETH.

**Solution**:
- Added `nativePerTxCapWei` state variable (default 0 = no cap)
- Added `setNativePerTxCapWei()` admin function with event emission
- Enhanced `withdraw()` to check both USD and native caps
- Added `WithdrawLimitPerTxNative` error for native cap violations
- Most restrictive cap wins when both are set

**Impact**: Additional security layer preventing large ETH withdrawals regardless of price.

### 4. **Oracle Hygiene Issues**
**Problem**: Insufficient oracle data validation.

**Solution**:
- Added staleness check: `MAX_ORACLE_STALENESS = 3600 seconds`
- Enhanced `_convertToUSD8()` with comprehensive oracle validation:
  - `answeredInRound >= roundId` check
  - `block.timestamp - updatedAt > MAX_ORACLE_STALENESS` check
  - Existing price > 0 and updatedAt > 0 checks
- Added `StalePrice` error with timestamp and max age information

**Impact**: Prevents use of stale or invalid oracle data.

### 5. **Admin Recovery Event Missing**
**Problem**: No audit trail for admin fund recovery operations.

**Solution**:
- Enhanced `adminRecoverFunds()` with `reason` parameter (bytes32)
- Added `AdminRecover` event with old balance, new balance, and reason
- Updated function signature: `adminRecoverFunds(user, token, newBalance, reason)`
- Event provides complete audit trail for recovery operations

**Impact**: Full auditability of admin recovery operations.

### 6. **Token Support Check Timing**
**Problem**: ERC20 token approval possible before token support validation.

**Solution**:
- Moved token support check (`priceFeeds[token] != address(0)`) before `safeTransferFrom()` in `depositERC20()`
- Prevents pointless token transfers for unsupported tokens
- Maintains checks-effects-interactions pattern

**Impact**: Better user experience and gas efficiency.

## Test Coverage

### Comprehensive Test Suites

#### 1. **KipuBankV3Fixes.ts** - New Tests for All Fixes (30 tests)
- **ERC-7528 Compliance**: 4 tests covering canonical address usage, input normalization, event emission
- **8-Decimal USD Accounting**: 7 tests verifying correct USD8 usage in all functions and events
- **Native Per-Tx Cap**: 6 tests covering admin controls and enforcement logic
- **Oracle Hygiene**: 5 tests covering staleness, validity, and data integrity checks
- **Admin Recovery**: 4 tests covering event emission, balance updates, and access control
- **USD Withdraw Limits**: 2 tests for USD-based withdrawal limits
- **Integration**: 2 comprehensive integration tests

#### 2. **KippuBankV3.ts** - Updated Original Tests (25 tests)
- All existing functionality tests updated for new 8-decimal accounting
- Error names updated (`WithdrawLimitPerTx` → `WithdrawLimitPerTxUSD`)
- Function names updated (`totalBankBalanceUSDC` → `totalBankBalanceUSD8`, etc.)
- All 25 tests pass with updated accounting

#### 3. **Test Results**
```
55 passing (2s)
- 30 new fix-specific tests
- 25 updated original functionality tests
```

## Contract Changes Summary

### State Variables
```solidity
// Before
uint256 public immutable BANK_CAP_USDC; // 6 decimals
uint256 public immutable MAX_WITHDRAW_PER_TX_USDC; // 6 decimals
uint256 public totalBankBalanceUSDC; // 6 decimals
address public constant ETH_ADDRESS = address(1);

// After
uint256 public immutable BANK_CAP_USD8; // 8 decimals
uint256 public immutable MAX_WITHDRAW_PER_TX_USD8; // 8 decimals
uint256 public totalBankBalanceUSD8; // 8 decimals
uint256 public nativePerTxCapWei; // wei cap for ETH
address public constant ETH_ALIAS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
uint256 public constant MAX_ORACLE_STALENESS = 3600;
```

### New Functions
```solidity
function setNativePerTxCapWei(uint256 newCap) external onlyRole(ADMIN_ROLE);
function adminRecoverFunds(address user, address token, uint256 newBalance, bytes32 reason) external onlyRole(ADMIN_ROLE);
function _canonicalizeToken(address token) internal pure returns (address);
```

### Enhanced Functions
- `_convertToUSD8()`: Added comprehensive oracle hygiene checks
- `withdraw()`: Added native wei cap checking alongside USD cap
- All token handling functions: Use canonical token normalization

### Events
- `AdminRecover`: New event for admin recovery operations
- `NativePerTxCapWeiUpdated`: New event for native cap changes
- `Deposit`/`Withdraw`: Updated to use `amountInUSD8` (8 decimals)

### Errors
- `WithdrawLimitPerTxUSD`: For USD-based withdrawal limits
- `WithdrawLimitPerTxNative`: For native wei-based limits
- `StalePrice`: For oracle staleness issues

## Security Improvements

1. **Accounting Consistency**: Eliminated decimal mismatches that could cause accounting errors
2. **Enhanced Oracle Security**: Comprehensive validation prevents stale/invalid price data
3. **Dual Withdrawal Limits**: USD + native caps provide layered protection
4. **Audit Trail**: Complete logging of admin recovery operations
5. **ERC-7528 Compliance**: Standard ETH handling across DeFi ecosystem
6. **Input Validation**: Token support checked before transfers

## Deployment Impact

- **Constructor**: Parameters changed from 6-decimal to 8-decimal USD values
- **Backward Compatibility**: Contract interface changed (MUST-FIX items)
- **Testing**: Both local Hardhat and Sepolia deployment tested
- **Gas Costs**: Slight increase due to additional checks (acceptable for security)

## Files Modified

1. `KippuBankV3.sol` - All contract fixes
2. `KippuBankV3Fixes.ts` - New comprehensive test suite
3. `KippuBankV3.ts` - Updated original tests
4. `00_deploy_your_contract.ts` - Updated deployment parameters

## Conclusion

All MUST-FIX and NICE-TO-HAVE security issues have been addressed. The contract now provides:
- Consistent 8-decimal USD accounting
- ERC-7528 compliant ETH handling
- Enhanced oracle security with staleness checks
- Dual withdrawal limits (USD + native)
- Complete audit trails for admin operations
- Comprehensive test coverage (55 tests)

The KippuBankV3 contract is now production-ready with enterprise-grade security and compliance.
