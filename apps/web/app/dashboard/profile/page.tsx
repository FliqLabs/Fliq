import type { Metadata } from "next";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile | Fliq" };

export default function ProfilePage() {
  return <ProfileForm />;
}
