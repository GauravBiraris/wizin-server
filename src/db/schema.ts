
import { pgTable, pgEnum, timestamp, date, primaryKey, integer, text, decimal, unique, uuid, varchar, boolean, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm/sql/sql';


// Define the strict Enum
export const productTypeEnum = pgEnum('product_type', [
  'finished_good', 
  'byproduct', 
  'scrap', 
  'rejected'
]);

export const roleEnum = pgEnum('role', ['ADMIN', 'MANAGER', 'OPERATOR', 'SUPERVISOR']);

// 1. Tenants (Companies)
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  currency: varchar('currency', { length: 3 }).default('INR').notNull(), // Tenant-level setting 
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 2. Users & Roles [cite: 5, 6]
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(), // Logical Isolation
  firebaseUid: varchar('firebase_uid', { length: 128 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  role: roleEnum('role').default('OPERATOR').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
});

// 3. Master Data: Raw Materials [cite: 9, 10]
export const rawMaterials = pgTable('raw_materials', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  sku: varchar('sku', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  currentStock: decimal('current_stock', { precision: 10, scale: 3 }).default('0').notNull(),
  reorderLevel: decimal('reorder_level', { precision: 10, scale: 3 }).notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  uom: varchar('uom', { length: 20 }).notNull(), // Unit of Measure (e.g., kg, liters)
});

// 4. Products Catalog [cite: 15]
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  sku: varchar('sku', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  type: productTypeEnum('type').default('finished_good').notNull(),
  uom: varchar('uom', { length: 50 }).notNull(),
  sellingPrice: decimal('selling_price', { precision: 12, scale: 2 }).notNull().default('0.00'),
  currentStock: decimal('current_stock', { precision: 12, scale: 3 }).notNull().default('0.000'),
  inventoryAccountId: uuid('inventory_account_id').references(() => accounts.id),
});

// 5. Batches (Production Bucket) [cite: 38]
export const batches = pgTable('batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  status: varchar('status', { enum: ['planned', 'started', 'in_progress', 'completed'] }).default('planned').notNull(), // [cite: 41]
  plannedYield: integer('planned_yield').notNull(),
  actualYield: integer('actual_yield').default(0),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
});

// 6. The Immutable Ledger (Material Bucket) [cite: 126, 241]
// This tracks every single movement of inventory
export const materialLedger = pgTable('material_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  rawMaterialId: uuid('raw_material_id').references(() => rawMaterials.id).notNull(),
  batchId: uuid('batch_id').references(() => batches.id), // Nullable if manual adjustment
  quantityChange: decimal('quantity_change', { precision: 10, scale: 3 }).notNull(), // Negative for consumption, positive for restock
  referenceType: varchar('reference_type', { enum: ['production_consumption', 'purchase_restock', 'manual_adjustment', 'production_variance'] }).notNull(),
  reason: text('reason'),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
  recordedBy: uuid('recorded_by').references(() => users.id).notNull(),
  }, (table) => {
  return {
    rmLookupIdx: index('mat_ledger_tenant_rm_idx').on(table.tenantId, table.rawMaterialId)
  };
});

//  Product Ledger (For Finished Goods & Byproducts)
export const productLedger = pgTable('product_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  quantityChange: decimal('quantity_change', { precision: 12, scale: 3 }).notNull(),
  referenceType: varchar('reference_type', { length: 50 }).notNull(), // 'production_yield', 'sales_dispatch', 'manual_adjustment'
  reason: text('reason'), 
  recordedBy: varchar('recorded_by', { length: 255 }),
  recordedAt: timestamp('recorded_at').defaultNow(),
  }, (table) => {
  return {
    productLookupIdx: index('prod_ledger_tenant_prod_idx').on(table.tenantId, table.productId)
  };
});

// Notifications Table (For Reorder Triggers)
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // e.g., 'reorder_alert'
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  }, (table) => {
  return {
    // Indexes (tenantId + isRead) so the 60-second polling query is instantaneous
    unreadLookupIdx: index('notifications_unread_idx').on(table.tenantId, table.isRead)
  };
});

// --- MASTER DATA REGISTRIES ---

// Labor Registry
export const labor = pgTable('labor', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  hourlyRate: decimal('hourly_rate', { precision: 12, scale: 2 }).notNull(),
  dailyCapacityHours: decimal('daily_capacity_hours', { precision: 5, scale: 2 }).notNull().default('8.00'), // NEW
});

// Machine Registry
export const machines = pgTable('machines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  hourlyCost: decimal('hourly_cost', { precision: 12, scale: 2 }).notNull(),
  dailyCapacityHours: decimal('daily_capacity_hours', { precision: 5, scale: 2 }).notNull().default('8.00'), // NEW
});

