// mcp-skills/financeAgent.ts

interface FinanceAgentArgs {
  portalUrl: string;
}

interface InvoiceRow {
  invoiceId: string;
  vendor: string;
  amountDue: string;
  status?: string;
}

interface ExecutionResult {
  status: 'success' | 'failure';
  timestamp: string;
  foundInvoices: number;
  totalDue: string;
  data: InvoiceRow[];
}

interface FinanceBrowser {
  goto: (url: string) => Promise<void>;
  click: (selector: string) => Promise<void>;
  evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>;
}

export const financePlugin = {
  name: 'finance-agent',
  description: 'Automates checking pending invoices and verifying corporate balances.',

  inputs: {
    portalUrl: { type: 'string', default: 'https://mock-finance-portal.test' },
  },

  async execute(browser: FinanceBrowser, args: FinanceAgentArgs): Promise<ExecutionResult> {
    const portalUrl = args.portalUrl || 'https://mock-finance-portal.test';
    console.log(`🚀 Starting finance invoice scan on: ${portalUrl}`);

    await browser.goto(portalUrl);
    await browser.click('text=Invoices');

    const invoiceData = await browser.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table.invoice-list tr'));
      return rows.slice(1).map((row) => {
        const columns = row.querySelectorAll('td');
        return {
          invoiceId: columns[0]?.textContent?.trim() || 'N/A',
          vendor: columns[1]?.textContent?.trim() || 'Unknown',
          amountDue: columns[2]?.textContent?.trim() || '$0.00',
          status: columns[3]?.textContent?.trim() || 'pending',
        } satisfies InvoiceRow;
      });
    });

    const totalDue = invoiceData.reduce((sum, item) => {
      const numeric = Number.parseFloat(item.amountDue.replace(/[^\d.-]/g, '')) || 0;
      return sum + numeric;
    }, 0);

    return {
      status: 'success',
      timestamp: new Date().toISOString(),
      foundInvoices: invoiceData.length,
      totalDue: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalDue),
      data: invoiceData,
    };
  },
} as const;

export const financeAgentPlugin = financePlugin;
export default financePlugin;