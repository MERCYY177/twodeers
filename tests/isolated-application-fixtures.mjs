export const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z8DwHwAFAAH/VscvDQAAAABJRU5ErkJggg==';

function imageRecord(id, blob, kind) {
  const fallbackSize = Buffer.from(PNG_BASE64, 'base64').length;
  return { id, blob, kind, mimeType: blob?.type || 'image/png', name: id + '.png', size: blob?.size ?? fallbackSize, createdAt: 1_794_000_000_000 };
}

export function createValidSeed() {
  const pngBytes = Buffer.from(PNG_BASE64, 'base64');
  const pngSize = pngBytes.length;
  const sticker = { id: 'phase17-uploaded-sticker', source: 'upload', mediaId: 'phase17-sticker-media', mimeType: 'image/png', name: '第十七阶段合成表情', size: pngSize };
  const main = {
    currentPage: 'homePage',
    icons: { 'home-chat': '', 'home-space': '', 'home-settings': '' },
    media: { 'avatar-me': '', 'avatar-other': '', 'bg-chat': '', 'home-cover': '' },
    avatarShape: 'round', bubbleShape: 'round', bubbleColors: { me: '#f2f5fb', other: '#ffffff' },
    appearanceColors: { theme: '#8aa05f', buttonBg: '#342d28', buttonText: '#ffffff' },
    replyWindow: { min: 3, max: 12 }, showReadReceipt: true, readReceiptStyle: 'text', customCSS: '',
    typing: { enabled: true, text: '正在输入中' },
    offline: { chatEnabled: false, chatMin: 30, chatMax: 180, lastHiddenAt: 0, lastChatAt: 1_794_000_000_000 },
    call: { active: false, direction: '', phase: 'idle', type: '', mini: false, startAt: 0, incomingAt: 0, miniPos: null },
    callSettings: { enabled: false, audioEnabled: false, videoEnabled: false },
    incomingCallSettings: { enabled: false, audioEnabled: false, videoEnabled: false, frequency: 'low', videoProbability: 0, minIntervalSec: 3600, maxIntervalSec: 10800, ringTimeoutSec: 25 },
    incomingCallNextAt: 0, settingsTab: 'param', enterKeySendEnabled: false,
    cardPhrases: ['隔离演练主字卡'], stickers: [sticker], stickerFavorites: ['phase17-uploaded-sticker'], stickerTombstones: [], stickerLibraryRevision: 1,
    chatHistory: [
      { id: 'phase17-chat-text', sender: 'other', type: 'text', text: '第十七阶段合成聊天消息', time: '09:00', read: true },
      { id: 'phase17-chat-image', sender: 'me', type: 'image', mediaId: 'phase17-chat-media', mediaMime: 'image/png', mediaSize: pngSize, time: '09:01', read: true }
    ],
    cardUsageOutbox: []
  };
  const circle = {
    myName: '隔离测试用户', otherName: '隔离测试对象',
    myAvatar: 'idb-media:phase17-circle-avatar', otherAvatar: '',
    myCover: 'idb-media:phase17-circle-cover', otherCover: '',
    dynamicCards: ['隔离演练动态字卡'], replyCards: ['隔离演练回复字卡'],
    autoPost: 'off', postMin: 60, postMax: 240, replyMin: 20, replyMax: 90,
    uiFontScale: 1, posts: [{
      id: 'phase17-circle-post', author: 'me', text: '第十七阶段合成朋友圈动态', ts: 1_794_000_000_000,
      private: false, likesBy: { me: false, other: false }, comments: [],
      media: [{ src: 'idb-media:phase17-circle-post-media', type: 'image' }]
    }],
    pendingEvents: [], usageOutbox: [], nextOtherPostAt: 0, notificationsEnabled: false,
    visitorRecords: [], visitorLastViewedCount: 0, visitorLastOnlineAt: 0, visitorNextAt: 0
  };
  const cards = {
    version: 1,
    chatIds: ['phase17-chat-card-id'], chatTexts: ['隔离演练主字卡'],
    momentsDynamicIds: ['phase17-circle-dynamic-card-id'], momentsDynamicTexts: ['隔离演练动态字卡'],
    momentsReplyIds: ['phase17-circle-reply-card-id'], momentsReplyTexts: ['隔离演练回复字卡'],
    recentDrawnRepliesV1: [], appliedEventIds: [], cardUsageOutbox: [], chatUsageOutbox: [], circleUsageOutbox: [], mailboxUsageOutbox: [],
    legacyModules: { kaomojiLibrary: [], customPokes: [], customIntros: [], customEmojis: [], customReplyGroups: [], customPokeGroups: [], kaomojiGroups: [] }
  };
  const mailbox = {
    version: 1,
    items: [{ id: 'phase17-letter', type: 'incoming', title: '隔离演练信件', content: '第十七阶段合成信件正文', originalContent: '第十七阶段合成信件正文', createdAt: 1_794_000_000_000, read: false, cardFragments: [], images: [{ id: 'phase17-mail-media', name: '隔离演练附件.png', mimeType: 'image/png', size: pngSize, order: 0 }] }],
    pending: [], usageOutbox: [], recentCardKeys: [], nextIncomingAt: 0,
    settings: { autoIncoming: false, autoReply: false, minIncomingMin: 720, maxIncomingMin: 2160, minReplyMin: 2, maxReplyMin: 15, cardCountMin: 2, cardCountMax: 4 }
  };
  const stickerLibrary = { version: 1, revision: 1, items: [sticker], tombstones: [], favorites: ['phase17-uploaded-sticker'] };
  const visitorBackup = { visitorRecords: [], visitorLastViewedCount: 0, visitorLastOnlineAt: 0, visitorNextAt: 0, backedUpAt: 1_794_000_000_000 };
  const media = [
    imageRecord('phase17-chat-media', null, 'chat'),
    imageRecord('phase17-sticker-media', null, 'sticker'),
    imageRecord('phase17-mail-media', null, 'mail'),
    imageRecord('phase17-circle-avatar', null, 'circle-avatar'),
    imageRecord('phase17-circle-cover', null, 'circle-cover'),
    imageRecord('phase17-circle-post-media', null, 'circle-image')
  ];
  return { main, circle, cards, mailbox, stickerLibrary, visitorBackup, media, pngBase64: PNG_BASE64, pngBytes: pngBytes.length };
}

