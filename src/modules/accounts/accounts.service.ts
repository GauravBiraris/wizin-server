import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, desc, inArray, gte, lte, sql, isNull } from 'drizzle-orm';
import { db } from '../../db';
import * as schema from '../../db/schema';
import { parse } from 'csv-parse/sync';
import { create } from 'xmlbuilder2';
import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'csv-stringify/sync';


@Injectable()
export class AccountsService {
  async findAll(tenantId: string) {
    return await db.select().from(schema.accounts)
      .where(eq(schema.accounts.tenantId, tenantId))
      .orderBy(schema.accounts.code);
  }

  async create(tenantId: string, dto: { code: string; name: string; type: any }) {
    const [account] = await db.insert(schema.accounts).values({
      tenantId,
      code: dto.code,
      name: dto.name,
      type: dto.type,
    }).returning();
    return account;
  }

async getJournalEntries(tenantId: string, startDateStr?: string, endDateStr?: string) {
    // 1. Calculate Date Boundaries
    const now = new Date();
    
    // Default to the 1st of the current month if no start date is provided
    const startDate = startDateStr 
      ? new Date(startDateStr) 
      : new Date(now.getFullYear(), now.getMonth(), 1); 
    startDate.setHours(0, 0, 0, 0); // Start of day

    // Default to the last day of the current month if no end date is provided
    const endDate = endDateStr 
      ? new Date(endDateStr) 
      : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endDate.setHours(23, 59, 59, 999); // End of day

    // 2. Fetch the Headers with Date Filters
    const entries = await db.select({
      id: schema.journalEntries.id,
      referenceType: schema.journalEntries.referenceType,
      description: schema.journalEntries.description,
      recordedAt: schema.journalEntries.recordedAt,

      woTargetQty: schema.workOrders.targetQuantity,
      woActualYield: schema.workOrders.actualYield,
      woActualCost: schema.workOrders.actualTotalCost,
    })
    .from(schema.journalEntries)
    .leftJoin(schema.workOrders, and(
      eq(schema.journalEntries.referenceType, 'work_order_completion'),
      eq(schema.journalEntries.referenceId, schema.workOrders.id)
    ))
    .where(
      and(
        eq(schema.journalEntries.tenantId, tenantId),
        gte(schema.journalEntries.recordedAt, startDate),
        lte(schema.journalEntries.recordedAt, endDate)
      )
    )
    .orderBy(desc(schema.journalEntries.recordedAt));

    if (entries.length === 0) return [];

    const entryIds = entries.map(e => e.id);

    // 3. Fetch the Lines with Account details
    const lines = await db.select({
      entryId: schema.journalLines.entryId,
      accountCode: schema.accounts.code,
      accountName: schema.accounts.name,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
    })
    .from(schema.journalLines)
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(inArray(schema.journalLines.entryId, entryIds));

    // 4. Map lines into their respective entries
    return entries.map(entry => ({
      ...entry,
      lines: lines.filter(l => l.entryId === entry.id)
    }));
  }
// Fetch specific company details for the invoice/settings page
  async getTenantDetails(tenantId: string) {
    const [details] = await db.select({
      companyName: schema.tenantSettings.companyName,
      companyAddress: schema.tenantSettings.companyAddress,
      companyPhone: schema.tenantSettings.companyPhone,
      companyGstin: schema.tenantSettings.companyGstin,
    })
    .from(schema.tenantSettings)
    .where(eq(schema.tenantSettings.tenantId, tenantId));
    
    return details || {};
  }

  // Update the company details
  async updateTenantDetails(tenantId: string, payload: { companyName?: string, companyAddress?: string, companyPhone?: string, companyGstin?: string }) {
    const [updated] = await db.update(schema.tenantSettings)
      .set({
        companyName: payload.companyName,
        companyAddress: payload.companyAddress,
        companyPhone: payload.companyPhone,
        companyGstin: payload.companyGstin,
      })
      .where(eq(schema.tenantSettings.tenantId, tenantId))
      .returning();
      
    return updated;
  }
  async getTenantSettings(tenantId: string) {
    const [settings] = await db.select().from(schema.tenantSettings).where(eq(schema.tenantSettings.tenantId, tenantId));
    return settings || {};
  }

