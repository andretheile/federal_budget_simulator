/**
 * npm run validate [-- <directory>]
 *
 * Validates every country pack under countries/ (or under the given directory). Prints the
 * errors of each invalid pack and exits with status 1 if there are any. For each valid pack it
 * prints the derived totals and what every policy does on its own at default parameters, so a
 * reviewer can judge whether the numbers are plausible, and for a pack with debt.json the debt
 * and interest without measures at default assumptions on the pack's starting path, with the other
 * starting path beside it (the base year's budget continued, or following a plan), and the
 * official plans the file lists set against the base year's budget continued. It also lists the collections of measures with their joint effect,
 * and the goals of goals.json.
 *
 * Runs on plain Node (>= 22.18), which strips the TypeScript types itself.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import process from "node:process";
import {
  defaultFollow,
  followablePlans,
  formatIssue,
  goalProgress,
  calendarYears,
  isComparablePlanIn,
  projectionAccounts,
  yearEnd,
  yearStart,
  measurePhase,
  measureWhoPays,
  measuresFrom,
  whoPays,
  projectScenario,
  resolveDebtAssumptions,
  shareOfGdp,
  simulate,
  simulatePolicy,
  validatePackFiles,
  type CountryPack,
  type DebtLongRun,
  type DebtPath,
  type TimingPhase,
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

function percent(share: number, digits = 1): string {
  return `${(share * 100).toFixed(digits)} %`;
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

/**
 * When measures act in the debt projection: the first year measures can act, and for each measure
 * with timing its start, build-up and end, and at default settings the year of its full effect and
 * the last year it acts.
 */
function printTiming(pack: CountryPack): void {
  const timed = pack.policies.filter((policy) => policy.timing);
  if (!pack.debt?.measuresFrom && timed.length === 0) return;
  console.log(`  timing in the debt projection: measures act from ${measuresFrom(pack)}, in full unless listed here`);
  if (timed.length === 0) return;
  const width = Math.max(...timed.map((policy) => policy.id.length));
  const describe = (phase: TimingPhase, unit?: string): string => {
    const parts = [phase.from ? `from ${phase.from}` : `from ${measuresFrom(pack)}`];
    if (phase.years) parts.push(`over ${phase.years} years`);
    if (phase.yearsPerUnit) parts.push(`${phase.yearsPerUnit} years per unit of ${unit}`);
    if (phase.once) parts.push("once (a one-off, in full in the year it falls in)");
    else if (!phase.years && !phase.yearsPerUnit) parts.push("at once");
    if (phase.lasts !== undefined) parts.push(`for ${phase.lasts} year${phase.lasts === 1 ? "" : "s"}`);
    return parts.join(", ");
  };
  for (const policy of timed) {
    const timing = policy.timing!;
    const phase = measurePhase(pack, policy.id)!;
    const rule = timing.param
      ? `at or above the baseline of ${timing.param}: ${describe(timing, timing.param)}; below: ${describe(timing.below ?? timing, timing.param)}`
      : describe(timing);
    const atDefaults = phase.once
      ? `once, in ${phase.start} only`
      : phase.to !== undefined
        ? `full from ${phase.from} to ${phase.to}, last year ${phase.last}`
        : phase.years === 0
          ? `full from ${phase.from}`
          : `${phase.from} to full in ${phase.full} (${phase.years} years)`;
    console.log(`    ${policy.id.padEnd(width)}  ${rule}`);
    console.log(`    ${"".padEnd(width)}  at default settings: ${atDefaults}`);
  }
}

