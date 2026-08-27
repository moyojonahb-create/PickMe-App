import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function TermsOfService() {
  const navigate = useNavigate();
  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-foreground">Terms of Service</h1>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8 prose prose-sm text-foreground">
        <p className="text-muted-foreground text-xs">Last updated: March 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>By downloading, installing, or using the CruiXe application ("App"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree, do not use the App.</p>

        <h2>2. Eligibility</h2>
        <p>You must be at least 18 years old and legally capable of entering into binding contracts under Zimbabwean law to use CruiXe as a rider or driver.</p>

        <h2>3. Service Description</h2>
        <p>CruiXe is a technology platform that connects riders with independent driver-partners. CruiXe does not provide transportation services directly. Drivers are independent contractors, not employees of CruiXe.</p>

        <h2>4. User Accounts</h2>
        <ul>
          <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
          <li>You agree to provide accurate and current information during registration.</li>
          <li>One account per person. Account sharing is prohibited.</li>
        </ul>

        <h2>5. Fares &amp; Payments</h2>
        <p>Fares are displayed in USD and may be subject to negotiation between rider and driver. A 15% platform commission is deducted from each completed trip. Payment methods include cash and EcoCash (paid directly to the driver).</p>

        <h2>6. Cancellation Policy</h2>
        <p>Riders may cancel a ride request at any time before driver arrival. Repeated no-show cancellations may incur a cancellation fee or temporary account restriction.</p>

        <h2>7. Driver Requirements</h2>
        <ul>
          <li>Valid Zimbabwean driver's licence.</li>
          <li>Vehicle roadworthy certificate and insurance.</li>
          <li>Compliance with all applicable traffic and transportation regulations.</li>
        </ul>

        <h2>8. Prohibited Conduct</h2>
        <p>Users shall not: engage in illegal activity, discriminate against others, tamper with the platform, use the service for purposes other than personal transportation, or harass drivers or riders.</p>

        <h2>9. Account Deletion</h2>
        <p>You may delete your account at any time from your profile settings. Upon deletion, your personal data will be removed in accordance with our Privacy Policy. Some transaction records may be retained for regulatory compliance.</p>

        <h2>10. Limitation of Liability</h2>
        <p>CruiXe is provided "as is." To the maximum extent permitted by law, CruiXe shall not be liable for indirect, incidental, or consequential damages arising from use of the platform.</p>

        <h2>11. Governing Law</h2>
        <p>These Terms are governed by and construed in accordance with the laws of Zimbabwe. Any disputes shall be resolved in the courts of Zimbabwe.</p>

        <h2>12. Changes to Terms</h2>
        <p>We may update these Terms from time to time. Continued use of the App after changes constitutes acceptance of the revised Terms.</p>

        <h2>13. Contact</h2>
        <p>Questions about these Terms? Email <a href="mailto:legal@pickme.co.zw" className="text-primary">legal@pickme.co.zw</a>.</p>
      </main>
    </div>
  );
}
