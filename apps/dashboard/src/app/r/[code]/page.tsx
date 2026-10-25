import { ReferralLanding } from "@/components/affiliates/ReferralLanding";
export default async function ReferralPage({ params }: { params: Promise<{ code: string }> }) {
  return <ReferralLanding code={(await params).code} />;
}
