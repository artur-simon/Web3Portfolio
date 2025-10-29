import { expect } from "chai";
import { ethers } from "hardhat";
import { KipuBankV3, MockV3Aggregator } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("KippuBankV3", function () {
  let kippuBank: KipuBankV3;
  let mockOracle: MockV3Aggregator;
  let owner: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"; // ERC-7528 canonical alias
  const BANK_CAP_USD8 = BigInt(1_000_000) * BigInt(10 ** 8); // 8 decimals
  const MAX_WITHDRAW_PER_TX_USD8 = BigInt(10_000) * BigInt(10 ** 8); // 8 decimals
  const ETH_PRICE_8_DECIMALS = 200000000000n;

  beforeEach(async () => {
    [owner, user1, user2] = await ethers.getSigners();

    const MockV3AggregatorFactory = await ethers.getContractFactory("MockV3Aggregator");
    mockOracle = (await MockV3AggregatorFactory.deploy(8, ETH_PRICE_8_DECIMALS)) as MockV3Aggregator;
    await mockOracle.waitForDeployment();

    const KipuBankV3Factory = await ethers.getContractFactory("KipuBankV3");
    kippuBank = (await KipuBankV3Factory.deploy(
      await mockOracle.getAddress(),
      BANK_CAP_USD8,
      MAX_WITHDRAW_PER_TX_USD8,
    )) as KipuBankV3;
    await kippuBank.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct oracle address", async function () {
      expect(await kippuBank.ethUsdOracle()).to.equal(await mockOracle.getAddress());
    });

    it("Should set the correct bank cap", async function () {
      expect(await kippuBank.BANK_CAP_USD8()).to.equal(BANK_CAP_USD8);
    });

    it("Should set the correct max withdraw per tx", async function () {
      expect(await kippuBank.MAX_WITHDRAW_PER_TX_USD8()).to.equal(MAX_WITHDRAW_PER_TX_USD8);
    });

    it("Should grant admin role to deployer", async function () {
      const ADMIN_ROLE = await kippuBank.ADMIN_ROLE();
      expect(await kippuBank.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should initialize with zero balances", async function () {
      expect(await kippuBank.totalBankBalanceUSD8()).to.equal(0);
      expect(await kippuBank.depositCount()).to.equal(0);
      expect(await kippuBank.withdrawCount()).to.equal(0);
    });
  });

  describe("ETH Deposits", function () {
    it("Should accept ETH deposits", async function () {
      const depositAmount = ethers.parseEther("1.0");

      await expect(kippuBank.connect(user1).depositETH({ value: depositAmount }))
        .to.emit(kippuBank, "Deposit")
        .withArgs(user1.address, ETH_ADDRESS, depositAmount, 2000n * 10n ** 8n);

      expect(await kippuBank.checkBalance(user1.address, ETH_ADDRESS)).to.equal(depositAmount);
      expect(await kippuBank.depositCount()).to.equal(1);
    });

    it("Should track total bank balance in USDC correctly", async function () {
      const depositAmount = ethers.parseEther("1.0");
      await kippuBank.connect(user1).depositETH({ value: depositAmount });

      const expectedUSD8 = 2000n * 10n ** 8n;
      expect(await kippuBank.totalBankBalanceUSD8()).to.equal(expectedUSD8);
    });

    it("Should reject zero amount deposits", async function () {
      await expect(kippuBank.connect(user1).depositETH({ value: 0 })).to.be.revertedWithCustomError(
        kippuBank,
        "ZeroAmount",
      );
    });

    it("Should enforce bank cap", async function () {
      const largeDeposit = ethers.parseEther("600");
      await expect(
        kippuBank.connect(user1).depositETH({ value: largeDeposit }),
      ).to.be.revertedWithCustomError(kippuBank, "DepositExceedsBankCap");
    });

    it("Should allow multiple deposits up to bank cap", async function () {
      const depositAmount = ethers.parseEther("100");

      await kippuBank.connect(user1).depositETH({ value: depositAmount });
      await kippuBank.connect(user2).depositETH({ value: depositAmount });

      expect(await kippuBank.checkBalance(user1.address, ETH_ADDRESS)).to.equal(depositAmount);
      expect(await kippuBank.checkBalance(user2.address, ETH_ADDRESS)).to.equal(depositAmount);
      expect(await kippuBank.depositCount()).to.equal(2);
    });

    it("Should calculate remaining bank capacity correctly", async function () {
      const depositAmount = ethers.parseEther("100");
      await kippuBank.connect(user1).depositETH({ value: depositAmount });

      const remaining = await kippuBank.remainingBankCapacityUSD8();
      expect(remaining).to.be.lessThan(BANK_CAP_USD8);
      expect(remaining).to.be.greaterThan(0);
    });
  });

  describe("ETH Withdrawals", function () {
    beforeEach(async function () {
      const depositAmount = ethers.parseEther("10");
      await kippuBank.connect(user1).depositETH({ value: depositAmount });
    });

    it("Should allow withdrawal of deposited ETH", async function () {
      const withdrawAmount = ethers.parseEther("5");
      const initialBalance = await ethers.provider.getBalance(user1.address);

      const tx = await kippuBank.connect(user1).withdraw(ETH_ADDRESS, withdrawAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const finalBalance = await ethers.provider.getBalance(user1.address);

      expect(finalBalance).to.equal(initialBalance + withdrawAmount - gasUsed);
      expect(await kippuBank.checkBalance(user1.address, ETH_ADDRESS)).to.equal(ethers.parseEther("5"));
      expect(await kippuBank.withdrawCount()).to.equal(1);
    });

    it("Should emit Withdraw event", async function () {
      const withdrawAmount = ethers.parseEther("1");

      await expect(kippuBank.connect(user1).withdraw(ETH_ADDRESS, withdrawAmount))
        .to.emit(kippuBank, "Withdraw")
        .withArgs(user1.address, ETH_ADDRESS, withdrawAmount, 2000n * 10n ** 8n);
    });

    it("Should reject zero amount withdrawals", async function () {
      await expect(kippuBank.connect(user1).withdraw(ETH_ADDRESS, 0)).to.be.revertedWithCustomError(
        kippuBank,
        "ZeroAmount",
      );
    });

    it("Should reject withdrawal exceeding balance", async function () {
      const excessAmount = ethers.parseEther("20");

      await expect(
        kippuBank.connect(user1).withdraw(ETH_ADDRESS, excessAmount),
      ).to.be.revertedWithCustomError(kippuBank, "InsufficientBalance");
    });

    it("Should enforce per-transaction withdraw limit", async function () {
      const largeDeposit = ethers.parseEther("100");
      await kippuBank.connect(user2).depositETH({ value: largeDeposit });

      const largeWithdraw = ethers.parseEther("10");
      await expect(
        kippuBank.connect(user2).withdraw(ETH_ADDRESS, largeWithdraw),
      ).to.be.revertedWithCustomError(kippuBank, "WithdrawLimitPerTxUSD");
    });

    it("Should update total bank balance after withdrawal", async function () {
      const initialTotalBalance = await kippuBank.totalBankBalanceUSD8();
      const withdrawAmount = ethers.parseEther("1");

      await kippuBank.connect(user1).withdraw(ETH_ADDRESS, withdrawAmount);

      const finalTotalBalance = await kippuBank.totalBankBalanceUSD8();
      expect(finalTotalBalance).to.be.lessThan(initialTotalBalance);
    });
  });

  describe("Balance Queries", function () {
    it("Should return correct user balance", async function () {
      const depositAmount = ethers.parseEther("5");
      await kippuBank.connect(user1).depositETH({ value: depositAmount });

      expect(await kippuBank.checkBalance(user1.address, ETH_ADDRESS)).to.equal(depositAmount);
      expect(await kippuBank.checkBalance(user2.address, ETH_ADDRESS)).to.equal(0);
    });

    it("Should return correct total token balance", async function () {
      const deposit1 = ethers.parseEther("5");
      const deposit2 = ethers.parseEther("3");

      await kippuBank.connect(user1).depositETH({ value: deposit1 });
      await kippuBank.connect(user2).depositETH({ value: deposit2 });

      expect(await kippuBank.getBankTokenBalance(ETH_ADDRESS)).to.equal(deposit1 + deposit2);
    });

    it("Should return correct remaining capacity", async function () {
      const depositAmount = ethers.parseEther("1");
      await kippuBank.connect(user1).depositETH({ value: depositAmount });

      const remaining = await kippuBank.remainingBankCapacityUSD8();
      const totalBalance = await kippuBank.totalBankBalanceUSD8();

      expect(remaining + totalBalance).to.equal(BANK_CAP_USD8);
    });
  });

  describe("Edge Cases", function () {
    it("Should reject direct ETH transfers", async function () {
      await expect(
        user1.sendTransaction({
          to: await kippuBank.getAddress(),
          value: ethers.parseEther("1"),
        }),
      ).to.be.reverted;
    });

    it("Should prevent reentrancy on deposit", async function () {
      const depositAmount = ethers.parseEther("1");
      await kippuBank.connect(user1).depositETH({ value: depositAmount });

      expect(await kippuBank.checkBalance(user1.address, ETH_ADDRESS)).to.equal(depositAmount);
    });

    it("Should handle multiple users independently", async function () {
      const amount1 = ethers.parseEther("2");
      const amount2 = ethers.parseEther("3");

      await kippuBank.connect(user1).depositETH({ value: amount1 });
      await kippuBank.connect(user2).depositETH({ value: amount2 });

      expect(await kippuBank.checkBalance(user1.address, ETH_ADDRESS)).to.equal(amount1);
      expect(await kippuBank.checkBalance(user2.address, ETH_ADDRESS)).to.equal(amount2);

      await kippuBank.connect(user1).withdraw(ETH_ADDRESS, amount1);

      expect(await kippuBank.checkBalance(user1.address, ETH_ADDRESS)).to.equal(0);
      expect(await kippuBank.checkBalance(user2.address, ETH_ADDRESS)).to.equal(amount2);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to update oracle price", async function () {
      const newPrice = 250000000000n;
      await mockOracle.updateAnswer(newPrice);

      const depositAmount = ethers.parseEther("1");
      await kippuBank.connect(user1).depositETH({ value: depositAmount });

      const expectedUSD8 = 2500n * 10n ** 8n;
      expect(await kippuBank.totalBankBalanceUSD8()).to.equal(expectedUSD8);
    });

    it("Should verify admin role exists", async function () {
      const ADMIN_ROLE = await kippuBank.ADMIN_ROLE();
      expect(await kippuBank.hasRole(ADMIN_ROLE, owner.address)).to.be.true;
      expect(await kippuBank.hasRole(ADMIN_ROLE, user1.address)).to.be.false;
    });
  });
});

