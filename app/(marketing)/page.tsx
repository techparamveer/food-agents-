import { Hero } from "@/components/hero";
import { ClosingCta } from "@/components/landing/closing-cta";
import { Faq } from "@/components/landing/faq";
import { FeatureGrid } from "@/components/landing/feature-grid";
import { HowItWorks } from "@/components/landing/how-it-works";

export default function Home() {
  return (
    <main>
      <Hero />
      <HowItWorks />
      <FeatureGrid />
      <Faq />
      <ClosingCta />
    </main>
  );
}
