/**
 * Phase 4 — the copyable renewal-brief text. The one place in this app where
 * prose belongs: meant to be read and pasted into an email, not scanned like
 * a table row.
 */

import { useState } from 'react';
import { generateBrief } from '../lib/brief.js';

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
        <button type="button" className="btn btn--secondary" onClick={copy}>
          {status === 'copied' ? 'Copied' : 'Copy brief'}
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
