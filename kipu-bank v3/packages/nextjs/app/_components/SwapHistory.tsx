"use client";

import { useAccount } from "wagmi";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { formatTokenAmount, getTokenInfo } from "~~/utils/tokens";

export const SwapHistory = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();

  const { data: swapEvents, isLoading } = useScaffoldEventHistory({
    contractName: "KipuBankV3",
    eventName: "TokenSwapped",
    fromBlock: 0n,
    watch: true,
    filters: connectedAddress ? { user: connectedAddress } : undefined,
  });

  if (!connectedAddress) {
    return (
      <div className="bg-base-200 rounded-xl p-6">
        <h2 className="text-xl font-bold mb-4">Swap History</h2>
        <p className="text-base-content/50 text-center py-4">Connect wallet to view swap history</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-base-200 rounded-xl p-6">
        <h2 className="text-xl font-bold mb-4">Swap History</h2>
        <div className="flex justify-center py-4">
          <span className="loading loading-spinner loading-md"></span>
        </div>
      </div>
    );
  }

  if (!swapEvents || swapEvents.length === 0) {
    return (
      <div className="bg-base-200 rounded-xl p-6">
        <h2 className="text-xl font-bold mb-4">Swap History</h2>
        <p className="text-base-content/50 text-center py-4">No swaps yet</p>
      </div>
    );
  }

  return (
    <div className="bg-base-200 rounded-xl p-6">
      <h2 className="text-xl font-bold mb-4">Recent Swaps</h2>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {swapEvents.slice(0, 10).map((event, index) => {
          const tokenInInfo = getTokenInfo(event.args.tokenIn as string, targetNetwork.id);
          const tokenOutInfo = getTokenInfo(event.args.tokenOut as string, targetNetwork.id);

          return (
            <div key={index} className="bg-base-100 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{tokenInInfo?.logo || "💱"}</span>
                  <div>
                    <div className="font-semibold text-sm">
                      {formatTokenAmount(event.args.amountIn, tokenInInfo?.decimals || 18)} {tokenInInfo?.symbol}
                    </div>
                    <div className="text-xs text-base-content/50">Swapped</div>
                  </div>
                </div>
                <div className="text-2xl">→</div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <div className="font-semibold text-sm">
                      {formatTokenAmount(event.args.amountOut, tokenOutInfo?.decimals || 6)} {tokenOutInfo?.symbol}
                    </div>
                    <div className="text-xs text-base-content/50">Received</div>
                  </div>
                  <span className="text-lg">{tokenOutInfo?.logo || "💵"}</span>
                </div>
              </div>
              <div className="text-xs text-base-content/40 flex justify-between items-center border-t border-base-300 pt-2 mt-2">
                <Address address={event.args.user} size="xs" />
                <span>Block: {event.blockNumber?.toString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

