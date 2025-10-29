import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("KipuBankV3 - Uniswap V4 Integration", function () {
  let kipuBank: Contract;
  let mockUSDC: Contract;
  let mockDAI: Contract;
  let mockLINK: Contract;
  let mockRouter: Contract;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    await deployments.fixture(["KipuBankV3"]);

    kipuBank = await ethers.getContract("KipuBankV3", owner);
    mockUSDC = await ethers.getContract("MockUSDC", owner);
    mockDAI = await ethers.getContract("MockDAI", owner);
    mockLINK = await ethers.getContract("MockLINK", owner);
    mockRouter = await ethers.getContract("MockUniversalRouter", owner);
  });

  describe("Configuration", function () {
    it("Should have correct USDC address", async function () {
      const usdcAddress = await kipuBank.USDC();
      expect(usdcAddress).to.equal(await mockUSDC.getAddress());
    });

    it("Should have correct UniversalRouter address", async function () {
      const routerAddress = await kipuBank.universalRouter();
      expect(routerAddress).to.equal(await mockRouter.getAddress());
    });

    it("Should have USDC registered with price feed", async function () {
      const usdcAddress = await mockUSDC.getAddress();
      const priceFeed = await kipuBank.priceFeeds(usdcAddress);
      expect(priceFeed).to.not.equal(ethers.ZeroAddress);
    });

    it("Should have DAI marked as supported token", async function () {
      const daiAddress = await mockDAI.getAddress();
      const isSupported = await kipuBank.supportedTokens(daiAddress);
      expect(isSupported).to.be.true;
    });

    it("Should have LINK marked as supported token", async function () {
      const linkAddress = await mockLINK.getAddress();
      const isSupported = await kipuBank.supportedTokens(linkAddress);
      expect(isSupported).to.be.true;
    });
  });

  describe("Direct USDC Deposits", function () {
    it("Should deposit USDC directly without swap", async function () {
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockUSDC.mintToSelf(depositAmount);
      await mockUSDC.approve(await kipuBank.getAddress(), depositAmount);

      const tx = await kipuBank.depositERC20(await mockUSDC.getAddress(), depositAmount);
      await expect(tx).to.emit(kipuBank, "Deposit");

      const balance = await kipuBank.checkBalance(owner.address, await mockUSDC.getAddress());
      expect(balance).to.equal(depositAmount);
    });

    it("Should handle multiple USDC deposits", async function () {
      const depositAmount1 = ethers.parseUnits("500", 6);
      const depositAmount2 = ethers.parseUnits("300", 6);
      const totalAmount = depositAmount1 + depositAmount2;

      await mockUSDC.mintToSelf(totalAmount);
      await mockUSDC.approve(await kipuBank.getAddress(), totalAmount);

      await kipuBank.depositERC20(await mockUSDC.getAddress(), depositAmount1);
      await kipuBank.depositERC20(await mockUSDC.getAddress(), depositAmount2);

      const balance = await kipuBank.checkBalance(owner.address, await mockUSDC.getAddress());
      expect(balance).to.equal(totalAmount);
    });
  });

  describe("Arbitrary Token Deposits with Swap", function () {
    it("Should deposit DAI and convert to USDC (1:1 rate)", async function () {
      const daiAmount = ethers.parseUnits("1000", 18);
      const expectedUSDC = ethers.parseUnits("1000", 6);

      await mockDAI.mint(owner.address, daiAmount);
      await mockDAI.approve(await kipuBank.getAddress(), daiAmount);

      const tx = await kipuBank.depositArbitraryToken(await mockDAI.getAddress(), daiAmount);
      
      await expect(tx).to.emit(kipuBank, "TokenSwapped");
      await expect(tx).to.emit(kipuBank, "Deposit");

      const usdcBalance = await kipuBank.checkBalance(owner.address, await mockUSDC.getAddress());
      expect(usdcBalance).to.equal(expectedUSDC);
    });

    it("Should deposit LINK and convert to USDC (15:1 rate)", async function () {
      const linkAmount = ethers.parseUnits("10", 18);
      const expectedUSDC = ethers.parseUnits("150", 6);

      await mockLINK.mint(owner.address, linkAmount);
      await mockLINK.approve(await kipuBank.getAddress(), linkAmount);

      const tx = await kipuBank.depositArbitraryToken(await mockLINK.getAddress(), linkAmount);
      
      await expect(tx).to.emit(kipuBank, "TokenSwapped");

      const usdcBalance = await kipuBank.checkBalance(owner.address, await mockUSDC.getAddress());
      expect(usdcBalance).to.equal(expectedUSDC);
    });

    it("Should handle depositArbitraryToken with USDC (no swap)", async function () {
      const usdcAmount = ethers.parseUnits("500", 6);

      await mockUSDC.mintToSelf(usdcAmount);
      await mockUSDC.approve(await kipuBank.getAddress(), usdcAmount);

      const tx = await kipuBank.depositArbitraryToken(await mockUSDC.getAddress(), usdcAmount);
      
      await expect(tx).to.not.emit(kipuBank, "TokenSwapped");
      await expect(tx).to.emit(kipuBank, "Deposit");

      const balance = await kipuBank.checkBalance(owner.address, await mockUSDC.getAddress());
      expect(balance).to.equal(usdcAmount);
    });

    it("Should accumulate USDC from multiple token deposits", async function () {
      const daiAmount = ethers.parseUnits("100", 18);
      const linkAmount = ethers.parseUnits("10", 18);
      const expectedTotal = ethers.parseUnits("250", 6);

      await mockDAI.mint(owner.address, daiAmount);
      await mockDAI.approve(await kipuBank.getAddress(), daiAmount);
      await kipuBank.depositArbitraryToken(await mockDAI.getAddress(), daiAmount);

      await mockLINK.mint(owner.address, linkAmount);
      await mockLINK.approve(await kipuBank.getAddress(), linkAmount);
      await kipuBank.depositArbitraryToken(await mockLINK.getAddress(), linkAmount);

      const balance = await kipuBank.checkBalance(owner.address, await mockUSDC.getAddress());
      expect(balance).to.equal(expectedTotal);
    });
  });

  describe("Bank Cap Enforcement After Swaps", function () {
    it("Should enforce bank cap after swap completes", async function () {
      await mockUSDC.mint(await mockRouter.getAddress(), ethers.parseUnits("2000000", 6));

      const initialDeposit = ethers.parseUnits("900000", 6);
      await mockUSDC.mintToSelf(initialDeposit);
      await mockUSDC.approve(await kipuBank.getAddress(), initialDeposit);
      await kipuBank.depositERC20(await mockUSDC.getAddress(), initialDeposit);

      const daiAmount = ethers.parseUnits("200000", 18);
      await mockDAI.mint(owner.address, daiAmount);
      await mockDAI.approve(await kipuBank.getAddress(), daiAmount);

      await expect(
        kipuBank.depositArbitraryToken(await mockDAI.getAddress(), daiAmount)
      ).to.be.revertedWithCustomError(kipuBank, "DepositExceedsBankCap");
    });

    it("Should properly revert when bank cap exceeded after large swap", async function () {
      await mockUSDC.mint(await mockRouter.getAddress(), ethers.parseUnits("500000", 6));

      const initialDeposit = ethers.parseUnits("900000", 6);
      await mockUSDC.mintToSelf(initialDeposit);
      await mockUSDC.approve(await kipuBank.getAddress(), initialDeposit);
      await kipuBank.depositERC20(await mockUSDC.getAddress(), initialDeposit);

      const daiAmount = ethers.parseUnits("200000", 18);
      await mockDAI.mint(user1.address, daiAmount);
      const daiConnected = mockDAI.connect(user1) as typeof mockDAI;
      await daiConnected.approve(await kipuBank.getAddress(), daiAmount);

      const bankBalanceBefore = await kipuBank.totalBankBalanceUSD8();

      const kipuBankConnected = kipuBank.connect(user1) as typeof kipuBank;
      await expect(
        kipuBankConnected.depositArbitraryToken(await mockDAI.getAddress(), daiAmount)
      ).to.be.revertedWithCustomError(kipuBank, "DepositExceedsBankCap");

      const bankBalanceAfter = await kipuBank.totalBankBalanceUSD8();
      expect(bankBalanceAfter).to.equal(bankBalanceBefore);

      const user1Balance = await kipuBank.checkBalance(user1.address, await mockUSDC.getAddress());
      expect(user1Balance).to.equal(0);
    });
  });

  describe("Withdraw After Arbitrary Token Deposits", function () {
    it("Should withdraw USDC after depositing DAI", async function () {
      const daiAmount = ethers.parseUnits("1000", 18);
      const expectedUSDC = ethers.parseUnits("1000", 6);

      await mockDAI.mint(owner.address, daiAmount);
      await mockDAI.approve(await kipuBank.getAddress(), daiAmount);
      await kipuBank.depositArbitraryToken(await mockDAI.getAddress(), daiAmount);

      const withdrawAmount = ethers.parseUnits("500", 6);
      await kipuBank.withdraw(await mockUSDC.getAddress(), withdrawAmount);

      const balance = await kipuBank.checkBalance(owner.address, await mockUSDC.getAddress());
      expect(balance).to.equal(expectedUSDC - withdrawAmount);
    });

    it("Should withdraw full USDC balance", async function () {
      const linkAmount = ethers.parseUnits("10", 18);
      const expectedUSDC = ethers.parseUnits("150", 6);

      await mockLINK.mint(owner.address, linkAmount);
      await mockLINK.approve(await kipuBank.getAddress(), linkAmount);
      await kipuBank.depositArbitraryToken(await mockLINK.getAddress(), linkAmount);

      await kipuBank.withdraw(await mockUSDC.getAddress(), expectedUSDC);

      const balance = await kipuBank.checkBalance(owner.address, await mockUSDC.getAddress());
      expect(balance).to.equal(0);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to add supported token", async function () {
      const newToken = await ethers.deployContract("MockERC20", ["New Token", "NEW", 18]);
      const newTokenAddress = await newToken.getAddress();

      await expect(kipuBank.addSupportedToken(newTokenAddress))
        .to.emit(kipuBank, "SupportedTokenAdded")
        .withArgs(newTokenAddress);

      const isSupported = await kipuBank.supportedTokens(newTokenAddress);
      expect(isSupported).to.be.true;
    });

    it("Should allow admin to remove supported token", async function () {
      const daiAddress = await mockDAI.getAddress();

      await expect(kipuBank.removeSupportedToken(daiAddress))
        .to.emit(kipuBank, "SupportedTokenRemoved")
        .withArgs(daiAddress);

      const isSupported = await kipuBank.supportedTokens(daiAddress);
      expect(isSupported).to.be.false;
    });

    it("Should reject non-admin adding supported token", async function () {
      const newToken = await ethers.deployContract("MockERC20", ["New Token", "NEW", 18]);
      const newTokenAddress = await newToken.getAddress();

      const kipuBankConnected = kipuBank.connect(user1) as typeof kipuBank;
      await expect(
        kipuBankConnected.addSupportedToken(newTokenAddress)
      ).to.be.reverted;
    });

    it("Should reject adding ETH as supported token", async function () {
      const ETH_ALIAS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      
      await expect(
        kipuBank.addSupportedToken(ETH_ALIAS)
      ).to.be.revertedWith("Invalid token");
    });

    it("Should reject adding zero address as supported token", async function () {
      await expect(
        kipuBank.addSupportedToken(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid token");
    });
  });

  describe("Edge Cases and Error Handling", function () {
    it("Should revert on zero amount deposit", async function () {
      await expect(
        kipuBank.depositArbitraryToken(await mockDAI.getAddress(), 0)
      ).to.be.revertedWithCustomError(kipuBank, "ZeroAmount");
    });

    it("Should revert when depositing unsupported token", async function () {
      const unsupportedToken = await ethers.deployContract("MockERC20", ["Unsupported", "UNS", 18]);
      const unsupportedAddress = await unsupportedToken.getAddress();
      const amount = ethers.parseUnits("100", 18);

      await unsupportedToken.mint(owner.address, amount);
      await unsupportedToken.approve(await kipuBank.getAddress(), amount);

      await expect(
        kipuBank.depositArbitraryToken(unsupportedAddress, amount)
      ).to.be.revertedWithCustomError(kipuBank, "TokenNotSupportedForSwap");
    });

    it("Should revert when trying to deposit ETH via depositArbitraryToken", async function () {
      const ETH_ALIAS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      
      await expect(
        kipuBank.depositArbitraryToken(ETH_ALIAS, ethers.parseEther("1"))
      ).to.be.revertedWith("use depositETH()");
    });

    it("Should handle token with insufficient allowance", async function () {
      const daiAmount = ethers.parseUnits("1000", 18);
      await mockDAI.mint(owner.address, daiAmount);

      await expect(
        kipuBank.depositArbitraryToken(await mockDAI.getAddress(), daiAmount)
      ).to.be.reverted;
    });
  });

  describe("Multiple Users", function () {
    it("Should handle deposits from multiple users", async function () {
      const user1Amount = ethers.parseUnits("100", 18);
      const user2Amount = ethers.parseUnits("200", 18);

      await mockDAI.mint(user1.address, user1Amount);
      const dai1 = mockDAI.connect(user1) as typeof mockDAI;
      await dai1.approve(await kipuBank.getAddress(), user1Amount);
      const kipu1 = kipuBank.connect(user1) as typeof kipuBank;
      await kipu1.depositArbitraryToken(await mockDAI.getAddress(), user1Amount);

      await mockDAI.mint(user2.address, user2Amount);
      const dai2 = mockDAI.connect(user2) as typeof mockDAI;
      await dai2.approve(await kipuBank.getAddress(), user2Amount);
      const kipu2 = kipuBank.connect(user2) as typeof kipuBank;
      await kipu2.depositArbitraryToken(await mockDAI.getAddress(), user2Amount);

      const user1Balance = await kipuBank.checkBalance(user1.address, await mockUSDC.getAddress());
      const user2Balance = await kipuBank.checkBalance(user2.address, await mockUSDC.getAddress());

      expect(user1Balance).to.equal(ethers.parseUnits("100", 6));
      expect(user2Balance).to.equal(ethers.parseUnits("200", 6));
    });
  });

  describe("V2 Functionality Preserved", function () {
    it("Should still support direct ETH deposits", async function () {
      const depositAmount = ethers.parseEther("1");

      const tx = await kipuBank.depositETH({ value: depositAmount });
      await expect(tx).to.emit(kipuBank, "Deposit");

      const ETH_ALIAS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      const balance = await kipuBank.checkBalance(owner.address, ETH_ALIAS);
      expect(balance).to.equal(depositAmount);
    });

    it("Should still support ETH withdrawals", async function () {
      const depositAmount = ethers.parseEther("1");
      await kipuBank.depositETH({ value: depositAmount });

      const ETH_ALIAS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      const withdrawAmount = ethers.parseEther("0.5");

      const balanceBefore = await ethers.provider.getBalance(owner.address);
      const tx = await kipuBank.withdraw(ETH_ALIAS, withdrawAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(owner.address);

      expect(balanceAfter).to.equal(balanceBefore + withdrawAmount - BigInt(gasUsed));
    });

    it("Should maintain reentrancy protection", async function () {
      const daiAmount = ethers.parseUnits("1000", 18);
      await mockDAI.mint(owner.address, daiAmount);
      await mockDAI.approve(await kipuBank.getAddress(), daiAmount);

      await expect(
        kipuBank.depositArbitraryToken(await mockDAI.getAddress(), daiAmount)
      ).to.not.be.revertedWithCustomError(kipuBank, "ReentrantCall");
    });
  });

  describe("Gas Optimization", function () {
    it("Should track deposit count correctly", async function () {
      const countBefore = await kipuBank.depositCount();

      const daiAmount = ethers.parseUnits("100", 18);
      await mockDAI.mint(owner.address, daiAmount);
      await mockDAI.approve(await kipuBank.getAddress(), daiAmount);
      await kipuBank.depositArbitraryToken(await mockDAI.getAddress(), daiAmount);

      const countAfter = await kipuBank.depositCount();
      expect(countAfter).to.equal(countBefore + BigInt(1));
    });
  });
});