// Utilities Tracking
export const utilities = pgTable('utilities', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(), // e.g., "Electricity", "CO2"
  uom: varchar('uom', { length: 20 }).notNull(),
  ratePerUnit: decimal('rate_per_unit', { precision: 12, scale: 2 }).notNull(),
});

// Vendor Database
export const vendors = pgTable('vendors', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  serviceType: varchar('service_type', { length: 255 }).notNull(),
  rate: decimal('rate', { precision: 12, scale: 2 }).notNull(),
  baseUnit: varchar('base_unit', { length: 50 }).default('batch').notNull(),
});


// --- VISUAL WORKSHOP DESIGNER (ROUTING & BOM) ---

// The core product line recipe
export const productLines = pgTable('product_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  mainProductId: uuid('main_product_id').references(() => products.id),
  rejectedProductId: uuid('rejected_product_id').references(() => products.id), // NEW: Links to the scrap/rejected SKU
  name: varchar('name', { length: 255 }).notNull(),
  baseQuantity: decimal('base_quantity', { precision: 12, scale: 3 }).notNull(),
});

// Sequential steps within a product line
export const productLineSteps = pgTable('product_line_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  productLineId: uuid('product_line_id').references(() => productLines.id).notNull(),
  stepOrder: integer('step_order').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  timeSpanHours: decimal('time_span_hours', { precision: 10, scale: 3 }).notNull(), // Expected duration
});

// POLYMORPHIC INPUTS: Materials, labor, machines, utilities, or vendor data required for the step
// Polymorphic Inputs using "Exclusive Arcs" for strict database integrity
export const stepInputs = pgTable('step_inputs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  stepId: uuid('step_id').references(() => productLineSteps.id).notNull(),
  
  // Instead of a single UUID without a constraint, we use explicit nullable foreign keys.
  // This guarantees that if an input exists, the linked resource cannot be accidentally deleted.
  rawMaterialId: uuid('raw_material_id').references(() => rawMaterials.id),
  laborId: uuid('labor_id').references(() => labor.id),
  machineId: uuid('machine_id').references(() => machines.id),
  utilityId: uuid('utility_id').references(() => utilities.id),
  vendorId: uuid('vendor_id').references(() => vendors.id),
  
  quantity: decimal('quantity', { precision: 10, scale: 3 }).notNull(), 
  customCostOverride: decimal('custom_cost_override', { precision: 12, scale: 2 }), 
});

// Outputs generated at this step (Finished goods, Scrap, or Byproducts)
export const stepOutputs = pgTable('step_outputs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  stepId: uuid('step_id').references(() => productLineSteps.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
});

// Define the lifecycle states of a production batch
export const workOrderStatusEnum = pgEnum('work_order_status', [
  'planned', 
  'in_progress', 
  'completed', 
  'cancelled'
]);

export const workOrders = pgTable('work_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  productLineId: uuid('product_line_id').references(() => productLines.id).notNull(),
  batchNumber: varchar('batch_number', { length: 100 }).notNull(), // e.g., BATCH-2026-001
  targetQuantity: decimal('target_quantity', { precision: 12, scale: 3 }).notNull(),
  status: workOrderStatusEnum('status').default('planned').notNull(),
  actualYield: decimal('actual_yield', { precision: 12, scale: 3 }), 
  actualTotalCost: decimal('actual_total_cost', { precision: 12, scale: 2 }),
  startDate: timestamp('start_date'),
  completedDate: timestamp('completed_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const workOrderRequirements = pgTable('work_order_requirements', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  workOrderId: uuid('work_order_id').references(() => workOrders.id).notNull(),
  resourceType: varchar('resource_type', { length: 50 }).notNull(), // raw_material, labor, etc.
  resourceId: uuid('resource_id').notNull(),
  resourceName: varchar('resource_name', { length: 255 }).notNull(),
  plannedQuantity: decimal('planned_quantity', { precision: 12, scale: 3 }).notNull(),
  uom: varchar('uom', { length: 50 }).notNull(),
  estimatedCost: decimal('estimated_cost', { precision: 12, scale: 2 }).notNull(),
  actualQuantity: decimal('actual_quantity', { precision: 12, scale: 3 }),
  actualCost: decimal('actual_cost', { precision: 12, scale: 2 }),
});

