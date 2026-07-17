"use client";

import { Archive, Mail, MailOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { parseJsonResponse } from "@/lib/utils";
import type { Message } from "@/types";

export function MessageList() {
  const [tab, setTab] = useState<"all" | "unread" | "archived">("all");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<Message | null>(null);
  const load = useCallback(async () => {
    const query = tab === "unread" ? "?unread=true" : tab === "archived" ? "?archived=true" : "";
    const data = await parseJsonResponse<{ messages: Message[] }>(await fetch(`/api/messages${query}`, { cache: "no-store" })); setMessages(data.messages);
  }, [tab]);
  useEffect(() => { load(); }, [load]);
  async function open(message: Message) { setSelected(message); if (!message.is_read) { await fetch(`/api/messages/${message.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isRead: true }) }); await load(); } }
  async function archive(message: Message) { await parseJsonResponse(await fetch(`/api/messages/${message.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isArchived: !message.is_archived }) })); setSelected(null); await load(); }
  return <div><h1 className="mb-5 text-2xl font-black">쪽지함</h1><div className="mb-4 flex gap-2">{[["all","받은 쪽지"],["unread","읽지 않은 쪽지"],["archived","보관함"]].map(([value,label]) => <button key={value} className={tab === value ? "btn-primary" : "btn-secondary"} onClick={() => setTab(value as typeof tab)}>{label}</button>)}</div><div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]"><section className="card max-h-[720px] divide-y divide-slate-200 overflow-y-auto">{messages.length === 0 ? <p className="p-8 text-center text-slate-500">쪽지가 없습니다.</p> : messages.map((message) => <button key={message.id} onClick={() => open(message)} className={`flex h-[72px] w-full gap-3 p-4 text-left hover:bg-slate-50 ${!message.is_read ? "bg-blue-50/60" : ""}`}>{message.is_read ? <MailOpen size={18} /> : <Mail size={18} className="text-blue-700" />}<div className="min-w-0"><div className="truncate font-bold">{message.title}</div><div className="mt-1 text-xs text-slate-500">{message.sender?.display_name ?? "시스템"} · {new Date(message.created_at).toLocaleString("ko-KR")}</div></div></button>)}</section><section className="card min-h-72 p-6">{selected ? <><div className="flex justify-between gap-3"><div><h2 className="text-xl font-black">{selected.title}</h2><p className="mt-1 text-xs text-slate-500">{selected.sender?.display_name ?? "시스템"} · {new Date(selected.created_at).toLocaleString("ko-KR")}</p></div><button className="btn-secondary flex items-center gap-1 text-sm" onClick={() => archive(selected)}><Archive size={16} /> {selected.is_archived ? "보관 해제" : "보관"}</button></div><p className="mt-6 whitespace-pre-wrap leading-7">{selected.content}</p></> : <p className="text-slate-500">왼쪽에서 쪽지를 선택하세요.</p>}</section></div></div>;
}
