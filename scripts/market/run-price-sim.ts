// `npm run market:sim`: prints the market model's best trade routes (scripts/market/priceSim.ts).
import { bestPerGood, formatRoute, topRoutes } from "./priceSim";

console.log("Top 10 routes by profit per cargo unit:");
for (const r of topRoutes(10, "profit")) console.log("  " + formatRoute(r));
console.log("\nTop 10 routes by profit per unit per 10k lane units (short hops count as 2k):");
for (const r of topRoutes(10, "perLeague")) console.log("  " + formatRoute(r));
console.log("\nBest route per good:");
for (const r of bestPerGood()) console.log("  " + formatRoute(r));