/** Each collection: how many measures it lists and what they do together at default parameters. */
function printCollections(pack: CountryPack): void {
  const collections = pack.collections ?? [];
  if (collections.length === 0) return;
  console.log("  collections, with the effect of all their measures switched on together at default parameters:");
  const width = Math.max(...collections.map((collection) => collection.id.length));
  for (const collection of collections) {
    const policies = Object.fromEntries(collection.policies.map((id) => [id, { enabled: true }]));
    const result = simulate(pack, { policies });
    const range =
      result.deltaLow.balance === result.deltaHigh.balance
        ? ""
        : `  (${amount(result.deltaLow.balance, true)} to ${amount(result.deltaHigh.balance, true)})`;
    const count = `${collection.policies.length} measure${collection.policies.length === 1 ? "" : "s"}`;
    console.log(`    ${collection.id.padEnd(width)}  ${count.padStart(12)}  ${amount(result.delta.balance, true).padStart(14)}${range}`);
  }
}

function longRun(outcome: DebtLongRun): string {
  if (outcome.kind === "drifts") return "never settles, the primary balance keeps changing";
  if (outcome.kind === "diverges") return "grows faster than the economy without limit";
  return outcome.debtRatio === 0 ? "the debt is paid off" : `settles at ${percent(outcome.debtRatio)} of GDP`;
}

/** The starting path in words: following a plan to a year, or the base year's budget continued. */
function pathName(followed: { plan: string; until: number } | undefined, baseYear: number): string {
  return followed ? `follows plan ${followed.plan} to ${followed.until}` : `continues the budget of ${baseYear}`;
}

/**
 * Debt and interest without measures at default assumptions, on the pack's starting path: the base
 * year, the years of the plan it follows, and 10, 20 and 30 years after the base year. Beside it the
 * other starting path: the base year's budget continued where the pack follows a plan, or the
 * first plan that can be followed where it does not.
 */
function printDebtSummary(pack: CountryPack): void {
  const debt = pack.debt;
  if (!debt) return;
  const defaults = resolveDebtAssumptions(debt);
  const horizon = Math.max(defaults.horizon, 30);
  const projection = projectScenario(pack, { policies: {} }, { ...defaults, horizon });
  if (!projection) return;
  const followed = defaultFollow(debt);
  const otherFollow = followed !== undefined ? null : followablePlans(debt)[0]?.id;
  const other = otherFollow === undefined ? undefined : projectScenario(pack, { policies: {} }, { ...defaults, horizon, follow: otherFollow });
  const { market_rate, growth, drift } = projection.assumptions;
  const change = drift === 0 ? "no drift of the primary balance" : `primary balance ${drift > 0 ? "+" : ""}${drift} points of GDP a year`;
  console.log(
    `  debt projection without measures at default assumptions (market rate ${market_rate} %, growth ${growth} %, ` +
      `${change}, ${percent(projection.refinancingShare)} of the debt refinanced a year):`,
  );
  // Where the pack is not a calendar-year pack in national accounts, say what its years and accounts are.
  if (!calendarYears(pack) || debt.accounts !== undefined) {
    const years = calendarYears(pack)
      ? "calendar years"
      : `the pack's own years, ${projection.baseYear} from ${yearStart(pack, projection.baseYear)} to ${yearEnd(pack, projection.baseYear)}`;
    console.log(`    years: ${years}; accounts of the budget and the projection: ${projectionAccounts(debt).replace("_", " ")}`);
  }
  console.log(`    starting path: ${pathName(projection.followed, projection.baseYear)}`);
  if (other) console.log(`    beside it: ${pathName(other.followed, other.baseYear)}`);
  console.log(`    year            debt   of GDP        interest  of GDP  of revenue${other ? "   beside it: debt of GDP  of revenue" : ""}`);
  const { baseline } = projection;
  const planYears = new Set(
    debt.plans?.find((plan) => plan.id === (projection.followed?.plan ?? other?.followed?.plan))?.points.map((point) => point.year) ?? [],
  );
  for (const year of [baseline.start, ...baseline.years]) {
    const after = year.year - projection.baseYear;
    if (!planYears.has(year.year) && after !== 0 && after !== 10 && after !== 20 && after !== 30) continue;
    const beside = other ? [other.baseline.start, ...other.baseline.years].find((candidate) => candidate.year === year.year) : undefined;
    console.log(
      `    ${year.year}  ${amount(year.debt).padStart(14)}  ${percent(year.debtRatio).padStart(7)}  ` +
        `${amount(year.interest).padStart(14)}  ${percent(year.interestRatio, 2).padStart(6)}  ${percent(year.interestToRevenue).padStart(10)}` +
        (beside ? `  ${percent(beside.debtRatio).padStart(22)}  ${percent(beside.interestToRevenue).padStart(10)}` : ""),
    );
  }
  console.log(`    in the long run the debt ratio ${longRun(baseline.longRun)}${other ? `; beside it ${longRun(other.baseline.longRun)}` : ""}`);
  // The plans against the base year's budget continued: what the plan adds to it.
  const continued = projection.followed ? other?.baseline : baseline;
  if (continued) printPlans(pack, continued, projection.baseYear);
}