  async upsertTenantSettings(tenantId: string, payload: any) {
    // Upsert ensures it creates the row if it doesn't exist, or updates it if it does
    const [settings] = await db.insert(schema.tenantSettings).values({
      tenantId,
      ...payload
    }).onConflictDoUpdate({
      target: schema.tenantSettings.tenantId,
      set: payload
    }).returning();
    
    return settings;
  }
  
  async getAccountBalances(tenantId: string, startDateStr?: string, endDateStr?: string) {
    const now = new Date();
    
    // Default to current month boundaries
    const startDate = startDateStr ? new Date(startDateStr) : new Date(now.getFullYear(), now.getMonth(), 1); 
    startDate.setHours(0, 0, 0, 0);

    const endDate = endDateStr ? new Date(endDateStr) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endDate.setHours(23, 59, 59, 999);

    // Perform the aggregation using Drizzle's sql template literal
    const balances = await db.select({
      accountId: schema.accounts.id,
      code: schema.accounts.code,
      name: schema.accounts.name,
      type: schema.accounts.type, // 'asset', 'liability', 'equity', 'revenue', 'expense'
      totalDebit: sql<string>`SUM(${schema.journalLines.debit})`,
      totalCredit: sql<string>`SUM(${schema.journalLines.credit})`,
    })
    .from(schema.journalLines)
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .innerJoin(schema.journalEntries, eq(schema.journalLines.entryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.journalEntries.tenantId, tenantId),
        gte(schema.journalEntries.recordedAt, startDate),
        lte(schema.journalEntries.recordedAt, endDate)
      )
    )
    .groupBy(schema.accounts.id)
    .orderBy(schema.accounts.code);