export function createMissingMediaSeed() {
  const main = {
    currentPage: 'homePage', icons: {}, media: {},
    call: { active: false, phase: 'idle' }, callSettings: { enabled: false }, incomingCallSettings: { enabled: false },
    offline: { chatEnabled: false, lastChatAt: 1_794_000_000_000 },
    chatHistory: [{ id: 'phase17-missing-image', sender: 'other', type: 'image', mediaId: 'phase17-missing-media', mediaMime: 'image/png', mediaSize: 68, time: '09:00', read: true }],
    cardPhrases: [], stickers: [], stickerFavorites: [], stickerTombstones: [], cardUsageOutbox: []
  };
  const circle = { myName: '', otherName: '', myAvatar: '', otherAvatar: '', myCover: '', otherCover: '', dynamicCards: [], replyCards: [], autoPost: 'off', posts: [], pendingEvents: [], usageOutbox: [], notificationsEnabled: false, visitorRecords: [] };
  return {
    main, circle,
    cards: { version: 1, chatIds: [], chatTexts: [], momentsDynamicIds: [], momentsDynamicTexts: [], momentsReplyIds: [], momentsReplyTexts: [], recentDrawnRepliesV1: [], appliedEventIds: [] },
    mailbox: { version: 1, items: [], pending: [], usageOutbox: [], recentCardKeys: [], nextIncomingAt: 0, settings: { autoIncoming: false, autoReply: false } },
    stickerLibrary: { version: 1, revision: 0, items: [], tombstones: [], favorites: [] },
    visitorBackup: { visitorRecords: [], visitorLastViewedCount: 0, visitorLastOnlineAt: 0, visitorNextAt: 0 },
    media: [], pngBase64: '', pngBytes: 0
  };
}

