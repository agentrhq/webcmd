// mcp-skills/financeAgent.ts

interface FinanceAgentArgs {
  portalUrl: string;
}

interface InvoiceRow {
  invoiceId: string;
  vendor: string;
  amountDue: string;
}

interface ExecutionResult {
  status: "success" | "failure";
  timestamp: string;
  foundInvoices: number;
  data: InvoiceRow[];
}

export const financePlugin = {
  name: "finance-agent",
  description: "Automates checking pending invoices and verifying corporate balances.",
  
  inputs: {
    portalUrl: { type: "string", default: "https://mock-finance-portal.test" }
  },

  async execute(browser: any, args: FinanceAgentArgs): Promise<ExecutionResult> {
    console.log(`🚀 Starting Agentic Payment sequence on: ${args.portalUrl}`);
    
    // 1. Navigate to the dashboard target page
    await browser.goto(args.portalUrl);
    
    // 2. Click the 'Invoices' tab visually
    await browser.click("text=Invoices");
    
    // 3. Extract table data fields safely with correct array indexing
    const invoiceData: InvoiceRow[] = await browser.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table.invoice-list tr"));
      
      // Skip the table header row if it exists
      return rows.slice(1).map((row) => {
        const columns = row.querySelectorAll("td");
        return {
          invoiceId: columns[0]?.textContent?.trim() || "N/A",
          vendor: columns[1]?.textContent?.trim() || "Unknown",
          amountDue: columns[2]?.textContent?.trim() || "$0.00"
        };
      });
    });

    // 4. Return structured types back to webcmd handler
    return {
      status: "success",
      timestamp: new Date().toISOString(),
      foundInvoices: invoiceData.length,
      data: invoiceData
    };
  }
};