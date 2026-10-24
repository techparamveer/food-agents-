import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import "@/components/dashboard/dashboard.css";
import "@/components/auth/login.css";

export const metadata: Metadata = {
  title: "Sign in · Comeda",
};

/* Organiser sign-in isn't wired up yet, so this screen leads into the demo. */
export default function LoginPage() {
  return <LoginForm />;
}