    // Post-process the results to calculate the Net Balance based on Accounting Rules
    return balances.map(b => {
      const debit = Number(b.totalDebit || 0);
      const credit = Number(b.totalCredit || 0);
      
      // Assets and Expenses increase with Debits. Everything else increases with Credits.
      const isDebitNormal = ['asset', 'expense'].includes(b.type.toLowerCase());
      const netBalance = isDebitNormal ? (debit - credit) : (credit - debit);

      return {
        ...b,
        totalDebit: debit,
        totalCredit: credit,
        netBalance
      };
    });
  }

  // 1. PROFIT & LOSS STATEMENT (Date Range)
  async getProfitAndLoss(tenantId: string, startDateStr: string, endDateStr: string) {
    // Reuse your existing balance logic, but strictly for the date range
    const allBalances = await this.getAccountBalances(tenantId, startDateStr, endDateStr);

    const revenueAccounts = allBalances.filter(b => b.type === 'revenue');
    const expenseAccounts = allBalances.filter(b => b.type === 'expense');

    const totalRevenue = revenueAccounts.reduce((sum, acc) => sum + acc.netBalance, 0);
    const totalExpense = expenseAccounts.reduce((sum, acc) => sum + acc.netBalance, 0);
    
    // In our logic, expenses have positive netBalances (normal debit). 
    // If your COGS is a specific account, you can isolate it for Gross Profit calculations.
    const netIncome = totalRevenue - totalExpense;

    return {
      revenue: revenueAccounts,
      expenses: expenseAccounts,
      summary: {
        totalRevenue,
        totalExpense,
        netIncome
      }
    };
  }

  // 2. BALANCE SHEET (Snapshot in Time)
  async getBalanceSheet(tenantId: string, asOfDateStr: string) {
    const asOfDate = asOfDateStr ? new Date(asOfDateStr) : new Date();
    asOfDate.setHours(23, 59, 59, 999); // End of target day

    // USE THE OPTIMIZED ENGINE HERE
    const allTimeBalances = await this.getOptimizedAllTimeBalances(tenantId, asOfDate);

    const assets = allTimeBalances.filter(b => b.type === 'asset');
    const liabilities = allTimeBalances.filter(b => b.type === 'liability');
    const equity = allTimeBalances.filter(b => b.type === 'equity');

    const totalAssets = assets.reduce((sum, acc) => sum + acc.netBalance, 0);
    const totalLiabilities = liabilities.reduce((sum, acc) => sum + acc.netBalance, 0);
    let totalEquity = equity.reduce((sum, acc) => sum + acc.netBalance, 0);

    const allTimeRevenue = allTimeBalances.filter(b => b.type === 'revenue').reduce((sum, acc) => sum + acc.netBalance, 0);
    const allTimeExpense = allTimeBalances.filter(b => b.type === 'expense').reduce((sum, acc) => sum + acc.netBalance, 0);
    const historicalNetIncome = allTimeRevenue - allTimeExpense;

    totalEquity += historicalNetIncome;
    equity.push({
      accountId: 'retained-earnings-virtual', code: '3999', name: 'Retained Earnings (Calculated)',
      type: 'equity', totalDebit: 0, totalCredit: historicalNetIncome, netBalance: historicalNetIncome
    });

    return {
      assets, liabilities, equity,
      summary: { totalAssets, totalLiabilities, totalEquity, isBalanced: totalAssets === (totalLiabilities + totalEquity) }
    };
  }

  // 1. THE OPTIMIZED ALL-TIME AGGREGATOR (Snapshot + Delta)
  async getOptimizedAllTimeBalances(tenantId: string, asOfDate: Date) {
    // A. Find the most recent snapshot date BEFORE or ON our target date
    const [latestSnapshotRecord] = await db.select({ date: schema.accountSnapshots.snapshotDate })
      .from(schema.accountSnapshots)
      .where(
        and(
          eq(schema.accountSnapshots.tenantId, tenantId),
          lte(schema.accountSnapshots.snapshotDate, asOfDate.toISOString().split('T')[0])
        )
      )
      .orderBy(desc(schema.accountSnapshots.snapshotDate))
      .limit(1);

    const snapshotDateStr = latestSnapshotRecord?.date;
    const deltaStartDate = snapshotDateStr ? new Date(snapshotDateStr) : new Date(0); // Dawn of time if no snapshot
    
    // B. Fetch the Snapshots (Base numbers)
    const snapshots = snapshotDateStr ? await db.select()
      .from(schema.accountSnapshots)
      .where(
        and(
          eq(schema.accountSnapshots.tenantId, tenantId),
          eq(schema.accountSnapshots.snapshotDate, snapshotDateStr)
        )
      ) : [];

    // C. Fetch the Delta (Transactions between snapshot and asOfDate)
    const deltas = await db.select({
      accountId: schema.accounts.id,
      code: schema.accounts.code,
      name: schema.accounts.name,
      type: schema.accounts.type,
      totalDebit: sql<string>`SUM(${schema.journalLines.debit})`,
      totalCredit: sql<string>`SUM(${schema.journalLines.credit})`,
    })
    .from(schema.journalLines)
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .innerJoin(schema.journalEntries, eq(schema.journalLines.entryId, schema.journalEntries.id))
    .where(
      and(
        eq(schema.journalEntries.tenantId, tenantId),
        // Only fetch transactions AFTER the snapshot, up to the AsOfDate
        snapshotDateStr ? gte(schema.journalEntries.recordedAt, deltaStartDate) : undefined,
        lte(schema.journalEntries.recordedAt, asOfDate)
      )
    )
    .groupBy(schema.accounts.id);

    // D. Merge Snapshot and Delta in memory (Extremely fast)
    const finalBalances = new Map<string, any>();

    // Load Deltas into Map (establishing account details)
    for (const delta of deltas) {
      finalBalances.set(delta.accountId, {
        accountId: delta.accountId, code: delta.code, name: delta.name, type: delta.type,
        totalDebit: Number(delta.totalDebit || 0),
        totalCredit: Number(delta.totalCredit || 0)
      });
    }

    // Add Snapshot base values to the Map
    for (const snap of snapshots) {
      const existing = finalBalances.get(snap.accountId);
      if (existing) {
        existing.totalDebit += Number(snap.totalDebit);
        existing.totalCredit += Number(snap.totalCredit);
      } else {
        // We need account details if it only exists in snapshot but had no delta activity
        const [acc] = await db.select().from(schema.accounts).where(eq(schema.accounts.id, snap.accountId));
        if (acc) {
          finalBalances.set(snap.accountId, {
            accountId: acc.id, code: acc.code, name: acc.name, type: acc.type,
            totalDebit: Number(snap.totalDebit),
            totalCredit: Number(snap.totalCredit)
          });
        }
      }
    }

    // E. Calculate Net Balances using Accounting Rules
    return Array.from(finalBalances.values()).map(b => {
      const isDebitNormal = ['asset', 'expense'].includes(b.type.toLowerCase());
      const netBalance = isDebitNormal ? (b.totalDebit - b.totalCredit) : (b.totalCredit - b.totalDebit);
      return { ...b, netBalance };
    });
  }

  // Call this via a CRON job on the 1st of every month, or a manual "Close Month" button in the UI
  async generateSnapshot(tenantId: string, closingDateStr: string) {
    const closingDate = new Date(closingDateStr);
    closingDate.setHours(23, 59, 59, 999);

    // Calculate balances from dawn of time up to this closing date
    // It's safe to use the optimizer here; it will build upon the previous month's snapshot!
    const balances = await this.getOptimizedAllTimeBalances(tenantId, closingDate);

    const snapshotsToInsert = balances.map(b => ({
      tenantId,
      accountId: b.accountId,
      snapshotDate: closingDate.toISOString().split('T')[0],
      totalDebit: b.totalDebit.toString(),
      totalCredit: b.totalCredit.toString()
    }));

    if (snapshotsToInsert.length > 0) {
      // Upsert logic: If a snapshot for this date already exists, overwrite it.
      await db.insert(schema.accountSnapshots)
        .values(snapshotsToInsert)
        .onConflictDoUpdate({
          target: [schema.accountSnapshots.tenantId, schema.accountSnapshots.accountId, schema.accountSnapshots.snapshotDate],
          set: {
            totalDebit: sql`EXCLUDED.total_debit`,
            totalCredit: sql`EXCLUDED.total_credit`
          }
        });
    }
    
    return { success: true, message: `Snapshot generated for ${closingDateStr}` };
  }

  

  
  async generateTallyXMLInBackground(tenantId: string) {
    try {
      // 1. Generate the XML (This might take 10-30 seconds for massive datasets)
      const { xmlString, warnings } = await this.generateTallyXML(tenantId);
      
      // 2. Save it to the server's disk (Ensure an 'exports' folder exists in your project root)
      const fileName = `tally_export_${Date.now()}.xml`;
      const exportDir = path.join(process.cwd(), 'exports');
      if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir);
      
      const filePath = path.join(exportDir, fileName);
      fs.writeFileSync(filePath, xmlString);

      // 3. Fire the Notification to the Frontend!
      const warningText = warnings.length > 0 ? ` (${warnings.length} unmapped fallbacks used).` : '.';
      
      await db.insert(schema.notifications).values({
        tenantId,
        type: 'export_ready',
        title: 'Tally XML Export Ready',
        // Use a delimiter "|||" so the frontend can easily split the text and the filename
        message: `Your financial data has been successfully packaged for Tally${warningText}|||${fileName}`,
      });

    } catch (error) {
      console.error("Background Export Failed:", error);
      await db.insert(schema.notifications).values({
        tenantId,
        type: 'export_failed',
        title: 'Tally Export Failed',
        message: 'An error occurred while generating the Tally XML file. Please contact support.',
      });
    }
  }

  // 1. EXPORT CSV TEMPLATE
  async getMappingTemplate(tenantId: string) {
    const mappings = await db.select({
      accountId: schema.accounts.id,
      accountCode: schema.accounts.code,
      internalName: schema.accounts.name,
      tallyLedgerName: schema.tallyBridge.tallyLedgerName,
      tallyVoucherType: schema.tallyBridge.tallyVoucherType,
      tallyCostCenter: schema.tallyBridge.tallyCostCenter
    })
    .from(schema.accounts)
    .leftJoin(schema.tallyBridge, eq(schema.accounts.id, schema.tallyBridge.accountId))
    .where(eq(schema.accounts.tenantId, tenantId));

    // Convert to CSV string (you can use a library like 'json2csv' or map manually)
    const header = "AccountId,AccountCode,InternalName,TallyLedgerName,TallyVoucherType,TallyCostCenter\n";
    const rows = mappings.map(m => `"${m.accountId}","${m.accountCode}","${m.internalName}","${m.tallyLedgerName || ''}","${m.tallyVoucherType || ''}","${m.tallyCostCenter || ''}"`);
    return header + rows.join('\n');
  }

  // 2. UPLOAD & UPSERT CSV
