"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import Button from "./Button";
import Badge from "./Badge";

export default function ViewJsonModal({ isOpen, onClose, connection }) {
  const [copied, setCopied] = useState(false);

  if (!connection) return null;

  // Format JSON to pretty-printed string
  const jsonString = JSON.stringify(connection, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy JSON:", err);
    }
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      
      // Clean connection name and email for filename
      const safeName = (connection.name || connection.provider || "connection")
        .replace(/[^a-z0-9_-]/gi, "_")
        .toLowerCase();
      const safeEmail = (connection.email || "")
        .replace(/[^a-z0-9_@.-]/gi, "_")
        .toLowerCase();
      
      const filename = safeEmail 
        ? `${safeName}_${safeEmail}.json` 
        : `${safeName}_${connection.id.slice(0, 8)}.json`;
      
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download JSON:", err);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export Connection JSON"
      size="lg"
      footer={
        <div className="flex gap-2 w-full justify-between items-center">
          <div>
            {copied && <Badge variant="success">Copied to clipboard!</Badge>}
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCopy} variant="secondary" icon="content_copy">
              Copy
            </Button>
            <Button onClick={handleDownload} variant="primary" icon="download">
              Download File
            </Button>
            <Button onClick={onClose} variant="ghost">
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted">
          Raw connection data stored in the database. Contains sensitive credential tokens.
        </p>
        <div className="relative rounded-lg border border-border bg-surface-2 p-4 overflow-hidden">
          <pre className="text-xs font-mono max-h-[50vh] overflow-y-auto custom-scrollbar whitespace-pre-wrap break-all text-text-main select-all">
            <code>{jsonString}</code>
          </pre>
        </div>
      </div>
    </Modal>
  );
}

ViewJsonModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  connection: PropTypes.object,
};