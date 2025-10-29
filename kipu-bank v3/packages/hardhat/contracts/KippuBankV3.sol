// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract KipuBankV3 is AccessControl {
    using SafeERC20 for IERC20;

    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // Constants - ERC-7528 compliant ETH alias
    address public constant ETH_ALIAS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    AggregatorV3Interface public immutable ethUsdOracle;
    uint256 public immutable BANK_CAP_USD8; // bank cap expressed in USD with 8 decimals (matching Chainlink feeds)
    uint256 public immutable MAX_WITHDRAW_PER_TX_USD8; // per-tx withdraw cap in USD with 8 decimals

    address public immutable USDC;
    address public immutable universalRouter;

    // Per-tx native ETH cap in wei (0 = no cap)
    uint256 public nativePerTxCapWei;
    
    // Oracle staleness threshold (seconds)
    uint256 public constant MAX_ORACLE_STALENESS = 3600; // 1 hour

    // State
    // user => token => balance (token-native units)
    mapping(address => mapping(address => uint256)) private _balances;
    // token => total balance (token-native units) held by the bank
    mapping(address => uint256) private _totalTokenBalances;

    // token => price feed (token->USD), if zero -> not supported (except ETH has ethUsdOracle)
    mapping(address => AggregatorV3Interface) public priceFeeds;
    // token => decimals (cached from token contract on registration)
    mapping(address => uint8) public tokenDecimals;
    // token => is supported for Uniswap swaps
    mapping(address => bool) public supportedTokens;

    // Total bank accounting in USD with 8 decimals (matching Chainlink feeds)
    uint256 public totalBankBalanceUSD8;

    // operation counters
    uint256 public depositCount;
    uint256 public withdrawCount;

    // events
    event Deposit(address indexed user, address indexed token, uint256 amount, uint256 amountInUSD8);
    event Withdraw(address indexed user, address indexed token, uint256 amount, uint256 amountInUSD8);
    event TokenRegistered(address indexed token, address indexed feed, uint8 decimals);
    event TokenUnregistered(address indexed token);
    event PriceFeedUpdated(address indexed token, address indexed newFeed);
    event AdminRecover(address indexed user, address indexed token, uint256 oldBalance, uint256 newBalance, bytes32 reason);
    event NativePerTxCapWeiUpdated(uint256 oldCap, uint256 newCap);
    event TokenSwapped(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event SupportedTokenAdded(address indexed token);
    event SupportedTokenRemoved(address indexed token);

    // errors
    error WithdrawLimitPerTxUSD(uint256 attemptedUSD8, uint256 limitUSD8);
    error WithdrawLimitPerTxNative(uint256 attemptedWei, uint256 limitWei);
    error DepositExceedsBankCap(uint256 attemptedUSD8, uint256 remainingCapacityUSD8);
    error InsufficientBalance(address user, address token, uint256 requested, uint256 available);
    error ZeroAmount();
    error ReentrantCall();
    error FailedToSendEther();
    error TokenNotSupported(address token);
    error InvalidPrice();
    error StalePrice(uint256 timestamp, uint256 maxAge);
    error SwapFailed();
    error TokenNotSupportedForSwap(address token);

    // reentrancy guard
    bool internal _locked;
    modifier noReentrant() {
        if (_locked) revert ReentrantCall();
        _locked = true;
        _;
        _locked = false;
    }

    /// @param _ethUsdOracle address of Chainlink ETH/USD feed
    /// @param bankCapUsd8 cap expressed in USD with 8 decimals, e.g., 1_000_000e8 == $1,000,000
    /// @param maxWithdrawPerTxUsd8 per-tx withdraw cap expressed in USD with 8 decimals
    /// @param _usdc address of USDC token contract
    /// @param _universalRouter address of Uniswap V4 UniversalRouter
    /// used 0x694AA1769357215DE4FAC081bf1f309aDC325306 for sepolia network, from https://docs.chain.link/data-feeds/getting-started
    constructor(
        address _ethUsdOracle,
        uint256 bankCapUsd8,
        uint256 maxWithdrawPerTxUsd8,
        address _usdc,
        address _universalRouter
    ) {
        require(_ethUsdOracle != address(0), "ethUsdOracle required");
        require(bankCapUsd8 > 0, "bank cap required");
        require(maxWithdrawPerTxUsd8 > 0, "max withdraw per tx required");
        require(_usdc != address(0), "USDC required");
        require(_universalRouter != address(0), "universalRouter required");

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);

        ethUsdOracle = AggregatorV3Interface(_ethUsdOracle);
        BANK_CAP_USD8 = bankCapUsd8;
        MAX_WITHDRAW_PER_TX_USD8 = maxWithdrawPerTxUsd8;
        USDC = _usdc;
        universalRouter = _universalRouter;
    }

    // INTERNAL HELPERS

    /// @dev Normalize token address to canonical form (ERC-7528 compliant)
    /// @param token address(0) or ETH_ALIAS become ETH_ALIAS; all others pass through
    function _canonicalizeToken(address token) internal pure returns (address) {
        return (token == address(0) || token == ETH_ALIAS) ? ETH_ALIAS : token;
    }

    /// @dev Internal helper for ERC20 deposits (no reentrancy guard, no token transfer)
    function _depositERC20Internal(address canonToken, uint256 amount) internal returns (uint256) {
        uint256 amountInUSD8 = _convertToUSD8(canonToken, amount);

        if (totalBankBalanceUSD8 + amountInUSD8 > BANK_CAP_USD8) {
            uint256 remaining = BANK_CAP_USD8 > totalBankBalanceUSD8 ? BANK_CAP_USD8 - totalBankBalanceUSD8 : 0;
            IERC20(canonToken).safeTransfer(msg.sender, amount);
            revert DepositExceedsBankCap(amountInUSD8, remaining);
        }

        _balances[msg.sender][canonToken] += amount;
        _totalTokenBalances[canonToken] += amount;
        totalBankBalanceUSD8 += amountInUSD8;
        unchecked { depositCount += 1; }

        emit Deposit(msg.sender, canonToken, amount, amountInUSD8);
        return _balances[msg.sender][canonToken];
    }

    // ADMIN FUNCTIONS

    /// @notice ADMIN: Register an ERC20 token and its Chainlink USD price feed
    /// @param token address for new erc20, do not use for eth (already present at constructor)
    /// @param feed chainlink aggregator for token/USD
    function registerToken(address token, address feed) external onlyRole(ADMIN_ROLE) {
        address canonToken = _canonicalizeToken(token);
        if (canonToken == ETH_ALIAS) revert("use ETH-specific logic");
        require(token != address(0), "token required");
        require(feed != address(0), "feed required");

        uint8 dec = IERC20Metadata(canonToken).decimals();
        priceFeeds[canonToken] = AggregatorV3Interface(feed);
        tokenDecimals[canonToken] = dec;

        emit TokenRegistered(canonToken, feed, dec);
    }

    /// @notice ADMIN: Unregister a token (removes it from the bank)
    /// @param token address of token to remove
    function unregisterToken(address token) external onlyRole(ADMIN_ROLE) {
        address canonToken = _canonicalizeToken(token);
        delete priceFeeds[canonToken];
        delete tokenDecimals[canonToken];
        emit TokenUnregistered(canonToken);
    }

    /// @notice ADMIN: Update the price feed for a token (ADMIN)
    function updatePriceFeed(address token, address newFeed) external onlyRole(ADMIN_ROLE) {
        address canonToken = _canonicalizeToken(token);
        require(newFeed != address(0), "feed required");
        priceFeeds[canonToken] = AggregatorV3Interface(newFeed);
        emit PriceFeedUpdated(canonToken, newFeed);
    }

    /// @notice ADMIN: Set the native per-tx cap in wei for ETH withdrawals (0 = no cap)
    function setNativePerTxCapWei(uint256 newCap) external onlyRole(ADMIN_ROLE) {
        uint256 oldCap = nativePerTxCapWei;
        nativePerTxCapWei = newCap;
        emit NativePerTxCapWeiUpdated(oldCap, newCap);
    }

    /// @notice ADMIN: forcibly adjust a user's token balance (fund recovery)
    /// @param user target user
    /// @param token token address (ETH_ALIAS or address(0) for ETH)
    /// @param newBalance new balance in token-native units
    /// @param reason bytes32 reason code for auditability
    function adminRecoverFunds(address user, address token, uint256 newBalance, bytes32 reason) external onlyRole(ADMIN_ROLE) {
        address canonToken = _canonicalizeToken(token);
        uint256 oldBalance = _balances[user][canonToken];
        if (oldBalance == newBalance) return;

        uint256 oldUSD8 = _convertToUSD8(canonToken, oldBalance);
        uint256 newUSD8 = _convertToUSD8(canonToken, newBalance);

        // update state
        _balances[user][canonToken] = newBalance;
        _totalTokenBalances[canonToken] = _totalTokenBalances[canonToken] > oldBalance
            ? _totalTokenBalances[canonToken] - oldBalance + newBalance
            : newBalance;
        totalBankBalanceUSD8 = totalBankBalanceUSD8 > oldUSD8
            ? totalBankBalanceUSD8 - oldUSD8 + newUSD8
            : newUSD8;

        emit AdminRecover(user, canonToken, oldBalance, newBalance, reason);
    }

    /// @notice ADMIN: Mark a token as supported for Uniswap swaps
    /// @param token token address to support
    function addSupportedToken(address token) external onlyRole(ADMIN_ROLE) {
        require(token != address(0) && token != ETH_ALIAS, "Invalid token");
        supportedTokens[token] = true;
        emit SupportedTokenAdded(token);
    }

    /// @notice ADMIN: Remove a token from supported swaps
    /// @param token token address to remove
    function removeSupportedToken(address token) external onlyRole(ADMIN_ROLE) {
        supportedTokens[token] = false;
        emit SupportedTokenRemoved(token);
    }

    // DEPOSIT / WITHDRAW

    function depositETH() external payable noReentrant returns (uint256 userBalance) {
        if (msg.value == 0) revert ZeroAmount();

        uint256 amountInUSD8 = _convertToUSD8(ETH_ALIAS, msg.value);

        // bank capacity check
        if (totalBankBalanceUSD8 + amountInUSD8 > BANK_CAP_USD8) {
            uint256 remaining = BANK_CAP_USD8 > totalBankBalanceUSD8 ? BANK_CAP_USD8 - totalBankBalanceUSD8 : 0;
            revert DepositExceedsBankCap(amountInUSD8, remaining);
        }

        // effects
        _balances[msg.sender][ETH_ALIAS] += msg.value;
        _totalTokenBalances[ETH_ALIAS] += msg.value;
        totalBankBalanceUSD8 += amountInUSD8;
        unchecked { depositCount += 1; }

        emit Deposit(msg.sender, ETH_ALIAS, msg.value, amountInUSD8);
        return _balances[msg.sender][ETH_ALIAS];
    }

    /// Deposit ERC20 token. Caller must approve first.
    function depositERC20(address token, uint256 amount) external noReentrant returns (uint256 userBalance) {
        if (amount == 0) revert ZeroAmount();
        address canonToken = _canonicalizeToken(token);
        if (canonToken == ETH_ALIAS) revert("use depositETH()");
        if (priceFeeds[canonToken] == AggregatorV3Interface(address(0))) revert TokenNotSupported(canonToken);

        IERC20(canonToken).safeTransferFrom(msg.sender, address(this), amount);

        return _depositERC20Internal(canonToken, amount);
    }

    /// Deposit arbitrary ERC20 token with automatic swap to USDC via Uniswap V4
    /// @param token address of token to deposit
    /// @param amount amount of token to deposit
    /// @return userBalance user's updated USDC balance in the bank
    function depositArbitraryToken(address token, uint256 amount) external noReentrant returns (uint256 userBalance) {
        if (amount == 0) revert ZeroAmount();
        address canonToken = _canonicalizeToken(token);
        if (canonToken == ETH_ALIAS) revert("use depositETH()");

        IERC20(canonToken).safeTransferFrom(msg.sender, address(this), amount);

        if (canonToken == USDC) {
            if (priceFeeds[USDC] == AggregatorV3Interface(address(0))) revert TokenNotSupported(USDC);
            return _depositERC20Internal(USDC, amount);
        }

        if (!supportedTokens[canonToken]) revert TokenNotSupportedForSwap(canonToken);

        uint256 usdcReceived = _swapExactInputSingle(canonToken, amount);

        uint256 amountInUSD8 = _convertToUSD8(USDC, usdcReceived);

        if (totalBankBalanceUSD8 + amountInUSD8 > BANK_CAP_USD8) {
            uint256 remaining = BANK_CAP_USD8 > totalBankBalanceUSD8 ? BANK_CAP_USD8 - totalBankBalanceUSD8 : 0;
            IERC20(USDC).safeTransfer(msg.sender, usdcReceived);
            revert DepositExceedsBankCap(amountInUSD8, remaining);
        }

        _balances[msg.sender][USDC] += usdcReceived;
        _totalTokenBalances[USDC] += usdcReceived;
        totalBankBalanceUSD8 += amountInUSD8;
        unchecked { depositCount += 1; }

        emit Deposit(msg.sender, USDC, usdcReceived, amountInUSD8);
        return _balances[msg.sender][USDC];
    }

    /// Withdraw tokens (ETH or ERC20)
    /// @param token ETH_ALIAS or address(0) for ETH, or ERC20 token address
    function withdraw(address token, uint256 amount) external noReentrant returns (uint256 remainingUserBalance) {
        if (amount == 0) revert ZeroAmount();
        address canonToken = _canonicalizeToken(token);
        uint256 userAvailable = _balances[msg.sender][canonToken];
        if (userAvailable < amount) revert InsufficientBalance(msg.sender, canonToken, amount, userAvailable);

        uint256 amountInUSD8 = _convertToUSD8(canonToken, amount);
        if (amountInUSD8 > MAX_WITHDRAW_PER_TX_USD8) revert WithdrawLimitPerTxUSD(amountInUSD8, MAX_WITHDRAW_PER_TX_USD8);

        // native ETH cap check (if set)
        if (canonToken == ETH_ALIAS && nativePerTxCapWei != 0 && amount > nativePerTxCapWei) {
            revert WithdrawLimitPerTxNative(amount, nativePerTxCapWei);
        }

        // effects
        _balances[msg.sender][canonToken] -= amount;
        _totalTokenBalances[canonToken] -= amount;
        totalBankBalanceUSD8 = totalBankBalanceUSD8 > amountInUSD8 ? totalBankBalanceUSD8 - amountInUSD8 : 0;
        unchecked { withdrawCount += 1; }

        // interactions
        if (canonToken == ETH_ALIAS) {
            (bool success, ) = msg.sender.call{value: amount}('');
            if (!success) revert FailedToSendEther();
        } else {
            IERC20(canonToken).safeTransfer(msg.sender, amount);
        }

        emit Withdraw(msg.sender, canonToken, amount, amountInUSD8);
        return _balances[msg.sender][canonToken];
    }

    // VIEW helpers

    function checkBalance(address user, address token) external view returns (uint256) {
        address canonToken = _canonicalizeToken(token);
        return _balances[user][canonToken];
    }

    function getBankTokenBalance(address token) external view returns (uint256) {
        address canonToken = _canonicalizeToken(token);
        return _totalTokenBalances[canonToken];
    }

    function remainingBankCapacityUSD8() external view returns (uint256) {
        return BANK_CAP_USD8 > totalBankBalanceUSD8 ? BANK_CAP_USD8 - totalBankBalanceUSD8 : 0;
    }

    // INTERNAL: conversion util
    /// @dev Convert a token native amount into USD with 8 decimals (matching Chainlink feeds)
    /// Uses Chainlink feed for price. For ETH uses ethUsdOracle.
    /// Includes oracle hygiene checks: answeredInRound >= roundId and staleness bounds
    function _convertToUSD8(address token, uint256 amount) internal view returns (uint256) {
        AggregatorV3Interface feed;
        uint8 decimals;

        if (token == ETH_ALIAS) {
            feed = ethUsdOracle;
            decimals = 18;
        } else {
            feed = priceFeeds[token];
            if (feed == AggregatorV3Interface(address(0))) revert TokenNotSupported(token);
            decimals = tokenDecimals[token];
        }

        (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        
        // Oracle hygiene checks
        if (price <= 0 || updatedAt == 0) revert InvalidPrice();
        if (answeredInRound < roundId) revert InvalidPrice();
        if (block.timestamp - updatedAt > MAX_ORACLE_STALENESS) revert StalePrice(updatedAt, MAX_ORACLE_STALENESS);

        // usd8 = amount * price8 / 10^decimals
        return (uint256(price) * amount) / (10 ** uint256(decimals));
    }

    /// @dev Swap tokenIn to USDC using Uniswap V4 UniversalRouter
    /// @param tokenIn address of input token
    /// @param amountIn amount of input token
    /// @return amountOut amount of USDC received
    function _swapExactInputSingle(address tokenIn, uint256 amountIn) internal returns (uint256 amountOut) {
        uint256 usdcBefore = IERC20(USDC).balanceOf(address(this));

        IERC20(tokenIn).forceApprove(universalRouter, amountIn);

        bytes memory commands = abi.encodePacked(uint8(0x00));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(tokenIn, USDC, amountIn, uint256(0), address(this));

        (bool success, ) = universalRouter.call(
            abi.encodeWithSignature("execute(bytes,bytes[])", commands, inputs)
        );
        if (!success) revert SwapFailed();

        uint256 usdcAfter = IERC20(USDC).balanceOf(address(this));
        amountOut = usdcAfter - usdcBefore;

        if (amountOut == 0) revert SwapFailed();

        emit TokenSwapped(msg.sender, tokenIn, USDC, amountIn, amountOut);

        IERC20(tokenIn).forceApprove(universalRouter, 0);
    }

    receive() external payable {
        revert("Direct ETH transfer not allowed. Use depositETH().");
    }

    fallback() external payable {
        revert("Fallback not allowed");
    }
}
