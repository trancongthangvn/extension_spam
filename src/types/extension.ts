export const DEFAULT_KEYWORDS: string[] = [
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
  'bắn cá',
];

export type CommentMode = 'random' | 'roundrobin';

export interface CapturedLead {
  id: string;
  phone: string;
  author: string;
  content: string;
  timestamp: string;
  url: string;
}

export interface InteractionHistoryItem {
  id: string;
  author: string;
  content: string;
  url: string;
  liked: boolean;
  commented: boolean;
  commentText?: string;
  timestamp: string;
}

export interface ExtensionSettings {
  enabled: boolean;
  showScroller: boolean;
  pauseOnSpam: boolean;
  detectLinks: boolean;
  detectPhones: boolean;
  speed: number;
  keywords: string[];
  autoInteractEnabled: boolean;
  autoExpandSeeMore: boolean;
  skipAlreadyLiked: boolean;
  autoStopOnFbWarning: boolean;
  autoShareMessenger: boolean;
  messengerTargetName: string;
  messengerCustomMsg: string;
  shareOnlyLeads: boolean;
  commentTemplate: string;
  commentTemplates: string[];
  commentMode: CommentMode;
  interactionDelay: number;
  interactionLimit: number;
}

export interface TabStatsResponse {
  count?: number;
  isScrolling?: boolean;
  isInteracting?: boolean;
  interactionCount?: number;
  likedCount?: number;
  commentedCount?: number;
  interactionDiagnostic?: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  enabled: true,
  showScroller: true,
  pauseOnSpam: false,
  detectLinks: true,
  detectPhones: true,
  speed: 2,
  keywords: DEFAULT_KEYWORDS,
  autoInteractEnabled: true,
  autoExpandSeeMore: true,
  skipAlreadyLiked: true,
  autoStopOnFbWarning: true,
  autoShareMessenger: true,
  messengerTargetName: '',
  messengerCustomMsg: '',
  shareOnlyLeads: false,
  commentTemplate: 'xin chào bạn\nbài viết hữu ích quá ạ\ncho mình xin thêm thông tin với nhé',
  commentTemplates: [
    'xin chào bạn',
    'bài viết hữu ích quá ạ',
    'cho mình xin thêm thông tin với nhé',
  ],
  commentMode: 'random',
  interactionDelay: 5,
  interactionLimit: 10,
};
