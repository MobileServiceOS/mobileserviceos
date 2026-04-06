// src/features/businessModel/modelConfigs.js
// SINGLE SOURCE OF TRUTH for all industry-specific behavior.
// Never put tire-specific logic outside this file.

export const MODEL_CONFIGS = {

  // ─────────────────────────────────────────────
  // TIRE SERVICE — MVP ACTIVE MODEL
  // ─────────────────────────────────────────────
  tire_service: {
    label:       'Mobile Tire Service',
    icon:        '🛞',
    active:      true,
    description: 'Tire repair, replacement, and roadside tire service',

    jobFields: {
      tireSize:  { label: 'Tire Size',  type: 'text',   placeholder: 'e.g. 225/55R17', required: false },
      quantity:  { label: 'Quantity',   type: 'number', placeholder: '1',              required: false },
      rimSize:   { label: 'Rim Size',   type: 'text',   placeholder: 'e.g. 17"',       required: false },
    },

    conditions: {
      emergency: { label: 'Emergency',  default: false },
      lateNight: { label: 'Late Night', default: false },
      highway:   { label: 'Highway',    default: false },
      weekend:   { label: 'Weekend',    default: false },
    },

    pricingModifiers: {
      emergency: 20,
      lateNight: 25,
      highway:   25,
      weekend:   10,
    },

    defaultServices: [
      { name: 'Tire Repair',       basePrice: 95,  minPrice: 85,  maxPrice: 140, targetProfit: 75 },
      { name: 'Tire Replacement',  basePrice: 160, minPrice: 140, maxPrice: 280, targetProfit: 100 },
      { name: 'Flat Tire Service', basePrice: 95,  minPrice: 85,  maxPrice: 130, targetProfit: 75 },
      { name: 'Spare Install',     basePrice: 85,  minPrice: 75,  maxPrice: 120, targetProfit: 65 },
      { name: 'Lock Removal',      basePrice: 90,  minPrice: 80,  maxPrice: 130, targetProfit: 70 },
      { name: 'Valve Stem',        basePrice: 45,  minPrice: 35,  maxPrice: 70,  targetProfit: 35 },
      { name: 'Installation',      basePrice: 120, minPrice: 100, maxPrice: 200, targetProfit: 90 },
      { name: 'Emergency Repair',  basePrice: 120, minPrice: 100, maxPrice: 180, targetProfit: 90 },
      { name: 'Roadside Assist',   basePrice: 95,  minPrice: 80,  maxPrice: 150, targetProfit: 75 },
    ],

    defaultMaterials: [
      'Tire Plug', 'Valve Stem', 'Patch Kit', 'Air (Nitrogen)',
      'Bead Sealer', 'Tire Lube', 'Mounting Paste',
    ],

    defaultExpenseCategories: [
      'Fuel', 'Plugs & Patches', 'Valve Stems', 'Tires (Stock)',
      'Tools & Equipment', 'Vehicle Maintenance', 'Van Repair',
      'Oil Change', 'Parts & Hardware', 'Tire Disposal Fee',
      'Phone Bill', 'Marketing', 'Storage', 'Insurance',
      'Supplies', 'Safety Equipment', 'Food & Drinks',
      'Parking', 'Tolls', 'Subscriptions', 'Other',
    ],

    invoiceLabels: {
      serviceField: 'Service',
      detailField:  'Tire Size',
      itemLabel:    'Tire Service',
    },
  },

  // ─────────────────────────────────────────────
  // SCAFFOLDED FUTURE MODELS (not yet active)
  // ─────────────────────────────────────────────
  oil_change: {
    label: 'Mobile Oil Change', icon: '🛢️', active: false,
    jobFields: {
      vehicleYear:  { label: 'Year',       type: 'text', placeholder: '2022' },
      vehicleMake:  { label: 'Make',       type: 'text', placeholder: 'Toyota' },
      vehicleModel: { label: 'Model',      type: 'text', placeholder: 'Camry' },
      oilType:      { label: 'Oil Type',   type: 'select', options: ['Conventional','Synthetic Blend','Full Synthetic'] },
      filterType:   { label: 'Filter',     type: 'text', placeholder: 'Standard' },
    },
    conditions: { emergency: { label: 'Emergency' }, weekend: { label: 'Weekend' } },
    pricingModifiers: { emergency: 20, weekend: 10 },
    defaultServices: [
      { name: 'Conventional Oil Change',   basePrice: 60,  minPrice: 50,  maxPrice: 90,  targetProfit: 40 },
      { name: 'Synthetic Blend',           basePrice: 80,  minPrice: 70,  maxPrice: 120, targetProfit: 55 },
      { name: 'Full Synthetic Oil Change', basePrice: 100, minPrice: 85,  maxPrice: 150, targetProfit: 65 },
    ],
    defaultMaterials: ['5W-30 Oil', '5W-20 Oil', '0W-20 Synthetic', 'Oil Filter', 'Drain Plug Gasket'],
    defaultExpenseCategories: ['Fuel', 'Oil (Stock)', 'Filters', 'Tools', 'Supplies', 'Other'],
    invoiceLabels: { serviceField: 'Service', detailField: 'Vehicle', itemLabel: 'Oil Change Service' },
  },

  detailing: {
    label: 'Mobile Auto Detailing', icon: '✨', active: false,
    jobFields: {
      vehicleType: { label: 'Vehicle Type', type: 'select', options: ['Sedan','SUV','Truck','Van','Luxury'] },
      packageName: { label: 'Package',      type: 'text', placeholder: 'Full Detail' },
    },
    conditions: { emergency: { label: 'Rush' }, weekend: { label: 'Weekend' } },
    pricingModifiers: { emergency: 30, weekend: 15 },
    defaultServices: [
      { name: 'Basic Wash & Dry',  basePrice: 80,  minPrice: 60,  maxPrice: 120, targetProfit: 55 },
      { name: 'Interior Detail',   basePrice: 150, minPrice: 120, maxPrice: 220, targetProfit: 90 },
      { name: 'Full Detail',       basePrice: 250, minPrice: 200, maxPrice: 400, targetProfit: 150 },
    ],
    defaultMaterials: ['Microfiber Cloths', 'Interior Cleaner', 'Ceramic Spray', 'Tire Shine'],
    defaultExpenseCategories: ['Fuel', 'Chemicals', 'Microfibers', 'Equipment', 'Water Supply', 'Other'],
    invoiceLabels: { serviceField: 'Package', detailField: 'Vehicle', itemLabel: 'Detailing Service' },
  },

  mechanic: {
    label: 'Mobile Mechanic', icon: '🔧', active: false,
    jobFields: {
      vehicleYear:  { label: 'Year',  type: 'text' },
      vehicleMake:  { label: 'Make',  type: 'text' },
      vehicleModel: { label: 'Model', type: 'text' },
      repairType:   { label: 'Repair Type', type: 'text' },
    },
    conditions: { emergency: { label: 'Emergency' }, highway: { label: 'Highway' }, weekend: { label: 'Weekend' } },
    pricingModifiers: { emergency: 30, highway: 25, weekend: 15 },
    defaultServices: [
      { name: 'Battery Jump / Replace', basePrice: 80,  minPrice: 65,  maxPrice: 150, targetProfit: 55 },
      { name: 'Brake Service',          basePrice: 200, minPrice: 160, maxPrice: 350, targetProfit: 120 },
      { name: 'Diagnostic',             basePrice: 80,  minPrice: 65,  maxPrice: 120, targetProfit: 60 },
    ],
    defaultMaterials: ['Battery', 'Brake Pads', 'Brake Fluid', 'Belts', 'Fuses'],
    defaultExpenseCategories: ['Fuel', 'Parts', 'Tools', 'Fluids', 'Other'],
    invoiceLabels: { serviceField: 'Repair', detailField: 'Vehicle', itemLabel: 'Mechanic Service' },
  },

  windshield: {
    label: 'Windshield Repair', icon: '🪟', active: false,
    jobFields: {
      damageType:  { label: 'Damage Type', type: 'select', options: ['Chip','Crack','Full Replace'] },
      vehicleMake: { label: 'Make',        type: 'text' },
    },
    conditions: { emergency: { label: 'Emergency' }, highway: { label: 'Highway' } },
    pricingModifiers: { emergency: 30, highway: 20 },
    defaultServices: [
      { name: 'Chip Repair',         basePrice: 60,  minPrice: 50,  maxPrice: 90,  targetProfit: 45 },
      { name: 'Crack Repair',        basePrice: 80,  minPrice: 65,  maxPrice: 120, targetProfit: 55 },
      { name: 'Windshield Replace',  basePrice: 250, minPrice: 200, maxPrice: 450, targetProfit: 120 },
    ],
    defaultMaterials: ['Resin Kit', 'UV Light', 'Bridge Tool', 'Adhesive'],
    defaultExpenseCategories: ['Fuel', 'Resins & Kits', 'Windshields (Stock)', 'Tools', 'Other'],
    invoiceLabels: { serviceField: 'Service', detailField: 'Vehicle', itemLabel: 'Windshield Service' },
  },

  custom: {
    label: 'Custom Business', icon: '⚙️', active: false,
    jobFields: {},
    conditions: { emergency: { label: 'Emergency' }, weekend: { label: 'Weekend' } },
    pricingModifiers: { emergency: 20, weekend: 10 },
    defaultServices: [
      { name: 'Service 1', basePrice: 100, minPrice: 80, maxPrice: 200, targetProfit: 70 },
    ],
    defaultMaterials: [],
    defaultExpenseCategories: ['Fuel', 'Supplies', 'Tools', 'Other'],
    invoiceLabels: { serviceField: 'Service', detailField: 'Details', itemLabel: 'Service' },
  },
};

// Returns the active model config for a business
export function getModelConfig(modelType) {
  return MODEL_CONFIGS[modelType] || MODEL_CONFIGS.tire_service;
}

// Returns only models available for selection
export function getActiveModels() {
  return Object.entries(MODEL_CONFIGS)
    .filter(([, cfg]) => cfg.active)
    .map(([key, cfg]) => ({ key, ...cfg }));
}