/**
 * The official projections in debt.json. One that covers the pack's whole budget in its accounts is
 * set against the base year's budget continued, without measures; any other is listed with its scope.
 */
function printPlans(pack: CountryPack, baseline: DebtPath, baseYear: number): void {
  const plans = pack.debt?.plans ?? [];
  if (plans.length === 0) return;
  const optional = (value: number | undefined, format: (n: number) => string): string => (value === undefined ? "" : format(value));
  for (const plan of plans) {
    const scope = `${plan.scope === "all" ? "whole budget" : plan.scope}, ${plan.accounts.replace("_", " ")}`;
    if (isComparablePlanIn(pack.debt!, plan)) {
      console.log(`  official plan ${plan.id} (${scope}) against the budget of ${baseYear} continued at default assumptions without measures:`);
      console.log("    year   debt: plan    model   balance: plan    model   interest/GDP: plan    model");
      for (const point of plan.points) {
        const model = [baseline.start, ...baseline.years].find((year) => year.year === point.year);
        const pct = (n: number): string => percent(n, 2);
        console.log(
          `    ${point.year}  ${optional(point.debtRatio, pct).padStart(11)}  ${optional(model?.debtRatio, pct).padStart(7)}  ` +
            `${optional(point.balanceRatio, pct).padStart(14)}  ${optional(model?.balanceRatio, pct).padStart(7)}  ` +
            `${optional(point.interestRatio, pct).padStart(18)}  ${optional(model?.interestRatio, pct).padStart(7)}`,
        );
      }
    } else {
      console.log(`  official plan ${plan.id} (${scope}), not comparable with the projection:`);
      for (const point of plan.points) {
        const parts = [
          point.debtRatio === undefined ? "" : `debt ${percent(point.debtRatio, 2)} of GDP`,
          point.balanceRatio === undefined ? "" : `balance ${percent(point.balanceRatio, 2)} of GDP`,
          point.interest === undefined ? "" : `interest ${amount(point.interest)}`,
          point.interestRatio === undefined ? "" : `interest ${percent(point.interestRatio, 2)} of GDP`,
          point.interestToRevenue === undefined ? "" : `interest ${percent(point.interestToRevenue, 1)} of revenue`,
        ].filter(Boolean);
        console.log(`    ${point.year}  ${parts.join(", ")}`);
      }
    }
  }
}

/**
 * goals.json: each goal with its level, year and amount; the default is marked. For a goal that
 * leaves something out, what counts and what does not with its excluded measures switched on, and
 * with every measure switched on, at default parameters.
 */
