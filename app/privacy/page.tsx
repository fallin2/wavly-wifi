import Link from 'next/link';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export default async function PrivacyPage() {
  const settings = await getSettings();
  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link className="brand" href="/">Wavly<span>WiFi</span></Link>
          <nav><Link href="/">Home</Link></nav>
        </div>
      </header>
      <main className="container" style={{ maxWidth: 640, paddingBottom: 48 }}>
        <h1 style={{ fontSize: '1.4rem', marginTop: 22 }}>Privacy notice</h1>
        <div className="card">
          <p style={{ lineHeight: 1.7 }}>{settings.privacy_notice}</p>
          <h3>What we collect</h3>
          <ul style={{ lineHeight: 1.8 }}>
            <li><b>Phone number</b> — to identify your account and send your sign-in code and receipts.</li>
            <li><b>Plan and payment history</b> — to activate your service and handle disputes.</li>
            <li><b>Device MAC address</b> (optionally, if MAC binding is enabled) — to enforce one-device plans and prevent abuse.</li>
            <li><b>Data volume used</b> — to enforce data caps and protect the network.</li>
          </ul>
          <h3>What we never collect</h3>
          <ul style={{ lineHeight: 1.8 }}>
            <li>Web browsing history, messages, passwords or app content.</li>
            <li>Location, contacts, or identity documents.</li>
          </ul>
          <h3>Your rights (Ghana Data Protection Act, 2012 — Act 843)</h3>
          <ul style={{ lineHeight: 1.8 }}>
            <li>Ask for a copy of your data, correct it, or request erasure — contact support and we will respond within 30 days.</li>
            <li>We keep records for 24 months, then delete or anonymise them.</li>
            <li>Payments are processed by Paystack; we never see your MoMo PIN. Receipts are SMSed to your number.</li>
          </ul>
          <p className="hint">Data controller: {settings.business_name}, Nkawie, Ghana{settings.support_phone ? ` · ${settings.support_phone}` : ''}. Registration with the Data Protection Commission of Ghana is a pre-launch item — see the rollout checklist. Until it completes, treat this notice as a draft to be confirmed at go-live.</p>
        </div>
      </main>
    </>
  );
}
