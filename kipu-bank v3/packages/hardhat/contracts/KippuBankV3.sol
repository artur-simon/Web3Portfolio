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

    // Constants
    address public constant ETH_ADDRESS = address(1); // Pseudo-address used for ETH in mappings (1 to not collide with real token addresses)

    AggregatorV3Interface public immutable ethUsdOracle; // required
    uint256 public immutable BANK_CAP_USDC; // bank cap expressed in USDC smallest units (8 decimals)
    uint256 public immutable MAX_WITHDRAW_PER_TX_USDC; // per-tx withdraw cap in USDC units

    // State
    // user => token => balance (token-native units)
    mapping(address => mapping(address => uint256)) private _balances;
    // token => total balance (token-native units) held by the bank
    mapping(address => uint256) private _totalTokenBalances;

    // token => price feed (token->USD), if zero -> not supported (except ETH has ethUsdOracle)
    mapping(address => AggregatorV3Interface) public priceFeeds;
    // token => decimals (cached from token contract on registration)
    mapping(address => uint8) public tokenDecimals;

    // Total bank accounting in USDC units (account for 6 decimals).
    // maintained on each deposit/withdraw using price feed: token native amount -> USDC units
    uint256 public totalBankBalanceUSDC;

    // operation counters
    uint256 public depositCount;
    uint256 public withdrawCount;

    // events
    event Deposit(address indexed user, address indexed token, uint256 amount, uint256 amountInUSDC);
    event Withdraw(address indexed user, address indexed token, uint256 amount, uint256 amountInUSDC);
    event TokenRegistered(address indexed token, address indexed feed, uint8 decimals);
    event TokenUnregistered(address indexed token);
    event PriceFeedUpdated(address indexed token, address indexed newFeed);

    // errors
    error WithdrawLimitPerTx(uint256 attemptedUSDC, uint256 limitUSDC);
    error DepositExceedsBankCap(uint256 attemptedUSDC, uint256 remainingCapacityUSDC);
    error InsufficientBalance(address user, address token, uint256 requested, uint256 available);
    error ZeroAmount();
    error ReentrantCall();
    error FailedToSendEther();
    error TokenNotSupported(address token);
    error InvalidPrice();

    // reentrancy guard
    bool internal _locked;
    modifier noReentrant() {
        if (_locked) revert ReentrantCall();
        _locked = true;
        _;
        _locked = false;
    }

    /// @param _ethUsdOracle address of Chainlink ETH/USD feed
    /// @param bankCapUsdc cap expressed in USDC smallest units (8 decimals), e.g., 1_000_000e8 == $1,000,000
    /// @param maxWithdrawPerTxUsdc per-tx withdraw cap expressed in USDC smallest units (8 decimals)
    /// used 0x694AA1769357215DE4FAC081bf1f309aDC325306 for sepolia network, from https://docs.chain.link/data-feeds/getting-started
    constructor(address _ethUsdOracle, uint256 bankCapUsdc, uint256 maxWithdrawPerTxUsdc) {
        require(_ethUsdOracle != address(0), "ethUsdOracle required");
        require(bankCapUsdc > 0, "bank cap required");
        require(maxWithdrawPerTxUsdc > 0, "max withdraw per tx required");

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);

        ethUsdOracle = AggregatorV3Interface(_ethUsdOracle);
        BANK_CAP_USDC = bankCapUsdc;
        MAX_WITHDRAW_PER_TX_USDC = maxWithdrawPerTxUsdc;
    }

    // ADMIN FUNCTIONS

    /// @notice ADMIN: Register an ERC20 token and its Chainlink USD price feed
    /// @param token address for new erc20, do not use for eth (already present at constructor)
    /// @param feed chainlink aggregator for token/USD
    function registerToken(address token, address feed) external onlyRole(ADMIN_ROLE) {
        if (token == ETH_ADDRESS) revert("use ETH-specific logic");
        require(token != address(0), "token required");
        require(feed != address(0), "feed required");

        uint8 dec = IERC20Metadata(token).decimals();
        priceFeeds[token] = AggregatorV3Interface(feed);
        tokenDecimals[token] = dec;

        emit TokenRegistered(token, feed, dec);
    }

    /// @notice ADMIN: Unregister a token (removes it from the bank)
    /// @param token address of token to remove
    function unregisterToken(address token) external onlyRole(ADMIN_ROLE) {
        delete priceFeeds[token];
        delete tokenDecimals[token];
        emit TokenUnregistered(token);
    }

    /// @notice ADMIN: Update the price feed for a token (ADMIN)
    function updatePriceFeed(address token, address newFeed) external onlyRole(ADMIN_ROLE) {
        require(newFeed != address(0), "feed required");
        priceFeeds[token] = AggregatorV3Interface(newFeed);
        emit PriceFeedUpdated(token, newFeed);
    }

    /// @notice ADMIN: forcibly adjust a user's token balance (fund recovery)
    /// @param user target user
    /// @param token token address (ETH_ADDRESS for ETH)
    /// @param newBalance new balance in token-native units
    function adminRecoverFunds(address user, address token, uint256 newBalance) external onlyRole(ADMIN_ROLE) {
        uint256 oldBalance = _balances[user][token];
        if (oldBalance == newBalance) return;

        // update totalBankBalanceUSDC accordingly
        uint256 oldUSDC = _convertTokenAmountToUSDC(token, oldBalance);
        uint256 newUSDC = _convertTokenAmountToUSDC(token, newBalance);

        // update state
        _balances[user][token] = newBalance;
        _totalTokenBalances[token] = _totalTokenBalances[token] > oldBalance
            ? _totalTokenBalances[token] - oldBalance + newBalance
            : newBalance; // protect against underflow
        totalBankBalanceUSDC = totalBankBalanceUSDC > oldUSDC
            ? totalBankBalanceUSDC - oldUSDC + newUSDC
            : newUSDC;
    }

    // DEPOSIT / WITHDRAW

    function depositETH() external payable noReentrant returns (uint256 userBalance) {
        if (msg.value == 0) revert ZeroAmount();

        uint256 amountInUSDC = _convertTokenAmountToUSDC(ETH_ADDRESS, msg.value);

        // bank capacity check
        if (totalBankBalanceUSDC + amountInUSDC > BANK_CAP_USDC) {
            uint256 remaining = BANK_CAP_USDC > totalBankBalanceUSDC ? BANK_CAP_USDC - totalBankBalanceUSDC : 0;
            revert DepositExceedsBankCap(amountInUSDC, remaining);
        }

        // effects
        _balances[msg.sender][ETH_ADDRESS] += msg.value;
        _totalTokenBalances[ETH_ADDRESS] += msg.value;
        totalBankBalanceUSDC += amountInUSDC;
        unchecked { depositCount += 1; }

        emit Deposit(msg.sender, ETH_ADDRESS, msg.value, amountInUSDC);
        return _balances[msg.sender][ETH_ADDRESS];
    }

    /// Deposit ERC20 token. Caller must approve first.
    function depositERC20(address token, uint256 amount) external noReentrant returns (uint256 userBalance) {
        if (amount == 0) revert ZeroAmount();
        if (priceFeeds[token] == AggregatorV3Interface(address(0))) revert TokenNotSupported(token);

        // transfer token in
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 amountInUSDC = _convertTokenAmountToUSDC(token, amount);

        // bank capacity check
        if (totalBankBalanceUSDC + amountInUSDC > BANK_CAP_USDC) {
            uint256 remaining = BANK_CAP_USDC > totalBankBalanceUSDC ? BANK_CAP_USDC - totalBankBalanceUSDC : 0;
            // return tokens to sender to avoid locking funds
            // Note: Using checks-effects-interactions: effects already minimal (no state change yet)
            IERC20(token).safeTransfer(msg.sender, amount);
            revert DepositExceedsBankCap(amountInUSDC, remaining);
        }

        // effects
        _balances[msg.sender][token] += amount;
        _totalTokenBalances[token] += amount;
        totalBankBalanceUSDC += amountInUSDC;
        unchecked { depositCount += 1; }

        emit Deposit(msg.sender, token, amount, amountInUSDC);
        return _balances[msg.sender][token];
    }

    /// Withdraw tokens (ETH or ERC20)
    /// @param token address(1) for ETH
    function withdraw(address token, uint256 amount) external noReentrant returns (uint256 remainingUserBalance) {
        if (amount == 0) revert ZeroAmount();
        uint256 userAvailable = _balances[msg.sender][token];
        if (userAvailable < amount) revert InsufficientBalance(msg.sender, token, amount, userAvailable);

        uint256 amountInUSDC = _convertTokenAmountToUSDC(token, amount);
        if (amountInUSDC > MAX_WITHDRAW_PER_TX_USDC) revert WithdrawLimitPerTx(amountInUSDC, MAX_WITHDRAW_PER_TX_USDC);

        // effects
        _balances[msg.sender][token] -= amount;
        _totalTokenBalances[token] -= amount;
        totalBankBalanceUSDC = totalBankBalanceUSDC > amountInUSDC ? totalBankBalanceUSDC - amountInUSDC : 0; // protect against underflow
        unchecked { withdrawCount += 1; }

        // interactions
        if (token == ETH_ADDRESS) {
            (bool success, ) = msg.sender.call{value: amount}('');
            if (!success) revert FailedToSendEther();
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }

        emit Withdraw(msg.sender, token, amount, amountInUSDC);
        return _balances[msg.sender][token];
    }

    // VIEW helpers

    function checkBalance(address user, address token) external view returns (uint256) {
        return _balances[user][token];
    }

    function getBankTokenBalance(address token) external view returns (uint256) {
        return _totalTokenBalances[token];
    }

    function remainingBankCapacityUSDC() external view returns (uint256) {
        return BANK_CAP_USDC > totalBankBalanceUSDC ? BANK_CAP_USDC - totalBankBalanceUSDC : 0;
    }

    // INTERNAL: conversion util
    /// @dev Convert a token native amount into USDC smallest units (8 decimals)
    /// Uses Chainlink feed for price. For ETH uses ethUsdOracle.
    function _convertTokenAmountToUSDC(address token, uint256 amount) internal view returns (uint256) {
        if (token == ETH_ADDRESS) {
            (, int256 price,, uint256 updatedAt,) = ethUsdOracle.latestRoundData();
            if (price <= 0 || updatedAt == 0) revert InvalidPrice();
            uint256 usdWith8 = (uint256(price) * amount) / 1e18;
            if (usdWith8 < 100) return 0;
            return usdWith8 / 1e2;
        }

        // ERC20 requires registered price feed
        AggregatorV3Interface feed = priceFeeds[token];
        if (feed == AggregatorV3Interface(address(0))) revert TokenNotSupported(token);

        (, int256 erc20Price, , uint256 erc20updatedAt, ) = feed.latestRoundData();
        if (erc20Price <= 0 || erc20updatedAt == 0) revert InvalidPrice();

        uint8 tDecimals = tokenDecimals[token];
        uint256 usdWith8decimals = (uint256(erc20Price) * amount) / (10 ** uint256(tDecimals));
        if (usdWith8decimals < 100) return 0;
        return usdWith8decimals / 1e2;
    }

    receive() external payable {
        revert("Direct ETH transfer not allowed. Use depositETH().");
    }

    fallback() external payable {
        revert("Fallback not allowed");
    }
}