function printGoals(pack: CountryPack): void {
  const goals = pack.goals;
  if (!goals) return;
  console.log("  goals, the improvement of a level's balance each asks for (* is the default):");
  const width = Math.max(...goals.goals.map((goal) => goal.id.length));
  /** Within a cent of zero is zero: counted and excluded parts are differences of large sums. */
  const money = (value: number): string => amount(Math.abs(value) < 0.01 ? 0 : value, true);
  const on = (ids: readonly string[]) => ({ policies: Object.fromEntries(ids.map((id) => [id, { enabled: true }])) });
  for (const goal of goals.goals) {
    const mark = goal.id === goals.default ? "*" : " ";
    const entries = goal.excluded ?? [];
    const names = entries.map((entry) => entry.node ?? `measure ${entry.policy}`);
    const without = names.length === 0 ? "" : `  not counting ${names.join(", ")}`;
    console.log(`    ${mark} ${goal.id.padEnd(width)}  ${(goal.level ?? "whole state").padEnd(15)}  ${goal.year}  ${amount(goal.amount).padStart(12)}${without}`);
    if (entries.length === 0) continue;
    const excludedPolicies = entries.flatMap((entry) => (entry.policy === undefined ? [] : [entry.policy]));
    const scenarios: [string, readonly string[]][] = [
      ...(excludedPolicies.length > 0 ? [["with the excluded measures on", excludedPolicies] as [string, readonly string[]]] : []),
      ["with every measure on", pack.policies.map((policy) => policy.id)],
    ];
    for (const [label, ids] of scenarios) {
      const progress = goalProgress(pack, on(ids), goal);
      const parts = progress.excluded.map((entry) => `${entry.node ?? entry.policy} ${money(entry.improvement)}`).join(", ");
      console.log(`        ${label}: counted ${money(progress.improvement)}, not counted ${money(progress.excludedImprovement)} (${parts})`);
    }
  }
}

/**
 * Who pays (incidence.json): each scope's shares by income group today, the statement of all
 * revenue by line, and for each measure that changes revenue on its own at default parameters what
 * it changes for the groups and the payers.
 */
function printWhoPays(pack: CountryPack): void {
  const file = pack.incidence;
  if (!file) return;
  const today = whoPays(pack, simulate(pack))!;
  const groups = file.groups.map((group) => group.id);
  console.log(`  who pays, by ${groups.join(" / ")} (incidence.json):`);
  console.log(`    income shares  ${file.income.shares.map((share) => percent(share)).join(" / ")}`);
  for (const scope of today.scopes) {
    const outside = scope.payers.map((payer) => `${payer.id} ${amount(payer.today)}`).join(", ");
    console.log(`    ${scope.id}: ${amount(scope.total.today)}, of it ${amount(scope.groupsTotal.today)} on the groups: ${scope.groups.map((group) => percent(group.shareToday)).join(" / ")}`);
    console.log(`      outside the groups: ${outside}`);
  }
  const lines = today.statement.lines.map((line) => `${line.payer ?? "groups"} ${amount(line.today)}`).join(", ");
  console.log(`    all revenue ${amount(today.statement.today)}: ${lines}`);
  console.log("    each measure on its own, change for the groups; and for the payers:");
  const width = Math.max(...pack.policies.map((policy) => policy.id.length));
  for (const policy of pack.policies) {
    const result = simulatePolicy(pack, policy.id);
    if (!result) continue;
    const measure = measureWhoPays(pack, result)!;
    if (measure.groups.every((change) => change === 0) && Object.keys(measure.payers).length === 0) continue;
    const payers = Object.entries(measure.payers).map(([id, change]) => `${id} ${amount(change, true)}`).join(", ");
    console.log(`      ${policy.id.padEnd(width)}  ${measure.groups.map((change) => amount(change, true)).join(" / ")}${payers ? `; ${payers}` : ""}`);
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
      // A preview is checked like any pack; the line says that a production build leaves it out.
      console.log(
        `${label}/${id}: valid${result.pack.country.preview ? " (preview: left out of a production build unless PREVIEW_PACKS=include)" : ""}`,
      );
      printIssues("warnings", result.warnings);
      printSummary(result.pack);
      printCollections(result.pack);
      printTiming(result.pack);
      printGoals(result.pack);
      printDebtSummary(result.pack);
      printWhoPays(result.pack);
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
