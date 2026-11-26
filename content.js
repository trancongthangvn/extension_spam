(() => {
  'use strict';

  let config = {
    enabled: true,
    showScroller: true,
    pauseOnSpam: false,
    detectLinks: true,
    detectPhones: true,
    keywords: [],
    autoInteractEnabled: true,
    autoExpandSeeMore: true,
    skipAlreadyLiked: true,
    autoStopOnFbWarning: true,
    autoShareMessenger: false,
    commentTemplate: 'xin chào bạn\nbài viết hữu ích quá ạ\ncho mình xin thêm thông tin với nhé',
    commentTemplates: [],
    commentMode: 'random',
    interactionDelay: 5,
    interactionLimit: 10
  };

  const SUSPICIOUS_DOMAINS_REGEX = /(t\.me|telegram\.me|zalo\.me|bit\.ly|tinyurl\.com|shorturl\.at|cutt\.ly|linktr\.ee|kubet|thabet|nohu|sunwin|go88|cho\s*vay|tài\s*xỉu)/i;
  const VN_PHONE_REGEX = /(?:\+84|0)(?:3[2-9]|5[2|6|8|9]|7[0|6-9]|8[1-9]|9[0-9])[\s\.\-]?[0-9]{3}[\s\.\-]?[0-9]{4}\b/g;

  let flaggedElements = new Set();
  let scannedElements = new WeakSet();
  let leadExtractedCards = new WeakMap();
  let scanTimeout = null;

  // Auto-scroll states
  let isScrolling = false;
  let scrollAnimId = null;
  let scrollSpeedLevel = 2;
  const SPEEDS = { 1: 2.5, 2: 5.0, 3: 9.0 };
  let scrollFrameCounter = 0;
  let holdForPendingPost = false;
  let holdStartedAt = 0;

  // Automatic Like/Comment states
  let isInteracting = false;
  let isInteractingBusy = false;
  let interactionTimer = null;
  let interactionCount = 0;
  let commentCount = 0;
  let processedInteractionCards = new WeakSet();
  const commentedCards = new WeakSet();
  const commentedPostKeys = new Set();
  let interactionDiagnostic = 'Chưa quét bài';
  let commentSeqIndex = 0;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function isContextValid() {
    try {
      return typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  // Universal text normalizer: NFC + removes zero-width spaces & non-breaking spaces
  function normalizeText(str) {
    if (!str) return '';
    return str
      .normalize('NFC')
      .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  }

  // ========================================================
  // 1. SAFETY SENTINEL: FACEBOOK WARNING / BLOCK DETECTION
  // ========================================================
  function checkFacebookWarningModal() {
    const warningKeywords = [
      'bạn tạm thời bị chặn',
      "you're temporarily blocked",
      'hành động này bị hạn chế',
      'this action is restricted',
      'tài khoản của bạn đã bị hạn chế',
      'chúng tôi giới hạn tần suất',
      'we limit how often',
      'vui lòng thử lại sau',
      'please try again later'
    ];

    const modals = document.querySelectorAll('[role="dialog"], [role="alertdialog"], div[aria-modal="true"]');
    for (const m of modals) {
      if (m.closest('.fb-spam-scroll-widget, .fb-spam-toast, .fb-spam-emergency-banner')) continue;
      if (m.offsetParent === null && m.getClientRects().length === 0) continue;
      const text = normalizeText(m.textContent || '');
      for (const kw of warningKeywords) {
        if (text.includes(kw)) {
          return { detected: true, reason: kw, text: text.slice(0, 160) };
        }
      }
    }
    return { detected: false };
  }

  function handleFacebookBlockWarning(reason) {
    stopScrolling();
    stopInteraction();
    interactionDiagnostic = `🚨 PHÁT HIỆN CẢNH BÁO FB (${reason}) - ĐÃ TỰ ĐỘNG TẠM DỪNG`;
    showEmergencyBanner(`🚨 PHÁT HIỆN CẢNH BÁO TỪ FACEBOOK (${reason})! Đã tự động tạm dừng toàn bộ để bảo vệ tài khoản.`);
    console.warn('[FB Sentinel] 🚨 ĐÃ PHÁT HIỆN CẢNH BÁO FACEBOOK:', reason);
  }

  function showEmergencyBanner(text) {
    const existing = document.querySelector('.fb-spam-emergency-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.className = 'fb-spam-emergency-banner';
    banner.innerHTML = `<span>⚠️</span> <span>${escapeHtml(text)}</span>`;
    (document.body || document.documentElement).appendChild(banner);

    setTimeout(() => {
      if (banner && banner.parentNode) banner.remove();
    }, 12000);
  }

  // Periodic safety check for FB warnings
  setInterval(() => {
    if (!isContextValid()) {
      stopScrolling();
      stopInteraction();
      return;
    }
    if (isInteracting || isScrolling) {
      const check = checkFacebookWarningModal();
      if (check.detected && config.autoStopOnFbWarning) {
        handleFacebookBlockWarning(check.reason);
      }
    }
  }, 1500);

  // ========================================================
  // 2. INITIALIZE CONFIGURATION & STORAGE LISTENERS
  // ========================================================
  chrome.storage.local.get({
    enabled: true,
    showScroller: true,
    pauseOnSpam: false,
    detectLinks: true,
    detectPhones: true,
    keywords: [
      't.me/',
      'zalo.me/',
      'telegram',
      'inbox nhận kèo',
      'kiếm tiền online',
      'cho vay',
      'tài xỉu',
      'cờ bạc',
      'kéo vốn',
      'việc nhẹ lương cao',
      'tuyển ctv hoa hồng',
      'hoa hồng ngày',
      'bắn cá'
    ],
    autoInteractEnabled: true,
    autoExpandSeeMore: true,
    skipAlreadyLiked: true,
    autoStopOnFbWarning: true,
    autoShareMessenger: true,
    messengerTargetName: '',
    messengerCustomMsg: '',
    shareOnlyLeads: false,
    commentTemplate: 'xin chào bạn\nbài viết hữu ích quá ạ\ncho mình xin thêm thông tin với nhé',
    commentTemplates: [],
    commentMode: 'random',
    interactionDelay: 5,
    interactionLimit: 10
  }, (data) => {
    config = { ...config, ...data };
    if (config.enabled) {
      scanDOM();
    }
    setupOrUpdateScrollWidget();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.keywords) config.keywords = changes.keywords.newValue || [];
      if (changes.enabled !== undefined) config.enabled = changes.enabled.newValue;
      if (changes.showScroller !== undefined) config.showScroller = changes.showScroller.newValue;
      if (changes.pauseOnSpam !== undefined) config.pauseOnSpam = changes.pauseOnSpam.newValue;
      if (changes.detectLinks !== undefined) config.detectLinks = changes.detectLinks.newValue;
      if (changes.detectPhones !== undefined) config.detectPhones = changes.detectPhones.newValue;
      if (changes.autoInteractEnabled !== undefined) config.autoInteractEnabled = changes.autoInteractEnabled.newValue;
      if (changes.autoExpandSeeMore !== undefined) config.autoExpandSeeMore = changes.autoExpandSeeMore.newValue;
      if (changes.skipAlreadyLiked !== undefined) config.skipAlreadyLiked = changes.skipAlreadyLiked.newValue;
      if (changes.autoStopOnFbWarning !== undefined) config.autoStopOnFbWarning = changes.autoStopOnFbWarning.newValue;
      if (changes.autoShareMessenger !== undefined) config.autoShareMessenger = changes.autoShareMessenger.newValue;
      if (changes.messengerTargetName !== undefined) config.messengerTargetName = changes.messengerTargetName.newValue || '';
      if (changes.messengerCustomMsg !== undefined) config.messengerCustomMsg = changes.messengerCustomMsg.newValue || '';
      if (changes.shareOnlyLeads !== undefined) config.shareOnlyLeads = Boolean(changes.shareOnlyLeads.newValue);
      if (changes.commentTemplate !== undefined) config.commentTemplate = changes.commentTemplate.newValue || '';
      if (changes.commentTemplates !== undefined) config.commentTemplates = changes.commentTemplates.newValue || [];
      if (changes.commentMode !== undefined) config.commentMode = changes.commentMode.newValue || 'random';
      if (changes.interactionDelay !== undefined) config.interactionDelay = changes.interactionDelay.newValue || 5;
      if (changes.interactionLimit !== undefined) config.interactionLimit = changes.interactionLimit.newValue || 10;
      rescanAll();
      setupOrUpdateScrollWidget();
    }
  });

  // Direct messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SETTINGS_UPDATED') {
      config = { ...config, ...message.settings };
      rescanAll();
      setupOrUpdateScrollWidget();
      sendResponse({ count: flaggedElements.size, isScrolling, isInteracting, interactionCount, likedCount: interactionCount, commentedCount: commentCount, interactionDiagnostic });
    } else if (message.action === 'RESCAN') {
      if (message.settings) config = { ...config, ...message.settings };
      rescanAll();
      setupOrUpdateScrollWidget();
      sendResponse({ count: flaggedElements.size, isScrolling, isInteracting, interactionCount, likedCount: interactionCount, commentedCount: commentCount, interactionDiagnostic });
    } else if (message.action === 'GET_STATS') {
      sendResponse({ count: flaggedElements.size, isScrolling, isInteracting, interactionCount, likedCount: interactionCount, commentedCount: commentCount, interactionDiagnostic });
    } else if (message.action === 'TOGGLE_SCROLL') {
      if (message.settings) config = { ...config, ...message.settings };
      toggleScrolling();
      sendResponse({ isScrolling, isInteracting, interactionCount, likedCount: interactionCount, commentedCount: commentCount, interactionDiagnostic });
    } else if (message.action === 'START_SCROLL') {
      startScrolling();
      sendResponse({ isScrolling: true, isInteracting, interactionCount, likedCount: interactionCount, commentedCount: commentCount, interactionDiagnostic });
    } else if (message.action === 'STOP_SCROLL') {
      stopScrolling();
      sendResponse({ isScrolling: false, isInteracting, interactionCount, likedCount: interactionCount, commentedCount: commentCount, interactionDiagnostic });
    } else if (message.action === 'TOGGLE_INTERACT') {
      if (message.settings) config = { ...config, ...message.settings };
      toggleInteraction();
      sendResponse({ isInteracting, interactionCount, likedCount: interactionCount, commentedCount: commentCount, interactionDiagnostic });
    } else if (message.action === 'START_INTERACT') {
      startInteraction();
      sendResponse({ isInteracting: true, interactionCount, likedCount: interactionCount, commentedCount: commentCount, interactionDiagnostic });
    } else if (message.action === 'STOP_INTERACT') {
      stopInteraction();
      sendResponse({ isInteracting: false, interactionCount, likedCount: interactionCount, commentedCount: commentCount, interactionDiagnostic });
    } else if (message.action === 'SET_SPEED') {
      if (message.speed) {
        scrollSpeedLevel = message.speed;
        updateSpeedUI();
      }
      sendResponse({ speed: scrollSpeedLevel });
    } else if (message.action === 'GET_LATEST_GROUP') {
      sendResponse({ groupUrl: findNewestGroupUrl() });
    }
    return true;
  });

  // Debounced scan scheduler
  function scheduleScan() {
    if (!isContextValid()) return;
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      if (config.enabled && isContextValid()) {
        scanDOM();
      }
    }, 500);
  }

  // Mutation observer for infinite scrolling / dynamic FB updates
  const observer = new MutationObserver((mutations) => {
    if (!config.enabled) return;
    let hasAdditions = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        const t = m.target && m.target.nodeType === 1 ? m.target : m.target?.parentElement;
        if (t && t.closest && t.closest('.fb-spam-scroll-widget, .fb-spam-toast, .fb-spam-alert-badge, .fb-spam-emergency-banner')) {
          continue;
        }
        hasAdditions = true;
        break;
      }
    }
    if (hasAdditions) {
      scheduleScan();
    }
  });

  const observeTarget = document.body || document.documentElement;
  if (observeTarget) {
    observer.observe(observeTarget, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // ========================================================
  // 3. EXPAND "XEM THÊM" (FEATURE 7: EXPAND HIDDEN CONTENT)
  // ========================================================
  function expandSeeMore(card) {
    if (!card || card === document.body) return false;
    try {
      if (card.closest && card.closest('footer, [role="contentinfo"], nav, [data-pagelet*="Chat"]')) return false;

      const candidateButtons = card.querySelectorAll('[role="button"]');
      for (const el of candidateButtons) {
        if (el.offsetParent === null && el.getClientRects().length === 0) continue;
        if (el.closest('footer, [role="contentinfo"], [data-pagelet*="Chat"], .fb-spam-scroll-widget, .fb-spam-alert-badge')) continue;

        const text = normalizeText(el.textContent || '');
        if (/^(xem thêm|see more)$/i.test(text)) {
          const parentText = normalizeText(el.parentElement?.textContent || '').toLowerCase();
          if (/quyền riêng tư|điều khoản|cookie|meta ©|lựa chọn quảng cáo|trợ giúp/i.test(parentText)) continue;

          // Keep scroll position stable if element is above viewport
          const beforeY = window.scrollY || document.documentElement.scrollTop || 0;
          el.focus?.({ preventScroll: true });
          el.click();
          const afterY = window.scrollY || document.documentElement.scrollTop || 0;
          if (Math.abs(afterY - beforeY) > 10) {
            window.scrollTo({ top: beforeY, behavior: 'auto' });
          }
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  // ========================================================
  // 4. EXTRACT & SAVE LEADS (FEATURE 3: PHONE & REQUIREMENT)
  // ========================================================
  const CHAT_AND_WIDGET_EXCLUDE_SELECTOR = '.fb-spam-scroll-widget, .fb-spam-alert-badge, .fb-spam-toast, [data-pagelet*="Chat"], [data-pagelet*="MWChat"], [aria-label*="Đoạn chat" i], [aria-label*="Messenger" i], [aria-label*="Tin nhắn" i], [role="region"][aria-label*="Chat" i], [role="complementary"]';

  function isInsideChatOrWidget(el) {
    if (!el || !el.closest) return false;
    if (el.closest(CHAT_AND_WIDGET_EXCLUDE_SELECTOR)) return true;
    // Also exclude floating chat dock in bottom-right corner outside main feed
    if (!el.closest('[role="feed"], [role="main"]')) {
      const rect = el.getBoundingClientRect?.();
      if (rect && rect.left > window.innerWidth - 440 && rect.bottom > window.innerHeight - 520) {
        return true;
      }
    }
    return false;
  }

  function extractAndSaveLeads(card, likeBtn, skipExpand = false) {
    if (!card || !isContextValid()) return null;
    if (isInsideChatOrWidget(card)) return null;
    if (leadExtractedCards.has(card)) return leadExtractedCards.get(card);
    leadExtractedCards.set(card, null);
    try {
      if (config.autoExpandSeeMore && !skipExpand) {
        expandSeeMore(card);
      }

      // Collect all text from post
      const textEls = card.querySelectorAll('div[dir="auto"], span[dir="auto"], [data-ad-preview="message"], p');
      let fullText = '';
      textEls.forEach(el => {
        if (el.closest('.fb-spam-scroll-widget, .fb-spam-alert-badge')) return;
        const t = (el.innerText || el.textContent || '').trim();
        if (t && !fullText.includes(t)) fullText += ' ' + t;
      });
      fullText = fullText.trim();

      const phones = fullText.match(VN_PHONE_REGEX);
      if (phones && phones.length > 0) {
        leadExtractedCards.set(card, phones);
        const authorEl = card.querySelector('[data-ad-rendering-role="profile_name"], h2 a, h3 a, h4 a, strong a, h2, h3, h4');
        const rawAuthor = authorEl ? (authorEl.innerText || authorEl.textContent || '').split('\n')[0].trim() : '';
        const author = (rawAuthor && !/có thể là hình ảnh/i.test(rawAuthor)) ? rawAuthor : 'Thành viên FB';

        const postUrl = getPostUrlFromCard(card, likeBtn) || window.location.href;

        if (!isContextValid()) return null;
        chrome.storage.local.get({ capturedLeads: [] }, (data) => {
          if (!isContextValid()) return;
          const list = data.capturedLeads || [];
          let hasNewLead = false;

          const normalizePhone = (p) => (p || '').replace(/[\s.\-]/g, '').replace(/^\+84/, '0');
          phones.forEach(p => {
            const clean = normalizePhone(p);
            const exists = list.some(item => normalizePhone(item.phone) === clean);
            if (!exists) {
              list.unshift({
                id: Date.now() + Math.random().toString(36).substring(2, 6),
                phone: p.trim(),
                author: author || 'Thành viên FB',
                content: fullText.slice(0, 300).trim(),
                timestamp: new Date().toLocaleString('vi-VN'),
                url: postUrl
              });
              hasNewLead = true;
            }
          });

          if (hasNewLead) {
            if (list.length > 500) list.length = 500;
            chrome.storage.local.set({ capturedLeads: list });
            showToast(`📞 Đã lưu SĐT: ${phones[0]} (${author})`);
          }
        });
        return phones;
      }
      return null;
    } catch (err) {
      if (!String(err).includes('Extension context invalidated')) {
        console.warn('extractAndSaveLeads error:', err);
      }
      return null;
    }
  }

  // ========================================================
  // 5. CORE SCANNER: SPAM & PHONE DETECTION
  // ========================================================
  function findEnclosingPostCard(startEl) {
    if (!startEl || startEl === document.body) return null;

    let curr = startEl;
    let outermostArticle = null;
    let largestCandidate = null;

    while (curr && curr !== document.body) {
      // Stop before climbing to feed container, main, dialog, or entire body
      if (curr.getAttribute('role') === 'feed' || curr.getAttribute('role') === 'main' || curr.id === 'facebook') {
        break;
      }

      if (curr.parentElement && curr.parentElement.getAttribute('role') === 'feed') {
        return curr;
      }

      if (curr.dataset && curr.dataset.pagelet && curr.dataset.pagelet.startsWith('FeedUnit')) {
        return curr;
      }

      if (curr.hasAttribute && curr.hasAttribute('aria-posinset')) {
        return curr;
      }

      if (curr.getAttribute('role') === 'article') {
        outermostArticle = curr;
      }

      if (curr.getAttribute('role') === 'dialog') {
        return outermostArticle || curr;
      }

      // Fallback candidate: single post dimensions
      if (curr.clientHeight >= 150 && curr.clientHeight <= 3500 && curr.clientWidth >= 280) {
        largestCandidate = curr;
      }

      curr = curr.parentElement;
    }

    return outermostArticle || largestCandidate || startEl.closest('div[data-virtualized="false"]') || startEl;
  }

  function scanDOM() {
    if (!config.enabled || !document.body || !isContextValid()) return;

    const keywords = (config.keywords || [])
      .map(k => normalizeText(k))
      .filter(k => k.length > 0);

    const primaryElements = document.querySelectorAll(
      'div[dir="auto"], span[dir="auto"], [data-ad-preview="message"], div[class*="text"], div[class*="Text"], h1, h2, h3, h4, h5, p'
    );

    for (const el of primaryElements) {
      if (scannedElements.has(el)) continue;
      scannedElements.add(el);
      if (isInsideChatOrWidget(el)) continue;

      const raw = el.textContent;
      if (!raw || raw.length < 2) continue;
      const clean = normalizeText(raw);

      // Check keywords
      for (const kw of keywords) {
        if (clean.includes(kw)) {
          triggerHighlight(el, `Từ khóa: "${kw}"`, kw);
          break;
        }
      }

      // Check phone numbers
      if (config.detectPhones) {
        const phoneMatches = raw.match(VN_PHONE_REGEX);
        if (phoneMatches && phoneMatches.length > 0) {
          triggerHighlight(el, `Số điện thoại: ${phoneMatches[0]}`);
          // Also automatically extract and save lead (without expanding off-screen posts)
          const enclosingCard = findEnclosingPostCard(el);
          if (enclosingCard) extractAndSaveLeads(enclosingCard, null, true);
        }
      }
    }

    // Check links
    if (config.detectLinks) {
      const links = document.querySelectorAll('a[href]');
      for (const a of links) {
        if (scannedElements.has(a)) continue;
        scannedElements.add(a);
        if (isInsideChatOrWidget(a)) continue;
        const href = a.href || '';
        if (SUSPICIOUS_DOMAINS_REGEX.test(href)) {
          triggerHighlight(a, 'Chứa link ngoài / Telegram / Zalo / Rút gọn');
        }
      }
    }
  }

  function triggerHighlight(matchedEl, reason, keywordMatched) {
    if (!matchedEl) return;
    const card = findEnclosingPostCard(matchedEl) || matchedEl;

    if (matchedEl.dataset.fbFlagged === 'true' && card.dataset.fbFlagged === 'true') {
      return;
    }

    matchedEl.dataset.fbFlagged = 'true';
    card.dataset.fbFlagged = 'true';
    flaggedElements.add(card);

    // Highlight text (lightweight, no layout-breaking display change)
    matchedEl.style.setProperty('background-color', '#fef08a', 'important');
    matchedEl.style.setProperty('border-left', '4px solid #dc2626', 'important');
    matchedEl.style.setProperty('padding', '2px 6px', 'important');
    matchedEl.style.setProperty('border-radius', '4px', 'important');
    matchedEl.style.setProperty('color', '#991b1b', 'important');
    matchedEl.style.setProperty('font-weight', '700', 'important');

    // Highlight card (lightweight outline, avoid heavy blur shadow repaint)
    card.classList.add('fb-spam-flagged-container');
    card.style.setProperty('outline', '3px solid #dc2626', 'important');
    card.style.setProperty('background-color', 'rgba(254, 226, 226, 0.2)', 'important');

    // Badge
    if (!card.querySelector('.fb-spam-alert-badge')) {
      const badge = createAlertBadge([reason], card, matchedEl);
      if (card.firstChild) {
        card.insertBefore(badge, card.firstChild);
      } else {
        card.appendChild(badge);
      }
    }

    // Auto-stop scrolling if enabled (keep interaction running until user manually stops)
    if (isScrolling && config.pauseOnSpam) {
      stopScrolling();
      showToast(`⚠️ Đã phát hiện: ${reason} - Tự động dừng lướt!`);
      setTimeout(() => {
        const target = card && card.clientHeight < window.innerHeight ? card : matchedEl;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
    }
  }

  function createAlertBadge(reasons, targetCard, matchedEl) {
    const badge = document.createElement('div');
    badge.className = 'fb-spam-alert-badge';

    const header = document.createElement('div');
    header.className = 'fb-spam-badge-header';

    const title = document.createElement('div');
    title.className = 'fb-spam-badge-title';
    title.innerHTML = `<span>⚠️</span> <span>Cảnh báo Nghi vấn Spam / Nick ảo</span>`;

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'fb-spam-badge-dismiss';
    dismissBtn.innerHTML = '&times;';
    dismissBtn.title = 'Bỏ qua cảnh báo bài này';
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      badge.remove();
      targetCard.classList.remove('fb-spam-flagged-container');
      targetCard.style.removeProperty('outline');
      targetCard.style.removeProperty('border');
      targetCard.style.removeProperty('box-shadow');
      matchedEl.style.removeProperty('background-color');
      matchedEl.style.removeProperty('border-left');
      matchedEl.style.removeProperty('padding');
      matchedEl.style.removeProperty('color');
      matchedEl.style.removeProperty('font-weight');
      delete targetCard.dataset.fbFlagged;
      delete matchedEl.dataset.fbFlagged;
      flaggedElements.delete(targetCard);
    });

    header.appendChild(title);
    header.appendChild(dismissBtn);

    const reasonsList = document.createElement('div');
    reasonsList.className = 'fb-spam-badge-reasons';

    const uniqueReasons = [...new Set(reasons)];
    uniqueReasons.forEach((r) => {
      const chip = document.createElement('span');
      chip.className = 'fb-spam-chip';
      chip.textContent = r;
      reasonsList.appendChild(chip);
    });

    badge.appendChild(header);
    badge.appendChild(reasonsList);
    return badge;
  }

  function rescanAll() {
    clearAllFlags();
    scanDOM();
  }

  function clearAllFlags() {
    document.querySelectorAll('.fb-spam-flagged-container').forEach(el => {
      el.classList.remove('fb-spam-flagged-container');
      el.style.removeProperty('outline');
      el.style.removeProperty('border');
      el.style.removeProperty('box-shadow');
      delete el.dataset.fbFlagged;
    });

    document.querySelectorAll('[data-fb-flagged]').forEach(el => {
      el.style.removeProperty('background-color');
      el.style.removeProperty('border-left');
      el.style.removeProperty('padding');
      el.style.removeProperty('color');
      el.style.removeProperty('font-weight');
      delete el.dataset.fbFlagged;
    });

    document.querySelectorAll('.fb-spam-alert-badge').forEach(el => el.remove());
    flaggedElements.clear();
    scannedElements = new WeakSet();
    leadExtractedCards = new WeakMap();
  }

  // ========================================================
  // 6. AUTOMATIC LIKE & COMMENT ENGINE
  // ========================================================

  function hasActiveReactionColor(el) {
    if (!el) return false;
    const targets = [el, ...el.querySelectorAll('span, i, svg')];
    for (const t of targets) {
      try {
        const style = window.getComputedStyle(t);
        for (const prop of [style.color, style.fill]) {
          const m = prop && prop.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (!m) continue;
          const r = parseInt(m[1], 10);
          const g = parseInt(m[2], 10);
          const b = parseInt(m[3], 10);
          // Facebook Like blue (#0866ff / #1877f2 / #2078f4) or Love/Haha/Wow/Angry colors
          if (b - r >= 45 && b >= 160) return true;
          if (r - b >= 50 && r >= 170) return true;
        }
      } catch (_) {}
    }
    return false;
  }

  function isLikeButtonActive(btn) {
    if (!btn) return false;
    const aria = normalizeText(btn.getAttribute('aria-label') || '');
    const text = normalizeText(btn.innerText || btn.textContent || '');
    if (/bỏ thích|gỡ thích|unlike|remove like|gỡ cảm xúc|đã thích|thay đổi cảm xúc|change .*reaction/i.test(aria)) {
      return true;
    }
    if (btn.getAttribute('aria-pressed') === 'true' ||
        Boolean(btn.querySelector('[aria-pressed="true"]')) ||
        Boolean(btn.closest('[aria-pressed="true"]'))) {
      return true;
    }
    if (/^(đã thích|yêu thích|thương thương|haha|wow|buồn|phẫn nộ|liked|love|care|sad|angry)$/i.test(text)) {
      return true;
    }
    if (hasActiveReactionColor(btn)) {
      return true;
    }
    return false;
  }

  function simulateClick(element) {
    if (!element) return false;
    try {
      element.focus?.({ preventScroll: true });

      const btn = element.closest('[role="button"]') || element;
      const rect = btn.getBoundingClientRect();
      const clientX = Math.round(rect.left + rect.width / 2);
      const clientY = Math.round(rect.top + rect.height / 2);
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        buttons: 1,
        clientX,
        clientY
      };

      btn.dispatchEvent(new MouseEvent('mousedown', opts));
      btn.dispatchEvent(new MouseEvent('mouseup', opts));

      if (typeof btn.click === 'function') {
        btn.click();
      } else {
        btn.dispatchEvent(new MouseEvent('click', opts));
      }
      return true;
    } catch (err) {
      console.warn('[FB Sentinel] simulateClick error:', err);
      try {
        element.click();
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  function isPostLikeButton(btn) {
    if (!btn || (btn.offsetParent === null && btn.getClientRects().length === 0)) return false;

    // 1. Must not be in widgets, toasts, badges, chat tabs, or temporary post modals while scrolling
    if (btn.closest('.fb-spam-scroll-widget, .fb-spam-alert-badge, .fb-spam-toast, [data-pagelet*="Chat"], [data-pagelet*="MWChat"], [role="region"][aria-label*="Chat" i], [role="region"][aria-label*="Đoạn chat" i], [role="region"][aria-label*="Messenger" i]')) return false;
    if (isScrolling && btn.closest('div[role="dialog"]')) return false;

    // 2. Must not be already interacted
    if (btn.dataset && btn.dataset.fbInteracted === 'true') return false;

    // 3. Must not be a comment action button
    if (btn.closest('[aria-label*="Bình luận về" i], [aria-label*="Comment by" i], [aria-label*="Danh sách bình luận" i]')) return false;
    const ulParent = btn.closest('ul');
    if (ulParent && ulParent.closest('[role="article"]')) return false;

    // 4. Post Like buttons are action buttons (including compact icon+count buttons)
    const rect = btn.getBoundingClientRect();
    if (rect.height < 18 || rect.width < 20) {
      return false;
    }

    // 5. Must not be a reaction counter link or Create Post composer button ("Cảm xúc/hoạt động")
    const rawAria = btn.getAttribute('aria-label') || btn.querySelector('[aria-label]')?.getAttribute('aria-label') || '';
    const aria = normalizeText(rawAria).toLowerCase();
    const text = normalizeText(btn.innerText || btn.textContent || '').toLowerCase();
    if (/người|people|others|xem ai|danh sách|bình luận|comment|phản hồi|reply|hoạt động|activity|ảnh\/video|photo\/video|trực tiếp|live video|bạn đang nghĩ gì|tạo bài viết/i.test(aria)) return false;

    const hasExplicitLikeAria = /^(thích|like|bỏ thích|gỡ thích|unlike)$/i.test(aria) ||
                                /^(bày tỏ cảm xúc|thả cảm xúc|react\b|thích\b|like\b)/i.test(aria);
    if (!hasExplicitLikeAria && /^\d+/.test(text)) return false;

    // 6. Check Like semantics
    const isLike = hasExplicitLikeAria || /^(thích|like)$/i.test(text);

    return isLike;
  }

  const LIKE_BUTTON_SELECTORS = [
    '[role="button"][aria-label="Thích" i]',
    '[role="button"][aria-label="Like" i]',
    '[role="button"][aria-label="Bỏ thích" i]',
    '[role="button"][aria-label="Unlike" i]',
    '[role="button"][aria-label^="Bày tỏ cảm xúc" i]',
    '[role="button"][aria-label^="Thả cảm xúc" i]',
    '[role="button"][aria-label^="React" i]',
    '[role="button"][aria-label^="Thích" i]',
    '[role="button"]:has([aria-label="Thích" i])',
    '[role="button"]:has([aria-label="Like" i])',
    '[role="button"]:has([aria-label^="Bày tỏ cảm xúc" i])',
    'button[aria-label*="Thích" i]',
    'button[aria-label*="Like" i]',
    '[role="button"][data-testid="UFIReactorLink"]',
    '[role="button"][data-testid*="LikeButton"]'
  ].join(', ');

  function getAllPostLikeButtons() {
    const results = [];
    const seen = new Set();

    const specificButtons = document.querySelectorAll(LIKE_BUTTON_SELECTORS);
    for (const btn of specificButtons) {
      if (seen.has(btn)) continue;
      if (isPostLikeButton(btn)) {
        seen.add(btn);
        results.push(btn);
      }
    }

    // Also scan inside visible feed post cards so no post with unusual button markup is ever skipped
    const feedCards = document.querySelectorAll('[role="feed"] > div, [aria-posinset], div[data-pagelet^="FeedUnit"]');
    for (const card of feedCards) {
      const cardRect = card.getBoundingClientRect();
      if (cardRect.bottom < -300 || cardRect.top > window.innerHeight + 300) continue;
      const cardBtns = card.querySelectorAll('[role="button"], button');
      for (const btn of cardBtns) {
        if (seen.has(btn)) continue;
        if (isPostLikeButton(btn)) {
          seen.add(btn);
          results.push(btn);
          break;
        }
      }
    }

    // Broad fallback only if specific selectors matched nothing
    if (results.length === 0) {
      const allButtons = document.querySelectorAll('[role="button"], button');
      for (const btn of allButtons) {
        if (seen.has(btn)) continue;
        if (isPostLikeButton(btn)) {
          seen.add(btn);
          results.push(btn);
        }
      }
    }

    return results.sort((a, b) => {
      const topA = a.getBoundingClientRect().top + (window.scrollY || document.documentElement.scrollTop || 0);
      const topB = b.getBoundingClientRect().top + (window.scrollY || document.documentElement.scrollTop || 0);
      return topA - topB;
    });
  }

  function isSinglePostCard(card, likeBtn) {
    if (!card || card === likeBtn || card === document.body) return false;
    const isArticle = card.getAttribute('role') === 'article';
    const isFeedUnit = Boolean(card.dataset && card.dataset.pagelet && card.dataset.pagelet.startsWith('FeedUnit'));
    if (!isArticle && !isFeedUnit) return false;

    // Ensure this card does not wrap multiple distinct post Like buttons
    const nestedLikes = card.querySelectorAll('div[aria-label="Thích" i][role="button"], div[aria-label="Like" i][role="button"], div[aria-label="Bỏ thích" i][role="button"], div[aria-label="Unlike" i][role="button"]');
    let postLikeCount = 0;
    for (const b of nestedLikes) {
      if (isPostLikeButton(b) || (b.dataset && b.dataset.fbInteracted === 'true')) {
        postLikeCount++;
        if (postLikeCount > 1) return false;
      }
    }
    return true;
  }

  function hasPendingVisibleLikeButton() {
    if (!isInteracting) return false;
    const likeButtons = document.querySelectorAll(LIKE_BUTTON_SELECTORS);
    for (const btn of likeButtons) {
      if (!isPostLikeButton(btn)) continue;
      if (processedInteractionCards.has(btn)) continue;
      const card = getPostCardFromLikeButton(btn);
      const trackCard = isSinglePostCard(card, btn);
      if (trackCard && ((card.dataset && card.dataset.fbInteracted === 'true') || processedInteractionCards.has(card))) continue;
      const rect = btn.getBoundingClientRect();
      if (rect.bottom >= -100 && rect.top <= window.innerHeight + 60) {
        return true;
      }
    }
    return false;
  }

  function getPostCardFromLikeButton(likeBtn) {
    if (!likeBtn) return null;
    return likeBtn.closest('[role="article"]') ||
           likeBtn.closest('div[data-pagelet^="FeedUnit"]') ||
           findEnclosingPostCard(likeBtn);
  }

  function getCommentButtonFromLikeButton(likeBtn, card) {
    if (!likeBtn) return null;

    let parent = likeBtn.parentElement;
    for (let depth = 0; depth < 4 && parent; depth++) {
      const buttons = [...parent.querySelectorAll('[role="button"], button')];
      for (const btn of buttons) {
        if (btn === likeBtn) continue;
        const rawAria = btn.getAttribute('aria-label') || btn.querySelector('[aria-label]')?.getAttribute('aria-label') || '';
        const aria = normalizeText(rawAria);
        const text = normalizeText(btn.innerText || btn.textContent || '');
        if (/^(bình luận|comment|viết bình luận|leave a comment)/i.test(aria) ||
            /\d+\s*(bình luận|comment)/i.test(aria) ||
            /^(bình luận|comment)$/i.test(text)) {
          return btn;
        }
      }
      // In compact [👍] [💬] [↗] action bars (2-4 buttons on one row), the button right next to Like is Comment
      const parentRect = parent.getBoundingClientRect();
      if (parentRect.height > 18 && parentRect.height <= 64 && buttons.length >= 2 && buttons.length <= 4) {
        const likeIdx = buttons.indexOf(likeBtn);
        if (likeIdx >= 0 && likeIdx + 1 < buttons.length) {
          const nextBtn = buttons[likeIdx + 1];
          const nextAria = normalizeText(nextBtn.getAttribute('aria-label') || '');
          if (!/chia sẻ|share|cảm xúc/i.test(nextAria)) {
            return nextBtn;
          }
        }
      }
      parent = parent.parentElement;
    }

    if (card) {
      const cardButtons = card.querySelectorAll('[role="button"], button');
      for (const btn of cardButtons) {
        if (btn === likeBtn) continue;
        if (btn.closest('ul, [aria-label*="Bình luận về" i], [aria-label*="Comment by" i]')) continue;
        const rawAria = btn.getAttribute('aria-label') || btn.querySelector('[aria-label]')?.getAttribute('aria-label') || '';
        const aria = normalizeText(rawAria);
        const text = normalizeText(btn.innerText || btn.textContent || '');
        if (/xem thêm|phù hợp nhất/i.test(text) || /trả lời/i.test(text)) continue;

        if (/^(bình luận|comment|viết bình luận|leave a comment)/i.test(aria) ||
            /\d+\s*(bình luận|comment)/i.test(aria) ||
            /^(bình luận|comment)$/i.test(text)) {
          return btn;
        }
      }
    }

    return null;
  }

  function isShareButtonElement(btn, likeBtn) {
    if (!btn || btn === likeBtn) return false;
    if (btn.closest('ul, [aria-label*="Bình luận về" i], [aria-label*="Comment by" i], .fb-spam-scroll-widget, .fb-spam-alert-badge')) return false;

    const aria = normalizeText(btn.getAttribute('aria-label') || '').toLowerCase();
    const text = normalizeText(btn.innerText || btn.textContent || '').toLowerCase();

    // Must not be like or comment
    if (/bình luận|comment|thích|like|bỏ thích|unlike/i.test(aria)) return false;
    if (/^(thích|like|bình luận|comment)$/i.test(text)) return false;
    if (/\d+\s*(lượt|chia sẻ|share)/i.test(aria) || /\d+\s*(lượt|chia sẻ|share)/i.test(text)) return false;

    // Check share indicators
    if (/chia sẻ|share|gửi bài viết|send this to|chia sẻ bài viết/i.test(aria)) return true;
    if (/^(chia sẻ|share)$/i.test(text)) return true;
    return false;
  }

  function getShareButton(likeBtn, card) {
    if (likeBtn) {
      let parent = likeBtn.parentElement;
      for (let depth = 0; depth < 5 && parent; depth++) {
        const buttons = parent.querySelectorAll('[role="button"], button');
        for (const btn of buttons) {
          if (isShareButtonElement(btn, likeBtn)) {
            return btn;
          }
        }
        parent = parent.parentElement;
      }
    }

    if (card) {
      const cardButtons = card.querySelectorAll('[role="button"], button');
      for (const btn of cardButtons) {
        if (isShareButtonElement(btn, likeBtn)) {
          return btn;
        }
      }
    }
    return null;
  }

  function findCommentTextbox(card, likeBtn) {
    const searchRoots = [];
    if (card && card !== document.body) searchRoots.push(card);
    if (likeBtn) {
      let p = likeBtn.parentElement;
      for (let depth = 0; depth < 7 && p && p !== document.body; depth++) {
        if (p.getAttribute('role') === 'feed' || p.getAttribute('role') === 'main' || p.id === 'facebook') break;
        if (!searchRoots.includes(p)) searchRoots.push(p);
        p = p.parentElement;
      }
    }
    // Also search any visible post modal dialog opened when clicking "Bình luận"
    const dialogs = document.querySelectorAll('div[role="dialog"]');
    for (const dlg of dialogs) {
      if (dlg.offsetParent === null && dlg.getClientRects().length === 0) continue;
      if (dlg.closest('.fb-spam-scroll-widget, div[data-pagelet*="Chat"], div[aria-label*="Đoạn chat" i], div[aria-label*="Messenger" i]')) continue;
      if (!searchRoots.includes(dlg)) searchRoots.push(dlg);
    }

    const selectors = [
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-lexical-editor="true"]',
      'div[contenteditable="true"][aria-label*="bình luận" i]',
      'div[contenteditable="true"][aria-label*="comment" i]',
      'div[contenteditable="true"][aria-placeholder*="bình luận" i]',
      'div[contenteditable="true"][aria-placeholder*="comment" i]',
      'div[contenteditable="true"][aria-label*="viết" i]',
      'div[contenteditable="true"][aria-label*="write" i]',
      'form textarea'
    ];

    for (const root of searchRoots) {
      if (!root || root === document.body) continue;
      // Do not search inside chat tab containers
      if (root.closest && root.closest('div[data-pagelet*="Chat"], div[data-pagelet*="MWChat"], div[aria-label*="Đoạn chat" i], div[aria-label*="Chat" i], div[aria-label*="Messenger" i]')) continue;

      for (const sel of selectors) {
        const candidates = root.querySelectorAll(sel);
        for (const el of candidates) {
          if (el.offsetParent === null && el.getClientRects().length === 0) continue;

          // CRITICAL: el MUST NOT be inside a Messenger chat dock or scroller widget!
          if (el.closest('div[data-pagelet*="Chat"], div[data-pagelet*="MWChat"], div[role="region"][aria-label*="Đoạn chat" i], div[role="region"][aria-label*="Chat" i], div[role="region"][aria-label*="Messenger" i], div[aria-label*="Đoạn chat" i], .fb-spam-scroll-widget')) {
            continue;
          }

          const label = normalizeText(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '');
          if (/bạn đang nghĩ gì|what's on your mind/i.test(label)) continue;
          if (/^(aa|tin nhắn|message|tìm kiếm|search)$/i.test(label)) continue;

          // If located in bottom-right corner where chat dock lives, skip
          const elRect = el.getBoundingClientRect();
          if (elRect.left > window.innerWidth - 380 && elRect.bottom > window.innerHeight - 350) {
            continue;
          }

          return el;
        }
      }
    }
    return null;
  }

  function waitForCommentTextbox(card, likeBtn, timeoutMs = 3500) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const check = () => {
        const box = findCommentTextbox(card, likeBtn);
        if (box) {
          resolve(box);
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  async function typeCommentIntoEditor(textbox, text) {
    if (!textbox || !text) return false;

    try {
      textbox.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    } catch (_) {}
    await sleep(150);

    // 1. Focus and activate Lexical editor without jumping scroll
    textbox.focus({ preventScroll: true });
    const opts = { bubbles: true, cancelable: true, view: window };
    textbox.dispatchEvent(new MouseEvent('mousedown', opts));
    textbox.dispatchEvent(new MouseEvent('mouseup', opts));
    textbox.dispatchEvent(new MouseEvent('click', opts));
    await sleep(200);

    // 2. Clear existing content
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(textbox);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
    } catch (_) {}
    await sleep(100);

    // 3. Insert text ONCE via native execCommand (browser fires its own beforeinput/input)
    try {
      document.execCommand('insertText', false, text);
    } catch (_) {}
    await sleep(80);

    // 4. Fallback paste event ONLY if text didn't land at all
    const currentText = (textbox.textContent || '').trim();
    if (!currentText) {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        textbox.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        }));
      } catch (_) {}
      await sleep(80);
    }

    await sleep(150);
    return true;
  }

  async function submitComment(textbox, card) {
    if (!textbox || textbox.dataset.fbSubmitted === 'true') return false;
    textbox.dataset.fbSubmitted = 'true';

    const composer = textbox.closest('form') ||
      textbox.closest('[role="presentation"]') ||
      textbox.parentElement?.parentElement?.parentElement ||
      card;

    const submitSelectors = [
      '[aria-label="Nhấn để gửi"][role="button"]',
      '[aria-label="Gửi"][role="button"]',
      '[aria-label*="gửi" i][role="button"]',
      '[aria-label*="send" i][role="button"]',
      'button[type="submit"]',
      '[data-testid="react-composer-post-button"]'
    ];

    let clickedButton = false;
    if (composer) {
      for (const sel of submitSelectors) {
        const btns = composer.querySelectorAll(sel);
        for (const b of btns) {
          if (b === textbox) continue;
          if (b.getAttribute('aria-disabled') === 'true') continue;
          const aria = normalizeText(b.getAttribute('aria-label') || '');
          if (/viết bình luận|leave a comment/i.test(aria)) continue;
          if (b.offsetParent !== null && b.getBoundingClientRect().width > 0) {
            // Single native click() only — avoid mousedown/mouseup double-triggering Facebook Comet Pressable
            b.click();
            clickedButton = true;
            break;
          }
        }
        if (clickedButton) break;
      }
    }

    if (clickedButton) {
      await sleep(250);
      return true;
    }

    // Fallback Enter key sequence ONLY if no Send button was found
    await sleep(120);
    textbox.focus({ preventScroll: true });

    const keyConfig = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey: false,
      ctrlKey: false,
      altKey: false
    };

    textbox.dispatchEvent(new KeyboardEvent('keydown', keyConfig));
    await sleep(60);
    textbox.dispatchEvent(new KeyboardEvent('keyup', keyConfig));

    return true;
  }

  // Feature 1: Multiple comment templates selector
  let lastCommentUsed = '';
  let isExtensionSendingChat = false;
  const chatInteractionTimestamps = new WeakMap();

  function getMessengerChatContainerFromNode(node) {
    if (!node || !node.closest) return null;
    if (node.closest('.fb-spam-scroll-widget, .fb-spam-alert-badge, .fb-spam-toast')) return null;
    return node.closest(
      'div[data-pagelet*="Chat"], div[data-pagelet*="MWChat"], div[role="region"][aria-label*="Đoạn chat" i], div[role="region"][aria-label*="Chat" i], div[role="region"][aria-label*="Messenger" i], div[aria-label*="Đoạn chat" i]'
    );
  }

  function recordUserChatInteraction(e) {
    if (isExtensionSendingChat) return;
    const target = e.target && e.target.nodeType === 1 ? e.target : e.target?.parentElement;
    if (!target) return;
    const container = getMessengerChatContainerFromNode(target);
    if (container) {
      chatInteractionTimestamps.set(container, Date.now());
    }
  }

  document.addEventListener('mousedown', recordUserChatInteraction, true);
  document.addEventListener('focusin', recordUserChatInteraction, true);
  document.addEventListener('keydown', recordUserChatInteraction, true);

  function getNextCommentTemplate() {
    let list = [];
    if (Array.isArray(config.commentTemplates) && config.commentTemplates.length > 0) {
      list = config.commentTemplates.map(s => s.trim()).filter(Boolean);
    }
    if (list.length === 0 && config.commentTemplate) {
      list = config.commentTemplate.split('\n').map(s => s.trim()).filter(Boolean);
    }
    if (list.length === 0) return '';

    let selected = '';
    if (config.commentMode === 'roundrobin') {
      selected = list[commentSeqIndex % list.length];
      commentSeqIndex++;
    } else {
      const candidates = list.filter(item => item !== lastCommentUsed);
      const pool = candidates.length > 0 ? candidates : list;
      const idx = Math.floor(Math.random() * pool.length);
      selected = pool[idx];
    }
    lastCommentUsed = selected;
    return selected;
  }

  // ========================================================
  // FEATURE 4: DIRECT AUTO-PASTE TO MESSENGER CHAT / GROUP
  // ========================================================

  function findActiveMessengerChatBox(preferredName) {
    const allTextboxes = document.querySelectorAll(
      'div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-lexical-editor="true"], div[contenteditable="true"]'
    );

    const candidates = [];

    for (const tb of allTextboxes) {
      if (tb.offsetParent === null) continue;
      const rect = tb.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 15) continue;

      const label = normalizeText(tb.getAttribute('aria-label') || tb.getAttribute('placeholder') || '');

      // Exclude news feed status box and post comment boxes
      if (/bạn đang nghĩ gì|what's on your mind/i.test(label)) continue;
      if (/viết bình luận|write a comment|bình luận công khai/i.test(label)) continue;
      if (tb.closest('[role="article"], div[data-pagelet^="FeedUnit"]')) continue;

      // Check if near bottom right of screen or inside chat container
      const isNearBottom = rect.bottom >= (window.innerHeight - 350);
      const isRightSide = rect.right >= (window.innerWidth / 2);

      const chatContainer = getMessengerChatContainerFromNode(tb) ||
        tb.closest('div[data-pagelet*="Chat"], div[role="region"], div[aria-label*="Đoạn chat" i], div[aria-label*="Chat" i]') ||
        tb.parentElement?.parentElement?.parentElement?.parentElement;

      let containerText = '';
      if (chatContainer) {
        containerText = normalizeText(chatContainer.textContent || '').toLowerCase();
      }

      const isChatPlaceholder = /^(aa|tin nhắn|message|nhập tin nhắn)$/i.test(label) ||
        tb.querySelector('p')?.innerText === 'Aa' ||
        tb.getAttribute('aria-placeholder') === 'Aa' ||
        containerText.includes('đang hoạt động') ||
        containerText.includes('active now') ||
        chatContainer?.querySelector('[aria-label*="Đoạn chat" i], [aria-label*="Chat" i], [aria-label*="Thu nhỏ" i], [aria-label*="Đóng đoạn chat" i]');

      if ((isNearBottom && isRightSide) || isChatPlaceholder) {
        candidates.push({
          textbox: tb,
          container: chatContainer,
          containerText: containerText
        });
      }
    }

    if (candidates.length === 0) return null;

    if (preferredName && preferredName.trim()) {
      const norm = preferredName.trim().toLowerCase();
      for (const cand of candidates) {
        if (cand.containerText && cand.containerText.includes(norm)) {
          return cand;
        }
      }
    }

    // No preferredName: pick the chat box the user interacted with most recently
    let bestCand = null;
    let bestTime = 0;
    for (const cand of candidates) {
      const t = cand.container ? (chatInteractionTimestamps.get(cand.container) || 0) : 0;
      if (t > bestTime) {
        bestTime = t;
        bestCand = cand;
      }
      // Also check if document.activeElement is currently inside this chat box
      if (!bestTime && cand.container && document.activeElement && cand.container.contains(document.activeElement)) {
        bestCand = cand;
      }
    }

    return bestCand || candidates[0];
  }

  function openMinimizedMessengerBubble(preferredName) {
    const bubbles = document.querySelectorAll('[role="button"], div[tabindex="0"]');
    for (const b of bubbles) {
      if (b.offsetParent === null) continue;
      const aria = normalizeText(b.getAttribute('aria-label') || '').toLowerCase();
      const rect = b.getBoundingClientRect();
      if (rect.right >= window.innerWidth - 100 && rect.bottom >= window.innerHeight - 400) {
        if (/đoạn chat|chat with/i.test(aria) || (preferredName && aria.includes(preferredName.toLowerCase()))) {
          simulateClick(b);
          return true;
        }
      }
    }
    return false;
  }

  async function sendToMessengerChatTab(chatBox, messageText) {
    if (!chatBox || !messageText) return false;
    const tb = chatBox.textbox || chatBox;

    isExtensionSendingChat = true;
    try {
      tb.focus({ preventScroll: true });
      tb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      tb.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      tb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      await sleep(120);

      // Clear existing
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(tb);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false, null);
      } catch (_) {}
      await sleep(40);

      // Insert message ONCE via execCommand (fallback to paste only if empty)
      try {
        document.execCommand('insertText', false, messageText);
      } catch (_) {}
      await sleep(80);

      const curVal = (tb.textContent || '').trim();
      if (!curVal) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', messageText);
          tb.dispatchEvent(new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt
          }));
        } catch (_) {}
        await sleep(80);
      }

      await sleep(140);

      // Press Enter key to send
      const keyOpts = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
        shiftKey: false
      };
      tb.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
      tb.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
      await sleep(50);
      tb.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
      await sleep(160);

      // Only click Send button if Enter didn't already clear & send the message
      const remainingVal = (tb.textContent || '').trim();
      if (remainingVal) {
        const container = chatBox.container || tb.parentElement?.parentElement?.parentElement;
        if (container) {
          const sendBtn = container.querySelector(
            '[aria-label*="gửi" i][role="button"], [aria-label*="send" i][role="button"], [aria-label*="Enter" i][role="button"], [data-testid*="send" i]'
          );
          if (sendBtn && sendBtn.offsetParent !== null) {
            simulateClick(sendBtn);
            await sleep(120);
          }
        }
      }

      tb.blur?.();
      showToast('🚀 Đã tự động dán và gửi bài vào nhóm Messenger!');
      return true;
    } catch (err) {
      console.warn('[FB Sentinel] sendToMessengerChatTab error:', err);
      return false;
    } finally {
      isExtensionSendingChat = false;
    }
  }

  function setReactInputValue(inputEl, value) {
    if (!inputEl) return;
    inputEl.focus({ preventScroll: true });
    try {
      const proto = inputEl.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(inputEl, value);
      } else {
        inputEl.value = value;
      }
    } catch (_) {
      inputEl.value = value;
    }
    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findMessengerShareDialog() {
    const dialogs = document.querySelectorAll('div[role="dialog"]');
    for (const d of dialogs) {
      if (d.offsetParent === null && d.getClientRects().length === 0) continue;
      if (d.closest('.fb-spam-scroll-widget')) continue;
      const dText = normalizeText(d.textContent || '');
      const dAria = normalizeText(d.getAttribute('aria-label') || '');
      if (/gửi bằng messenger|send in messenger|gửi trong messenger|tìm kiếm người|search for people|chia sẻ/i.test(dText) ||
          /gửi bằng messenger|send in messenger|gửi trong messenger|chia sẻ/i.test(dAria) ||
          d.querySelector('input[placeholder*="Tìm kiếm" i], input[placeholder*="Search" i]')) {
        return d;
      }
    }
    return null;
  }

  function findExactRecipientRow(dialog, groupName) {
    if (!dialog || !groupName) return null;
    const candidates = dialog.querySelectorAll('[role="listitem"], [role="row"], [role="option"], [role="checkbox"], [role="button"], a[role="link"], div[tabindex="0"], li, label, div');
    let bestRow = null;
    let bestArea = Infinity;

    for (const el of candidates) {
      if (el === dialog) continue;
      if (el.offsetParent === null && el.getClientRects().length === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height < 32 || rect.height > 120 || rect.width < 140) continue;
      const txt = normalizeText(el.textContent || '');
      if (!txt || !txt.includes(groupName)) continue;
      // Avoid matching a button that is literally just "Gửi" or search input container
      if (/^(gửi|send|đóng|close)$/i.test(txt)) continue;
      if (el.querySelector('input[type="search"], input[type="text"]')) continue;

      const area = rect.width * rect.height;
      if (area < bestArea) {
        bestArea = area;
        bestRow = el;
      }
    }
    return bestRow;
  }

  async function openAndSendViaHeaderMessenger(targetName, messageText) {
    const normTarget = normalizeText(targetName);
    if (!normTarget || !messageText) return false;

    const messBtn = document.querySelector(
      '[role="banner"] [role="button"][aria-label*="Messenger" i], [role="navigation"] [role="button"][aria-label*="Messenger" i], div[role="button"][aria-label="Messenger" i]'
    );
    if (!messBtn || (messBtn.offsetParent === null && messBtn.getClientRects().length === 0)) {
      return false;
    }

    simulateClick(messBtn);
    await sleep(600);

    let messPanel = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const dialogs = document.querySelectorAll('div[role="dialog"], div[aria-label*="Đoạn chat" i], div[aria-label*="Messenger" i]');
      for (const d of dialogs) {
        if (d.offsetParent === null && d.getClientRects().length === 0) continue;
        if (d.querySelector('input[type="search"], input[placeholder*="Tìm kiếm" i], input[placeholder*="Search" i]')) {
          messPanel = d;
          break;
        }
      }
      if (messPanel) break;
      await sleep(250);
    }

    if (!messPanel) return false;

    const searchInput = messPanel.querySelector(
      'input[type="search"], input[placeholder*="Tìm kiếm" i], input[placeholder*="Search" i], input[aria-label*="Tìm kiếm" i], input[aria-label*="Search" i]'
    );
    if (!searchInput) return false;

    setReactInputValue(searchInput, targetName.trim());
    await sleep(1000);

    const matchedRow = findExactRecipientRow(messPanel, normTarget);
    if (!matchedRow) {
      // Close Messenger dropdown if not found
      simulateClick(messBtn);
      return false;
    }

    const clickTarget = matchedRow.closest('[role="button"], a[role="link"], div[tabindex="0"]') || matchedRow;
    simulateClick(clickTarget);

    let openedChat = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(250);
      openedChat = findActiveMessengerChatBox(targetName);
      if (openedChat) break;
    }

    if (!openedChat) return false;

    const sent = await sendToMessengerChatTab(openedChat, messageText);
    if (sent) {
      await sleep(250);
      const container = openedChat.container;
      const closeChatBtn = container?.querySelector(
        '[aria-label*="Đóng đoạn chat" i][role="button"], [aria-label*="Close chat" i][role="button"], [aria-label*="Đóng" i][role="button"]'
      );
      if (closeChatBtn) {
        simulateClick(closeChatBtn);
      }
    }
    return sent;
  }

  async function sendPostViaMessengerDialog(targetGroupName, customMessage, card, likeBtn) {
    const groupName = normalizeText(targetGroupName || config.messengerTargetName || '');
    const shareBtn = getShareButton(likeBtn, card);
    if (!shareBtn) return false;

    simulateClick(shareBtn);
    await sleep(500);

    // Wait for either Messenger menu item or Share dialog
    let dialog = null;
    let clickedMessengerOption = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const existingDialog = findMessengerShareDialog();
      const hasSearchAlready = existingDialog?.querySelector('input[placeholder*="Tìm kiếm" i], input[placeholder*="Search" i], input[aria-label*="Tìm kiếm" i], input[aria-label*="Search" i]');
      if (hasSearchAlready) {
        dialog = existingDialog;
        break;
      }

      if (!clickedMessengerOption) {
        const scope = existingDialog || document;
        const menuCandidates = scope.querySelectorAll('[role="menuitem"], [role="button"], div[tabindex="0"]');
        for (const item of menuCandidates) {
          if (item.offsetParent === null && item.getClientRects().length === 0) continue;
          const text = normalizeText(item.textContent || '');
          const aria = normalizeText(item.getAttribute('aria-label') || '');
          if (/gửi bằng messenger|send in messenger|gửi trong messenger|chia sẻ qua messenger/i.test(text) ||
              /gửi bằng messenger|send in messenger|gửi trong messenger/i.test(aria)) {
            simulateClick(item);
            clickedMessengerOption = true;
            break;
          }
        }
      }
      await sleep(300);
    }

    if (!dialog) {
      dialog = findMessengerShareDialog();
    }

    if (!dialog) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      return false;
    }

    const searchInput = dialog.querySelector(
      'input[type="search"], input[placeholder*="Tìm kiếm" i], input[placeholder*="Search" i], input[aria-label*="Tìm kiếm" i], input[aria-label*="Search" i], input[type="text"]'
    );

    if (searchInput && groupName) {
      setReactInputValue(searchInput, targetGroupName || config.messengerTargetName || '');
      await sleep(1100);
    }

    if (customMessage) {
      const msgBox = dialog.querySelector('div[contenteditable="true"][role="textbox"], textarea');
      if (msgBox) {
        try {
          await typeCommentIntoEditor(msgBox, customMessage);
          await sleep(250);
        } catch (_) {}
      }
    }

    let sent = false;
    if (groupName) {
      const matchedRow = findExactRecipientRow(dialog, groupName);
      if (matchedRow) {
        // Case 1: Row itself has a "Gửi" / "Send" button
        const rowSendBtns = matchedRow.querySelectorAll('[role="button"], button');
        for (const btn of rowSendBtns) {
          if (btn.offsetParent === null) continue;
          const btnText = normalizeText(btn.textContent || '');
          const btnAria = normalizeText(btn.getAttribute('aria-label') || '');
          if (/^(gửi|send)$/i.test(btnText) || /^(gửi|send)$/i.test(btnAria)) {
            simulateClick(btn);
            sent = true;
            break;
          }
        }

        // Case 2: Select recipient row/checkbox first, then click dialog's bottom "Gửi" button
        if (!sent) {
          const checkbox = matchedRow.querySelector('[role="checkbox"], input[type="checkbox"], [role="radio"]') || matchedRow;
          simulateClick(checkbox);
          await sleep(300);

          const dialogBtns = dialog.querySelectorAll('[role="button"], button');
          for (const btn of dialogBtns) {
            if (btn.offsetParent === null) continue;
            const btnText = normalizeText(btn.textContent || '');
            const btnAria = normalizeText(btn.getAttribute('aria-label') || '');
            if (/đóng|close|quay lại|back|hủy|cancel/i.test(btnAria) || /đóng|close|hủy|cancel/i.test(btnText)) continue;
            if (/^(gửi|send)$/i.test(btnText) || /^(gửi|send)$/i.test(btnAria)) {
              simulateClick(btn);
              sent = true;
              break;
            }
          }
        }
      } else {
        console.log('[FB Sentinel] Không tìm thấy người/nhóm khớp tên:', groupName);
      }
    }

    if (sent) {
      showToast(`✅ Đã gửi bài viết cho "${targetGroupName || config.messengerTargetName}"!`);
    }

    await sleep(600);
    const closeBtn = dialog.querySelector('[aria-label="Đóng" i][role="button"], [aria-label="Close" i][role="button"]');
    if (closeBtn) {
      simulateClick(closeBtn);
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
    return sent;
  }

  function cleanFacebookPostUrl(rawUrl) {
    if (!rawUrl) return '';
    try {
      const u = new URL(rawUrl, window.location.origin);
      const keepParams = new URLSearchParams();
      for (const key of ['fbid', 'story_fbid', 'id', 'v', 'set']) {
        const val = u.searchParams.get(key);
        if (val) keepParams.set(key, val);
      }
      const qs = keepParams.toString();
      return `${u.origin}${u.pathname}${qs ? `?${qs}` : ''}`;
    } catch (_) {
      return rawUrl.split('?')[0];
    }
  }

  function hydrateTimestampLinks(postRoot) {
    if (!postRoot) return;
    try {
      const links = postRoot.querySelectorAll('a[role="link"], a[tabindex="0"]');
      for (const a of links) {
        if (a.closest('ul, [aria-label*="Bình luận về" i], [aria-label*="Comment by" i]')) continue;
        const rawHref = a.getAttribute('href') || '';
        if (rawHref && rawHref !== '#' && !rawHref.startsWith('#')) continue;
        const txt = normalizeText(a.innerText || a.textContent || '');
        const aria = normalizeText(a.getAttribute('aria-label') || '');
        if (/^(vừa xong|just now|hôm qua|yesterday|\d+\s*(giờ|phút|ngày|tuần|tháng|năm|h|m|d|w|y)|tháng\s+\d+)/i.test(txt) ||
            /(\d+\s*(giờ|phút|ngày|h|m|d)|lúc\s+\d+)/i.test(aria)) {
          a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
          a.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true, view: window }));
          a.focus?.({ preventScroll: true });
          a.blur?.();
        }
      }
    } catch (_) {}
  }

  function getPostUrlFromCard(card, likeBtn) {
    const postRoot = (card && card !== document.body && card.getAttribute?.('role') !== 'feed' && card.getAttribute?.('role') !== 'main')
      ? findEnclosingPostCard(card) || card
      : (likeBtn ? findEnclosingPostCard(likeBtn) : null);

    if (!postRoot) return '';

    // Ensure Facebook populates lazy timestamp permalinks inside this exact post only
    hydrateTimestampLinks(postRoot);

    const isCommentLink = (a) => Boolean(a.closest('ul, [aria-label*="Bình luận về" i], [aria-label*="Comment by" i], [aria-label*="Danh sách bình luận" i]'));
    const postTop = postRoot.getBoundingClientRect().top;
    const isHeaderRegion = (a) => (a.getBoundingClientRect().top - postTop) <= 280;

    // 1. Check timestamp/header links in the top header of this exact post first
    const headerLinks = postRoot.querySelectorAll('h2 a, h3 a, h4 a, [data-ad-rendering-role="profile_name"] a, a[role="link"]');
    for (const a of headerLinks) {
      if (isCommentLink(a) || !isHeaderRegion(a)) continue;
      const h = a.href || '';
      if (!h || h.includes('/user/') || h.includes('profile.php') || h.includes('#') || h.includes('/photo')) continue;
      if (h.includes('/posts/') || h.includes('/permalink/') || h.includes('story_fbid=') || h.includes('/reel/') || h.includes('/share/p/') || h.includes('/share/v/')) {
        return cleanFacebookPostUrl(h);
      }
      const txt = normalizeText(a.innerText || a.textContent || '');
      if (/^(vừa xong|just now|\d+\s*(giờ|phút|ngày|h|m|d)|hôm qua|tháng)/i.test(txt)) {
        if (h && !/\/groups\/[^/]+\/?$/.test(h.split('?')[0])) {
          return cleanFacebookPostUrl(h);
        }
      }
    }

    // 2. Fallback to direct post/permalink links inside this post (preferring top-most)
    const postLinks = postRoot.querySelectorAll(
      'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="], a[href*="/share/p/"], a[href*="/share/v/"], a[href*="/watch/"], a[href*="/reel/"]'
    );
    for (const a of postLinks) {
      if (isCommentLink(a)) continue;
      const h = a.href || '';
      if (!h || h.includes('/user/') || h.includes('/hashtag/')) continue;
      if (/\/groups\/[^/]+\/?$/.test(h.split('?')[0]) && !h.includes('story_fbid=')) continue;
      return cleanFacebookPostUrl(h);
    }

    // 3. Convert /photo/?fbid=...&set=pcb.<POST_ID> (or gm.<POST_ID>) inside this post to full post URL
    const photoLinks = postRoot.querySelectorAll('a[href*="/photo"], a[href*="fbid="]');
    for (const a of photoLinks) {
      if (isCommentLink(a)) continue;
      const h = a.href || '';
      if (!h) continue;
      try {
        const u = new URL(h, window.location.origin);
        const setParam = u.searchParams.get('set') || '';
        const postIdMatch = setParam.match(/(?:pcb|gm)\.(\d+)/);
        if (postIdMatch && postIdMatch[1]) {
          const postId = postIdMatch[1];
          const groupLink = postRoot.querySelector('a[href*="/groups/"]');
          const groupMatch = groupLink?.href?.match(/\/groups\/([^/?#]+)/);
          if (groupMatch && groupMatch[1]) {
            return `https://www.facebook.com/groups/${groupMatch[1]}/posts/${postId}/`;
          }
          const ownerLink = postRoot.querySelector('h2 a, h3 a, h4 a, [data-ad-rendering-role="profile_name"] a');
          if (ownerLink?.href) {
            const ownerUrl = new URL(ownerLink.href, window.location.origin);
            const ownerId = ownerUrl.searchParams.get('id');
            if (ownerId) {
              return `https://www.facebook.com/permalink.php?story_fbid=${postId}&id=${ownerId}`;
            }
            const slugMatch = ownerUrl.pathname.match(/^\/([^/?#]+)\/?$/);
            if (slugMatch && slugMatch[1] && !['groups', 'profile.php', 'watch', 'reel'].includes(slugMatch[1])) {
              return `https://www.facebook.com/${slugMatch[1]}/posts/${postId}/`;
            }
          }
          return `https://www.facebook.com/${postId}`;
        }
      } catch (_) {}
      return cleanFacebookPostUrl(h);
    }

    return '';
  }

  function parsePostAgeMinutes(text) {
    const t = normalizeText(text);
    if (!t) return Infinity;
    if (/^(vừa xong|just now)$/i.test(t)) return 0;
    let m = t.match(/^(\d+)\s*(?:phút|min|mins|m)\b/i);
    if (m) return parseInt(m[1], 10);
    m = t.match(/^(\d+)\s*(?:giờ|hr|hrs|h)\b/i);
    if (m) return parseInt(m[1], 10) * 60;
    if (/^(hôm qua|yesterday)$/i.test(t)) return 1440;
    m = t.match(/^(\d+)\s*(?:ngày|day|days|d)\b/i);
    if (m) return parseInt(m[1], 10) * 1440;
    m = t.match(/^(\d+)\s*(?:tuần|week|weeks|w)\b/i);
    if (m) return parseInt(m[1], 10) * 10080;
    return Infinity;
  }

  function findNewestGroupUrl() {
    const cards = document.querySelectorAll('[role="feed"] > div, [aria-posinset], div[data-pagelet^="FeedUnit"], [role="article"]');
    let bestUrl = '';
    let bestAge = Infinity;

    for (const card of cards) {
      if (card.closest && card.closest('ul, [aria-label*="Bình luận về" i], [aria-label*="Comment by" i]')) continue;
      const groupLinks = card.querySelectorAll('a[href*="/groups/"]');
      let groupId = '';
      for (const gl of groupLinks) {
        const match = (gl.href || '').match(/\/groups\/([^/?#]+)/);
        if (match && match[1] && !['feed', 'joins', 'discover', 'create', 'notifications'].includes(match[1].toLowerCase())) {
          groupId = match[1];
          break;
        }
      }
      if (!groupId) continue;

      let cardAge = Infinity;
      const timeEls = card.querySelectorAll('a[role="link"], a[tabindex="0"], span');
      for (const el of timeEls) {
        if (el.closest('ul, [aria-label*="Bình luận về" i], [aria-label*="Comment by" i]')) continue;
        const txt = (el.textContent || '').trim();
        if (txt.length > 25) continue;
        const age = parsePostAgeMinutes(txt);
        if (age < cardAge) {
          cardAge = age;
        }
      }

      if (cardAge < bestAge) {
        bestAge = cardAge;
        bestUrl = `https://www.facebook.com/groups/${groupId}/?sorting_setting=CHRONOLOGICAL`;
      } else if (!bestUrl) {
        bestUrl = `https://www.facebook.com/groups/${groupId}/?sorting_setting=CHRONOLOGICAL`;
      }
    }

    return bestUrl;
  }

  const sentPostUrls = new Set();

  function isVideoOrReelPost(card, likeBtn, postUrl) {
    if (postUrl && /\/(reel|reels|watch|videos|share\/v|share\/r)\b/i.test(postUrl)) {
      return true;
    }
    const postRoot = (card && card !== document.body)
      ? (findEnclosingPostCard(card) || card)
      : (likeBtn ? findEnclosingPostCard(likeBtn) : null);
    if (!postRoot) return false;

    const videos = postRoot.querySelectorAll('video');
    for (const v of videos) {
      if (!v.closest('ul, [aria-label*="Bình luận về" i], [aria-label*="Comment by" i]')) {
        return true;
      }
    }
    const videoLinks = postRoot.querySelectorAll(
      'a[href*="/reel/"], a[href*="/reels/"], a[href*="/watch/"], a[href*="/videos/"], a[href*="/share/v/"], a[href*="/share/r/"]'
    );
    for (const a of videoLinks) {
      if (!a.closest('ul, [aria-label*="Bình luận về" i], [aria-label*="Comment by" i]')) {
        return true;
      }
    }
    return false;
  }

  async function sharePostToMessenger(likeBtn, card, capturedPhones) {
    try {
      let postUrl = getPostUrlFromCard(card, likeBtn);
      if (!postUrl || postUrl.includes('/photo')) {
        await sleep(160);
        const retriedUrl = getPostUrlFromCard(card, likeBtn);
        if (retriedUrl) postUrl = retriedUrl;
      }

      if (isVideoOrReelPost(card, likeBtn, postUrl)) {
        console.log('[FB Sentinel] Bỏ qua gửi Messenger vì đây là bài Video/Reel.');
        return false;
      }

      // If postUrl is empty or home feed URL, create a descriptive preview snippet instead of sending bare domain
      if (!postUrl || postUrl === 'https://www.facebook.com/' || postUrl === 'https://www.facebook.com') {
        const authorEl = card?.querySelector('h2, h3, h4, [data-ad-rendering-role="profile_name"], strong');
        const author = authorEl ? (authorEl.innerText || authorEl.textContent || '').split('\n')[0].trim() : '';
        const contentEl = card?.querySelector('div[dir="auto"], [data-ad-preview="message"]');
        const snippet = (contentEl?.innerText || '').slice(0, 100).trim();
        postUrl = author ? `Bài của ${author}: "${snippet}"` : (snippet ? `Bài viết: "${snippet}"` : window.location.href);
      }

      // Deduplication guard: Never re-send the exact same post/message into Messenger
      if (sentPostUrls.has(postUrl)) {
        console.log('[FB Sentinel] Bài này đã được gửi vào Messenger rồi, bỏ qua không gửi lại:', postUrl);
        return true;
      }
      sentPostUrls.add(postUrl);

      let msgToSend = postUrl;
      if (capturedPhones && capturedPhones.length > 0) {
        const uniquePhones = [...new Set(capturedPhones.map(p => p.trim()).filter(Boolean))];
        msgToSend = `${postUrl} | 📞 SĐT: ${uniquePhones.join(', ')}`;
      }
      if (config.messengerCustomMsg) {
        msgToSend = `${config.messengerCustomMsg} ${msgToSend}`;
      }

      // Ưu tiên 1: Tự động dán vào cửa sổ Chat Messenger đang mở ở góc dưới màn hình
      const activeChat = findActiveMessengerChatBox(config.messengerTargetName);
      if (activeChat) {
        const ok = await sendToMessengerChatTab(activeChat, msgToSend);
        if (ok) return true;
      }

      // Ưu tiên 2: Mở bong bóng chat bị thu nhỏ nếu có
      if (openMinimizedMessengerBubble(config.messengerTargetName)) {
        await sleep(500);
        const reopenedChat = findActiveMessengerChatBox(config.messengerTargetName);
        if (reopenedChat) {
          const ok = await sendToMessengerChatTab(reopenedChat, msgToSend);
          if (ok) return true;
        }
      }

      // Ưu tiên 3: Tự mở hộp thoại Messenger trên thanh tiêu đề để gửi đúng người/nhóm (chạy được cả nhóm riêng tư)
      if (config.messengerTargetName) {
        const ok = await openAndSendViaHeaderMessenger(config.messengerTargetName, msgToSend);
        if (ok) return true;
      }

      // Ưu tiên 4: Dùng hộp thoại Chia sẻ -> Gửi bằng Messenger
      if (config.messengerTargetName) {
        const ok = await sendPostViaMessengerDialog(config.messengerTargetName, config.messengerCustomMsg, card, likeBtn);
        if (ok) return true;
      }

      try {
        await navigator.clipboard.writeText(msgToSend);
      } catch (_) {}
      showToast('📋 Đã sao chép link bài viết (hãy mở ô chat nhóm để dán tự động)');
      return false;
    } catch (err) {
      console.warn('[FB Sentinel] sharePostToMessenger error:', err);
      return false;
    }
  }

  function ensureButtonVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const isAlreadyVisible = (rect.top >= 50 && rect.bottom <= (window.innerHeight - 40));
    if (!isAlreadyVisible) {
      try {
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      } catch (_) {
        window.scrollBy({
          top: Math.round(rect.top - (window.innerHeight / 2)),
          behavior: 'smooth'
        });
      }
      return true;
    }
    return false;
  }

  // Master Interaction Routine for a single post
  async function interactWithPostByLikeButton(likeBtn) {
    if (!likeBtn || !likeBtn.isConnected) return false;

    // Safety check: FB Warning check
    if (config.autoStopOnFbWarning) {
      const warn = checkFacebookWarningModal();
      if (warn.detected) {
        handleFacebookBlockWarning(warn.reason);
        return false;
      }
    }

    const card = getPostCardFromLikeButton(likeBtn) || likeBtn;
    const trackCard = isSinglePostCard(card, likeBtn);
    if (processedInteractionCards.has(likeBtn) ||
        (trackCard && (processedInteractionCards.has(card) || (card.dataset && card.dataset.fbInteracted === 'true'))) ||
        likeBtn.dataset.fbInteracted === 'true') {
      return false;
    }

    processedInteractionCards.add(likeBtn);
    likeBtn.dataset.fbInteracted = 'true';
    if (trackCard) {
      processedInteractionCards.add(card);
      if (card.dataset) card.dataset.fbInteracted = 'true';
    }

    // Feature 7: Expand "Xem thêm" FIRST so post height settles before centering Like button
    if (config.autoExpandSeeMore && card) {
      const expanded = expandSeeMore(card);
      if (expanded) await sleep(280);
    }

    // 1. Gently ensure button is in view after post expansion
    const didScroll = ensureButtonVisible(likeBtn);
    await sleep(didScroll ? 360 : 40);

    // Feature 3: Extract and save lead (already expanded above)
    let capturedPhones = null;
    if (card) {
      capturedPhones = extractAndSaveLeads(card, likeBtn, true);
    }

    // Feature 5: Check if already liked -> Do not comment again!
    const isAlreadyLiked = isLikeButtonActive(likeBtn);
    let didLikeNow = false;
    let didCommentNow = false;
    let postedCommentText = '';

    if (isAlreadyLiked) {
      if (config.skipAlreadyLiked) {
        interactionDiagnostic = `Bài #${interactionCount + 1}: Đã Like trước đó -> Bỏ qua không comment`;
        showToast('⏭️ Bỏ qua bài đã Thích (không cmt lại)');
        return true;
      }
      interactionDiagnostic = `Bài #${interactionCount + 1}: Đã Like trước đó`;
    } else {
      simulateClick(likeBtn);
      await sleep(250);
      if (!isLikeButtonActive(likeBtn) && likeBtn.isConnected) {
        // Fallback click on inner label/icon if outer button didn't toggle Like
        const innerTarget = likeBtn.querySelector('span, i') || likeBtn;
        innerTarget.click?.();
        await sleep(250);
      }
      didLikeNow = true;
      interactionCount++;
      interactionDiagnostic = `Đã Like bài #${interactionCount}`;
      showToast(`👍 Đã Like bài #${interactionCount}`);
    }

    // Check FB Warning again after Like
    if (config.autoStopOnFbWarning) {
      await sleep(150);
      const warn = checkFacebookWarningModal();
      if (warn.detected) {
        handleFacebookBlockWarning(warn.reason);
        return false;
      }
    }

    // Feature 1 & 2: Comment each post ONCE using chosen template (strictly deduped by card + URL + content)
    const commentText = getNextCommentTemplate();
    const commentUrlKey = getPostUrlFromCard(card, likeBtn);
    const commentTextKey = normalizeText((card?.querySelector('div[dir="auto"], [data-ad-preview="message"]')?.textContent || card?.textContent || '').slice(0, 100));
    const alreadyCommented = (card && commentedCards.has(card)) ||
      (commentUrlKey && commentedPostKeys.has(commentUrlKey)) ||
      (commentTextKey && commentedPostKeys.has(commentTextKey));
    if (commentText && !alreadyCommented) {
      if (card) commentedCards.add(card);
      if (commentUrlKey) commentedPostKeys.add(commentUrlKey);
      if (commentTextKey) commentedPostKeys.add(commentTextKey);
      await sleep(350);

      let textbox = findCommentTextbox(card, likeBtn);
      if (!textbox) {
        const commentBtn = getCommentButtonFromLikeButton(likeBtn, card);
        if (commentBtn) {
          simulateClick(commentBtn);
        }
        textbox = await waitForCommentTextbox(card, likeBtn, 3500);
      }

      if (textbox) {
        interactionDiagnostic = `Đang viết comment: "${commentText.slice(0, 30)}..."`;
        const typed = await typeCommentIntoEditor(textbox, commentText);
        if (typed) {
          await sleep(400);
          await submitComment(textbox, card);
          didCommentNow = true;
          commentCount++;
          postedCommentText = commentText;
          interactionDiagnostic = `Đã tương tác bài #${commentCount}`;
          showToast(`💬 Đã tương tác bài #${commentCount}`);

          // If comment opened in a post modal dialog, close it so scrolling can continue cleanly
          const openedDialog = textbox.closest('div[role="dialog"]');
          if (openedDialog && (!card || !card.closest('div[role="dialog"]'))) {
            await sleep(350);
            const closeBtn = openedDialog.querySelector('[aria-label="Đóng" i][role="button"], [aria-label="Close" i][role="button"]');
            if (closeBtn) {
              simulateClick(closeBtn);
            } else {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            }
          }
        }
      } else {
        interactionDiagnostic = `Không mở được ô bình luận (bài có thể đã tắt bình luận)`;
        console.log('[FB Sentinel] Không mở được ô comment:', card);
      }
    }

    // Save to interactionHistory in storage so user can view all Liked/Commented posts in popup
    if ((didLikeNow || didCommentNow) && isContextValid()) {
      try {
        const postRoot = (card && card !== document.body) ? (findEnclosingPostCard(card) || card) : null;
        const authorEl = postRoot?.querySelector('[data-ad-rendering-role="profile_name"], h2 a, h3 a, h4 a, strong a');
        const rawAuthor = authorEl ? (authorEl.textContent || '').split('\n')[0].trim() : '';
        const author = (rawAuthor && !/có thể là hình ảnh/i.test(rawAuthor)) ? rawAuthor : 'Thành viên FB';

        const textEls = postRoot ? postRoot.querySelectorAll('div[dir="auto"], span[dir="auto"], [data-ad-preview="message"]') : [];
        let snippet = '';
        textEls.forEach(el => {
          if (el.closest('.fb-spam-scroll-widget, .fb-spam-alert-badge')) return;
          const t = (el.textContent || '').trim();
          if (t && !snippet.includes(t)) snippet += (snippet ? ' ' : '') + t;
        });
        snippet = snippet.slice(0, 220).trim();

        const postUrl = getPostUrlFromCard(card, likeBtn) || '';
        chrome.storage.local.get({ interactionHistory: [] }, (data) => {
          if (!isContextValid()) return;
          const hist = Array.isArray(data.interactionHistory) ? data.interactionHistory : [];
          const exists = hist.some(h => (postUrl && h.url === postUrl) || (snippet && h.content === snippet));
          if (!exists) {
            hist.unshift({
              id: Date.now() + Math.random().toString(36).substring(2, 6),
              author,
              content: snippet,
              url: postUrl,
              liked: didLikeNow,
              commented: didCommentNow,
              commentText: postedCommentText,
              timestamp: new Date().toLocaleString('vi-VN')
            });
            if (hist.length > 300) hist.length = 300;
            chrome.storage.local.set({ interactionHistory: hist });
          }
        });
      } catch (_) {}
    }

    // Feature 4: Auto Share / Direct Paste to Messenger if enabled
    if (config.autoShareMessenger) {
      const hasPhone = capturedPhones && capturedPhones.length > 0;
      if (config.shareOnlyLeads && !hasPhone) {
        console.log('[FB Sentinel] Bỏ qua dán bài Messenger vì bài viết không có SĐT.');
      } else {
        await sleep(300);
        await sharePostToMessenger(likeBtn, card, capturedPhones);
      }
    }

    return true;
  }

  let lastInteractionTime = 0;

  async function runInteractionPass() {
    if (!isInteracting || isInteractingBusy) return;

    const delayMs = Math.max(2, config.interactionDelay || 5) * 1000;
    if (lastInteractionTime > 0 && (Date.now() - lastInteractionTime) < delayMs) {
      return;
    }

    // Safety check FB warning
    if (config.autoStopOnFbWarning) {
      const warn = checkFacebookWarningModal();
      if (warn.detected) {
        handleFacebookBlockWarning(warn.reason);
        return;
      }
    }

    const likeButtons = getAllPostLikeButtons();
    if (likeButtons.length === 0) {
      interactionDiagnostic = 'Đang tìm bài viết trên bảng tin...';
      return;
    }

    let targetBtn = null;
    let fallbackBtn = null;
    for (const btn of likeButtons) {
      if (btn.dataset && btn.dataset.fbInteracted === 'true') continue;
      if (processedInteractionCards.has(btn)) continue;
      const card = getPostCardFromLikeButton(btn);
      const trackCard = isSinglePostCard(card, btn);
      if (trackCard && ((card.dataset && card.dataset.fbInteracted === 'true') || processedInteractionCards.has(card))) continue;

      if (!fallbackBtn) fallbackBtn = btn;
      const rect = btn.getBoundingClientRect();
      if (rect.bottom > -400) {
        targetBtn = btn;
        break;
      }
    }
    if (!targetBtn && !isScrolling) targetBtn = fallbackBtn;

    if (!targetBtn) {
      interactionDiagnostic = `Đã duyệt ${likeButtons.length} bài (chờ lướt thêm bài mới)`;
      return;
    }

    isInteractingBusy = true;
    try {
      await interactWithPostByLikeButton(targetBtn);
      lastInteractionTime = Date.now();
    } catch (err) {
      console.error('[FB Sentinel] Lỗi trong quá trình tương tác:', err);
      lastInteractionTime = Date.now();
    } finally {
      isInteractingBusy = false;
      holdForPendingPost = false;
      holdStartedAt = 0;
    }
  }

  function startInteraction() {
    if (isInteracting) return;
    if (!config.autoInteractEnabled) {
      config.autoInteractEnabled = true;
      chrome.storage.local.set({ autoInteractEnabled: true });
    }
    isInteracting = true;
    isInteractingBusy = false;
    interactionCount = 0;
    commentCount = 0;
    lastInteractionTime = 0;
    processedInteractionCards = new WeakSet();
    runInteractionPass();
    interactionTimer = setInterval(runInteractionPass, 500);
    showToast('▶ Bắt đầu Like & Comment tự động');
    updateWidgetUI();
  }

  function stopInteraction() {
    isInteracting = false;
    isInteractingBusy = false;
    if (interactionTimer) {
      clearInterval(interactionTimer);
      interactionTimer = null;
    }
    updateWidgetUI();
  }

  function toggleInteraction() {
    if (isInteracting) {
      stopInteraction();
      showToast('⏸ Đã dừng Like/Comment');
    } else {
      startInteraction();
    }
  }

  // ========================================================
  // 7. COMPREHENSIVE AUTO-SCROLL ENGINE
  // ========================================================

  function executeScroll(speed) {
    const beforeY = window.scrollY || document.documentElement.scrollTop || 0;
    window.scrollBy(0, speed);
    const afterY = window.scrollY || document.documentElement.scrollTop || 0;
    if (Math.abs(afterY - beforeY) >= 0.5) {
      return;
    }

    if (document.scrollingElement) {
      const prev = document.scrollingElement.scrollTop;
      document.scrollingElement.scrollTop += speed;
      if (document.scrollingElement.scrollTop !== prev) {
        return;
      }
    }

    const mainRole = document.querySelector('div[role="main"]');
    if (mainRole && mainRole.scrollHeight > mainRole.clientHeight) {
      mainRole.scrollTop += speed;
      return;
    }

    const scrollables = document.querySelectorAll('div[data-pagelet*="Feed"], div[data-pagelet*="Group"], div[role="feed"]');
    for (const s of scrollables) {
      if (s.scrollHeight > s.clientHeight) {
        s.scrollTop += speed;
        break;
      }
    }
  }

  function startScrolling() {
    if (isScrolling) return;
    isScrolling = true;
    scrollFrameCounter = 0;
    updateWidgetUI();
    showToast('▶ Bắt đầu tự lướt Facebook');

    if (config.autoInteractEnabled && !isInteracting) {
      startInteraction();
    }

    holdForPendingPost = false;
    holdStartedAt = 0;

    function step() {
      if (!isScrolling) return;

      scrollFrameCounter++;
      if (isInteractingBusy) {
        holdStartedAt = 0;
      } else if (scrollFrameCounter % 8 === 0) {
        const shouldHold = hasPendingVisibleLikeButton();
        if (shouldHold) {
          if (!holdStartedAt) holdStartedAt = Date.now();
          const maxHoldMs = (Math.max(2, config.interactionDelay || 5) + 4) * 1000;
          holdForPendingPost = (Date.now() - holdStartedAt) < maxHoldMs;
        } else {
          holdStartedAt = 0;
          holdForPendingPost = false;
        }
      }

      if (scrollFrameCounter % 90 === 0) {
        scanDOM();
      }

      // Pause scrolling while actively interacting OR waiting for interactionDelay on a visible post
      if (!isInteractingBusy && !holdForPendingPost) {
        const speed = SPEEDS[scrollSpeedLevel] || 5.0;
        executeScroll(speed);
      }

      scrollAnimId = requestAnimationFrame(step);
    }

    scrollAnimId = requestAnimationFrame(step);
  }

  function stopScrolling() {
    isScrolling = false;
    holdForPendingPost = false;
    holdStartedAt = 0;
    if (scrollAnimId) {
      cancelAnimationFrame(scrollAnimId);
      scrollAnimId = null;
    }
    if (isInteracting) {
      stopInteraction();
    }
    updateWidgetUI();
  }

  function toggleScrolling() {
    if (isScrolling) {
      stopScrolling();
      showToast('⏸ Đã tạm dừng lướt & tương tác');
    } else {
      startScrolling();
    }
  }

  // Keyboard shortcut: Alt + S
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      toggleScrolling();
    }
  });

  function showToast(text) {
    const existing = document.querySelector('.fb-spam-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'fb-spam-toast';
    toast.innerHTML = `<span>🛡️</span> <span>${escapeHtml(text)}</span>`;
    const target = document.body || document.documentElement;
    target.appendChild(toast);

    setTimeout(() => {
      if (toast && toast.parentNode) toast.remove();
    }, 3200);
  }

  // ========================================================
  // 8. ON-SCREEN FLOATING CONTROL WIDGET
  // ========================================================
  function setupOrUpdateScrollWidget() {
    let widget = document.getElementById('fb-spam-floating-widget');

    if (!config.showScroller) {
      if (widget) widget.remove();
      return;
    }

    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'fb-spam-floating-widget';
      widget.className = 'fb-spam-scroll-widget';

      widget.innerHTML = `
        <div class="fb-spam-scroll-panel">
          <button id="fb-spam-btn-toggle" class="fb-spam-scroll-btn" title="Phím tắt: Alt + S">
            <span class="fb-spam-icon">▶</span>
            <span class="fb-spam-label">Tự lướt</span>
          </button>

          <button id="fb-spam-btn-interact" class="fb-spam-scroll-btn ${isInteracting ? 'active' : ''}" style="background: ${isInteracting ? '#dc2626' : '#059669'};" title="Bật/Tắt Tự động Like & Comment">
            <span class="fb-spam-interact-icon">${isInteracting ? '⏹' : '👍'}</span>
            <span class="fb-spam-interact-label">${isInteracting ? 'Dừng Tương tác' : 'Tương tác'}</span>
          </button>

          <div class="fb-spam-speed-group" title="Tốc độ cuộn">
            <button class="fb-spam-speed-btn ${scrollSpeedLevel === 1 ? 'selected' : ''}" data-speed="1">1x</button>
            <button class="fb-spam-speed-btn ${scrollSpeedLevel === 2 ? 'selected' : ''}" data-speed="2">2x</button>
            <button class="fb-spam-speed-btn ${scrollSpeedLevel === 3 ? 'selected' : ''}" data-speed="3">3x</button>
          </div>

          <label class="fb-spam-scroll-options" title="Tự dừng khi phát hiện bài có từ khóa/link spam">
            <input type="checkbox" id="fb-spam-chk-pause" ${config.pauseOnSpam ? 'checked' : ''}>
            <span>Dừng khi gặp spam</span>
          </label>

          <button id="fb-spam-btn-minimize" class="fb-spam-scroll-min-btn" title="Thu nhỏ nút">−</button>
        </div>

        <div class="fb-spam-scroll-bubble" title="Nhấn để mở bảng điều khiển lướt">
          🛡️
        </div>
      `;

      const target = document.body || document.documentElement;
      target.appendChild(widget);

      const btnToggle = widget.querySelector('#fb-spam-btn-toggle');
      btnToggle.addEventListener('click', toggleScrolling);

      const btnInteract = widget.querySelector('#fb-spam-btn-interact');
      if (btnInteract) {
        btnInteract.addEventListener('click', toggleInteraction);
      }

      const speedBtns = widget.querySelectorAll('.fb-spam-speed-btn');
      speedBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          scrollSpeedLevel = parseInt(btn.dataset.speed, 10);
          updateSpeedUI();
        });
      });

      const chkPause = widget.querySelector('#fb-spam-chk-pause');
      chkPause.addEventListener('change', () => {
        config.pauseOnSpam = chkPause.checked;
        chrome.storage.local.set({ pauseOnSpam: config.pauseOnSpam });
      });

      const btnMin = widget.querySelector('#fb-spam-btn-minimize');
      btnMin.addEventListener('click', () => {
        widget.classList.add('minimized');
      });

      const bubble = widget.querySelector('.fb-spam-scroll-bubble');
      bubble.addEventListener('click', () => {
        widget.classList.remove('minimized');
      });
    }

    updateWidgetUI();
  }

  function updateSpeedUI() {
    const widget = document.getElementById('fb-spam-floating-widget');
    if (!widget) return;
    const speedBtns = widget.querySelectorAll('.fb-spam-speed-btn');
    speedBtns.forEach(b => {
      if (parseInt(b.dataset.speed, 10) === scrollSpeedLevel) {
        b.classList.add('selected');
      } else {
        b.classList.remove('selected');
      }
    });
  }

  function updateWidgetUI() {
    const widget = document.getElementById('fb-spam-floating-widget');
    if (!widget) return;

    const btnToggle = widget.querySelector('#fb-spam-btn-toggle');
    if (btnToggle) {
      const icon = btnToggle.querySelector('.fb-spam-icon');
      const label = btnToggle.querySelector('.fb-spam-label');
      if (isScrolling) {
        btnToggle.classList.add('active');
        if (icon) icon.textContent = '⏸';
        if (label) label.textContent = 'Tạm dừng';
      } else {
        btnToggle.classList.remove('active');
        if (icon) icon.textContent = '▶';
        if (label) label.textContent = 'Tự lướt';
      }
    }

    const btnInteract = widget.querySelector('#fb-spam-btn-interact');
    if (btnInteract) {
      const interactIcon = btnInteract.querySelector('.fb-spam-interact-icon');
      const interactLabel = btnInteract.querySelector('.fb-spam-interact-label');
      if (isInteracting) {
        btnInteract.classList.add('active');
        btnInteract.style.setProperty('background', '#dc2626', 'important');
        if (interactIcon) interactIcon.textContent = '⏹';
        if (interactLabel) interactLabel.textContent = 'Dừng Tương tác';
      } else {
        btnInteract.classList.remove('active');
        btnInteract.style.setProperty('background', '#059669', 'important');
        if (interactIcon) interactIcon.textContent = '👍';
        if (interactLabel) interactLabel.textContent = 'Tương tác';
      }
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  console.log('[FB Group Spam Sentinel Pro] Multi-Strategy Engine v1.8.0 đã sẵn sàng.');
})();
