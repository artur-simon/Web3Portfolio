// SPDX-License-Identifier: GPL-3.0

pragma solidity >=0.7.0 <0.9.0;

/// @title KipuBank
/// @author Artur Simon
/// @notice This contract is a bank that holds currency to a max cap
contract KipuBank {

    // -- Constants --

    /// Limit to the value that the contract will hold
    uint public immutable BANK_CAP; 
    /// Maximum value alowed to be withdrawn per transfer
    uint public immutable MAX_WITHDRAW_PER_TX;

    // -- State Variables --

    /// Registry of the users balances
    mapping(address => uint) private _balances; 
    /// Total deposit operations made
    uint256 public depositCount; 
    /// Total withdraw operations made
    uint256 public withdrawCount;

    // -- Events --

    event Deposit(address indexed user, uint amount);
    event Withdraw(address indexed user, uint amount);

    // -- Errors --

    /// @param attempted the value that was attempted to be withdrawn
    /// @param limit the max value that can be withdrawn per transaction
    error WithdrawLimitPerTx(uint256 attempted, uint256 limit);
    /// @notice Bank capacity exceeded
    /// @param attempted the value that was attempted to be deposited
    /// @param remainingCapacity the remaining capacity of the bank
    error DepositExceedsBankCap(uint256 attempted, uint256 remainingCapacity);
    /// @param requested the value that was requested to be withdrawn
    /// @param available the value that is available to be withdrawn
    error InsufficientBalance(uint256 requested, uint256 available);
    /// @notice The amount to be transferred is zero
    error ZeroAmount();
    /// @notice This function is not reentrant
    error ReentrantCall();
    /// @notice Transfer failed
    error FailedToSendEther();
    /// @notice Fallback reached
    error FallbackNotAllowed();

    // -- Modifiers --
    // -- Guard for reentrancy --
    
    bool internal _locked;
    modifier noReentrant() {
        if (_locked) revert ReentrantCall();
        _locked = true;
        _;
        _locked = false;
    }

    // -- Functions --

    constructor(uint _bankCap, uint _maxtWithdrawTransfer) {
        // Won't declare custom errors here as this is a one time-only event
        require(_bankCap > 0, "bankCap must be > 0");
        require(_maxtWithdrawTransfer > 0, "maxWithdrawalPerTx must be > 0");

        BANK_CAP = _bankCap;
        MAX_WITHDRAW_PER_TX = _maxtWithdrawTransfer;
    }

    // -- Public functions --

    /// @notice Deposit ether into bank
    /// @return The balance of the user after the deposit
    /// @dev Reentrancy here could cause the capacity to malfunction.
    ///      Created an internal function to use along with receive().
    function deposit() external payable noReentrant returns (uint) {
        return _deposit(msg.sender, msg.value);
    }

    /// @notice Withdraw ether from bank
    /// @return The balance of the user after withdraw
    function withdraw(uint amount) external noReentrant returns(uint)  {

        //check
        if (_balances[msg.sender] < amount) revert InsufficientBalance(amount, _balances[msg.sender]);
        if (amount > MAX_WITHDRAW_PER_TX) revert WithdrawLimitPerTx(amount, MAX_WITHDRAW_PER_TX);
        if (amount == 0) revert ZeroAmount();

        //effects
        _balances[msg.sender] -= amount;
        _incrementWithdrawCount();

        //interactions
        (bool success, ) = msg.sender.call{value: amount}("");
        if(!success) revert FailedToSendEther();

        emit Withdraw(msg.sender, amount);
        return _balances[msg.sender];

    }

    /// Allow user to check his balance
    /// @return The balance of the user
    function checkBalance() external view returns (uint) {
        return _balances[msg.sender];
    }

    /// Allow user to check contract total balance
    /// @return The balance of the contract
    function getBankBalance() external view returns (uint) {
        return address(this).balance;
    }

    /// Allow user to check the remaining contract availability
    /// @return The remaining balance of the contract
    function remainingBankCapacity() external view returns (uint256) {
        return BANK_CAP - address(this).balance;
    }

    // -- Private functions --

    function _deposit(address sender, uint256 amount) internal returns(uint256){

        //check
        if (address(this).balance > BANK_CAP) {
            //manage possible underflow (by using this.balance the msg.value is already present)
            uint256 preBalance = address(this).balance - amount;
            revert DepositExceedsBankCap(amount, BANK_CAP - preBalance);
        }
        if (amount == 0) revert ZeroAmount();

        //effect
        _balances[sender] += amount;
        _incrementDepositCount();

        emit Deposit(sender, amount);
        return _balances[sender];
    }

    /// @dev Increments the deposit count
    function _incrementDepositCount() private {
        unchecked { depositCount += 1; }
    }

    /// @dev Increments the withdraw count
    function _incrementWithdrawCount() private {
        unchecked { withdrawCount += 1; }
    }

    /// @dev Makes a direct call to internal _deposit function
    receive() external payable noReentrant {
        _deposit(msg.sender, msg.value);
    }
    
    fallback() external payable {
        revert FallbackNotAllowed();
    }

}
