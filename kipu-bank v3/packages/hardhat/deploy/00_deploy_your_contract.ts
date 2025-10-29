import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract } from "ethers";

const deployKippuBank: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const chainId = await hre.getChainId();
  const isLocalhost = chainId === "31337";

  let ethUsdOracleAddress: string;

  if (isLocalhost) {
    console.log("Deploying MockV3Aggregator for local testing...");
    const mockOracle = await deploy("MockV3Aggregator", {
      from: deployer,
      args: [8, 200000000000],
      log: true,
      autoMine: true,
    });
    ethUsdOracleAddress = mockOracle.address;
    console.log("MockV3Aggregator deployed at:", ethUsdOracleAddress);
  } else if (chainId === "11155111") {
    ethUsdOracleAddress = "0x694AA1769357215DE4FAC081bf1f309aDC325306";
    console.log("Using Sepolia Chainlink ETH/USD Oracle:", ethUsdOracleAddress);
  } else {
    throw new Error(`No ETH/USD oracle configured for chain ID ${chainId}`);
  }

  const bankCapUsd8 = BigInt(1_000_000) * BigInt(10 ** 8);
  const maxWithdrawPerTxUsd8 = BigInt(10_000) * BigInt(10 ** 8);

  console.log("Deploying KipuBankV3...");
  await deploy("KipuBankV3", {
    from: deployer,
    args: [ethUsdOracleAddress, bankCapUsd8, maxWithdrawPerTxUsd8],
    log: true,
    autoMine: true,
  });

  const kippuBank = await hre.ethers.getContract<Contract>("KipuBankV3", deployer);
  console.log("KipuBankV3 deployed successfully");
  console.log("Bank Cap (USD8):", await kippuBank.BANK_CAP_USD8());
  console.log("Max Withdraw Per Tx (USD8):", await kippuBank.MAX_WITHDRAW_PER_TX_USD8());
};

export default deployKippuBank;

deployKippuBank.tags = ["KipuBankV3"];
