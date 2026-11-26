'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmModal } from '@/components/ConfirmModal';
import { FiltersTab } from '@/components/FiltersTab';
import { InteractTab } from '@/components/InteractTab';
import { LeadsTab } from '@/components/LeadsTab';
import {
  getActiveTab,
  hasChromeExtensionApi,
  openNewTab,
  sendActiveTabMessage,
  storageGet,
  storageSet,
} from '@/lib/chrome';
import {
  DEFAULT_SETTINGS,
  type CapturedLead,
  type ExtensionSettings,
  type TabStatsResponse,
} from '@/types/extension';

type TabKey = 'tab-interact' | 'tab-leads' | 'tab-filters';

export default function PopupPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('tab-interact');
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [leads, setLeads] = useState<CapturedLead[]>([]);
  const [detectedCount, setDetectedCount] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [likedCount, setLikedCount] = useState(0);
  const [commentedCount, setCommentedCount] = useState(0);
  const [interactionDiagnostic, setInteractionDiagnostic] = useState('');
  const [delayInput, setDelayInput] = useState<string>(String(DEFAULT_SETTINGS.interactionDelay));
  const [showDelayModal, setShowDelayModal] = useState(false);

  const settingsRef = useRef<ExtensionSettings>(DEFAULT_SETTINGS);
  settingsRef.current = settings;

  const applyTabStats = useCallback((res?: TabStatsResponse) => {
    if (!res) return;
    if (typeof res.count === 'number') setDetectedCount(res.count);
    if (typeof res.isScrolling === 'boolean') setIsScrolling(res.isScrolling);
    if (typeof res.isInteracting === 'boolean') setIsInteracting(res.isInteracting);
    if (typeof res.likedCount === 'number') {
      setLikedCount(res.likedCount);
    } else if (typeof res.interactionCount === 'number') {
      setLikedCount(res.interactionCount);
    }
    if (typeof res.commentedCount === 'number') setCommentedCount(res.commentedCount);
    if (typeof res.interactionDiagnostic === 'string') {
      setInteractionDiagnostic(res.interactionDiagnostic);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const data = await storageGet({
        ...DEFAULT_SETTINGS,
        capturedLeads: [] as CapturedLead[],
      });
      if (!mounted) return;

      const commentTemplate = data.commentTemplate || '';
      const commentTemplates = commentTemplate
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const loaded: ExtensionSettings = {
        enabled: data.enabled !== false,
        showScroller: data.showScroller !== false,
        pauseOnSpam: Boolean(data.pauseOnSpam),
        detectLinks: data.detectLinks !== false,
        detectPhones: data.detectPhones !== false,
        speed: data.speed || 2,
        keywords: Array.isArray(data.keywords) ? data.keywords : DEFAULT_SETTINGS.keywords,
        autoInteractEnabled: Boolean(data.autoInteractEnabled),
        autoExpandSeeMore: data.autoExpandSeeMore !== false,
        skipAlreadyLiked: data.skipAlreadyLiked !== false,
        autoStopOnFbWarning: data.autoStopOnFbWarning !== false,
        autoShareMessenger: data.autoShareMessenger !== false,
        messengerTargetName: data.messengerTargetName || '',
        messengerCustomMsg: data.messengerCustomMsg || '',
        shareOnlyLeads: Boolean(data.shareOnlyLeads),
        commentTemplate,
        commentTemplates,
        commentMode: data.commentMode === 'roundrobin' ? 'roundrobin' : 'random',
        interactionDelay: data.interactionDelay || 5,
        interactionLimit: data.interactionLimit || 10,
      };
      setSettings(loaded);
      setDelayInput(String(loaded.interactionDelay));
      setLeads(Array.isArray(data.capturedLeads) ? data.capturedLeads : []);

      const stats = await sendActiveTabMessage({ action: 'GET_STATS' });
      if (mounted) applyTabStats(stats);
    })();

    const interval = setInterval(async () => {
      const stats = await sendActiveTabMessage({ action: 'GET_STATS' });
      applyTabStats(stats);
    }, 1500);

    const handleStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area === 'local' && changes.capturedLeads) {
        setLeads((changes.capturedLeads.newValue as CapturedLead[]) || []);
      }
    };

    if (hasChromeExtensionApi() && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChanged);
    }

    return () => {
      mounted = false;
      clearInterval(interval);
      if (hasChromeExtensionApi() && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleStorageChanged);
      }
    };
  }, [applyTabStats]);

  const persistAndNotify = useCallback(
    async (nextSettings: ExtensionSettings, forceRescan = false) => {
      await storageSet(nextSettings as unknown as Record<string, unknown>);
      const res = await sendActiveTabMessage({
        action: forceRescan ? 'RESCAN' : 'SETTINGS_UPDATED',
        settings: nextSettings,
      });
      applyTabStats(res);
    },
    [applyTabStats]
  );

  const handleUpdateSettings = useCallback(
    (patch: Partial<ExtensionSettings>) => {
      const next = { ...settingsRef.current, ...patch };
      setSettings(next);
      void persistAndNotify(next);
    },
    [persistAndNotify]
  );

  const handleDelayInputChange = useCallback(
    (val: string) => {
      if (val.trim() === '') {
        setDelayInput('');
        return;
      }
      if (val === '0') {
        setDelayInput('2');
        const next = { ...settingsRef.current, interactionDelay: 2 };
        setSettings(next);
        void persistAndNotify(next);
        return;
      }
      setDelayInput(val);
      const parsed = parseInt(val, 10);
      if (!Number.isNaN(parsed) && parsed >= 2) {
        const clamped = Math.min(120, parsed);
        const next = { ...settingsRef.current, interactionDelay: clamped };
        setSettings(next);
        void persistAndNotify(next);
      }
    },
    [persistAndNotify]
  );

  const handleToggleScroll = useCallback(async () => {
    const hasComments = settingsRef.current.commentTemplate.trim().length > 0;
    const parsedDelay = parseInt(delayInput, 10);
    const isEmptyWithComments = hasComments && delayInput.trim() === '';
    const isBelowMin =
      delayInput.trim() !== '' && (Number.isNaN(parsedDelay) || parsedDelay < 2);
    if (!isScrolling && (isEmptyWithComments || isBelowMin)) {
      setShowDelayModal(true);
      return;
    }

    const tab = await getActiveTab();
    if (hasChromeExtensionApi() && (!tab?.url || !tab.url.includes('facebook.com'))) {
      alert('Vui lòng mở một tab Facebook để sử dụng tính năng tự lướt!');
      return;
    }
    await storageSet(settingsRef.current as unknown as Record<string, unknown>);
    const res = await sendActiveTabMessage({
      action: 'TOGGLE_SCROLL',
      settings: settingsRef.current,
    });
    applyTabStats(res);
  }, [applyTabStats, delayInput, isScrolling]);

  const handleSetSpeed = useCallback(
    async (speed: number) => {
      const next = { ...settingsRef.current, speed };
      setSettings(next);
      await storageSet(next as unknown as Record<string, unknown>);
      await sendActiveTabMessage({ action: 'SETTINGS_UPDATED', settings: next });
      await sendActiveTabMessage({ action: 'SET_SPEED', speed });
    },
    []
  );

  const handleToggleAutoInteract = useCallback(
    async (checked: boolean) => {
      const next = { ...settingsRef.current, autoInteractEnabled: checked };
      setSettings(next);
      await persistAndNotify(next);
      if (!checked) {
        const res = await sendActiveTabMessage({ action: 'STOP_INTERACT' });
        applyTabStats(res);
      }
    },
    [applyTabStats, persistAndNotify]
  );

  const handleClearLeads = useCallback(async () => {
    setLeads([]);
    await storageSet({ capturedLeads: [] });
  }, []);

  const handleRescan = useCallback(() => {
    void persistAndNotify(settingsRef.current, true);
  }, [persistAndNotify]);

  const handleOpenLatestGroup = useCallback(async () => {
    const res = await sendActiveTabMessage({ action: 'GET_LATEST_GROUP' });
    const targetUrl =
      res?.groupUrl || 'https://www.facebook.com/groups/feed/?sorting_setting=CHRONOLOGICAL';
    openNewTab(targetUrl);
  }, []);

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon48.png" alt="Logo" className="logo" />
          <div>
            <h2>Spam Sentinel Pro</h2>
            <span className="subtext">Trợ lý Tương tác &amp; Lọc bài Facebook</span>
          </div>
        </div>
        <span className="badge-version">v1.8.3</span>
      </header>

      {/* Navigation Tabs */}
      <nav className="tabs-nav">
        <button
          className={`tab-btn ${activeTab === 'tab-interact' ? 'active' : ''}`}
          onClick={() => setActiveTab('tab-interact')}
        >
          ⚡ Tương tác &amp; Lướt
        </button>
        <button
          className={`tab-btn ${activeTab === 'tab-leads' ? 'active' : ''}`}
          onClick={() => setActiveTab('tab-leads')}
        >
          📞 Số ĐT &amp; Yêu cầu (<span id="leadsBadgeCount">{leads.length}</span>)
        </button>
        <button
          className={`tab-btn ${activeTab === 'tab-filters' ? 'active' : ''}`}
          onClick={() => setActiveTab('tab-filters')}
        >
          🛡️ Bộ lọc Spam
        </button>
      </nav>

      {activeTab === 'tab-interact' && (
        <InteractTab
          settings={settings}
          isScrolling={isScrolling}
          isInteracting={isInteracting}
          likedCount={likedCount}
          commentedCount={commentedCount}
          interactionDiagnostic={interactionDiagnostic}
          delayInput={delayInput}
          onDelayInputChange={handleDelayInputChange}
          onUpdateSettings={handleUpdateSettings}
          onToggleScroll={handleToggleScroll}
          onSetSpeed={handleSetSpeed}
          onToggleAutoInteract={handleToggleAutoInteract}
        />
      )}

      {activeTab === 'tab-leads' && (
        <LeadsTab leads={leads} onClearLeads={handleClearLeads} />
      )}

      {activeTab === 'tab-filters' && (
        <FiltersTab
          settings={settings}
          detectedCount={detectedCount}
          onUpdateSettings={handleUpdateSettings}
          onRescan={handleRescan}
        />
      )}

      {/* Quick Navigation */}
      <section className="section quick-nav" style={{ marginTop: 10 }}>
        <button
          id="btnOpenGroups"
          className="btn btn-outline"
          onClick={() => void handleOpenLatestGroup()}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          Bảng tin Nhóm
        </button>
        <button
          id="btnOpenModeration"
          className="btn btn-outline"
          onClick={() => openNewTab('https://www.facebook.com/groups/joins/')}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          Quản lý Nhóm
        </button>
      </section>

      {/* Safety Notice */}
      <footer className="footer">
        <div className="notice">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>
            <strong>Tự động an toàn:</strong> Tự giãn cách theo giây, chống lặp bài, tự phát hiện
            cảnh báo FB để bảo vệ tài khoản tối đa.
          </span>
        </div>
      </footer>

      <ConfirmModal
        open={showDelayModal}
        title="Thiếu thời gian giãn cách"
        message="Mời bạn điền thời gian giãn cách (tối thiểu 2 giây)"
        confirmLabel="Ok, ngay"
        cancelLabel="Từ chối"
        danger={false}
        onCancel={() => setShowDelayModal(false)}
        onConfirm={() => {
          setShowDelayModal(false);
          setTimeout(() => {
            const el = document.getElementById('numInteractionDelay') as HTMLInputElement | null;
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.focus();
            }
          }, 50);
        }}
      />
    </div>
  );
}
