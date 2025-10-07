# KipuBank

## Description

KipuBank is a capped Ethereum custodial bank that allows users to deposit and withdraw Ether. It enforces strict limits on total holdings (`BANK_CAP`) and per-transaction withdrawals (`MAX_WITHDRAW_PER_TX`). The contract tracks individual user balances, total deposit and withdrawal operations, and provides mechanisms to query balances and remaining capacity. It includes reentrancy protection and custom errors for clear failure reporting.

---

## Deployment Instructions

1. Ensure your environment supports Solidity >=0.7.0 <0.9.0.
2. Compile the contract using your preferred Ethereum development tool (Remix, Hardhat, Truffle, etc.).
3. Deploy `KipuBank` with two parameters:
   - `_bankCap` (uint): maximum Ether the bank can hold.
   - `_maxWithdrawTransfer` (uint): maximum Ether allowed per withdrawal transaction.
4. Confirm deployment transaction on the target network.

**Example using Remix:**

- Open Remix IDE.
- Paste `KipuBank.sol` code.
- Select compiler version `0.8.x`.
- Deploy contract and set `_bankCap` and `_maxWithdrawTransfer`.

---

## Interacting with the Contract

### Deposit

- Call `deposit()` as a payable transaction with the desired Ether amount.
- Returns the user’s updated balance.
- Will revert if deposit exceeds `BANK_CAP`.

### Withdraw

- Call `withdraw(uint amount)` specifying the desired withdrawal amount.
- Will revert if amount exceeds `MAX_WITHDRAW_PER_TX`, exceeds your balance, or is zero.
- Returns updated user balance after successful transfer.

### Check Balances

- `checkBalance()` → Returns your current balance in the bank.
- `getBankBalance()` → Returns the total Ether held by the contract.
- `remainingBankCapacity()` → Returns how much more Ether the contract can accept.

### Ether Transfers

- Direct transfers to the contract (`send`, `transfer`, or simple `msg.value` transfers) are routed through `deposit()` and credited to the sender’s balance.
- Any call to a non-existent function that sends Ether will revert.
