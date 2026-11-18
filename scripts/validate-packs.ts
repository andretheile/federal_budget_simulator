/**
 * npm run validate [-- <directory>]
 *
 * Validates every country pack under countries/ (or under the given directory). Prints the
 * errors of each invalid pack and exits with status 1 if there are any. For each valid pack it
 * prints the derived totals and what every policy does on its own at default parameters, so a
 * reviewer can judge whether the numbers are plausible.
 *
 * Runs on plain Node (>= 22.18), which strips the TypeScript types itself.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import process from "node:process";
import {
  formatIssue,
  shareOfGdp,
  simulate,
  simulatePolicy,
  validatePackFiles,
  type CountryPack,
  type ValidationIssue,
} from "../src/engine/index.ts";

const root = resolve(process.argv[2] ?? "countries");
const inside = relative(process.cwd(), root);
const label = inside === "" ? "." : inside.startsWith("..") ? root : inside;

/** All .json files below `dir`, as paths relative to it with forward slashes. */
function jsonFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsonFiles(path, base));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(relative(base, path).split(sep).join("/"));
  }
  return out.sort();
}

/** 1234567890 -> "1.23 bn"; small test numbers are printed as they are. */
function amount(value: number, signed = false): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : signed ? "+" : "";
  const digits = (n: number): string => n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (abs >= 1e9) return `${sign}${digits(abs / 1e9)} bn`;
  if (abs >= 1e6) return `${sign}${digits(abs / 1e6)} m`;
  return `${sign}${abs.toLocaleString("en", { maximumFractionDigits: 2 })}`;
}

function percent(share: number): string {
  return `${(share * 100).toFixed(1)} %`;
}

function printIssues(title: string, issues: ValidationIssue[]): void {
  if (issues.length === 0) return;
  console.log(`  ${title}:`);
  for (const issue of issues) console.log(`    ${formatIssue(issue)}`);
}

function printSummary(pack: CountryPack): void {
  const { currency, baseYear } = pack.country;
  const base = simulate(pack);
  const totals = base.baseline;
  console.log(`  base year ${baseYear}, amounts in ${currency} per year`);
  console.log(`    revenue      ${amount(totals.revenue).padStart(14)}  (${percent(shareOfGdp(pack, totals.revenue))} of GDP)`);
  console.log(`    expenditure  ${amount(totals.expenditure).padStart(14)}  (${percent(shareOfGdp(pack, totals.expenditure))} of GDP)`);
  console.log(`    balance      ${amount(totals.balance).padStart(14)}  (${percent(shareOfGdp(pack, totals.balance))} of GDP)`);
  if (pack.policies.length === 0) {
    console.log("  no policies");
    return;
  }
  console.log("  effect on the balance of each policy on its own, at default parameters (low to high):");
  const width = Math.max(...pack.policies.map((policy) => policy.id.length));
  for (const policy of pack.policies) {
    const result = simulatePolicy(pack, policy.id);
    if (!result) continue;
    const range =
      result.low.balance === result.high.balance
        ? ""
        : `  (${amount(result.low.balance, true)} to ${amount(result.high.balance, true)})`;
    console.log(`    ${policy.id.padEnd(width)}  ${amount(result.delta.balance, true).padStart(14)}${range}`);
    for (const warning of result.warnings) console.log(`      warning: ${warning.message}`);
    // For calibrated schedules: how close the model on the distribution comes to the official amount.
    for (const effect of result.effects) {
      const modelled = effect.model?.baseline;
      const official = base.nodes[effect.target]?.baseline;
      if (modelled === undefined || !official) continue;
      console.log(`      model of ${effect.target}: ${amount(modelled)} against ${amount(official)} official (${percent(modelled / official)})`);
    }
  }
}

function main(): number {
  if (!existsSync(root)) {
    console.log(`${label}/ does not exist: no country packs to validate.`);
    return 0;
  }
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  if (ids.length === 0) {
    console.log(`${label}/ contains no country packs: nothing to validate.`);
    return 0;
  }

  let invalid = 0;
  for (const id of ids) {
    const dir = join(root, id);
    const texts: Record<string, string> = {};
    for (const file of jsonFiles(dir)) texts[file] = readFileSync(join(dir, file), "utf8");
    const result = validatePackFiles(texts, id);
    if (result.ok) {
      console.log(`${label}/${id}: valid`);
      printIssues("warnings", result.warnings);
      printSummary(result.pack);
    } else {
      invalid++;
      console.log(`${label}/${id}: INVALID, ${result.errors.length} error(s)`);
      printIssues("errors", result.errors);
      printIssues("warnings", result.warnings);
    }
    console.log("");
  }

  const valid = ids.length - invalid;
  console.log(`${ids.length} pack(s) checked: ${valid} valid, ${invalid} invalid.`);
  return invalid > 0 ? 1 : 0;
}

process.exitCode = main();
