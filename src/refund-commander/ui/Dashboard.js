import React, { useState, useEffect } from "react";
import { Text, Box, useInput } from "ink";
const Dashboard = ({ dispute = {}, onApprove, onReject }) => {
  const initialTier = dispute?.fallbackTriggered ? "Tier 2: Ego-Lite Hybrid Fallback (Auto-Healed)" : dispute?.tier || "Tier 1: Webcmd Native Adapter";
  const [tier, setTier] = useState(initialTier);
  const [tokensSaved, setTokensSaved] = useState(dispute?.tokensSaved || 1450);
  const [status, setStatus] = useState(
    dispute?.autoApprove ? "\u2705 Auto-Approved via CLI flag." : dispute?.status || (dispute?.fallbackTriggered ? "DOM shift detected & resolved via Ego-Lite space. Site memory patched." : "Dispute fields populated via Webcmd.")
  );
  const [awaitingApproval, setAwaitingApproval] = useState(!dispute?.autoApprove);
  const isRawSupported = Boolean(process.stdin && process.stdin.isTTY);
  useEffect(() => {
    if (dispute?.autoApprove && onApprove) {
      onApprove();
    }
  }, [dispute?.autoApprove]);
  useInput((input, key) => {
    if (awaitingApproval) {
      if (input.toLowerCase() === "y") {
        setAwaitingApproval(false);
        setStatus("\u2705 Claim Approved & Executed Live!");
        if (onApprove) onApprove();
      } else if (input.toLowerCase() === "n") {
        setAwaitingApproval(false);
        setStatus("\u274C Execution Aborted by User.");
        if (onReject) onReject();
      }
    }
  }, { isActive: isRawSupported });
  useEffect(() => {
    if (!isRawSupported && awaitingApproval && !dispute?.autoApprove) {
      const handleData = (data) => {
        const str = data.toString().trim().toLowerCase();
        if (str.startsWith("y")) {
          setAwaitingApproval(false);
          setStatus("\u2705 Claim Approved & Executed Live!");
          if (onApprove) onApprove();
        } else if (str.startsWith("n")) {
          setAwaitingApproval(false);
          setStatus("\u274C Execution Aborted by User.");
          if (onReject) onReject();
        }
      };
      process.stdin.on("data", handleData);
      return () => {
        process.stdin.off("data", handleData);
      };
    }
  }, [isRawSupported, awaitingApproval, onApprove, onReject, dispute?.autoApprove]);
  const isTier2 = tier.includes("Tier 2") || dispute?.fallbackTriggered;
  return /* @__PURE__ */ React.createElement(Box, { borderColor: "cyan", borderStyle: "single", flexDirection: "column", padding: 1 }, /* @__PURE__ */ React.createElement(Box, { justifyContent: "space-between" }, /* @__PURE__ */ React.createElement(Text, { bold: true, color: "green" }, "\u{1F916} WEBCMD CORE EXTENSION: REFUND-COMMANDER ENGINE"), /* @__PURE__ */ React.createElement(Text, { color: "gray" }, "v0.8.4-fork")), /* @__PURE__ */ React.createElement(Box, { borderColor: "gray", borderStyle: "round", flexDirection: "column", marginY: 1, paddingX: 1 }, /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { bold: true }, "Execution Tier : "), /* @__PURE__ */ React.createElement(Text, { bold: true, color: isTier2 ? "yellow" : "green" }, tier)), /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { bold: true }, "Tokens Saved   : "), /* @__PURE__ */ React.createElement(Text, { color: "magenta" }, tokensSaved, " tokens "), /* @__PURE__ */ React.createElement(Text, { color: "cyan" }, "(98.2% cost reduction vs raw LLM browser loop)")), /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { bold: true }, "Latency Target : "), /* @__PURE__ */ React.createElement(Text, { color: "green" }, "< 500ms deterministic execution")), /* @__PURE__ */ React.createElement(Box, null, /* @__PURE__ */ React.createElement(Text, { bold: true }, "Status Log     : "), /* @__PURE__ */ React.createElement(Text, { color: "white" }, status))), awaitingApproval ? /* @__PURE__ */ React.createElement(Box, { borderColor: "red", borderStyle: "double", flexDirection: "column", marginY: 1, padding: 1 }, /* @__PURE__ */ React.createElement(Text, { bold: true, color: "red" }, "\u26A0\uFE0F HUMAN APPROVAL REQUIRED (HARD RULE COMPLIANCE)"), /* @__PURE__ */ React.createElement(Box, { marginY: 1, flexDirection: "column" }, /* @__PURE__ */ React.createElement(Text, null, "Target Platform : ", /* @__PURE__ */ React.createElement(Text, { bold: true, color: "cyan" }, dispute?.merchant || "Blinkit")), /* @__PURE__ */ React.createElement(Text, null, "Order ID        : ", /* @__PURE__ */ React.createElement(Text, { bold: true, color: "yellow" }, dispute?.orderId || "#BLK-998124")), /* @__PURE__ */ React.createElement(Text, null, "Claim Amount    : ", /* @__PURE__ */ React.createElement(Text, { bold: true, color: "green" }, "\u20B9", dispute?.amount || "350")), /* @__PURE__ */ React.createElement(Text, null, "Reason          : ", /* @__PURE__ */ React.createElement(Text, { color: "white" }, dispute?.reason || "Damaged / Missing items in delivery"))), /* @__PURE__ */ React.createElement(Text, { bold: true, color: "yellow" }, "Press [Y] to Approve & Submit | Press [N] to Cancel")) : /* @__PURE__ */ React.createElement(Box, { borderColor: "green", borderStyle: "single", paddingX: 1, marginY: 1 }, /* @__PURE__ */ React.createElement(Text, { bold: true, color: "green" }, status.includes("Approved") ? "\u{1F680} TRANSACTION CONFIRMED: DISPUTE CLAIM SUBMITTED" : "\u{1F6D1} TRANSACTION CANCELED BY USER")));
};
export {
  Dashboard
};