async uploadMappings(tenantId: string, csvBuffer: Buffer) {
    const csvString = csvBuffer.toString('utf-8');

    // 1. Define the exact shape of the expected CSV row for TypeScript
    type TallyCsvRow = {
      AccountId: string;
      AccountCode?: string;
      InternalName?: string;
      TallyLedgerName?: string;
      TallyVoucherType?: string;
      TallyCostCenter?: string;
    };

    // 2. Cast the parsed result as an array of our specific type using 'as TallyCsvRow[]'
    const records = parse(csvString, { 
      columns: true, 
      skip_empty_lines: true, 
      bom: true 
    }) as TallyCsvRow[];
    
    const upsertData: any[] = [];

    for (const row of records) {
      // TypeScript now knows that 'AccountId' is a valid string property!
      if (!row.AccountId) continue; 

      upsertData.push({
        tenantId,
        accountId: row.AccountId,
        tallyLedgerName: row.TallyLedgerName?.trim() || null,
        tallyVoucherType: row.TallyVoucherType?.trim() || null,
        tallyCostCenter: row.TallyCostCenter?.trim() || null,
      });
    }

    if (upsertData.length > 0) {
      await db.insert(schema.tallyBridge)
        .values(upsertData)
        .onConflictDoUpdate({
          target: [schema.tallyBridge.tenantId, schema.tallyBridge.accountId],
          set: {
            tallyLedgerName: sql`EXCLUDED.tally_ledger_name`,
            tallyVoucherType: sql`EXCLUDED.tally_voucher_type`,
            tallyCostCenter: sql`EXCLUDED.tally_cost_center`,
          }
        });
    }
    return { success: true, mappedCount: upsertData.length };
  }

  // Hardcoded Default Mappings
  private defaultVoucherMap: Record<string, string> = {
    'sales_dispatch': 'Sales',
    'goods_receipt': 'Purchase',
    'production_yield': 'Journal',
    'manual_adjustment': 'Journal'
  };

  // HELPER: Groups flat SQL rows into structured Vouchers
  private groupLinesIntoVouchers(rawData: any[]) {
    const grouped = new Map<string, any>();
    
    for (const row of rawData) {
      if (!grouped.has(row.entryId)) {
        grouped.set(row.entryId, {
          entryId: row.entryId,
          date: row.date,
          refType: row.refType,
          narration: row.narration,
          tallyVoucher: row.tallyVoucher,
          woYield: row.woYield, // Ensure these match your schema names!
          woCost: row.woCost,
          lines: []
        });
      }
      
      grouped.get(row.entryId).lines.push({
        debit: row.debit,
        credit: row.credit,
        internalAccountName: row.internalAccountName,
        tallyLedger: row.tallyLedger,
        tallyCostCenter: row.tallyCostCenter
      });
    }
    
    return Array.from(grouped.values());
  }

  async extractDataForTally(tenantId: string) {
    const BATCH_SIZE = 5000;
    let offset = 0;
    let hasMore = true;
    const allVouchers : any[] = [];
    const warnings = new Set<string>(); // Keep track of unmapped accounts

    while (hasMore) {
      // The Dynamic Join Query
      const batch = await db.select({
        entryId: schema.journalEntries.id,
        date: schema.journalEntries.recordedAt,
        refType: schema.journalEntries.referenceType,
        narration: schema.journalEntries.description,
        debit: schema.journalLines.debit,
        credit: schema.journalLines.credit,
        internalAccountName: schema.accounts.name,
        tallyLedger: schema.tallyBridge.tallyLedgerName,
        tallyVoucher: schema.tallyBridge.tallyVoucherType,
        tallyCostCenter: schema.tallyBridge.tallyCostCenter,
        woYield: schema.workOrders.actualYield,
        woCost: schema.workOrders.actualTotalCost
      })
      .from(schema.journalLines)
      .innerJoin(schema.journalEntries, eq(schema.journalLines.entryId, schema.journalEntries.id))
      .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
      .leftJoin(schema.tallyBridge, eq(schema.accounts.id, schema.tallyBridge.accountId))
      // Dynamic Work Order Join
      .leftJoin(schema.workOrders, and(
         eq(schema.journalEntries.referenceType, 'production_yield'),
         eq(schema.journalEntries.referenceId, schema.workOrders.id)
      ))
      .where(and(
        eq(schema.journalEntries.tenantId, tenantId),
        isNull(schema.journalEntries.exportedAt) // Only fetch unexported!
      ))
      .limit(BATCH_SIZE)
      .offset(offset);

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      // Process the batch (Grouping lines by Entry ID to form Vouchers)
      // ... (Grouping logic happens here, structuring into a Voucher object) ...

      allVouchers.push(...batch);
      offset += BATCH_SIZE;
    }

    return { rawData: allVouchers, warnings: Array.from(warnings) };
  }

  async checkTallyMappingExists(tenantId: string): Promise<boolean> {
    const [mapping] = await db.select({ count: sql<number>`count(*)` })
      .from(schema.tallyBridge)
      .where(eq(schema.tallyBridge.tenantId, tenantId));
    
    return Number(mapping.count) > 0;
  }

  // // MISSING VOID 1: The Grouping Helper
  // private groupLinesIntoVouchers(rawData: any[]) {
  //   const vouchersMap = new Map<string, any>();

  //   for (const row of rawData) {
  //     if (!vouchersMap.has(row.entryId)) {
  //       vouchersMap.set(row.entryId, {
  //         entryId: row.entryId,
  //         date: new Date(row.date),
  //         refType: row.refType,
  //         narration: row.narration,
  //         tallyVoucher: row.tallyVoucher,
  //         woYield: row.woYield,
  //         woCost: row.woCost,
  //         lines: []
  //       });
  //     }
  //     vouchersMap.get(row.entryId).lines.push(row);
  //   }

  //   return Array.from(vouchersMap.values());
  // }

  async generateTallyXML(tenantId: string) {
    const { rawData, warnings } = await this.extractDataForTally(tenantId);
    
    // Group the flat rawData by entryId to build complete Vouchers
    const groupedVouchers = this.groupLinesIntoVouchers(rawData); 

    const root = create({ version: '1.0', encoding: 'utf-8' })
      .ele('ENVELOPE')
        .ele('HEADER')
          .ele('TALLYREQUEST').txt('Import Data').up()
        .up()
        .ele('BODY')
          .ele('IMPORTDATA')
            .ele('REQUESTDESC')
              .ele('REPORTNAME').txt('Vouchers').up()
            .up()
            .ele('REQUESTDATA');

    const entryIdsToMarkExported: any[] = [];

    for (const voucher of groupedVouchers) {
      entryIdsToMarkExported.push(voucher.entryId);

      // 1. Voucher Type Logic (CSV Override -> Hardcoded Fallback -> 'Journal')
      const vchType = voucher.tallyVoucher || this.defaultVoucherMap[voucher.refType] || 'Journal';

      // 2. Narration Builder
      let finalNarration = voucher.narration;
      if (voucher.refType === 'production_yield' && voucher.woYield) {
        finalNarration += ` | Yield: ${voucher.woYield} | Mat Cost: ${voucher.woCost}`;
      }

      const tallyMessage = root.ele('TALLYMESSAGE', { 'xmlns:UDF': 'TallyUDF' })
        .ele('VOUCHER', { VCHTYPE: vchType, ACTION: 'Create' })
          .ele('DATE').txt(voucher.date.toISOString().split('T')[0].replace(/-/g, '')).up() // Tally format: YYYYMMDD
          .ele('VOUCHERTYPENAME').txt(vchType).up()
          .ele('NARRATION').txt(finalNarration).up();

      // 3. Ledger Line Logic
      for (const line of voucher.lines) {
        // Fallback Logic
        const ledgerName = line.tallyLedger || line.internalAccountName;
        if (!line.tallyLedger) {
          warnings.push(`Fallback used for account: ${line.internalAccountName}`);
        }

        const amount = Number(line.debit) > 0 ? `-${line.debit}` : `${line.credit}`; // Tally uses negative for debits internally sometimes, or ISDEEMEDPOSITIVE

        const allLedger = tallyMessage.ele('ALLLEDGERENTRIES.LIST')
          .ele('LEDGERNAME').txt(ledgerName).up()
          .ele('ISDEEMEDPOSITIVE').txt(Number(line.debit) > 0 ? 'Yes' : 'No').up()
          .ele('AMOUNT').txt(amount).up();

        // 4. Cost Center Injection
        if (line.tallyCostCenter) {
          allLedger.ele('CATEGORYALLOCATIONS.LIST')
            .ele('CATEGORY').txt('Primary Cost Category').up() // Assuming default category
            .ele('COSTCENTREALLOCATIONS.LIST')
              .ele('NAME').txt(line.tallyCostCenter).up()
              .ele('AMOUNT').txt(amount).up()
            .up()
          .up();
        }
      }
    }

    // Mark as exported in the DB
    if (entryIdsToMarkExported.length > 0) {
      const CHUNK_SIZE = 1000; // Safe batch limit for PostgreSQL
      
      for (let i = 0; i < entryIdsToMarkExported.length; i += CHUNK_SIZE) {
        const chunk = entryIdsToMarkExported.slice(i, i + CHUNK_SIZE);
        await db.update(schema.journalEntries)
          .set({ exportedAt: new Date() })
          .where(inArray(schema.journalEntries.id, chunk));
      }
    }

    return { 
      xmlString: root.end({ prettyPrint: true }), 
      warnings 
    };
  }

  // --- GENERAL CSV EXPORT ---
  async exportJournalsToCSV(tenantId: string, startDateStr?: string, endDateStr?: string) {
    const now = new Date();
    
    const startDate = startDateStr ? new Date(startDateStr) : new Date(now.getFullYear(), now.getMonth(), 1); 
    startDate.setHours(0, 0, 0, 0);

    const endDate = endDateStr ? new Date(endDateStr) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endDate.setHours(23, 59, 59, 999);

    // Fetch the flat data
    const rawData = await db.select({
      date: schema.journalEntries.recordedAt,
      journalId: schema.journalEntries.id,
      referenceType: schema.journalEntries.referenceType,
      description: schema.journalEntries.description,
      accountCode: schema.accounts.code,
      accountName: schema.accounts.name,
      debit: schema.journalLines.debit,
      credit: schema.journalLines.credit,
    })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalLines.entryId, schema.journalEntries.id))
    .innerJoin(schema.accounts, eq(schema.journalLines.accountId, schema.accounts.id))
    .where(
      and(
        eq(schema.journalEntries.tenantId, tenantId),
        gte(schema.journalEntries.recordedAt, startDate),
        lte(schema.journalEntries.recordedAt, endDate)
      )
    )
    .orderBy(desc(schema.journalEntries.recordedAt), schema.journalEntries.id);

    // Map it to a clean structure for Excel
    const csvData = rawData.map(row => ({
      'Date': row.date ? row.date.toISOString().split('T')[0] : '',
      'Journal ID': row.journalId,
      'Type': row.referenceType,
      'Account Code': row.accountCode,
      'Account Name': row.accountName,
      'Debit (₹)': Number(row.debit || 0).toFixed(2),
      'Credit (₹)': Number(row.credit || 0).toFixed(2),
      'Narration': row.description
    }));

    // Generate and return the CSV string
    return stringify(csvData, { header: true });
  }

}