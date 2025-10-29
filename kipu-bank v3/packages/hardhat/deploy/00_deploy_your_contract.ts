import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract } from "ethers";

const deployKippuBank: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const chainId = await hre.getChainId();
  const isLocalhost = chainId === "31337";

  let ethUsdOracleAddress: string;
  let usdcOracleAddress: string;
  let usdcAddress: string;
  let universalRouterAddress: string;

  if (isLocalhost) {
    console.log("\n=== Deploying Mock Contracts for Local Testing ===\n");

    console.log("1. Deploying MockV3Aggregator (ETH/USD)...");
    const ethOracle = await deploy("MockV3Aggregator", {
      from: deployer,
      args: [8, 200000000000],
      log: true,
      autoMine: true,
    });
    ethUsdOracleAddress = ethOracle.address;
    console.log("   ETH/USD Oracle:", ethUsdOracleAddress);

    console.log("\n2. Deploying MockUSDC...");
    const mockUSDC = await deploy("MockUSDC", {
      from: deployer,
      args: [],
      log: true,
      autoMine: true,
    });
    usdcAddress = mockUSDC.address;
    console.log("   MockUSDC:", usdcAddress);

    console.log("\n3. Deploying MockV3Aggregator (USDC/USD)...");
    const usdcOracle = await deploy("MockV3Aggregator_USDC", {
      contract: "MockV3Aggregator",
      from: deployer,
      args: [8, 100000000],
      log: true,
      autoMine: true,
    });
    usdcOracleAddress = usdcOracle.address;
    console.log("   USDC/USD Oracle:", usdcOracleAddress);

    console.log("\n4. Deploying test tokens (DAI, LINK)...");
    const mockDAI = await deploy("MockDAI", {
      contract: "MockERC20",
      from: deployer,
      args: ["Mock DAI", "DAI", 18],
      log: true,
      autoMine: true,
    });
    console.log("   MockDAI:", mockDAI.address);

    const daiOracle = await deploy("MockV3Aggregator_DAI", {
      contract: "MockV3Aggregator",
      from: deployer,
      args: [8, 100000000],
      log: true,
      autoMine: true,
    });
    console.log("   DAI/USD Oracle:", daiOracle.address);

    const mockLINK = await deploy("MockLINK", {
      contract: "MockERC20",
      from: deployer,
      args: ["Mock LINK", "LINK", 18],
      log: true,
      autoMine: true,
    });
    console.log("   MockLINK:", mockLINK.address);

    const linkOracle = await deploy("MockV3Aggregator_LINK", {
      contract: "MockV3Aggregator",
      from: deployer,
      args: [8, 1500000000],
      log: true,
      autoMine: true,
    });
    console.log("   LINK/USD Oracle:", linkOracle.address);

    console.log("\n5. Deploying MockUniversalRouter...");
    const router = await deploy("MockUniversalRouter", {
      from: deployer,
      args: [],
      log: true,
      autoMine: true,
    });
    universalRouterAddress = router.address;
    console.log("   MockUniversalRouter:", universalRouterAddress);

    console.log("\n6. Configuring MockUniversalRouter exchange rates...");
    const routerContract = await hre.ethers.getContract<Contract>("MockUniversalRouter", deployer);
    const usdcContract = await hre.ethers.getContract<Contract>("MockUSDC", deployer);
    
    await routerContract.setExchangeRate(mockDAI.address, usdcAddress, BigInt(10 ** 18));
    console.log("   DAI -> USDC rate: 1:1");
    
    await routerContract.setExchangeRate(mockLINK.address, usdcAddress, BigInt(15) * BigInt(10 ** 18));
    console.log("   LINK -> USDC rate: 15:1");

    console.log("\n7. Minting test tokens to MockUniversalRouter...");
    await usdcContract.mint(universalRouterAddress, BigInt(1_000_000) * BigInt(10 ** 6));
    console.log("   Minted 1,000,000 USDC to router");

  } else if (chainId === "11155111") {
    ethUsdOracleAddress = "0x694AA1769357215DE4FAC081bf1f309aDC325306";
    console.log("Using Sepolia Chainlink ETH/USD Oracle:", ethUsdOracleAddress);

    console.log("\n=== Deploying Mock Contracts for Sepolia ===\n");

    console.log("1. Deploying MockUSDC...");
    const mockUSDC = await deploy("MockUSDC", {
      from: deployer,
      args: [],
      log: true,
    });
    usdcAddress = mockUSDC.address;
    console.log("   MockUSDC:", usdcAddress);

    console.log("\n2. Deploying MockV3Aggregator (USDC/USD)...");
    const usdcOracle = await deploy("MockV3Aggregator_USDC", {
      contract: "MockV3Aggregator",
      from: deployer,
      args: [8, 100000000],
      log: true,
    });
    usdcOracleAddress = usdcOracle.address;
    console.log("   USDC/USD Oracle:", usdcOracleAddress);

    console.log("\n3. Deploying test tokens...");
    const mockDAI = await deploy("MockDAI", {
      contract: "MockERC20",
      from: deployer,
      args: ["Mock DAI", "DAI", 18],
      log: true,
    });
    console.log("   MockDAI:", mockDAI.address);

    const daiOracle = await deploy("MockV3Aggregator_DAI", {
      contract: "MockV3Aggregator",
      from: deployer,
      args: [8, 100000000],
      log: true,
    });

    const mockLINK = await deploy("MockLINK", {
      contract: "MockERC20",
      from: deployer,
      args: ["Mock LINK", "LINK", 18],
      log: true,
    });
    console.log("   MockLINK:", mockLINK.address);

    const linkOracle = await deploy("MockV3Aggregator_LINK", {
      contract: "MockV3Aggregator",
      from: deployer,
      args: [8, 1500000000],
      log: true,
    });

    console.log("\n4. Deploying MockUniversalRouter...");
    const router = await deploy("MockUniversalRouter", {
      from: deployer,
      args: [],
      log: true,
    });
    universalRouterAddress = router.address;
    console.log("   MockUniversalRouter:", universalRouterAddress);

    console.log("\n5. Configuring MockUniversalRouter...");
    const routerContract = await hre.ethers.getContract<Contract>("MockUniversalRouter", deployer);
    const usdcContract = await hre.ethers.getContract<Contract>("MockUSDC", deployer);
    
    await routerContract.setExchangeRate(mockDAI.address, usdcAddress, BigInt(10 ** 18));
    await routerContract.setExchangeRate(mockLINK.address, usdcAddress, BigInt(15) * BigInt(10 ** 18));

    console.log("\n6. Minting test tokens to MockUniversalRouter...");
    await usdcContract.mint(universalRouterAddress, BigInt(1_000_000) * BigInt(10 ** 6));

  } else {
    throw new Error(`No configuration for chain ID ${chainId}`);
  }

  const bankCapUsd8 = BigInt(1_000_000) * BigInt(10 ** 8);
  const maxWithdrawPerTxUsd8 = BigInt(10_000) * BigInt(10 ** 8);

  console.log("\n=== Deploying KipuBankV3 ===\n");
  await deploy("KipuBankV3", {
    from: deployer,
    args: [ethUsdOracleAddress, bankCapUsd8, maxWithdrawPerTxUsd8, usdcAddress, universalRouterAddress],
    log: true,
    autoMine: isLocalhost,
  });

  const kipuBank = await hre.ethers.getContract<Contract>("KipuBankV3", deployer);
  console.log("\n=== KipuBankV3 Configuration ===");
  console.log("Bank Cap (USD8):", await kipuBank.BANK_CAP_USD8());
  console.log("Max Withdraw Per Tx (USD8):", await kipuBank.MAX_WITHDRAW_PER_TX_USD8());
  console.log("USDC:", await kipuBank.USDC());
  console.log("UniversalRouter:", await kipuBank.universalRouter());

  console.log("\n=== Configuring KipuBankV3 ===");

  console.log("\n1. Registering USDC token...");
  await kipuBank.registerToken(usdcAddress, usdcOracleAddress);
  console.log("   USDC registered");

  const mockDAI = await hre.deployments.get("MockDAI");
  const daiOracle = await hre.deployments.get("MockV3Aggregator_DAI");
  console.log("\n2. Registering DAI token...");
  await kipuBank.registerToken(mockDAI.address, daiOracle.address);
  console.log("   DAI registered");

  const mockLINK = await hre.deployments.get("MockLINK");
  const linkOracle = await hre.deployments.get("MockV3Aggregator_LINK");
  console.log("\n3. Registering LINK token...");
  await kipuBank.registerToken(mockLINK.address, linkOracle.address);
  console.log("   LINK registered");

  console.log("\n4. Adding supported tokens for swaps...");
  await kipuBank.addSupportedToken(mockDAI.address);
  console.log("   DAI marked as supported");
  await kipuBank.addSupportedToken(mockLINK.address);
  console.log("   LINK marked as supported");

  console.log("\n=== Deployment Complete ===\n");
};

export default deployKippuBank;

deployKippuBank.tags = ["KipuBankV3"];
