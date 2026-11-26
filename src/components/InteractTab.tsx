'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { CommentMode, ExtensionSettings } from '@/types/extension';

interface InteractTabProps {
  settings: ExtensionSettings;
  isScrolling: boolean;
  isInteracting: boolean;
  likedCount: number;
  commentedCount: number;
  interactionDiagnostic: string;
  delayInput: string;
  onDelayInputChange: (val: string) => void;
  onUpdateSettings: (patch: Partial<ExtensionSettings>, immediate?: boolean) => void;
  onToggleScroll: () => void;
  onSetSpeed: (speed: number) => void;
  onToggleAutoInteract: (checked: boolean) => void;
}

export function InteractTab({
  settings,
  isScrolling,
  isInteracting,
  likedCount,
  commentedCount,
  interactionDiagnostic,
  delayInput,
  onDelayInputChange,
  onUpdateSettings,
  onToggleScroll,
  onSetSpeed,
  onToggleAutoInteract,
}: InteractTabProps) {
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modeMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [modeMenuOpen]);

  const commentModeLabel =
    settings.commentMode === 'roundrobin'
      ? '🔄 Xoay vòng lần lượt'
      : '🎲 Random ngẫu nhiên';

  const statusText = isInteracting
    ? interactionDiagnostic || 'Đang chạy...'
    : interactionDiagnostic || 'Đang dừng';

  return (
    <div id="tab-interact" className="tab-content active">
      {/* Master Auto-Scroll Action */}
      <section className="section">
        <button
          id="btnToggleScrollPopup"
          className={`btn btn-primary btn-scroller-main${isScrolling ? ' is-scrolling' : ''}`}
          onClick={onToggleScroll}
        >
          <span id="scrollPopupIcon">{isScrolling ? '⏸' : '▶'}</span>
          <span id="scrollPopupText">
            {isScrolling ? 'Tạm dừng' : 'Bắt đầu'}
          </span>
        </button>

        <div
          id="interactionStatusPopup"
          className="card"
          style={{
            marginTop: 8,
            padding: '8px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            fontSize: 12.5,
            color: 'var(--text-secondary)',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {statusText}
          </span>
          <span style={{ whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>
            👍 {likedCount} &nbsp;|&nbsp; 💬 {commentedCount}
          </span>
        </div>
      </section>

      {/* Auto-Scroll Configuration */}
      <section className="section card">
        <div className="toggle-row">
          <div>
            <strong className="toggle-title">Thanh điều khiển nổi trên FB</strong>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              id="chkShowScroller"
              checked={settings.showScroller}
              onChange={(e) => onUpdateSettings({ showScroller: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>

        <div
          style={{
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
            TỐC ĐỘ LƯỚT:
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { speed: 1, label: '1x Chậm' },
              { speed: 2, label: '2x Vừa' },
              { speed: 3, label: '3x Nhanh' },
            ].map((item) => (
              <button
                key={item.speed}
                className={`btn btn-sm speed-btn ${
                  settings.speed === item.speed ? 'btn-primary' : 'btn-outline'
                }`}
                onClick={() => onSetSpeed(item.speed)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Automatic Like & Comment */}
      <section className="section card">
        <div className="toggle-row">
          <div>
            <strong className="toggle-title">Tự động Like &amp; Comment bài viết</strong>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              id="chkAutoInteract"
              checked={settings.autoInteractEnabled}
              onChange={(e) => onToggleAutoInteract(e.target.checked)}
            />
            <span className="slider" />
          </label>
        </div>

        {/* Advanced Options Checkboxes */}
        <div className="checkbox-group-compact" style={{ marginTop: 10 }}>
          <label
            className="checkbox-label"
            title="Tự động bấm chữ 'Xem thêm' để mở rộng bài viết dài bị ẩn nội dung"
          >
            <input
              type="checkbox"
              id="chkAutoExpandSeeMore"
              checked={settings.autoExpandSeeMore}
              onChange={(e) => onUpdateSettings({ autoExpandSeeMore: e.target.checked })}
            />
            <span>
              <strong>Mở rộng bài viết:</strong> Tự bấm &quot;Xem thêm&quot; để lấy đủ nội dung
            </span>
          </label>
          <label
            className="checkbox-label"
            title="Không bao giờ comment lại những bài mà bạn hoặc tài khoản đã thả Like/cảm xúc"
          >
            <input
              type="checkbox"
              id="chkSkipAlreadyLiked"
              checked={settings.skipAlreadyLiked}
              onChange={(e) => onUpdateSettings({ skipAlreadyLiked: e.target.checked })}
            />
            <span>
              <strong>Chống trùng:</strong> Bài nào đã Like thì <u>KHÔNG</u> comment lại
            </span>
          </label>
          <label
            className="checkbox-label"
            title="Khi Facebook xuất hiện cửa sổ chặn hoặc cảnh báo, lập tức dừng ngay toàn bộ để giữ tài khoản an toàn"
          >
            <input
              type="checkbox"
              id="chkAutoStopOnFbWarning"
              checked={settings.autoStopOnFbWarning}
              onChange={(e) => onUpdateSettings({ autoStopOnFbWarning: e.target.checked })}
            />
            <span>
              <strong>Bảo vệ tài khoản:</strong> FB cảnh báo là dừng ngay lập tức
            </span>
          </label>
          <label
            className="checkbox-label"
            title="Tự dừng lướt khi gặp bài chứa từ khóa/link spam"
          >
            <input
              type="checkbox"
              id="chkPauseOnSpam"
              checked={settings.pauseOnSpam}
              onChange={(e) => onUpdateSettings({ pauseOnSpam: e.target.checked })}
            />
            <span>Tự dừng lướt khi phát hiện bài có từ khóa rác</span>
          </label>
        </div>

        {/* Comment Template Setting */}
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label className="toggle-title" htmlFor="txtCommentTemplate">
              Danh sách mẫu bình luận:
            </label>
            <span
              style={{
                fontSize: 11.5,
                color: 'var(--primary)',
                fontWeight: 600,
                background: '#eff6ff',
                border: '1px solid #60a5fa',
                padding: '2px 8px',
                borderRadius: 999,
              }}
            >
              Mỗi dòng là 1 mẫu cmt
            </span>
          </div>
          <textarea
            id="txtCommentTemplate"
            className="interaction-textarea"
            rows={4}
            placeholder={
              'Nhập các mẫu câu cmt (mỗi dòng 1 câu)...\nVí dụ:\nxin chào shop\ncho mình xin thêm thông tin với nhé\ninbox mình nha shop\nbài viết hữu ích quá ạ'
            }
            value={settings.commentTemplate}
            onChange={(e) => {
              const val = e.target.value;
              const templates = val
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
              onUpdateSettings({ commentTemplate: val, commentTemplates: templates });
            }}
          />

          <div
            style={{
              marginTop: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>
              Thứ tự chọn mẫu:
            </span>
            <div className="custom-select" ref={modeMenuRef}>
              <button
                type="button"
                id="selCommentMode"
                className="custom-select-trigger"
                onClick={() => setModeMenuOpen((prev) => !prev)}
              >
                <span>{commentModeLabel}</span>
                <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>▼</span>
              </button>
              {modeMenuOpen && (
                <div className="custom-select-menu">
                  {(
                    [
                      { value: 'random', label: '🎲 Random ngẫu nhiên' },
                      { value: 'roundrobin', label: '🔄 Xoay vòng lần lượt' },
                    ] as { value: CommentMode; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`custom-select-option ${
                        settings.commentMode === opt.value ? 'selected' : ''
                      }`}
                      onClick={() => {
                        onUpdateSettings({ commentMode: opt.value });
                        setModeMenuOpen(false);
                      }}
                    >
                      <span>{opt.label}</span>
                      {settings.commentMode === opt.value && <span>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Delay Control */}
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <label
            htmlFor="numInteractionDelay"
            style={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}
          >
            Giãn cách (giây):
          </label>
          <input
            type="number"
            id="numInteractionDelay"
            min={2}
            max={120}
            className="interaction-number"
            value={delayInput}
            onChange={(e) => onDelayInputChange(e.target.value)}
            onBlur={() => {
              if (delayInput.trim() === '') return;
              const parsed = parseInt(delayInput, 10);
              const clamped = Number.isNaN(parsed) ? 5 : Math.max(2, Math.min(120, parsed));
              onDelayInputChange(String(clamped));
            }}
          />
        </div>
      </section>

      {/* Messenger Auto Share */}
      <section className="section card messenger-card">
        <div className="toggle-row">
          <div>
            <strong className="toggle-title">💬 Tự động dán vào nhóm Messenger</strong>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              id="chkAutoShareMessenger"
              checked={settings.autoShareMessenger}
              onChange={(e) => onUpdateSettings({ autoShareMessenger: e.target.checked })}
            />
            <span className="slider" />
          </label>
        </div>

        <div id="messengerSettingsPanel" style={{ marginTop: 10 }}>
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 3,
                }}
              >
                <label
                  htmlFor="txtMessengerGroupName"
                  style={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}
                >
                  📌 Tên nhóm Messenger nhận bài:
                </label>
              </div>
              <input
                type="text"
                id="txtMessengerGroupName"
                className="input-text-full"
                placeholder="Ví dụ: Tên người nhận, biệt danh và tên nhóm"
                value={settings.messengerTargetName}
                onChange={(e) =>
                  onUpdateSettings({ messengerTargetName: e.target.value })
                }
              />
              <p className="field-hint">
                💡 Nếu bạn <strong>mở sẵn ô chat ở góc dưới màn hình</strong>, Extension sẽ{' '}
                <strong>tự nhận diện ô chat và gửi thẳng vào ô chat đó</strong>
              </p>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label
                htmlFor="txtMessengerCustomMsg"
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: '#1e293b',
                  marginBottom: 4,
                  display: 'block',
                }}
              >
                ✍️ Lời nhắn gửi kèm link:
              </label>
              <input
                type="text"
                id="txtMessengerCustomMsg"
                className="input-text-full"
                placeholder="Ví dụ: Khách mới có SĐT, các bạn vào hỗ trợ nhé!"
                value={settings.messengerCustomMsg}
                onChange={(e) =>
                  onUpdateSettings({ messengerCustomMsg: e.target.value })
                }
              />
            </div>

            <label
              className="checkbox-label"
              title="Chỉ tự động dán và gửi những bài viết có trích xuất được Số điện thoại"
            >
              <input
                type="checkbox"
                id="chkShareOnlyLeads"
                checked={settings.shareOnlyLeads}
                onChange={(e) => onUpdateSettings({ shareOnlyLeads: e.target.checked })}
              />
              <span>
                <strong>Chỉ dán bài có SĐT</strong>
              </span>
            </label>
          </div>
      </section>
    </div>
  );
}