// Tracks the individual physical machine cycles (Sub-batches)
export const workOrderRuns = pgTable('work_order_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  workOrderId: uuid('work_order_id').references(() => workOrders.id).notNull(),
  runSequence: integer('run_sequence').notNull(), // e.g., Run 1 of 3
  status: workOrderStatusEnum('status').default('planned').notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  }, (table) => {
  return {
    // Indexes (workOrderId + status) to instantly block/allow master batch completion
    pendingRunsIdx: index('runs_wo_status_idx').on(table.workOrderId, table.status)
  };
});

// The Operator Logbook for timestamps and floor notes
export const workOrderLogs = pgTable('work_order_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  workOrderId: uuid('work_order_id').references(() => workOrders.id).notNull(),
  author: varchar('author', { length: 255 }).notNull(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const accountTypeEnum = pgEnum('account_type', ['asset', 'liability', 'equity', 'revenue', 'expense']);

// Chart of Accounts (e.g., "1000 - RM Inventory", "2000 - Accrued Payroll")
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  type: accountTypeEnum('type').notNull(),
});

// The Accounting Journal
export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  referenceId: uuid('reference_id').notNull(),
  referenceType: varchar('reference_type', { length: 50 }).notNull(),
  description: text('description'),
  recordedAt: timestamp('recorded_at').defaultNow(),
  exportedAt: timestamp('exported_at'), // Our Tally bridge column
}, (table) => {
  return {
    // 1. Polymorphic Join Index (For Tally Bridge & Reconciliations)
    referenceIdx: index('idx_journal_reference').on(table.tenantId, table.referenceType, table.referenceId),
    
    // 2. Chronological Index (For P&L, Balance Sheet, and Snapshot generation)
    dateIdx: index('idx_journal_date').on(table.tenantId, table.recordedAt),
    
    // 3. Unexported Data Index (Rapidly finds what needs to go to Tally)
    exportIdx: index('idx_journal_unexported').on(table.tenantId).where(sql`${table.exportedAt} IS NULL`)
  };
});

// Double-Entry Lines (Must balance to 0)
export const journalLines = pgTable('journal_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  entryId: uuid('entry_id').references(() => journalEntries.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  debit: decimal('debit', { precision: 15, scale: 2 }).default('0.00'),
  credit: decimal('credit', { precision: 15, scale: 2 }).default('0.00'),
}, (table) => {
  return {
    // 1. Foreign Key Index (For fetching lines belonging to an entry)
    entryIdx: index('idx_journal_line_entry').on(table.tenantId, table.entryId),
    
    // 2. Account Aggregation Index (For Trial Balances and Ledgers)
    accountIdx: index('idx_journal_line_account').on(table.tenantId, table.accountId)
  };
});

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid('tenant_id').references(() => tenants.id).primaryKey(), // 1-to-1 relationship with Tenant
  companyName: varchar('company_name', { length: 255 }),
  companyAddress: text('company_address'),
  companyPhone: varchar('company_phone', { length: 50 }),
  companyGstin: varchar('company_gstin', { length: 50 }),
  
  // Accounts
  finishedGoodsAssetId: uuid('fg_asset_id').references(() => accounts.id),
  rawMaterialAssetId: uuid('rm_asset_id').references(() => accounts.id),
  byproductAssetId: uuid('byproduct_asset_id').references(() => accounts.id),
  wagesPayableId: uuid('wages_payable_id').references(() => accounts.id),
  machineOverheadId: uuid('machine_overhead_id').references(() => accounts.id),
  utilitiesPayableId: uuid('utilities_payable_id').references(() => accounts.id),
  vendorPayableId: uuid('vendor_payable_id').references(() => accounts.id),
  wipAssetId: uuid('wip_asset_id').references(() => accounts.id),
  varianceExpenseId: uuid('variance_expense_id').references(() => accounts.id),
  cogsAccountId: uuid('cogs_account_id').references(() => accounts.id),
  salesRevenueAccountId: uuid('sales_revenue_account_id').references(() => accounts.id),
  accountsReceivableId: uuid('accounts_receivable_id').references(() => accounts.id),
  grniLiabilityId: uuid('grni_liability_id').references(() => accounts.id),

  // Operational Booleans & Preferences
  currency: varchar('currency', { length: 10 }).default('₹'),
  allowDirectInventoryEdit: boolean('allow_direct_inventory_edit').default(false),
  mergeGrnAndInvoice: boolean('merge_grn_and_invoice').default(false),
});

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  address: text('address'),
  creditLimit: decimal('credit_limit', { precision: 12, scale: 2 }).default('0.00'),
  gstin: varchar('gstin', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow(),
});

