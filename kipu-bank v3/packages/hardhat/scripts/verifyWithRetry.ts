import { run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function verifyWithRetry(contractName: string, maxRetries = 3) {
  const deploymentsPath = path.join(__dirname, "../deployments/sepolia");
  const contractPath = path.join(deploymentsPath, `${contractName}.json`);

  if (!fs.existsSync(contractPath)) {
    console.log(`❌ ${contractName} deployment file not found`);
    return;
  }

  const deployment = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
  const address = deployment.address;
  const args = deployment.args || [];

  console.log(`\n📝 Verifying ${contractName} at ${address}...`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await run("verify:verify", {
        address: address,
        constructorArguments: args,
      });
      console.log(`✅ ${contractName} verified successfully!`);
      return;
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        console.log(`✅ ${contractName} already verified`);
        return;
      }
      
      if (error.message.includes("rate limit") && attempt < maxRetries) {
        const waitTime = 15000 * attempt; // Exponential backoff: 15s, 30s, 45s
        console.log(`⏳ Rate limited. Waiting ${waitTime/1000}s before retry ${attempt}/${maxRetries}...`);
        await delay(waitTime);
      } else if (attempt === maxRetries) {
        console.log(`❌ ${contractName} verification failed after ${maxRetries} attempts:`);
        console.log(error.message);
      }
    }
  }
}

async function main() {
  const contracts = [
    "KipuBankV3",
    "MockUSDC",
    "MockV3Aggregator_USDC",
    "MockDAI",
    "MockV3Aggregator_DAI",
    "MockLINK",
    "MockV3Aggregator_LINK",
    "MockUniversalRouter",
  ];

  console.log("🚀 Starting verification with rate limit handling...\n");

  for (const contract of contracts) {
    await verifyWithRetry(contract);
    await delay(3000); // 3 second delay between contracts
  }

  console.log("\n✨ Verification process complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

