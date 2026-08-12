// Shared between server.js and the client (script.js/index.html), single source of truth for
// values that used to be hardcoded in two separate places, per Gatekeeper finding 2026-08-12:
// the exact same drift risk already fixed once for VOTE_SECONDS existed here too (ALLOWED_EMOJI,
// REACTION_EMOJI, MAX_CUSTOM_QUESTION_LEN, and the question-count options were all duplicated).
const ALLOWED_EMOJI = ['😂', '🔥', '😎', '🥳', '🎉', '👑', '💥', '🦊', '🍕', '⚡'];
const EMOJI_LABELS = { '😂': 'צוחק', '🔥': 'אש', '😎': 'מגניב', '🥳': 'חוגג', '🎉': 'קונפטי', '👑': 'כתר', '💥': 'פיצוץ', '🦊': 'שועל', '🍕': 'פיצה', '⚡': 'ברק' };
const REACTION_EMOJI = ['🤣', '😱', '🔥', '👏'];
const REACTION_LABELS = { '🤣': 'צחוק', '😱': 'הלם', '🔥': 'אש', '👏': 'מחיאות כפיים' };
const MAX_CUSTOM_QUESTION_LEN = 120;
// 3 added per idea-manager brainstorm 2026-08-12 ("סבב בזק"): a quick round for when time is
// short, same mechanism as 5/10/15, just fewer questions.
const QUESTION_COUNT_OPTIONS = [3, 5, 10, 15];

if (typeof module !== 'undefined') {
  module.exports = { ALLOWED_EMOJI, EMOJI_LABELS, REACTION_EMOJI, REACTION_LABELS, MAX_CUSTOM_QUESTION_LEN, QUESTION_COUNT_OPTIONS };
}
