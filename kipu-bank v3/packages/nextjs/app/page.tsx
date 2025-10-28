"use client";

import { useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { formatEther, parseEther } from "viem";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  const ETH_ADDRESS = "0x0000000000000000000000000000000000000001";

  const { data: userBalance } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "checkBalance",
    args: [connectedAddress, ETH_ADDRESS],
  });

  const { data: totalBankBalanceUSDC } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "totalBankBalanceUSDC",
  });

  const { data: remainingCapacity } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "remainingBankCapacityUSDC",
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
    functionName: "BANK_CAP_USDC",
  });

  const { data: maxWithdraw } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "MAX_WITHDRAW_PER_TX_USDC",
  });

  const { writeContractAsync: depositETH, isPending: isDepositPending } = useScaffoldWriteContract("KipuBankV3");

  const { writeContractAsync: withdraw, isPending: isWithdrawPending } = useScaffoldWriteContract("KipuBankV3");

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) return;

    try {
      await depositETH({
        functionName: "depositETH",
        value: parseEther(depositAmount),
      });
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
        args: [ETH_ADDRESS, parseEther(withdrawAmount)],
      });
      setWithdrawAmount("");
    } catch (error) {
      console.error("Withdraw failed:", error);
    }
  };

  const formatUSDC = (value: bigint | undefined) => {
    if (!value) return "0.00";
    return (Number(value) / 1e6).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="flex items-center flex-col grow pt-10">
      <div className="px-5 w-full max-w-5xl">
        <h1 className="text-center mb-8">
          <span className="block text-4xl font-bold mb-2">Kipu Bank</span>
          <span className="block text-xl">Decentralized ETH Banking</span>
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
            <div className="text-3xl font-bold">${formatUSDC(totalBankBalanceUSDC)}</div>
            <div className="text-xs text-base-content/50 mt-1">
              Cap: ${formatUSDC(bankCap)}
            </div>
          </div>

          <div className="bg-base-200 rounded-xl p-6 text-center">
            <div className="text-sm text-base-content/70 mb-2">Remaining Capacity</div>
            <div className="text-3xl font-bold">${formatUSDC(remainingCapacity)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-base-100 rounded-xl p-6 shadow-lg">
            <h2 className="text-2xl font-bold mb-4">Deposit ETH</h2>
            <div className="form-control">
              <label className="label">
                <span className="label-text">Amount (ETH)</span>
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
            <button
              className="btn btn-primary w-full mt-4"
              onClick={handleDeposit}
              disabled={!connectedAddress || isDepositPending || !depositAmount}
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
              Max per transaction: ${formatUSDC(maxWithdraw)}
            </div>
          </div>
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
