import { Controller, BadRequestException, Get, Post, Put, Body, Param, Res, Request, UseGuards, Query, UseInterceptors, UploadedFile, } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer'; 
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('api/accounts')
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER') // Operators and Supervisors are blocked from the entire finance module!
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  async findAll(@Request() req: any) {
    return this.accountsService.findAll(req.user.tenantId);
  }

  @Post()
  async create(@Body() dto: { code: string; name: string; type: string }, @Request() req: any) {
    return this.accountsService.create(req.user.tenantId, dto);
  }

@Get('journals')
  async getJournalEntries(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    return this.accountsService.getJournalEntries(req.user.tenantId, startDate, endDate);
  }

  @Get('settings')
  async getSettings(@Request() req: any) {
    return this.accountsService.getTenantSettings(req.user.tenantId);
  }

  @Put('settings')
  async updateSettings(@Body() payload: any, @Request() req: any) {
    return this.accountsService.upsertTenantSettings(req.user.tenantId, payload);
  }

  @Get('balances')
  async getAccountBalances(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    return this.accountsService.getAccountBalances(req.user.tenantId, startDate, endDate);
  }

  @Get('reports/pnl')
  async getPnL(@Request() req: any, @Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.accountsService.getProfitAndLoss(req.user.tenantId, startDate, endDate);
  }

  @Get('reports/balance-sheet')
  async getBalanceSheet(@Request() req: any, @Query('asOfDate') asOfDate: string) {
    return this.accountsService.getBalanceSheet(req.user.tenantId, asOfDate);
  }

  @Post('reports/snapshot')
  async generateSnapshot(@Request() req: any, @Body('closingDate') closingDate: string) {
    return this.accountsService.generateSnapshot(req.user.tenantId, closingDate);
  }

 // 1. Download CSV Template
  @Get('tally-mapping/template')
  async downloadMappingTemplate(@Request() req: any, @Res() res: Response) {
    const csvString = await this.accountsService.getMappingTemplate(req.user.tenantId);
    res.header('Content-Type', 'text/csv');
    res.attachment('tally_account_mapping.csv');
    return res.send(csvString);
  }

  // 2. Upload Mapped CSV
  @Post('tally-mapping/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadMappings(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.accountsService.uploadMappings(req.user.tenantId, file.buffer);
  }

  // 3. Trigger Background XML Export
  @Post('exports/tally')
  async triggerTallyExport(@Request() req: any) {
    // THE PRE-FLIGHT HALT
    const hasMapping = await this.accountsService.checkTallyMappingExists(req.user.tenantId);
    if (!hasMapping) {
      throw new BadRequestException("Export Halted: You must upload the CSV Chart of Accounts Bridge before generating a Tally export.");
    }

    // Note: We don't await this! We let it run in the background.
    this.accountsService.generateTallyXMLInBackground(req.user.tenantId);
    return { message: "Export started. You will receive a notification when ready." };
  }

  @Get('exports/download/:fileName')
  downloadExport(@Param('fileName') fileName: string, @Res() res: Response) {
    // 1. SECURITY CRITICAL: Prevent directory traversal attacks (e.g., ../../etc/passwd)
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return res.status(400).send('Invalid file name request');
    }

    // 2. Locate the file
    const filePath = path.join(process.cwd(), 'exports', fileName);

    // 3. Check if it exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found or has expired.');
    }

    // 4. Send the file to the user's browser as an attachment
    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error("Error downloading file:", err);
        if (!res.headersSent) res.status(500).send("File download failed.");
      } else {
        // AUTO-DELETE: The transfer is complete! Delete the file from the disk.
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.error(`Failed to delete temporary file ${fileName}:`, unlinkErr);
          else console.log(`Successfully auto-deleted ${fileName}`);
        });
      }
    });
  }

  @Get('tenant-details')
  @Roles('ADMIN', 'MANAGER', 'SUPERVISOR', 'OPERATOR') // Even basic operators can view tenant details, but only higher roles can edit
  async getTenantDetails(@Request() req: any) {
    return this.accountsService.getTenantDetails(req.user.tenantId);
  }

  @Put('tenant-details')
  @Roles('ADMIN', 'MANAGER') // Prevent basic operators from changing company details
  async updateTenantDetails(@Body() payload: any, @Request() req: any) {
    return this.accountsService.updateTenantDetails(req.user.tenantId, payload);
  }
  
@Get('exports/csv')
  async downloadGeneralLedgerCSV(
    @Request() req: any,
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const csvString = await this.accountsService.exportJournalsToCSV(req.user.tenantId, startDate, endDate);
    
    res.header('Content-Type', 'text/csv');
    res.attachment(`general_ledger_export_${Date.now()}.csv`);
    
    return res.send(csvString);
  }
}