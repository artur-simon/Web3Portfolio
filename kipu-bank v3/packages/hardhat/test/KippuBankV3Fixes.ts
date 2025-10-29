import { expect } from "chai";
import { ethers } from "hardhat";
import { KipuBankV3, MockV3Aggregator } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("KipuBankV3 Fixes", function () {
  let kippuBank: KipuBankV3;
  let mockOracle: MockV3Aggregator;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  const ETH_PRICE_8_DECIMALS = 2000e8; // $2000
  const BANK_CAP_USD8 = BigInt(1_000_000) * BigInt(10 ** 8); // $1,000,000 with 8 decimals
  const MAX_WITHDRAW_PER_TX_USD8 = BigInt(10_000) * BigInt(10 ** 8); // $10,000 with 8 decimals
  const ETH_ALIAS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

  beforeEach(async () => {
    [owner, user1, user2] = await ethers.getSigners();

    const MockV3AggregatorFactory = await ethers.getContractFactory("MockV3Aggregator");
    mockOracle = (await MockV3AggregatorFactory.deploy(8, ETH_PRICE_8_DECIMALS)) as MockV3Aggregator;
    await mockOracle.waitForDeployment();

    const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDCFactory.deploy();
    await mockUSDC.waitForDeployment();

    const MockUniversalRouterFactory = await ethers.getContractFactory("MockUniversalRouter");
    const mockRouter = await MockUniversalRouterFactory.deploy();
    await mockRouter.waitForDeployment();

    const KipuBankV3Factory = await ethers.getContractFactory("KipuBankV3");
    kippuBank = (await KipuBankV3Factory.deploy(
      await mockOracle.getAddress(),
      BANK_CAP_USD8,
      MAX_WITHDRAW_PER_TX_USD8,
      await mockUSDC.getAddress(),
      await mockRouter.getAddress(),
    )) as KipuBankV3;
    await kippuBank.waitForDeployment();
  });

  describe("ERC-7528 Compliance", function () {
    it("should use canonical ETH_ALIAS address", async function () {
      const ethAlias = await kippuBank.ETH_ALIAS();
      expect(ethAlias).to.equal(ETH_ALIAS);
    });

    it("should accept address(0) and normalize to ETH_ALIAS for deposits", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("1") });
      
      // Balance should be stored under ETH_ALIAS
      const balanceWithAlias = await kippuBank.checkBalance(user1.address, ETH_ALIAS);
      const balanceWithZero = await kippuBank.checkBalance(user1.address, ethers.ZeroAddress);
      
      expect(balanceWithAlias).to.equal(ethers.parseEther("1"));
      expect(balanceWithZero).to.equal(ethers.parseEther("1"));
    });

    it("should accept address(0) and normalize to ETH_ALIAS for withdrawals", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("1") });
      
      // Withdraw using address(0)
      await kippuBank.connect(user1).withdraw(ethers.ZeroAddress, ethers.parseEther("0.5"));
      
      const balance = await kippuBank.checkBalance(user1.address, ETH_ALIAS);
      expect(balance).to.equal(ethers.parseEther("0.5"));
    });

    it("should emit events with canonical ETH_ALIAS address", async function () {
      await expect(kippuBank.connect(user1).depositETH({ value: ethers.parseEther("1") }))
        .to.emit(kippuBank, "Deposit")
        .withArgs(user1.address, ETH_ALIAS, ethers.parseEther("1"), 2000n * 10n ** 8n);
    });
  });

  describe("8-Decimal USD Accounting", function () {
    it("should use BANK_CAP_USD8 with 8 decimals", async function () {
      const cap = await kippuBank.BANK_CAP_USD8();
      expect(cap).to.equal(BANK_CAP_USD8);
    });

    it("should use MAX_WITHDRAW_PER_TX_USD8 with 8 decimals", async function () {
      const maxWithdraw = await kippuBank.MAX_WITHDRAW_PER_TX_USD8();
      expect(maxWithdraw).to.equal(MAX_WITHDRAW_PER_TX_USD8);
    });

    it("should track totalBankBalanceUSD8 with 8 decimals", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("1") });
      
      const totalBalance = await kippuBank.totalBankBalanceUSD8();
      // 1 ETH * $2000 = $2000 with 8 decimals = 2000e8
      expect(totalBalance).to.equal(2000n * 10n ** 8n);
    });

    it("should emit Deposit event with amountInUSD8 using 8 decimals", async function () {
      await expect(kippuBank.connect(user1).depositETH({ value: ethers.parseEther("1") }))
        .to.emit(kippuBank, "Deposit")
        .withArgs(user1.address, ETH_ALIAS, ethers.parseEther("1"), 2000n * 10n ** 8n);
    });

    it("should emit Withdraw event with amountInUSD8 using 8 decimals", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("1") });
      
      await expect(kippuBank.connect(user1).withdraw(ETH_ALIAS, ethers.parseEther("0.5")))
        .to.emit(kippuBank, "Withdraw")
        .withArgs(user1.address, ETH_ALIAS, ethers.parseEther("0.5"), 1000n * 10n ** 8n);
    });

    it("should calculate remainingBankCapacityUSD8 correctly with 8 decimals", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("100") });
      
      const remaining = await kippuBank.remainingBankCapacityUSD8();
      // $1,000,000 - (100 ETH * $2000) = $1,000,000 - $200,000 = $800,000
      expect(remaining).to.equal(800_000n * 10n ** 8n);
    });

    it("should reject deposit exceeding bank cap with correct 8-decimal error values", async function () {
      // Deposit almost to cap
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("499") });
      
      // Try to deposit 2 ETH (=$4000) which should exceed cap
      await expect(
        kippuBank.connect(user2).depositETH({ value: ethers.parseEther("2") })
      ).to.be.revertedWithCustomError(kippuBank, "DepositExceedsBankCap");
    });
  });

  describe("Native Per-Tx Cap (Wei)", function () {
    it("should allow setting native per-tx cap by admin", async function () {
      const newCap = ethers.parseEther("10");
      
      await expect(kippuBank.connect(owner).setNativePerTxCapWei(newCap))
        .to.emit(kippuBank, "NativePerTxCapWeiUpdated")
        .withArgs(0, newCap);
      
      expect(await kippuBank.nativePerTxCapWei()).to.equal(newCap);
    });

    it("should reject setting native cap by non-admin", async function () {
      await expect(
        kippuBank.connect(user1).setNativePerTxCapWei(ethers.parseEther("10"))
      ).to.be.reverted;
    });

    it("should enforce native per-tx cap on ETH withdrawals", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("20") });
      
      // Set cap to 3 ETH (=$6,000, under the $10,000 USD cap)
      await kippuBank.connect(owner).setNativePerTxCapWei(ethers.parseEther("3"));
      
      // Try to withdraw 4 ETH - should fail native cap (4 ETH = $8,000, under USD cap)
      await expect(
        kippuBank.connect(user1).withdraw(ETH_ALIAS, ethers.parseEther("4"))
      ).to.be.revertedWithCustomError(kippuBank, "WithdrawLimitPerTxNative")
        .withArgs(ethers.parseEther("4"), ethers.parseEther("3"));
    });

    it("should allow withdrawals under native cap", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("20") });
      
      // Set cap to 10 ETH
      await kippuBank.connect(owner).setNativePerTxCapWei(ethers.parseEther("10"));
      
      // Withdraw 5 ETH - should succeed
      await expect(
        kippuBank.connect(user1).withdraw(ETH_ALIAS, ethers.parseEther("5"))
      ).to.emit(kippuBank, "Withdraw");
    });

    it("should not enforce native cap when set to 0", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("20") });
      
      // Native cap is 0 by default
      expect(await kippuBank.nativePerTxCapWei()).to.equal(0);
      
      // Should be able to withdraw large amount limited only by USD cap
      await kippuBank.connect(user1).withdraw(ETH_ALIAS, ethers.parseEther("4"));
      // 4 ETH * $2000 = $8000, which is under the $10,000 USD cap
    });

    it("should enforce both USD cap and native cap (most restrictive wins)", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("20") });
      
      // Set native cap to 3 ETH (=$6000)
      await kippuBank.connect(owner).setNativePerTxCapWei(ethers.parseEther("3"));
      // USD cap is $10,000
      
      // Try to withdraw 4 ETH - should fail native cap (even though USD cap allows it)
      await expect(
        kippuBank.connect(user1).withdraw(ETH_ALIAS, ethers.parseEther("4"))
      ).to.be.revertedWithCustomError(kippuBank, "WithdrawLimitPerTxNative");
      
      // Withdraw 2 ETH - should succeed (under both caps)
      await expect(
        kippuBank.connect(user1).withdraw(ETH_ALIAS, ethers.parseEther("2"))
      ).to.emit(kippuBank, "Withdraw");
    });
  });

  describe("Oracle Hygiene", function () {
    it("should accept valid oracle data with correct answeredInRound", async function () {
      await mockOracle.updateAnswer(2500e8);
      
      // Should work fine
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("1") });
      
      const totalBalance = await kippuBank.totalBankBalanceUSD8();
      expect(totalBalance).to.equal(2500n * 10n ** 8n);
    });

    it("should reject zero price from oracle", async function () {
      await mockOracle.updateAnswer(0);
      
      await expect(
        kippuBank.connect(user1).depositETH({ value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(kippuBank, "InvalidPrice");
    });

    it("should reject negative price from oracle", async function () {
      await mockOracle.updateAnswer(-1000e8);
      
      await expect(
        kippuBank.connect(user1).depositETH({ value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(kippuBank, "InvalidPrice");
    });

    it("should reject stale oracle data", async function () {
      // Fast forward time by more than MAX_ORACLE_STALENESS (1 hour)
      await time.increase(3601);
      
      // Try to deposit - should fail due to stale price
      await expect(
        kippuBank.connect(user1).depositETH({ value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(kippuBank, "StalePrice");
    });

    it("should accept recent oracle data within staleness threshold", async function () {
      // Fast forward by 30 minutes (within 1 hour threshold)
      await time.increase(1800);
      
      // Update price to refresh timestamp
      await mockOracle.updateAnswer(2100e8);
      
      // Should work fine
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("1") });
      
      const totalBalance = await kippuBank.totalBankBalanceUSD8();
      expect(totalBalance).to.equal(2100n * 10n ** 8n);
    });
  });

  describe("Admin Recovery with Events", function () {
    it("should emit AdminRecover event with old and new balances", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("5") });
      
      const oldBalance = await kippuBank.checkBalance(user1.address, ETH_ALIAS);
      const newBalance = ethers.parseEther("3");
      const reason = ethers.encodeBytes32String("RECOVERY");
      
      await expect(
        kippuBank.connect(owner).adminRecoverFunds(user1.address, ETH_ALIAS, newBalance, reason)
      )
        .to.emit(kippuBank, "AdminRecover")
        .withArgs(user1.address, ETH_ALIAS, oldBalance, newBalance, reason);
    });

    it("should update balances correctly during recovery", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("5") });
      const initialTotalUSD8 = await kippuBank.totalBankBalanceUSD8();
      
      const newBalance = ethers.parseEther("3");
      const reason = ethers.encodeBytes32String("ADJUST");
      
      await kippuBank.connect(owner).adminRecoverFunds(user1.address, ETH_ALIAS, newBalance, reason);
      
      const userBalance = await kippuBank.checkBalance(user1.address, ETH_ALIAS);
      expect(userBalance).to.equal(newBalance);
      
      // Total USD8 should reflect the change
      const expectedTotalUSD8 = 3n * 2000n * 10n ** 8n; // 3 ETH * $2000
      const actualTotalUSD8 = await kippuBank.totalBankBalanceUSD8();
      expect(actualTotalUSD8).to.equal(expectedTotalUSD8);
    });

    it("should handle recovery with address(0) and normalize to ETH_ALIAS", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("5") });
      
      const newBalance = ethers.parseEther("2");
      const reason = ethers.encodeBytes32String("FIX");
      
      // Use address(0) - should be normalized to ETH_ALIAS
      await expect(
        kippuBank.connect(owner).adminRecoverFunds(user1.address, ethers.ZeroAddress, newBalance, reason)
      )
        .to.emit(kippuBank, "AdminRecover")
        .withArgs(user1.address, ETH_ALIAS, ethers.parseEther("5"), newBalance, reason);
      
      const balance = await kippuBank.checkBalance(user1.address, ETH_ALIAS);
      expect(balance).to.equal(newBalance);
    });

    it("should require ADMIN_ROLE for recovery", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("5") });
      
      await expect(
        kippuBank.connect(user2).adminRecoverFunds(
          user1.address,
          ETH_ALIAS,
          ethers.parseEther("3"),
          ethers.encodeBytes32String("HACK")
        )
      ).to.be.reverted;
    });
  });

  describe("USD Withdraw Limit", function () {
    it("should enforce USD per-tx limit with WithdrawLimitPerTxUSD error", async function () {
      // Deposit enough ETH
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("100") });
      
      // Try to withdraw 6 ETH = $12,000 (exceeds $10,000 limit)
      await expect(
        kippuBank.connect(user1).withdraw(ETH_ALIAS, ethers.parseEther("6"))
      ).to.be.revertedWithCustomError(kippuBank, "WithdrawLimitPerTxUSD")
        .withArgs(12000n * 10n ** 8n, MAX_WITHDRAW_PER_TX_USD8);
    });

    it("should allow withdrawals under USD limit", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("100") });
      
      // Withdraw 4 ETH = $8,000 (under $10,000 limit)
      await expect(
        kippuBank.connect(user1).withdraw(ETH_ALIAS, ethers.parseEther("4"))
      ).to.emit(kippuBank, "Withdraw");
    });
  });

  describe("Integration Tests", function () {
    it("should handle full deposit-withdraw cycle with all fixes", async function () {
      // Set native cap
      await kippuBank.connect(owner).setNativePerTxCapWei(ethers.parseEther("5"));
      
      // Deposit with canonical address
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("10") });
      
      // Check balance using address(0) - should normalize
      const balance = await kippuBank.checkBalance(user1.address, ethers.ZeroAddress);
      expect(balance).to.equal(ethers.parseEther("10"));
      
      // Withdraw respecting both caps
      await kippuBank.connect(user1).withdraw(ethers.ZeroAddress, ethers.parseEther("3"));
      
      const remainingBalance = await kippuBank.checkBalance(user1.address, ETH_ALIAS);
      expect(remainingBalance).to.equal(ethers.parseEther("7"));
      
      // Check USD8 accounting
      const totalUSD8 = await kippuBank.totalBankBalanceUSD8();
      expect(totalUSD8).to.equal(7n * 2000n * 10n ** 8n);
    });

    it("should handle multiple users with canonical address", async function () {
      await kippuBank.connect(user1).depositETH({ value: ethers.parseEther("5") });
      await kippuBank.connect(user2).depositETH({ value: ethers.parseEther("3") });
      
      const balance1 = await kippuBank.checkBalance(user1.address, ETH_ALIAS);
      const balance2 = await kippuBank.checkBalance(user2.address, ethers.ZeroAddress);
      
      expect(balance1).to.equal(ethers.parseEther("5"));
      expect(balance2).to.equal(ethers.parseEther("3"));
      
      const totalUSD8 = await kippuBank.totalBankBalanceUSD8();
      expect(totalUSD8).to.equal(8n * 2000n * 10n ** 8n); // 8 ETH * $2000
    });
  });
});

