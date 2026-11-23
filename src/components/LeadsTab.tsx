'use client';

import React, { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import type { CapturedLead } from '@/types/extension';

interface LeadsTabProps {
  leads: CapturedLead[];
  onClearLeads: () => void;
}

export function LeadsTab({ leads, onClearLeads }: LeadsTabProps) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const handleExportCsv = () => {
    if (leads.length === 0) {
      alert('Chưa có số điện thoại nào để xuất file!');
      return;
    }

    let csvContent = '\uFEFF';
    csvContent += 'Số điện thoại,Người đăng,Thời gian,Nội dung yêu cầu,Link bài viết\n';

    leads.forEach((lead) => {
      const p = `"${(lead.phone || '').replace(/"/g, '""')}"`;
      const a = `"${(lead.author || '').replace(/"/g, '""')}"`;
      const t = `"${(lead.timestamp || '').replace(/"/g, '""')}"`;
      const c = `"${(lead.content || '').replace(/\r?\n|\r/g, ' ').replace(/"/g, '""')}"`;
      const u = `"${(lead.url || '').replace(/"/g, '""')}"`;
      csvContent += `${p},${a},${t},${c},${u}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fb_leads_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyPhones = async () => {
    if (leads.length === 0) {
      alert('Chưa có số điện thoại nào để sao chép!');
      return;
    }

    const uniquePhones = [...new Set(leads.map((l) => l.phone).filter(Boolean))];
    const text = uniquePhones.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      alert(`Đã sao chép ${uniquePhones.length} số điện thoại vào bộ nhớ tạm!`);
    } catch {
      prompt('Sao chép danh sách số điện thoại:', text);
    }
  };

  const handleCopyLeadToChat = async (lead: CapturedLead) => {
    const text = `${lead.url || ''}\n📞 SĐT: ${lead.phone || ''} | Người đăng: ${lead.author || ''}`;
    try {
      await navigator.clipboard.writeText(text);
      alert(
        'Đã sao chép SĐT & Link bài vào bộ nhớ tạm!\n👉 Hãy click vào ô chat "Aa" ở góc màn hình và bấm Ctrl + V để gửi.'
      );
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div id="tab-leads" className="tab-content active">
      <section className="section card">
        <div className="leads-header-row">
          <div>
            <strong className="toggle-title">Số điện thoại &amp; Nhu cầu</strong>
            <p className="toggle-desc">Tự động trích xuất từ bài viết khi lướt</p>
          </div>
          <span id="leadsTotalCount" className="badge-count">
            {leads.length} số
          </span>
        </div>

        <div className="leads-action-buttons">
          <button id="btnExportCsv" className="btn btn-sm btn-primary" onClick={handleExportCsv}>
            📥 Xuất Excel (CSV)
          </button>
          <button id="btnCopyPhones" className="btn btn-sm btn-outline" onClick={handleCopyPhones}>
            📋 Sao chép SĐT
          </button>
          <button
            id="btnClearLeads"
            className="btn btn-sm btn-danger-outline"
            disabled={leads.length === 0}
            onClick={() => setConfirmingClear(true)}
          >
            🗑️ Xóa
          </button>
        </div>

        <div id="leadsListContainer" className="leads-list">
          {leads.length === 0 ? (
            <div className="leads-empty">
              Chưa có số điện thoại nào được quét. Hãy bật Tự lướt hoặc Like/Comment để thu thập tự
              động.
            </div>
          ) : (
            leads.map((lead) => (
              <div key={lead.id} className="lead-card">
                <div className="lead-card-header">
                  <span className="lead-phone-badge">📞 {lead.phone}</span>
                  <span className="lead-time-text">{lead.timestamp || ''}</span>
                </div>
                <div className="lead-author-text">👤 {lead.author || 'Thành viên FB'}</div>
                <div className="lead-content-box">{lead.content || ''}</div>
                <div className="lead-card-actions">
                  <a
                    href={lead.url || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-lead-open"
                  >
                    🔗 Xem bài
                  </a>
                  <button
                    className="btn-lead-mess"
                    onClick={() => handleCopyLeadToChat(lead)}
                  >
                    💬 Dán vào ô chat
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <ConfirmModal
        open={confirmingClear}
        title="Xóa toàn bộ số điện thoại?"
        message={`Bạn có chắc chắn muốn xóa toàn bộ ${leads.length} số điện thoại đã lưu không?`}
        confirmLabel="Xác nhận"
        cancelLabel="Huỷ"
        danger
        onConfirm={() => {
          setConfirmingClear(false);
          onClearLeads();
        }}
        onCancel={() => setConfirmingClear(false)}
      />
    </div>
  );
}
