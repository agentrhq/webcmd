import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render as renderInk } from 'ink-testing-library';
import { runWebcmdAdapter } from './engine/adapterRunner.js';
import { runEgoFallback } from './engine/egoFallback.js';
import { generateAdapterFromRepair, saveGeneratedAdapter } from './engine/adapterGenerator.js';
import { EgoBrowser, EgoTaskSpace } from '@citrolabs/ego-browser-sdk';
import { Dashboard } from './ui/Dashboard.js';
import { executeRefundCommander } from './index.js';

describe('Refund-Commander & Ego-Lite Engine Test Suite', () => {
  const testOutputDir = path.resolve(process.cwd(), 'scratch/test-clis');

  beforeEach(() => {
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true });
    }
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testOutputDir)) {
        fs.rmSync(testOutputDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe('1. Ego-Lite Browser SDK Bridge', () => {
    it('spawns isolated task spaces with independent state', async () => {
      const browser = new EgoBrowser();
      const space1 = await browser.useOrCreateTaskSpace('Space-Alpha');
      const space2 = await browser.useOrCreateTaskSpace('Space-Beta');

      expect(space1).toBeInstanceOf(EgoTaskSpace);
      expect(space2).toBeInstanceOf(EgoTaskSpace);
      expect(space1.spaceId).toBe('Space-Alpha');
      expect(space2.spaceId).toBe('Space-Beta');
    });

    it('navigates and inherits Chrome active profile', async () => {
      const browser = new EgoBrowser();
      const space = await browser.useOrCreateTaskSpace('Profile-Test');

      const nav = await space.navigate('https://blinkit.com/orders/BLK-998124');
      expect(nav.status).toBe(200);
      expect(nav.profile).toContain('Chrome Active Profile');
      expect(nav.url).toBe('https://blinkit.com/orders/BLK-998124');
    });

    it('extracts semantic layout snapshot for DOM shift resolution', async () => {
      const browser = new EgoBrowser();
      const space = await browser.useOrCreateTaskSpace('DOM-Snapshot-Test');
      await space.navigate('https://blinkit.com/support');

      const snapshot = await space.snapshotText();
      expect(snapshot).toContain('Semantic Tree Extract');
      expect(snapshot).toContain('form#refund-dispute-form');
      expect(snapshot).toContain('#refund-amount');
      expect(snapshot).toContain('button#submit-dispute');
    });

    it('evaluates repair scripts in page context and captures mutations', async () => {
      const browser = new EgoBrowser();
      const space = await browser.useOrCreateTaskSpace('DOM-Repair-Test');
      
      const res = await space.js("document.querySelector('#refund-amount').value = '1250';");
      expect(res.executed).toBe(true);
      expect(res.selectorPatched).toBe('#refund-amount');
      expect(res.injectedValue).toBe('1250');
      expect(res.domMutationSuccess).toBe(true);
    });

    it('guards against operations on closed task spaces', async () => {
      const browser = new EgoBrowser();
      const space = await browser.useOrCreateTaskSpace('Closed-Space-Test');
      await space.close();

      await expect(space.navigate('https://example.com')).rejects.toThrow(/closed/i);
      await expect(space.snapshotText()).rejects.toThrow(/closed/i);
      await expect(space.js('true')).rejects.toThrow(/closed/i);
    });
  });

  describe('2. Ego Fallback Bridge & Auto-Healing', () => {
    it('executes Tier 2 fallback and triggers Tier 3 auto-healing', async () => {
      const targetUrl = 'https://example.com/support/dispute';
      const repairScript = "document.querySelector('#refund-amount').value = '350';";

      const res = await runEgoFallback(targetUrl, repairScript);
      expect(res.success).toBe(true);
      expect(res.repaired).toBe(true);
      expect(res.data).toBeDefined();
      expect(res.snapshot).toContain('form#refund-dispute-form');
    });

    it('handles unexpected errors gracefully', async () => {
      const badBrowserFallback = async () => {
        const browser = new EgoBrowser();
        const space = await browser.useOrCreateTaskSpace('Fail-Space');
        await space.close();
        return await space.navigate('https://invalid');
      };

      await expect(badBrowserFallback()).rejects.toThrow();
    });
  });

  describe('3. Native Adapter Runner & Generator', () => {
    it('handles unknown native adapters without crashing', async () => {
      const res = await runWebcmdAdapter('unknown-refund-adapter-xyz', ['--orderId', 'TEST-001']);
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('generates valid adapter manifest from healed selectors', () => {
      const manifest = generateAdapterFromRepair({
        merchant: 'Zepto',
        targetUrl: 'https://zepto.com/help',
        resolvedSelector: '#claim-amount-box',
        action: 'refund-dispute'
      });

      expect(manifest.site).toBe('zepto');
      expect(manifest.name).toBe('refund-dispute');
      expect(manifest.tier).toBe('hybrid-ego-healed');
      expect(manifest.selectors.inputAmount).toBe('#claim-amount-box');
      expect(manifest.selectors.submitButton).toBe('#submit-dispute');
      expect(manifest.generatedAt).toBeDefined();
    });

    it('persists generated adapter to disk', () => {
      const manifest = generateAdapterFromRepair({
        merchant: 'Instamart',
        targetUrl: 'https://swiggy.com/instamart',
        resolvedSelector: '#refund-val'
      });

      const savedPath = saveGeneratedAdapter(manifest, testOutputDir);
      expect(fs.existsSync(savedPath)).toBe(true);

      const loaded = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
      expect(loaded.site).toBe('instamart');
      expect(loaded.selectors.inputAmount).toBe('#refund-val');
    });
  });

  describe('4. Ink React Terminal Dashboard (TUI)', () => {
    it('renders dashboard with telemetry and safety gate info', () => {
      const dispute = {
        merchant: 'Blinkit',
        orderId: 'BLK-998124',
        amount: '350',
        tokensSaved: 1450,
        reason: 'Missing item in basket'
      };

      const { lastFrame } = renderInk(
        React.createElement(Dashboard, { dispute })
      );

      const frame = lastFrame();
      expect(frame).toContain('REFUND-COMMANDER ENGINE');
      expect(frame).toContain('Tokens Saved');
      expect(frame).toContain('1450 tokens');
      expect(frame).toContain('HUMAN APPROVAL REQUIRED');
      expect(frame).toContain('Blinkit');
      expect(frame).toContain('BLK-998124');
      expect(frame).toContain('350');
      expect(frame).toContain('Press [Y] to Approve');
    });

    it('renders Tier 2 fallback badge when fallbackTriggered is true', () => {
      const dispute = {
        merchant: 'Zomato',
        orderId: 'ZOM-5541',
        amount: '500',
        fallbackTriggered: true
      };

      const { lastFrame } = renderInk(
        React.createElement(Dashboard, { dispute })
      );

      const frame = lastFrame();
      expect(frame).toContain('Tier 2: Ego-Lite Hybrid Fallback');
      expect(frame).toContain('DOM shift detected & resolved');
    });

    it('handles autoApprove mode cleanly without blocking', async () => {
      let approvedCalled = false;
      const dispute = {
        merchant: 'Swiggy',
        orderId: 'SWG-1122',
        amount: '200',
        autoApprove: true
      };

      const { lastFrame } = renderInk(
        React.createElement(Dashboard, {
          dispute,
          onApprove: () => { approvedCalled = true; }
        })
      );

      await new Promise((r) => setTimeout(r, 50));
      expect(approvedCalled).toBe(true);
      const frame = lastFrame();
      expect(frame).toContain('TRANSACTION CONFIRMED');
    });
  });

  describe('5. Full Agent Lifecycle Execution', () => {
    it('executes Tier 1 deterministic fast-path when requested', async () => {
      const result = await executeRefundCommander({
        merchant: 'Blinkit',
        orderId: 'BLK-FAST-01',
        amount: '150',
        tier: '1',
        autoApprove: true,
        exitOnComplete: false
      });

      expect(result.approved).toBe(true);
      expect(result.dispute.tier).toBe('Tier 1: Webcmd Native Adapter');
      expect(result.dispute.tokensSaved).toBe(2100);
    });

    it('executes Tier 2 fallback with auto-healing and persists audit file', async () => {
      const orderId = 'BLK-AUDIT-TEST';
      const result = await executeRefundCommander({
        merchant: 'Blinkit',
        orderId,
        amount: '450',
        autoApprove: true,
        exitOnComplete: false
      });

      expect(result.approved).toBe(true);
      expect(result.dispute.fallbackTriggered).toBe(true);

      const auditFile = path.resolve(process.cwd(), `dispute-audit-${orderId}.json`);
      expect(fs.existsSync(auditFile)).toBe(true);

      const auditData = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
      expect(auditData.status).toBe('SUBMITTED');
      expect(auditData.dispute.orderId).toBe(orderId);
      expect(auditData.dispute.amount).toBe('450');
      expect(auditData.telemetry.tier).toContain('Tier 2');

      // Cleanup
      try { fs.unlinkSync(auditFile); } catch {}
    });
  });
});
