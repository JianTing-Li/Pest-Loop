/**
 * Phase 4 — the copyable renewal-brief text. The one place in this app where
 * prose belongs: meant to be read and pasted into an email, not scanned like
 * a table row.
 *
 * Phase 5 adds export: a plain .txt download (Blob + temporary anchor, no
 * dependency) and a PDF via the browser's own print-to-PDF, scoped to just
 * this element by the `@media print` rule in styles.css — no PDF-generation
 * library needed for a single page of prose.
 */

import { useState } from 'react';
import { generateBrief, briefFilename } from '../lib/brief.js';

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Deferred, not immediate: revoking synchronously can cancel the download
  // in some browsers before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function RenewalBrief({ building, clientName, meta }) {
  const [status, setStatus] = useState('idle'); // idle | copied | error
  const text = generateBrief({ building, clientName, meta });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      // Clipboard API can be unavailable (older browser, non-secure context,
      // denied permission) — say so rather than failing silently; the text
      // is still selectable and copyable by hand below.
      setStatus('error');
    }
  };

  return (
    <div className="brief">
      <div className="brief__toolbar">
        {/* Filled/primary, not secondary — this is the action someone actually
            uses (grab text for an email); .txt and PDF are occasional exports
            and shouldn't visually compete with it for attention. */}
        <button type="button" className="btn" onClick={copy}>
          {status === 'copied' ? 'Copied' : 'Copy brief'}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => downloadText(briefFilename({ building, clientName }, 'txt'), text)}>
          Download .txt
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
        {status === 'error' ? (
          <span className="brief__error">Couldn't copy automatically — select the text below and copy it manually.</span>
        ) : null}
      </div>
      {text.split('\n\n').map((para, i) => (
        <p key={i} className="brief__para">
          {para}
        </p>
      ))}
    </div>
  );
}
