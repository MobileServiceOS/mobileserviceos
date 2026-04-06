// src/features/pricing/pricingEngine.js
// All pricing logic lives here. Model-agnostic — uses modifiers from modelConfig.

import { getModelConfig } from '../businessModel/modelConfigs.js';

// ─── Travel ───────────────────────────────────────────────────────────────

export function calculateTravelCost(miles, costPerMile = 0.65) {
  return miles * costPerMile;
}

export function getDistanceBand(miles, bands = []) {
  if (!bands.length) return null;
  return bands.find(b => miles <= b.maxMiles) || bands[bands.length - 1];
}

export function calculateTravelFee(miles, travelConfig = {}) {
  const { freeRadiusMiles = 0, chargePerMile = 1.0, bands = [] } = travelConfig;
  if (miles <= freeRadiusMiles) return 0;
  const band     = getDistanceBand(miles, bands);
  const base     = miles * chargePerMile;
  const surcharge = band ? band.surcharge : 0;
  return parseFloat((base + surcharge).toFixed(2));
}

// ─── Condition modifiers ──────────────────────────────────────────────────

export function getConditionAdjustment(conditions = {}, modelType = 'tire_service') {
  const cfg  = getModelConfig(modelType);
  const mods = cfg.pricingModifiers || {};
  let total  = 0;
  if (conditions.emergency) total += mods.emergency || 0;
  if (conditions.lateNight) total += mods.lateNight  || 0;
  if (conditions.highway)   total += mods.highway    || 0;
  if (conditions.weekend)   total += mods.weekend    || 0;
  return total;
}

// ─── Core pricing ─────────────────────────────────────────────────────────

/**
 * Calculate net profit for a job.
 * @param {object} params
 * @returns {number} net profit
 */
export function calculateNetProfit({ revenue = 0, materialCost = 0, otherJobCost = 0, laborCost = 0, travelCost = 0 }) {
  return parseFloat((revenue - materialCost - otherJobCost - laborCost - travelCost).toFixed(2));
}

/**
 * Calculate labor cost from assigned team (per_job members only).
 * Profit-percentage members are handled in the payout engine.
 */
export function calculateLaborCost(assignedTeam = []) {
  return assignedTeam
    .filter(m => m.payType === 'per_job')
    .reduce((sum, m) => sum + (parseFloat(m.value) || 0), 0);
}

/**
 * Minimum recommended price = all costs + target profit.
 */
export function minimumPrice({ service, materialCost = 0, otherJobCost = 0, laborCost = 0, travelCost = 0, dailyOverhead = 0, expectedJobsPerDay = 3 }) {
  const overheadPerJob = dailyOverhead / Math.max(1, expectedJobsPerDay);
  return parseFloat((materialCost + otherJobCost + laborCost + travelCost + overheadPerJob + (service?.targetProfit || 0)).toFixed(2));
}

/**
 * Suggested price = base + condition modifiers, floored at minimum.
 */
export function suggestedPrice({ service, materialCost = 0, otherJobCost = 0, laborCost = 0, travelCost = 0, conditions = {}, modelType = 'tire_service', dailyOverhead = 0, expectedJobsPerDay = 3 }) {
  if (!service) return 0;
  const condAdj = getConditionAdjustment(conditions, modelType);
  const base    = (service.basePrice || 0) + condAdj;
  const minP    = minimumPrice({ service, materialCost, otherJobCost, laborCost, travelCost, dailyOverhead, expectedJobsPerDay });
  return Math.max(base, minP);
}

/**
 * Margin status based on entered price vs min/suggested.
 */
export function marginStatus(enteredPrice, minP, suggested) {
  if (enteredPrice < minP)       return { label: 'Underpriced', color: '#dc2626', emoji: '🔴' };
  if (enteredPrice < suggested)  return { label: 'Low Margin',  color: '#d97706', emoji: '🟡' };
  return                                { label: 'Good Margin', color: '#16a34a', emoji: '🟢' };
}

/**
 * Full pricing summary — call this anytime pricing inputs change.
 */
export function computePricingSummary({ service, revenue, materialCost = 0, otherJobCost = 0, assignedTeam = [], miles = 0, conditions = {}, modelType = 'tire_service', travelConfig = {}, monthlyOverhead = 0, expectedJobsPerDay = 3 }) {
  const laborCost   = calculateLaborCost(assignedTeam);
  const travelCost  = calculateTravelCost(miles, travelConfig.costPerMile);
  const travelFee   = calculateTravelFee(miles, travelConfig);
  const dailyOverhead = monthlyOverhead / 30;
  const netProfit   = calculateNetProfit({ revenue, materialCost, otherJobCost, laborCost, travelCost });
  const minP        = minimumPrice({ service, materialCost, otherJobCost, laborCost, travelCost, dailyOverhead, expectedJobsPerDay });
  const suggested   = suggestedPrice({ service, materialCost, otherJobCost, laborCost, travelCost, conditions, modelType, dailyOverhead, expectedJobsPerDay });
  const margin      = marginStatus(revenue, minP, suggested);
  const condAdj     = getConditionAdjustment(conditions, modelType);

  return { laborCost, travelCost, travelFee, netProfit, minP, suggested, margin, condAdj };
}
