import { UsageDetail } from "@/components/usage/UsageDetail";

export default async function UsageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <UsageDetail userId={id} />;
}
