/* ============================================================
   TAROT CARD DATA — all 78 cards
   Each card has an upright and a reversed meaning.
   The frontend uses this for the demo readings.
   The backend sends these meanings to the AI so it can
   write a personal reading for the user's question.
   ------------------------------------------------------------
   Works in the browser (window.TAROT_CARDS) and in Node.js
   (module.exports) so both sides share one file.
   ============================================================ */

const TAROT_CARDS = [
  {
    "id": "major-0",
    "name": "The Fool",
    "arcana": "major",
    "number": 0,
    "upright": "新的开始，纯真，勇敢追梦",
    "reversed": "鲁莽，停滞不前，轻率决定",
    "upright_en": "New beginnings, innocence, chasing dreams",
    "reversed_en": "Recklessness, stagnation, rash decisions"
  },
  {
    "id": "major-1",
    "name": "The Magician",
    "arcana": "major",
    "number": 1,
    "upright": "创造力，行动力，心想事成",
    "reversed": "欺骗，优柔寡断，才华被埋没",
    "upright_en": "Creativity, willpower, making it happen",
    "reversed_en": "Deception, indecision, wasted talent"
  },
  {
    "id": "major-2",
    "name": "The High Priestess",
    "arcana": "major",
    "number": 2,
    "upright": "直觉，内在智慧，神秘",
    "reversed": "忽视直觉，被表象迷惑，情绪压抑",
    "upright_en": "Intuition, inner wisdom, mystery",
    "reversed_en": "Ignoring intuition, fooled by appearances, suppressed emotions"
  },
  {
    "id": "major-3",
    "name": "The Empress",
    "arcana": "major",
    "number": 3,
    "upright": "丰盛，母性，创造与滋养",
    "reversed": "依赖，创造力受阻，过度保护",
    "upright_en": "Abundance, motherhood, creation and nurturing",
    "reversed_en": "Dependence, blocked creativity, overprotectiveness"
  },
  {
    "id": "major-4",
    "name": "The Emperor",
    "arcana": "major",
    "number": 4,
    "upright": "权威，稳定，掌控力",
    "reversed": "专制，失控，固执己见",
    "upright_en": "Authority, stability, control",
    "reversed_en": "Tyranny, loss of control, stubbornness"
  },
  {
    "id": "major-5",
    "name": "The Hierophant",
    "arcana": "major",
    "number": 5,
    "upright": "信仰，传统，师者指引",
    "reversed": "打破常规，教条束缚，质疑权威",
    "upright_en": "Faith, tradition, guidance from a mentor",
    "reversed_en": "Breaking convention, dogma, challenging authority"
  },
  {
    "id": "major-6",
    "name": "The Lovers",
    "arcana": "major",
    "number": 6,
    "upright": "真爱，和谐，结合",
    "reversed": "失衡，错误选择，关系裂痕",
    "upright_en": "True love, harmony, union",
    "reversed_en": "Imbalance, poor choices, rifts in a relationship"
  },
  {
    "id": "major-7",
    "name": "The Chariot",
    "arcana": "major",
    "number": 7,
    "upright": "意志力，胜利，勇往直前",
    "reversed": "失控，方向迷失，原地空转",
    "upright_en": "Willpower, victory, charging ahead",
    "reversed_en": "Loss of control, lost direction, spinning wheels"
  },
  {
    "id": "major-8",
    "name": "Strength",
    "arcana": "major",
    "number": 8,
    "upright": "勇气，耐心，以柔克刚",
    "reversed": "自我怀疑，软弱，情绪失控",
    "upright_en": "Courage, patience, gentleness overcomes force",
    "reversed_en": "Self-doubt, weakness, losing control of emotions"
  },
  {
    "id": "major-9",
    "name": "The Hermit",
    "arcana": "major",
    "number": 9,
    "upright": "内省，寻找答案，独处",
    "reversed": "孤立，迷失方向，拒绝成长",
    "upright_en": "Introspection, seeking answers, solitude",
    "reversed_en": "Isolation, lost direction, refusing to grow"
  },
  {
    "id": "major-10",
    "name": "Wheel of Fortune",
    "arcana": "major",
    "number": 10,
    "upright": "转机，好运，命运之轮转动",
    "reversed": "厄运，抗拒改变，循环重复",
    "upright_en": "Turning point, good fortune, the wheel turns",
    "reversed_en": "Bad luck, resisting change, repeating cycles"
  },
  {
    "id": "major-11",
    "name": "Justice",
    "arcana": "major",
    "number": 11,
    "upright": "公正，真相，因果",
    "reversed": "不公，偏见，逃避责任",
    "upright_en": "Fairness, truth, cause and effect",
    "reversed_en": "Injustice, bias, dodging responsibility"
  },
  {
    "id": "major-12",
    "name": "The Hanged Man",
    "arcana": "major",
    "number": 12,
    "upright": "换位思考，等待，牺牲",
    "reversed": "无谓牺牲，拖延，执念",
    "upright_en": "New perspective, waiting, sacrifice",
    "reversed_en": "Pointless sacrifice, delays, fixation"
  },
  {
    "id": "major-13",
    "name": "Death",
    "arcana": "major",
    "number": 13,
    "upright": "结束与新生，蜕变，放下",
    "reversed": "抗拒改变，停滞，执着过去",
    "upright_en": "Endings and new beginnings, transformation, letting go",
    "reversed_en": "Resisting change, stagnation, clinging to the past"
  },
  {
    "id": "major-14",
    "name": "Temperance",
    "arcana": "major",
    "number": 14,
    "upright": "平衡，节制，调和",
    "reversed": "失衡，极端，急于求成",
    "upright_en": "Balance, moderation, harmony",
    "reversed_en": "Imbalance, extremes, rushing things"
  },
  {
    "id": "major-15",
    "name": "The Devil",
    "arcana": "major",
    "number": 15,
    "upright": "执念，束缚，欲望",
    "reversed": "挣脱束缚，觉醒，重获自由",
    "upright_en": "Obsession, bondage, desire",
    "reversed_en": "Breaking free, awakening, regained freedom"
  },
  {
    "id": "major-16",
    "name": "The Tower",
    "arcana": "major",
    "number": 16,
    "upright": "剧变，真相揭露，旧结构崩塌",
    "reversed": "逃避灾难，延迟的剧变，内心动荡",
    "upright_en": "Upheaval, truth revealed, old structures fall",
    "reversed_en": "Avoiding disaster, delayed upheaval, inner turmoil"
  },
  {
    "id": "major-17",
    "name": "The Star",
    "arcana": "major",
    "number": 17,
    "upright": "希望，疗愈，灵感",
    "reversed": "失望，迷茫，信心受挫",
    "upright_en": "Hope, healing, inspiration",
    "reversed_en": "Disappointment, confusion, shaken confidence"
  },
  {
    "id": "major-18",
    "name": "The Moon",
    "arcana": "major",
    "number": 18,
    "upright": "不安，幻象，潜意识",
    "reversed": "迷雾散去，真相浮现，走出恐惧",
    "upright_en": "Anxiety, illusion, the subconscious",
    "reversed_en": "Fog lifting, truth emerging, moving past fear"
  },
  {
    "id": "major-19",
    "name": "The Sun",
    "arcana": "major",
    "number": 19,
    "upright": "喜悦，成功，光明，活力",
    "reversed": "短暂阴霾，成功延迟，自我怀疑",
    "upright_en": "Joy, success, light, vitality",
    "reversed_en": "Temporary gloom, delayed success, self-doubt"
  },
  {
    "id": "major-20",
    "name": "Judgement",
    "arcana": "major",
    "number": 20,
    "upright": "觉醒，召唤，重生",
    "reversed": "自我批判，错过召唤，犹豫不决",
    "upright_en": "Awakening, calling, rebirth",
    "reversed_en": "Self-criticism, missed calling, indecision"
  },
  {
    "id": "major-21",
    "name": "The World",
    "arcana": "major",
    "number": 21,
    "upright": "圆满，达成，新的循环",
    "reversed": "功败垂成，圆满延迟，画地为牢",
    "upright_en": "Completion, achievement, a new cycle",
    "reversed_en": "Near miss, delayed completion, self-imposed limits"
  },
  {
    "id": "wands-ace",
    "name": "Ace of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "新的热情，灵感乍现，行动的火花",
    "reversed": "热情熄灭，方向不明，冲动",
    "upright_en": "New passion, a spark of inspiration, the fire to act",
    "reversed_en": "Passion fizzles, unclear direction, impulsiveness"
  },
  {
    "id": "wands-2",
    "name": "Two of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "规划，远见，抉择",
    "reversed": "计划受阻，眼光短浅，犹豫",
    "upright_en": "Planning, vision, a choice to make",
    "reversed_en": "Plans blocked, shortsightedness, hesitation"
  },
  {
    "id": "wands-3",
    "name": "Three of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "远景，拓展，初步成果",
    "reversed": "延迟，计划落空，目光受限",
    "upright_en": "Foresight, expansion, early results",
    "reversed_en": "Delays, plans falling through, limited vision"
  },
  {
    "id": "wands-4",
    "name": "Four of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "庆祝，和谐，安定",
    "reversed": "过渡期，根基不稳，庆祝推迟",
    "upright_en": "Celebration, harmony, stability",
    "reversed_en": "Transition, shaky foundations, postponed celebration"
  },
  {
    "id": "wands-5",
    "name": "Five of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "竞争，分歧，磨合",
    "reversed": "内耗结束，和解，避开冲突",
    "upright_en": "Competition, disagreement, finding your rhythm",
    "reversed_en": "Infighting ends, reconciliation, sidestepping conflict"
  },
  {
    "id": "wands-6",
    "name": "Six of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "胜利，认可，自信",
    "reversed": "骄傲自满，失败，名不副实",
    "upright_en": "Victory, recognition, confidence",
    "reversed_en": "Arrogance, defeat, all talk no substance"
  },
  {
    "id": "wands-7",
    "name": "Seven of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "坚守立场，迎战，以一敌众",
    "reversed": "寡不敌众，退缩，立场动摇",
    "upright_en": "Standing your ground, rising to the challenge, one against many",
    "reversed_en": "Outnumbered, backing down, wavering resolve"
  },
  {
    "id": "wands-8",
    "name": "Eight of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "迅速，消息，好事将至",
    "reversed": "延误，混乱，操之过急",
    "upright_en": "Speed, news, good things incoming",
    "reversed_en": "Delays, confusion, rushing in too fast"
  },
  {
    "id": "wands-9",
    "name": "Nine of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "坚韧，最后一搏，严阵以待",
    "reversed": "疲惫，固执，过度防备",
    "upright_en": "Resilience, one last push, battle-ready",
    "reversed_en": "Exhaustion, stubbornness, over-defensiveness"
  },
  {
    "id": "wands-10",
    "name": "Ten of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "重担，责任，咬牙坚持",
    "reversed": "放下重担，推卸责任，筋疲力尽",
    "upright_en": "Heavy burden, responsibility, gritting your teeth",
    "reversed_en": "Laying down the burden, shirking duty, burnout"
  },
  {
    "id": "wands-page",
    "name": "Page of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "探索，好奇心，新消息",
    "reversed": "浮躁，三分钟热度，坏消息",
    "upright_en": "Exploration, curiosity, news on the way",
    "reversed_en": "Restlessness, fleeting enthusiasm, bad news"
  },
  {
    "id": "wands-knight",
    "name": "Knight of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "冲劲，冒险，迅速行动",
    "reversed": "鲁莽，虎头蛇尾，横冲直撞",
    "upright_en": "Drive, adventure, swift action",
    "reversed_en": "Recklessness, fizzling out, charging blindly"
  },
  {
    "id": "wands-queen",
    "name": "Queen of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "热情，自信，魅力四射",
    "reversed": "急躁，自我中心，嫉妒",
    "upright_en": "Passion, confidence, magnetic charm",
    "reversed_en": "Impatience, self-centeredness, jealousy"
  },
  {
    "id": "wands-king",
    "name": "King of Wands",
    "arcana": "minor",
    "suit": "wands",
    "upright": "领导力，远见，果断",
    "reversed": "专横，急功近利，夸夸其谈",
    "upright_en": "Leadership, vision, decisiveness",
    "reversed_en": "Domineering, cutting corners, empty boasting"
  },
  {
    "id": "cups-ace",
    "name": "Ace of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "新的感情，爱，心灵丰盈",
    "reversed": "情感压抑，爱受阻，空虚",
    "upright_en": "New love, affection, emotional fullness",
    "reversed_en": "Suppressed feelings, blocked love, emptiness"
  },
  {
    "id": "cups-2",
    "name": "Two of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "相知相惜，合作，情谊",
    "reversed": "失衡，误会，貌合神离",
    "upright_en": "Mutual understanding, partnership, affection",
    "reversed_en": "Imbalance, misunderstandings, drifting apart"
  },
  {
    "id": "cups-3",
    "name": "Three of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "欢聚，友情，值得庆祝",
    "reversed": "闲言碎语，排挤，狂欢后的空虚",
    "upright_en": "Gatherings, friendship, cause to celebrate",
    "reversed_en": "Gossip, exclusion, post-party emptiness"
  },
  {
    "id": "cups-4",
    "name": "Four of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "倦怠，审视内心，机会在侧",
    "reversed": "重燃兴趣，走出低谷，抓住机会",
    "upright_en": "Apathy, soul-searching, opportunity at hand",
    "reversed_en": "Renewed interest, climbing out of the rut, seizing the chance"
  },
  {
    "id": "cups-5",
    "name": "Five of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "失落，哀伤，为打翻的奶哭泣",
    "reversed": "走出伤痛，原谅，重新振作",
    "upright_en": "Loss, grief, crying over spilled milk",
    "reversed_en": "Moving past pain, forgiveness, bouncing back"
  },
  {
    "id": "cups-6",
    "name": "Six of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "怀旧，纯真，旧人旧事",
    "reversed": "沉溺过去，幼稚，难以释怀",
    "upright_en": "Nostalgia, innocence, old faces and memories",
    "reversed_en": "Stuck in the past, childishness, unable to let go"
  },
  {
    "id": "cups-7",
    "name": "Seven of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "幻想，选择太多，雾里看花",
    "reversed": "看清现实，做出选择，脚踏实地",
    "upright_en": "Fantasies, too many choices, wishful haze",
    "reversed_en": "Seeing clearly, making a choice, staying grounded"
  },
  {
    "id": "cups-8",
    "name": "Eight of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "离开，追寻更深的意义",
    "reversed": "逃避，徘徊，半途而废",
    "upright_en": "Walking away, seeking deeper meaning",
    "reversed_en": "Avoidance, dithering, giving up halfway"
  },
  {
    "id": "cups-9",
    "name": "Nine of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "愿望成真，满足，犒赏自己",
    "reversed": "贪心不足，愿望落空，物质空虚",
    "upright_en": "Wishes fulfilled, contentment, treat yourself",
    "reversed_en": "Greed, dashed wishes, hollow materialism"
  },
  {
    "id": "cups-10",
    "name": "Ten of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "幸福圆满，家庭和乐",
    "reversed": "家庭矛盾，表面和谐，期望落差",
    "upright_en": "Joy and fulfillment, family harmony",
    "reversed_en": "Family conflict, surface harmony, unmet expectations"
  },
  {
    "id": "cups-page",
    "name": "Page of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "浪漫，温柔，直觉敏锐",
    "reversed": "情绪化，幼稚，多愁善感",
    "upright_en": "Romance, tenderness, sharp intuition",
    "reversed_en": "Moodiness, childishness, oversensitivity"
  },
  {
    "id": "cups-knight",
    "name": "Knight of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "浪漫追求，理想主义，跟随内心",
    "reversed": "空许诺言，情绪反复，不切实际",
    "upright_en": "Romantic pursuit, idealism, following your heart",
    "reversed_en": "Empty promises, mood swings, unrealistic dreams"
  },
  {
    "id": "cups-queen",
    "name": "Queen of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "温柔，善解人意，包容",
    "reversed": "敏感多疑，被情绪淹没，界限模糊",
    "upright_en": "Gentleness, empathy, acceptance",
    "reversed_en": "Oversensitive, drowning in emotion, blurred boundaries"
  },
  {
    "id": "cups-king",
    "name": "King of Cups",
    "arcana": "minor",
    "suit": "cups",
    "upright": "沉稳，情绪成熟，值得信赖",
    "reversed": "压抑情感，操控，冷暴力",
    "upright_en": "Composure, emotional maturity, trustworthiness",
    "reversed_en": "Repressed feelings, manipulation, cold treatment"
  },
  {
    "id": "swords-ace",
    "name": "Ace of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "真相，思路清晰，突破",
    "reversed": "混乱，误判，言语伤人",
    "upright_en": "Truth, mental clarity, breakthrough",
    "reversed_en": "Confusion, misjudgment, hurtful words"
  },
  {
    "id": "swords-2",
    "name": "Two of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "僵局，回避决定，蒙眼抉择",
    "reversed": "打破僵局，直面真相，信息过载",
    "upright_en": "Stalemate, avoiding a decision, choosing blind",
    "reversed_en": "Breaking the deadlock, facing the truth, information overload"
  },
  {
    "id": "swords-3",
    "name": "Three of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "心痛，真相刺痛，分离",
    "reversed": "伤口愈合，释然，走出心痛",
    "upright_en": "Heartbreak, painful truth, separation",
    "reversed_en": "Healing wounds, release, moving past heartbreak"
  },
  {
    "id": "swords-4",
    "name": "Four of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "休养，暂停，恢复元气",
    "reversed": "失眠焦虑，过度休息，逃避现实",
    "upright_en": "Rest, pause, recharging",
    "reversed_en": "Sleepless anxiety, resting too long, escaping reality"
  },
  {
    "id": "swords-5",
    "name": "Five of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "惨胜，纷争，得不偿失",
    "reversed": "放下争执，和解，及时止损",
    "upright_en": "Hollow victory, conflict, winning at a cost",
    "reversed_en": "Dropping the fight, reconciliation, cutting losses"
  },
  {
    "id": "swords-6",
    "name": "Six of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "过渡，渐入佳境，离开风暴",
    "reversed": "困于原地，旧事重提，进展缓慢",
    "upright_en": "Transition, things improving, leaving the storm",
    "reversed_en": "Stuck in place, old issues resurfacing, slow progress"
  },
  {
    "id": "swords-7",
    "name": "Seven of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "策略，独行，智取",
    "reversed": "弄巧成拙，谎言败露，孤立无援",
    "upright_en": "Strategy, going solo, winning by wit",
    "reversed_en": "Schemes backfiring, lies exposed, no backup"
  },
  {
    "id": "swords-8",
    "name": "Eight of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "自我设限，困局，作茧自缚",
    "reversed": "重获自由，打破心魔，看见出路",
    "upright_en": "Self-imposed limits, feeling trapped, tied in knots",
    "reversed_en": "Regained freedom, breaking inner demons, seeing a way out"
  },
  {
    "id": "swords-9",
    "name": "Nine of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "失眠，焦虑，噩梦",
    "reversed": "走出阴霾，希望重现，如释重负",
    "upright_en": "Sleeplessness, anxiety, nightmares",
    "reversed_en": "Emerging from the dark, hope returns, relief"
  },
  {
    "id": "swords-10",
    "name": "Ten of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "触底，结束，否极泰来",
    "reversed": "复苏，阴影散去，缓慢好转",
    "upright_en": "Rock bottom, an ending, the worst is over",
    "reversed_en": "Recovery, shadows lifting, slow improvement"
  },
  {
    "id": "swords-page",
    "name": "Page of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "好奇，敏锐，新想法",
    "reversed": "多疑，口舌是非，刻薄",
    "upright_en": "Curiosity, sharpness, new ideas",
    "reversed_en": "Suspicion, gossip, spitefulness"
  },
  {
    "id": "swords-knight",
    "name": "Knight of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "果断，快刀斩乱麻，直言",
    "reversed": "冲动，言语伤人，好斗",
    "upright_en": "Decisiveness, cutting through the mess, straight talk",
    "reversed_en": "Impulsiveness, hurtful words, aggression"
  },
  {
    "id": "swords-queen",
    "name": "Queen of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "独立，睿智，经验老道",
    "reversed": "刻薄，冷漠，愤世嫉俗",
    "upright_en": "Independence, wisdom, hard-won experience",
    "reversed_en": "Bitterness, coldness, cynicism"
  },
  {
    "id": "swords-king",
    "name": "King of Swords",
    "arcana": "minor",
    "suit": "swords",
    "upright": "理性，公正，逻辑清晰",
    "reversed": "冷酷，操控，滥用理性",
    "upright_en": "Reason, fairness, clear logic",
    "reversed_en": "Coldness, manipulation, twisted logic"
  },
  {
    "id": "pentacles-ace",
    "name": "Ace of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "新财机，务实开端，机遇",
    "reversed": "财机错失，计划不周，贪小失大",
    "upright_en": "New financial prospects, practical start, opportunity",
    "reversed_en": "Missed chances, poor planning, penny-wise and pound-foolish"
  },
  {
    "id": "pentacles-2",
    "name": "Two of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "平衡，多线兼顾，灵活",
    "reversed": "失衡，分身乏术，顾此失彼",
    "upright_en": "Balance, juggling it all, flexibility",
    "reversed_en": "Imbalance, stretched too thin, dropping the ball"
  },
  {
    "id": "pentacles-3",
    "name": "Three of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "匠心，合作，技艺受赏",
    "reversed": "敷衍，团队不合，怀才不遇",
    "upright_en": "Craftsmanship, teamwork, skill recognized",
    "reversed_en": "Sloppy work, team friction, talent unrecognized"
  },
  {
    "id": "pentacles-4",
    "name": "Four of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "守成，安全感，稳固",
    "reversed": "吝啬，守财，抱残守缺",
    "upright_en": "Holding steady, security, stability",
    "reversed_en": "Stinginess, hoarding, clinging to the old"
  },
  {
    "id": "pentacles-5",
    "name": "Five of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "困顿，艰难，雪中送炭",
    "reversed": "走出困境，贵人相助，否极泰来",
    "upright_en": "Hardship, tough times, help in need",
    "reversed_en": "Out of the woods, timely help, the worst is over"
  },
  {
    "id": "pentacles-6",
    "name": "Six of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "慷慨，施与受，资源流动",
    "reversed": "施舍不均，债务，人情负担",
    "upright_en": "Generosity, giving and receiving, resources flowing",
    "reversed_en": "Unequal giving, debt, strings attached"
  },
  {
    "id": "pentacles-7",
    "name": "Seven of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "耕耘，评估，耐心等待",
    "reversed": "白费力气，急功近利，方向错误",
    "upright_en": "Hard work, assessment, patient waiting",
    "reversed_en": "Wasted effort, chasing quick wins, wrong direction"
  },
  {
    "id": "pentacles-8",
    "name": "Eight of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "精进，专注，工匠精神",
    "reversed": "敷衍了事，倦怠，完美主义",
    "upright_en": "Mastery, focus, craftsman dedication",
    "reversed_en": "Cutting corners, burnout, perfectionism"
  },
  {
    "id": "pentacles-9",
    "name": "Nine of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "丰足，独立，优雅收获",
    "reversed": "财来财去，过度劳累，物质依赖",
    "upright_en": "Abundance, independence, graceful rewards",
    "reversed_en": "Money comes and goes, overwork, material dependence"
  },
  {
    "id": "pentacles-10",
    "name": "Ten of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "富足传承，家族兴旺，长远",
    "reversed": "家业纷争，短视，财富缩水",
    "upright_en": "Wealth and legacy, family prosperity, the long view",
    "reversed_en": "Family feuds over money, shortsightedness, shrinking wealth"
  },
  {
    "id": "pentacles-page",
    "name": "Page of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "务实，学习新技能，好机会",
    "reversed": "好高骛远，错失机会，学而不精",
    "upright_en": "Practicality, learning new skills, a good opening",
    "reversed_en": "Overreaching, missed opportunities, half-learned skills"
  },
  {
    "id": "pentacles-knight",
    "name": "Knight of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "踏实，靠谱，稳步前进",
    "reversed": "固执，停滞不前，一成不变",
    "upright_en": "Steadiness, reliability, moving forward surely",
    "reversed_en": "Stubbornness, going nowhere, stuck in routine"
  },
  {
    "id": "pentacles-queen",
    "name": "Queen of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "持家，富足，体贴入微",
    "reversed": "操劳过度，物质焦虑，忽视自己",
    "upright_en": "Homemaking, abundance, thoughtful care",
    "reversed_en": "Overwork, money anxiety, neglecting yourself"
  },
  {
    "id": "pentacles-king",
    "name": "King of Pentacles",
    "arcana": "minor",
    "suit": "pentacles",
    "upright": "成就，稳健，值得托付",
    "reversed": "拜金，守旧，唯利是图",
    "upright_en": "Achievement, steadiness, someone you can count on",
    "reversed_en": "Materialism, conservatism, profit above all"
  }
];


// Make it loadable from Node.js too (backend reuses this file)
if (typeof module !== "undefined" && module.exports) {
  module.exports = TAROT_CARDS;
}
