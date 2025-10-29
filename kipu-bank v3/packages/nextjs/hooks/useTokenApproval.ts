import { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { erc20Abi } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";

export const useTokenApproval = (tokenAddress: `0x${string}` | undefined, amount: bigint) => {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const [needsApproval, setNeedsApproval] = useState(false);

  const kipuBankAddress = (deployedContracts as any)[targetNetwork.id]?.KipuBankV3?.address as `0x${string}`;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && kipuBankAddress ? [address, kipuBankAddress] : undefined,
    query: {
      enabled: !!address && !!tokenAddress && !!kipuBankAddress,
    },
  });

  const {
    data: approveHash,
    writeContract: approve,
    isPending: isApprovePending,
  } = useWriteContract();

  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  useEffect(() => {
    if (allowance !== undefined && amount > 0n) {
      setNeedsApproval(allowance < amount);
    }
  }, [allowance, amount]);

  useEffect(() => {
    if (isApproveSuccess) {
      refetchAllowance();
    }
  }, [isApproveSuccess, refetchAllowance]);

  const handleApprove = async () => {
    if (!tokenAddress || !kipuBankAddress) return;

    approve({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [kipuBankAddress, amount],
    });
  };

  return {
    needsApproval,
    allowance,
    approve: handleApprove,
    isApprovePending,
    isApproveConfirming,
    isApproveSuccess,
  };
};

