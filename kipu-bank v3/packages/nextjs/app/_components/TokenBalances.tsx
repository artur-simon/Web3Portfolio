"use client";

import { useAccount } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { ETH_ALIAS, formatTokenAmount, getAvailableTokens } from "~~/utils/tokens";

export const TokenBalances = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();

  const availableTokens = getAvailableTokens(targetNetwork.id);

  const { data: ethBalance } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "checkBalance",
    args: [connectedAddress, ETH_ALIAS],
  });

  const { data: usdcBalance } = useScaffoldReadContract({
    contractName: "KipuBankV3",
    functionName: "checkBalance",
    args: [connectedAddress, availableTokens.find(t => t.symbol === "USDC")?.address as `0x${string}`],
  });

  if (!connectedAddress) {
    return (
      <div className="bg-base-200 rounded-xl p-6">
        <h2 className="text-xl font-bold mb-4">Your Balances</h2>
        <p className="text-base-content/50 text-center py-4">Connect wallet to view balances</p>
      </div>
    );
  }

  return (
    <div className="bg-base-200 rounded-xl p-6">
      <h2 className="text-xl font-bold mb-4">Your Balances in Bank</h2>
      <div className="space-y-3">
        <div className="flex justify-between items-center p-3 bg-base-100 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⟠</span>
            <div>
              <div className="font-semibold">ETH</div>
              <div className="text-xs text-base-content/50">Ethereum</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-bold">{formatTokenAmount(ethBalance, 18)}</div>
            <div className="text-xs text-base-content/50">ETH</div>
          </div>
        </div>

        <div className="flex justify-between items-center p-3 bg-base-100 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-2xl">💵</span>
            <div>
              <div className="font-semibold">USDC</div>
              <div className="text-xs text-base-content/50">USD Coin</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-bold">{formatTokenAmount(usdcBalance, 6)}</div>
            <div className="text-xs text-base-content/50">USDC</div>
          </div>
        </div>
      </div>
    </div>
  );
};

