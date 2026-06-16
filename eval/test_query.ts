import { searchDocuments } from "../src/services/rag.service";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

async function main() {
  const query = process.argv[2] || "vocês têm vacina da febre amarela?";
  console.log(`Buscando por: "${query}"...`);
  const result = await searchDocuments(query, {});
  console.log(`Status: ${result.status}`);
  console.log(`Top Score: ${result.topScore}`);
  console.log("Trechos Retornados:");
  console.log(result.content);
}

main().catch(console.error);
