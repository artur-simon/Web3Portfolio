import { formatUnits, parseUnits } from "viem";
import deployedContracts from "~~/contracts/deployedContracts";

export const ETH_ALIAS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
}

export const getTokenAddresses = (chainId: number) => {
  const contracts = deployedContracts[chainId as keyof typeof deployedContracts];
  if (!contracts) return null;

  return {
    usdc: (contracts as any).MockUSDC?.address,
    dai: (contracts as any).MockDAI?.address,
    link: (contracts as any).MockLINK?.address,
  };
};

export const TOKENS: Record<string, TokenInfo> = {
  ETH: {
    address: ETH_ALIAS,
    symbol: "ETH",
    name: "Ethereum",
    decimals: 18,
    logo: "⟠",
  },
  USDC: {
    address: "",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logo: "💵",
  },
  DAI: {
    address: "",
    symbol: "DAI",
    name: "Dai Stablecoin",
    decimals: 18,
    logo: "◈",
  },
  LINK: {
    address: "",
    symbol: "LINK",
    name: "Chainlink",
    decimals: 18,
    logo: "🔗",
  },
};

export const getTokenInfo = (address: string, chainId: number): TokenInfo | null => {
  const addresses = getTokenAddresses(chainId);
  if (!addresses) return null;

  if (address === ETH_ALIAS || address === "0x0000000000000000000000000000000000000000") {
    return TOKENS.ETH;
  }

  if (address.toLowerCase() === addresses.usdc?.toLowerCase()) {
    return { ...TOKENS.USDC, address: addresses.usdc };
  }

  if (address.toLowerCase() === addresses.dai?.toLowerCase()) {
    return { ...TOKENS.DAI, address: addresses.dai };
  }

  if (address.toLowerCase() === addresses.link?.toLowerCase()) {
    return { ...TOKENS.LINK, address: addresses.link };
  }

  return null;
};

export const formatTokenAmount = (amount: bigint | undefined, decimals: number): string => {
  if (!amount) return "0.00";
  const formatted = formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  
  if (num === 0) return "0.00";
  if (num < 0.01) return num.toExponential(2);
  
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: num < 1 ? 4 : 2,
  });
};

export const parseTokenAmount = (amount: string, decimals: number): bigint => {
  try {
    return parseUnits(amount, decimals);
  } catch {
    return BigInt(0);
  }
};

export const getAvailableTokens = (chainId: number): TokenInfo[] => {
  const addresses = getTokenAddresses(chainId);
  if (!addresses) return [TOKENS.ETH];

  return [
    TOKENS.ETH,
    { ...TOKENS.USDC, address: addresses.usdc || "" },
    { ...TOKENS.DAI, address: addresses.dai || "" },
    { ...TOKENS.LINK, address: addresses.link || "" },
  ].filter(token => token.address);
};

