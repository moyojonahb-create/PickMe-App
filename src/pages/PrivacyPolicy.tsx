import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function PrivacyPolicy() {
  const navigate = useNavigate();
  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold text-foreground">Privacy Policy</h1>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8 prose prose-sm text-foreground">
        <p className="text-muted-foreground text-xs">Last updated: March 2026</p>

        <h2>1. Information We Collect</h2>
        <p>We collect the following personal information when you use CruiXe:</p>
        <ul>
          <li><strong>Account data</strong> – name, email, phone number, and profile photo.</li>
          <li><strong>Location data</strong> – real-time GPS coordinates during active rides for routing and safety.</li>
          <li><strong>Trip data</strong> – pickup/dropoff addresses, fare amounts, payment method, and ride history.</li>
          <li><strong>Device data</strong> – device type, operating system, and app version for debugging.</li>
        </ul>

        <h2>2. How We Use Your Information</h2>
        <ul>
          <li>Matching riders with nearby drivers and calculating fares.</li>
          <li>Processing payments and maintaining transaction records.</li>
          <li>Providing safety features such as trip sharing and emergency contacts.</li>
          <li>Improving our service through aggregated, anonymised analytics.</li>
        </ul>

        <h2>3. Data Sharing</h2>
        <p>We share limited data only when necessary:</p>
        <ul>
          <li><strong>Driver ↔ Rider</strong> – name, vehicle info, and real-time location during an active trip.</li>
          <li><strong>Payment processors</strong> – to complete EcoCash or wallet transactions.</li>
          <li><strong>Law enforcement</strong> – when required by Zimbabwean law or a valid court order.</li>
        </ul>
        <p>We do not sell your personal data to third parties.</p>

        <h2>4. Data Retention</h2>
        <p>We retain trip data for up to 3 years for regulatory compliance. You may request deletion of your account and all associated data at any time from your profile settings.</p>

        <h2>5. Your Rights</h2>
        <p>You have the right to access, correct, or delete your personal information. You can exercise these rights through the app's profile settings or by emailing <a href="mailto:privacy@pickme.co.zw" className="text-primary">privacy@pickme.co.zw</a>.</p>

        <h2>6. Security</h2>
        <p>We use industry-standard encryption (TLS), row-level access controls, and secure cloud infrastructure to protect your data.</p>

        <h2>7. Contact</h2>
        <p>For privacy-related questions, contact us at <a href="mailto:privacy@pickme.co.zw" className="text-primary">privacy@pickme.co.zw</a>.</p>
      </main>
    </div>
  );
}
