import { MyEventsDetail } from "@/components/calendar/MyEventsDetail";

export default async function MyEventsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MyEventsDetail userId={id} />;
}
