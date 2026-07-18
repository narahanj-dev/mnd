"use client";

import { ArrowLeft, Building2, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { parseJsonResponse } from "@/lib/utils";
import type { UserRole } from "@/types";

type RequestItem = {
  id: string;
  name: string;
  department: string;
  contact: string;
  birth_date: string;
  requested_login_id: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  created_at: string;
};

type DepartmentSummary = { name: string; requestCount: number };
type SignupResponse = {
  requests: RequestItem[];
  departments: DepartmentSummary[];
  selectedDepartment: string | null;
  viewerRole: UserRole;
  viewerDepartment: string;
};

export function SignupRequestList() {
  const [items, setItems] = useState<RequestItem[]>([]);
  const [departments, setDepartments] = useState<DepartmentSummary[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<UserRole>("user");
  const [viewerDepartment, setViewerDepartment] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (department: string | null = null) => {
    setLoading(true);
    setError("");
    try {
      const query = department ? `?department=${encodeURIComponent(department)}` : "";
      const data = await parseJsonResponse<SignupResponse>(
        await fetch(`/api/admin/signup-requests${query}`, { cache: "no-store" }),
      );
      setItems(data.requests);
      setDepartments(data.departments);
      setSelectedDepartment(data.selectedDepartment);
      setViewerRole(data.viewerRole);
      setViewerDepartment(data.viewerDepartment);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "가입신청을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function decide(item: RequestItem, decision: "approve" | "reject") {
    let body: Record<string, string> = { decision };
    if (decision === "approve") {
      const loginId = prompt("발급할 군번", item.requested_login_id)?.trim();
      if (!loginId) return;
      const password = prompt("임시 비밀번호(4자 이상)")?.trim();
      if (!password) return;
      body = { ...body, loginId, password };
    } else {
      const reason = prompt("거절 사유")?.trim();
      if (!reason) return;
      body.reason = reason;
    }

    try {
      await parseJsonResponse(
        await fetch(`/api/admin/signup-requests/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      await load(selectedDepartment);
    } catch (decisionError) {
      alert(decisionError instanceof Error ? decisionError.message : "처리에 실패했습니다.");
    }
  }

  if (loading) return <div className="card p-8 text-center text-slate-500">가입신청을 불러오는 중...</div>;

  if (error) {
    return (
      <div>
        <h1 className="mb-5 text-2xl font-black">가입 신청</h1>
        <div className="card p-8 text-center">
          <p className="text-rose-700">{error}</p>
          <button className="btn-secondary mt-4" onClick={() => void load(selectedDepartment)}>다시 불러오기</button>
        </div>
      </div>
    );
  }

  if (!selectedDepartment) {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-black">가입 신청</h1>
        <p className="mb-5 text-sm text-slate-500">
          {viewerRole === "admin"
            ? "5개 부서 중 가입신청을 확인할 부서를 선택하세요."
            : `${viewerDepartment} 가입신청만 승인하거나 거절할 수 있습니다.`}
        </p>
        <div className={`grid gap-3 ${departments.length === 1 ? "max-w-md" : "sm:grid-cols-2 xl:grid-cols-5"}`}>
          {departments.map((department) => (
            <button
              key={department.name}
              type="button"
              onClick={() => void load(department.name)}
              className="card flex items-center gap-3 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50"
            >
              <span className="rounded-xl bg-slate-100 p-2 text-slate-600"><Building2 size={20} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-black">{department.name}</span>
                <span className="mt-1 block text-xs font-bold text-slate-500">신청 {department.requestCount}건</span>
              </span>
              <ChevronRight size={18} className="text-slate-400" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setSelectedDepartment(null);
          setItems([]);
        }}
        className="btn-secondary mb-4 flex items-center gap-1.5"
      >
        <ArrowLeft size={16} /> 부서 목록
      </button>
      <h1 className="mb-2 text-2xl font-black">{selectedDepartment} 가입 신청</h1>
      <p className="mb-5 text-sm text-slate-500">승인 또는 거절하면 처리된 신청은 이 화면에서 즉시 삭제됩니다.</p>
      <div className="space-y-4">
        {items.length === 0 ? (
          <div className="card p-8 text-center text-slate-500">대기 중인 가입신청이 없습니다.</div>
        ) : items.map((item) => (
          <article key={item.id} className="card p-5">
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <div className="font-black">{item.name} · {item.department}</div>
                <p className="mt-1 text-sm text-slate-600">생년월일 {item.birth_date} · 희망 군번 {item.requested_login_id} · 연락처 {item.contact}</p>
                {item.reason && <p className="mt-2 text-sm">신청 사유: {item.reason}</p>}
                <p className="mt-2 text-xs text-slate-400">{new Date(item.created_at).toLocaleString("ko-KR")}</p>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" onClick={() => void decide(item, "approve")}>승인</button>
                <button className="btn-danger" onClick={() => void decide(item, "reject")}>거절</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
