// Comment keyword -> the DM Tara's bot sends (one private reply per comment) and a short public reply under the comment. Words match whole words, any case. Every DM ends with the AI + education-only line (CLAUDE.md rules 1 and 9).
// Add a keyword: copy the SIP block, change the words, the DM and the public replies; push; Netlify redeploys.
export default {
  "SIP": {
    "words": [
      "sip",
      "एसआईपी"
    ],
    "dm": "Yeh lo aapka free SIP calculator 👇\nhttps://tara-sip-calculator.netlify.app\n\nMonthly SIP, kitne saal aur step-up daalo: seedha dikh jayega kitna ban sakta hai (andaaza, guarantee nahi).\n\nTara ek AI creator hai. Education only, not investment advice.",
    "public": [
      "DM bhej diya ✅",
      "Check karo DM 📩",
      "Bhej diya, DM dekho ✅"
    ]
  }
};
