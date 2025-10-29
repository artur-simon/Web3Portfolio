"use client";

import { useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { formatEther, parseEther } from "viem";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { TokenBalances } from "./_components/TokenBalances";
import { SwapHistory } from "./_components/SwapHistory";
import { getAvailableTokens, formatTokenAmount, parseTokenAmount, ETH_ALIAS } from "~~/utils/tokens";
import { useTokenApproval } from "~~/hooks/useTokenApproval";

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [selectedDepositToken, setSelectedDepositToken] = useState("ETH");

  const availableTokens = getAvailableTokens(targetNetwork.id);
  const selectedToken = availableTokens.find(t => t.symbol === selectedDepositToken) || availableTokens[0];
  const depositAmountBigInt = depositAmount ? parseTokenAmount(depositAmount, selectedToken.decimals) : 0n;

  const {
    needsApproval,
    approve,
    isApprovePending,
    isApproveConfirming,
    isApproveSuccess,
  } = useTokenApproval(
    selectedToken.symbol !== "ETH" ? (selectedToken.address as `0x${string}`) : undefined,
    depositAmountBigInt,
  );

  const { data: userBalance } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "checkBalance",
    args: [connectedAddress, ETH_ALIAS],
  });

  const { data: totalBankBalanceUSD8 } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "totalBankBalanceUSD8",
  });

  const { data: remainingCapacity } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "remainingBankCapacityUSD8",
  });

  const { data: depositCount } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "depositCount",
  });

  const { data: withdrawCount } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "withdrawCount",
  });

  const { data: bankCap } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "BANK_CAP_USD8",
  });

  const { data: maxWithdraw } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "MAX_WITHDRAW_PER_TX_USD8",
  });

  const { writeContractAsync: writeContract, isPending: isDepositPending } = useScaffoldWriteContract("KipuBankV3");

  const { writeContractAsync: withdraw, isPending: isWithdrawPending } = useScaffoldWriteContract("KipuBankV3");

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;

    try {
      if (selectedToken.symbol === "ETH") {
        await writeContract({
          functionName: "depositETH",
          value: parseEther(depositAmount),
        });
      } else if (selectedToken.symbol === "USDC") {
        await writeContract({
          functionName: "depositERC20",
          args: [selectedToken.address as `0x${string}`, depositAmountBigInt],
        });
      } else {
        await writeContract({
          functionName: "depositArbitraryToken",
          args: [selectedToken.address as `0x${string}`, depositAmountBigInt],
        });
      }
      setDepositAmount("");
    } catch (error) {
      console.error("Deposit failed:", error);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) return;

    try {
      await withdraw({
        functionName: "withdraw",
        args: [ETH_ALIAS, parseEther(withdrawAmount)],
      });
      setWithdrawAmount("");
    } catch (error) {
      console.error("Withdraw failed:", error);
    }
  };

  const formatUSD8 = (value: bigint | undefined) => {
    if (!value) return "0.00";
    return (Number(value) / 1e8).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="flex items-center flex-col grow pt-10">
      <div className="px-5 w-full max-w-5xl">
        <h1 className="text-center mb-8">
          <span className="block text-4xl font-bold mb-2">Kipu Bank V3</span>
          <span className="block text-xl">Multi-Token Banking with Auto-Swap</span>
        </h1>

        <div className="flex justify-center items-center space-x-2 flex-col mb-8">
          <p className="my-2 font-medium">Connected Address:</p>
          <Address address={connectedAddress} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-base-200 rounded-xl p-6 text-center">
            <div className="text-sm text-base-content/70 mb-2">Your Balance</div>
            <div className="text-3xl font-bold">{userBalance ? formatEther(userBalance) : "0.00"} ETH</div>
          </div>

          <div className="bg-base-200 rounded-xl p-6 text-center">
            <div className="text-sm text-base-content/70 mb-2">Bank Total (USD)</div>
            <div className="text-3xl font-bold">${formatUSD8(totalBankBalanceUSD8)}</div>
            <div className="text-xs text-base-content/50 mt-1">
              Cap: ${formatUSD8(bankCap)}
            </div>
          </div>

          <div className="bg-base-200 rounded-xl p-6 text-center">
            <div className="text-sm text-base-content/70 mb-2">Remaining Capacity</div>
            <div className="text-3xl font-bold">${formatUSD8(remainingCapacity)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-base-100 rounded-xl p-6 shadow-lg">
            <h2 className="text-2xl font-bold mb-4">Deposit Tokens</h2>
            
            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Select Token</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={selectedDepositToken}
                onChange={e => setSelectedDepositToken(e.target.value)}
              >
                {availableTokens.map(token => (
                  <option key={token.symbol} value={token.symbol}>
                    {token.logo} {token.symbol} - {token.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text">Amount ({selectedToken.symbol})</span>
              </label>
              <input
                type="number"
                placeholder="0.0"
                className="input input-bordered w-full"
                value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                step="0.01"
                min="0"
              />
            </div>

            {selectedToken.symbol !== "ETH" && selectedToken.symbol !== "USDC" && depositAmount && (
              <div className="alert alert-info mt-3 text-xs">
                <span>💱 {selectedToken.symbol} will be automatically swapped to USDC</span>
              </div>
            )}

            {needsApproval && selectedToken.symbol !== "ETH" && (
              <button
                className="btn btn-warning w-full mt-4"
                onClick={approve}
                disabled={!connectedAddress || isApprovePending || isApproveConfirming}
              >
                {isApprovePending || isApproveConfirming ? (
                  <span className="loading loading-spinner"></span>
                ) : (
                  `Approve ${selectedToken.symbol}`
                )}
              </button>
            )}

            <button
              className="btn btn-primary w-full mt-4"
              onClick={handleDeposit}
              disabled={
                !connectedAddress ||
                isDepositPending ||
                !depositAmount ||
                (needsApproval && selectedToken.symbol !== "ETH") ||
                isApprovePending ||
                isApproveConfirming
              }
            >
              {isDepositPending ? <span className="loading loading-spinner"></span> : "Deposit"}
            </button>
          </div>

          <div className="bg-base-100 rounded-xl p-6 shadow-lg">
            <h2 className="text-2xl font-bold mb-4">Withdraw ETH</h2>
            <div className="form-control">
              <label className="label">
                <span className="label-text">Amount (ETH)</span>
              </label>
              <input
                type="number"
                placeholder="0.0"
                className="input input-bordered w-full"
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
                step="0.01"
                min="0"
              />
            </div>
            <button
              className="btn btn-secondary w-full mt-4"
              onClick={handleWithdraw}
              disabled={!connectedAddress || isWithdrawPending || !withdrawAmount}
            >
              {isWithdrawPending ? <span className="loading loading-spinner"></span> : "Withdraw"}
            </button>
            <div className="text-xs text-base-content/50 mt-2 text-center">
              Max per transaction: ${formatUSD8(maxWithdraw)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <TokenBalances />
          <SwapHistory />
        </div>

        <div className="bg-base-200 rounded-xl p-6">
          <h2 className="text-xl font-bold mb-4">Bank Statistics</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-base-content/70">Total Deposits</div>
              <div className="text-2xl font-bold">{depositCount?.toString() || "0"}</div>
            </div>
            <div>
              <div className="text-sm text-base-content/70">Total Withdrawals</div>
              <div className="text-2xl font-bold">{withdrawCount?.toString() || "0"}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
