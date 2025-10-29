// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockUniversalRouter is Ownable {
    using SafeERC20 for IERC20;

    mapping(address => mapping(address => uint256)) public exchangeRates;

    event ExchangeRateSet(address indexed tokenIn, address indexed tokenOut, uint256 rate);
    event SwapExecuted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    constructor() Ownable(msg.sender) {}

    function setExchangeRate(address tokenIn, address tokenOut, uint256 rateE18) external onlyOwner {
        exchangeRates[tokenIn][tokenOut] = rateE18;
        emit ExchangeRateSet(tokenIn, tokenOut, rateE18);
    }

    function execute(bytes calldata commands, bytes[] calldata inputs) external payable {
        require(commands.length == inputs.length, "Length mismatch");

        for (uint256 i = 0; i < commands.length; i++) {
            uint8 command = uint8(commands[i]);
            
            if (command == 0x00) {
                _executeV4Swap(inputs[i]);
            } else {
                revert("Unsupported command");
            }
        }
    }

    function _executeV4Swap(bytes calldata input) internal {
        (address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient) = 
            abi.decode(input, (address, address, uint256, uint256, address));

        require(amountIn > 0, "Zero amount");
        require(exchangeRates[tokenIn][tokenOut] > 0, "Exchange rate not set");

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 tokenInDecimals = _getDecimals(tokenIn);
        uint256 tokenOutDecimals = _getDecimals(tokenOut);
        
        uint256 amountOut = (amountIn * exchangeRates[tokenIn][tokenOut] * (10 ** tokenOutDecimals)) / 
                            ((10 ** tokenInDecimals) * 1e18);

        require(amountOut >= minAmountOut, "Insufficient output amount");

        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        emit SwapExecuted(tokenIn, tokenOut, amountIn, amountOut);
    }

    function _getDecimals(address token) internal view returns (uint256) {
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        require(success, "Failed to get decimals");
        return abi.decode(data, (uint8));
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }
}

