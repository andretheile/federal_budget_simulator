/**
 * Public API of the calculation engine. Pure TypeScript: no React, no DOM, no fetch, no Node APIs.
 * It knows nothing about any particular country; everything comes from a country pack.
 */
export * from "./types.ts";

export {
  validatePack,
  validatePackFiles,
  formatIssue,
  formatPath,
  SHARE_TOLERANCE,
  type RawPackFiles,
  type ValidationIssue,
  type ValidationResult,
} from "./validate.ts";

export {
  simulate,
  simulateWeighted,
  simulatePolicy,
  resolveParams,
  resolveCurve,
  scheduleView,
  evaluateValue,
  evaluateBrackets,
  findNode,
  shareOfGdp,
  perCapita,
  type EffectResult,
  type LevelFilter,
  type NodeResult,
  type ParamValue,
  type ParamValues,
  type PolicyResult,
  type PolicyState,
  type Scenario,
  type ScheduleView,
  type ShiftResult,
  type Side,
  type SimulationResult,
  type SimulationWarning,
  type Totals,
  type WarningCode,
} from "./simulate.ts";

export { emptyScenario, encodeScenario, decodeScenario, encodeNumber, decodeNumber } from "./scenario.ts";

export { measurePhase, measuresFrom, shareInYear, type MeasurePhase } from "./timing.ts";

export { calendarYears, yearStart, yearEnd, yearOfDate, yearBeginningOn, yearShort } from "./years.ts";

export { goalProgress, measureGoal, goalLevel, findGoal, defaultGoal, type GoalProgress } from "./goals.ts";

export {
  whoPays,
  measureWhoPays,
  type Amounts,
  type MeasureWhoPays,
  type WhoPays,
  type WhoPaysGroup,
  type WhoPaysItem,
  type WhoPaysLine,
  type WhoPaysPayer,
  type WhoPaysScope,
} from "./incidence.ts";

export {
  projectDebt,
  projectScenario,
  resolveDebtAssumptions,
  debtAssumptionParam,
  applyDebtPreset,
  presetApplies,
  isComparablePlan,
  isComparablePlanIn,
  projectionAccounts,
  isFollowablePlan,
  isFollowablePlanIn,
  defaultFollow,
  followablePlans,
  longRunDebtRatio,
  firstYearAbove,
  firstYearBelow,
  type DebtAssumptions,
  type DebtLongRun,
  type DebtMeasure,
  type DebtPath,
  type DebtProjection,
  type DebtYear,
} from "./debt.ts";

export {
  unitsAbove,
  excessAbove,
  totalUnits,
  totalAmount,
  scheduleTotal,
  scheduleAmount,
  marginalRate,
  orderBrackets,
  affectedUnits,
  valueAtShare,
  type AffectedUnits,
  type Bracket,
} from "./distribution.ts";

export {
  bracketsToCurve,
  curveRate,
  curveOwed,
  curveAverageRate,
  curveTotal,
  curveAffected,
  scheduleBands,
  payMoreOrLess,
  type PayMoreOrLess,
  type RateCurve,
  type ScheduleBand,
} from "./curve.ts";
