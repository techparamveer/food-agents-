import type { Metadata } from "next";
import { DashboardProvider } from "@/components/dashboard/data";
import { HomeScreen } from "@/components/dashboard/home-screen";
import { PlannerProvider } from "@/components/dashboard/planner-state";
import { isSection, isSettingsTab } from "@/lib/sections";
import { oxhackForToday } from "@/lib/seed/oxhack";
import "@/components/dashboard/dashboard.css";
import "@/components/dashboard/meal-check.css";
import "@/components/onboarding/onboarding.css";
import "@/components/settings/settings.css";

/* The organiser dashboard with the seeded OxHack event. No sign-in. */

export const metadata: Metadata = {
  title: "Demo · Comeda",
  robots: { index: false },
};

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { section, settings, play } = await searchParams;
  const demo = oxhackForToday();
  return (
    <DashboardProvider initial={demo} demo>
      <PlannerProvider>
        <HomeScreen
          initialSection={typeof section === "string" && isSection(section) ? section : undefined}
          initialSettings={isSettingsTab(settings) ? settings : undefined}
          autoplay={play === "1"}
        />
      </PlannerProvider>
    </DashboardProvider>
  );
}
