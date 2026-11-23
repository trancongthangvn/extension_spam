'use client';

import React, { useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { DEFAULT_KEYWORDS, type ExtensionSettings } from '@/types/extension';

interface FiltersTabProps {
  settings: ExtensionSettings;
  detectedCount: number;
  onUpdateSettings: (patch: Partial<ExtensionSettings>) => void;
  onRescan: () => void;
}

export function FiltersTab({
  settings,
  detectedCount,
  onUpdateSettings,
  onRescan,
}: FiltersTabProps) {
  const [newKeyword, setNewKeyword] = useState('');
  const [confirmingReset, setConfirmingReset] = useState(false);

  const handleAddKeyword = () => {
    const val = newKeyword.trim().toLowerCase();
    if (!val) return;
    if (!settings.keywords.includes(val)) {
      onUpdateSettings({ keywords: [...settings.keywords, val] });
    }
    setNewKeyword('');
  };

  const handleRemoveKeyword = (idx: number) => {
    const next = [...settings.keywords];
    next.splice(idx, 1);
    onUpdateSettings({ keywords: next });
  };

  const handleClearKeywords = () => {
    onUpdateSettings({ keywords: [] });
  };

  const handleResetKeywords = () => {
    setConfirmingReset(false);
    onUpdateSettings({ keywords: [...DEFAULT_KEYWORDS] });
  };

  return (
    <div id="tab-filters" className="tab-content active">
      <section className="section card">
        <div className="toggle-row">
          <div>
            <strong className="toggle-title">Chế độ quét trực quan</strong>
            <p className="toggle-desc">Gắn nhãn đỏ cảnh báo bài vi phạm</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              id="chkEnable"
              checked={settings.enabled}
              onChange={(e) => onUpdateSettings({ enabled: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>

        <div className="stats-box">
          <div className="stats-info">
            <span className="stats-label">Bài nghi vấn trên trang:</span>
            <span id="detectedCount" className="stats-count">
              {detectedCount}
            </span>
          </div>
          <button
            id="btnRescan"
            className="btn btn-sm btn-secondary"
            title="Quét lại nội dung trên trang"
            onClick={onRescan}
          >
            Quét lại
          </button>
        </div>
      </section>

      {/* Detection Rules */}
      <section className="section">
        <h3 className="section-title">Quy tắc nhận diện tự động</h3>
        <div className="checkbox-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              id="chkDetectLinks"
              checked={settings.detectLinks}
              onChange={(e) => onUpdateSettings({ detectLinks: e.target.checked })}
            />
            <span>Nhận diện Link ngoài (t.me, zalo.me, bit.ly, v.v.)</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              id="chkDetectPhones"
              checked={settings.detectPhones}
              onChange={(e) => onUpdateSettings({ detectPhones: e.target.checked })}
            />
            <span>Nhận diện Số điện thoại (dấu hiệu telesale / lừa đảo)</span>
          </label>
        </div>
      </section>

      {/* Custom Keywords */}
      <section className="section">
        <div className="section-header-row">
          <h3 className="section-title">Từ khóa Spam &amp; Nick ảo</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              id="btnClearKeywords"
              className="btn-link"
              style={{ color: '#dc2626' }}
              title="Xóa toàn bộ từ khóa để quét & tương tác tất cả bài"
              onClick={handleClearKeywords}
            >
              Xóa hết
            </button>
            <button
              id="btnResetKeywords"
              className="btn-link"
              onClick={() => setConfirmingReset(true)}
            >
              Mặc định
            </button>
          </div>
        </div>

        <div className="input-group">
          <input
            type="text"
            id="txtNewKeyword"
            placeholder="Nhập từ khóa (vd: cờ bạc, kiếm tiền...)"
            maxLength={50}
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddKeyword();
            }}
          />
          <button id="btnAddKeyword" className="btn btn-primary" onClick={handleAddKeyword}>
            Thêm
          </button>
        </div>

        <div id="keywordsContainer" className="tags-container">
          {settings.keywords.length === 0 ? (
            <span style={{ fontSize: 11, color: '#64748b' }}>
              Đang để trống: sẽ quét toàn bộ bài viết, tự động Like &amp; Comment tất cả bài lướt
              qua.
            </span>
          ) : (
            settings.keywords.map((kw, index) => (
              <span key={`${kw}-${index}`} className="tag">
                <span>{kw}</span>
                <span className="tag-remove" onClick={() => handleRemoveKeyword(index)}>
                  &times;
                </span>
              </span>
            ))
          )}
        </div>
      </section>

      <ConfirmModal
        open={confirmingReset}
        title="Khôi phục từ khóa mặc định?"
        message="Danh sách từ khóa hiện tại sẽ được thay thế bằng bộ từ khóa mặc định."
        confirmLabel="Xác nhận"
        cancelLabel="Huỷ"
        danger={false}
        onConfirm={handleResetKeywords}
        onCancel={() => setConfirmingReset(false)}
      />
    </div>
  );
}