// Purchase Orders Table
export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  vendorId: uuid('vendor_id').notNull(), // Assuming you link this to your existing vendors table
  status: varchar('status', { length: 50 }).default('pending_approval').notNull(), // pending_approval, approved, received
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).default('0.00'),
  extraCosts: decimal('extra_costs', { precision: 12, scale: 2 }).default('0.00'), // Landed Costs
  requestedBy: varchar('requested_by', { length: 255 }),
  approvedBy: varchar('approved_by', { length: 255 }), // Populated upon approval
  createdAt: timestamp('created_at').defaultNow(),
  receivedAt: timestamp('received_at'),
});

// PO Items (Raw Materials being purchased)
export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  poId: uuid('po_id').references(() => purchaseOrders.id).notNull(),
  rawMaterialId: uuid('raw_material_id').references(() => rawMaterials.id).notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(), // Price negotiated with vendor
});

export const inventoryLots = pgTable('inventory_lots', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  
  // Genealogy Links (A lot comes from either Production or Procurement)
  workOrderId: uuid('work_order_id').references(() => workOrders.id),
  purchaseOrderId: uuid('po_id').references(() => purchaseOrders.id), 
  
  lotNumber: varchar('lot_number', { length: 100 }).notNull(), // e.g., "WO-BATCH-001"
  initialQuantity: decimal('initial_quantity', { precision: 12, scale: 3 }).notNull(),
  currentQuantity: decimal('current_quantity', { precision: 12, scale: 3 }).notNull(),
  unitCost: decimal('unit_cost', { precision: 12, scale: 2 }).notNull(), // Locked COGS value!
  
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: date('expires_at'), // Optional, but great for organic materials/chemicals
  }, (table) => {
  return {
    // Indexes (tenantId + productId) for fast dispatch queries
    productLookupIdx: index('lots_tenant_product_idx').on(table.tenantId, table.productId)
  };
});

// 2. Sales Orders (The Commercial Agreement)
export const salesOrders = pgTable('sales_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  customerId: uuid('customer_id').references(() => customers.id).notNull(),
  orderNumber: varchar('order_number', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(), // pending, partial, fulfilled
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).default('0.00'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const salesOrderItems = pgTable('sales_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  salesOrderId: uuid('sales_order_id').references(() => salesOrders.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  orderedQuantity: decimal('ordered_quantity', { precision: 12, scale: 3 }).notNull(),
  fulfilledQuantity: decimal('fulfilled_quantity', { precision: 12, scale: 3 }).default('0.00'),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(), // Selling price (editable)
});

// 3. Dispatch Notes (The Physical "OUT" Gate)
export const dispatchNotes = pgTable('dispatch_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  salesOrderId: uuid('sales_order_id').references(() => salesOrders.id).notNull(),
  dispatchedAt: timestamp('dispatched_at').defaultNow(),
  dispatchedBy: varchar('dispatched_by', { length: 255 }),
});

// Mapping exactly which lot was used for the dispatch
export const dispatchItems = pgTable('dispatch_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  dispatchNoteId: uuid('dispatch_note_id').references(() => dispatchNotes.id).notNull(),
  salesOrderItemId: uuid('sales_order_item_id').references(() => salesOrderItems.id).notNull(),
  inventoryLotId: uuid('inventory_lot_id').references(() => inventoryLots.id).notNull(), // The Genealogy Link!
  quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
  cogsUnitCost: decimal('cogs_unit_cost', { precision: 12, scale: 2 }).notNull(), // Snapshot of the lot cost at time of dispatch
});

export const accountSnapshots = pgTable('account_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  
  snapshotDate: date('snapshot_date').notNull(), // e.g., '2026-04-30'
  
  totalDebit: decimal('total_debit', { precision: 15, scale: 2 }).default('0.00'),
  totalCredit: decimal('total_credit', { precision: 15, scale: 2 }).default('0.00'),
  
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => {
  return {
    // Prevent duplicate snapshots for the same account on the same day
    unq: unique().on(table.tenantId, table.accountId, table.snapshotDate)
  };
});

export const tallyBridge = pgTable('tally_bridge', {
  // Remove .primaryKey() from here, just make them .notNull()
  tenantId: uuid('tenant_id').references(() => tenants.id).notNull(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  tallyLedgerName: varchar('tally_ledger_name', { length: 255 }),
  tallyVoucherType: varchar('tally_voucher_type', { length: 100 }),
  tallyCostCenter: varchar('tally_cost_center', { length: 255 }),
}, (table) => {
  return {
    // THIS is the correct Drizzle syntax to create a composite primary key!
    pk: primaryKey({ columns: [table.tenantId, table.accountId] }),
  };
});