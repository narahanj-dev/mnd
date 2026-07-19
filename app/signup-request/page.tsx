import { redirect } from "next/navigation";

export default function SignupRequestPage() {
  redirect("/login?reason=signup-disabled");
}
