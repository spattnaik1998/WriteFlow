const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Distil raw notes into structured insights using GPT-4o.
 * Returns an array of idea objects.
 */
async function distillNotes({ bookTitle, author, chapterName, rawNotes, existingIdeas = [] }) {
  const systemPrompt = `You are an intellectual thinking partner helping a serious reader distil rough book notes into polished, insight-rich idea cards. You think like a combination of a philosopher, a scientist, and a great writer.

Your job is to:
1. Identify the core insights buried in the raw notes
2. Synthesise each insight into a clear, compelling 2-4 sentence articulation
3. Surface the deeper implication — what does this mean beyond the book?
4. Suggest 2-3 short tags per insight (UPPERCASE)
5. Return valid JSON only

Return an array of objects: { title, body, tags: string[], number }`;

  const userPrompt = `Book: "${bookTitle}" by ${author}
Chapter: ${chapterName}

Raw notes:
"""
${rawNotes}
"""

${existingIdeas.length ? `Existing insights to avoid duplicating: ${existingIdeas.map(i => i.title).join(', ')}` : ''}

Return 3-5 insight cards as JSON array. Each card: { title: string, body: string, tags: string[], number: number }`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 1500
  });

  const raw = JSON.parse(response.choices[0].message.content);
  return Array.isArray(raw) ? raw : (raw.insights || raw.ideas || raw.cards || []);
}

/**
 * Generate a contextual AI partner response based on
 * the user's message, book context, and their notes.
 * Optional libraryContext: [{ bookTitle, author, ideas: [{title, body}] }]
 */
async function chatWithPartner({ userMessage, bookTitle, author, notes, ideaCards, conversationHistory, libraryContext }) {
  let systemPrompt = `You are an insightful reading partner helping someone master ideas from the books they read. You have access to their raw notes and distilled idea cards.

Your personality:
- Intellectually curious and deeply engaged
- You ask probing questions that push thinking further
- You make unexpected connections across ideas
- You're direct but warm — like a brilliant friend who loves books
- You never give generic answers; everything is grounded in the specific book and notes

Current book: "${bookTitle}" by ${author}

Their notes summary:
${notes ? notes.slice(0, 1500) : 'No notes yet'}

Their distilled ideas:
${ideaCards ? ideaCards.map(c => `- ${c.title}: ${c.body}`).join('\n') : 'None yet'}

Guidelines:
- Reference specific things from their notes and ideas
- Push them to go deeper, not just summarise
- Highlight implications they may not have considered
- Use italics (*word*) for key concepts
- Keep responses under 200 words but make every word count`;

  if (libraryContext && libraryContext.length > 0) {
    systemPrompt += `\n\n### Your Library\nYou also have context from the reader's other books. Draw explicit cross-book connections when relevant — name the book and author:\n`;
    libraryContext.forEach(({ bookTitle: bt, author: au, ideas }) => {
      systemPrompt += `\n**${bt}** by ${au}:\n`;
      (ideas || []).slice(0, 5).forEach(idea => {
        systemPrompt += `  - ${idea.title}: ${idea.body ? idea.body.slice(0, 120) : ''}\n`;
      });
    });
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(conversationHistory || []).slice(-8), // Last 8 turns for context
    { role: 'user', content: userMessage }
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    temperature: 0.82,
    max_tokens: 400
  });

  return response.choices[0].message.content;
}

/**
 * Generate thematic clusters and a macro prose narrative
 * across multiple books' idea cards.
 * Input: books = [{ title, author, ideas: [{title, body, tags}] }]
 * Returns: { themes: [{name, ideas: [{bookTitle, ideaTitle, ideaBody}]}], narrative: string }
 */
async function generateMacroNarrative({ books }) {
  const booksText = books.map(b =>
    `### ${b.title} by ${b.author}\n` +
    (b.ideas || []).map(i => `- **${i.title}**: ${i.body || ''} [tags: ${(i.tags || []).join(', ')}]`).join('\n')
  ).join('\n\n');

  const systemPrompt = `You are a cross-library intellectual synthesist. Given idea cards from multiple books, your job is to:
1. Identify 3-5 thematic clusters that cut across the books (e.g. "The Architecture of Irrationality", "Systems That Fail Silently")
2. Assign each idea card to its best-fit theme, preserving book attribution
3. Write a compelling macro narrative (300-400 words) that traces a single intellectual thread connecting all the books — like an essay introduction

Return ONLY valid JSON: { "themes": [{ "name": string, "ideas": [{ "bookTitle": string, "ideaTitle": string, "ideaBody": string }] }], "narrative": string }`;

  const userPrompt = `Here are the idea cards from the reader's library:\n\n${booksText}\n\nGenerate thematic clusters and a macro narrative.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.75,
    max_tokens: 2500
  });

  const raw = JSON.parse(response.choices[0].message.content);
  return {
    themes:    raw.themes    || [],
    narrative: raw.narrative || ''
  };
}

/**
 * Classify a batch of articles as supporting/opposing/neutral
 * relative to a book's thesis.
 * Input: articles = [{title, snippet}], thesis = string
 * Returns: array of stance strings aligned by index
 */
async function classifyArticleStances({ articles, thesis }) {
  if (!articles || articles.length === 0) return [];

  const articleList = articles.map((a, i) =>
    `${i + 1}. Title: "${a.title}" | Snippet: "${(a.snippet || '').slice(0, 200)}"`
  ).join('\n');

  const systemPrompt = `You classify articles as supporting, opposing, or neutral relative to a book's thesis.
- "supporting": the article argues for, validates, or extends the thesis
- "opposing": the article argues against, critiques, or contradicts the thesis
- "neutral": the article discusses the topic without taking a clear stance

Return ONLY valid JSON: { "stances": ["supporting"|"opposing"|"neutral", ...] } — one entry per article, in the same order.`;

  const userPrompt = `Book thesis: "${thesis}"\n\nArticles:\n${articleList}\n\nClassify each article's stance toward the thesis.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 300
  });

  const raw = JSON.parse(response.choices[0].message.content);
  return raw.stances || articles.map(() => 'neutral');
}

/**
 * Generate a writing suggestion / continuation for the Write tab.
 */
async function suggestWriting({ bookTitle, author, currentText, ideaCards }) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a brilliant essayist helping someone write a synthesis of ideas from "${bookTitle}" by ${author}. Given their current draft and idea cards, suggest a compelling next paragraph or sentence. Write in their voice — thoughtful, precise, unhurried. Return only the suggested text, no preamble.`
      },
      {
        role: 'user',
        content: `Current draft:\n${currentText.slice(-600)}\n\nKey ideas:\n${ideaCards?.map(c => `• ${c.title}`).join('\n') || ''}\n\nSuggest a continuation (1-2 sentences or a paragraph):`
      }
    ],
    temperature: 0.75,
    max_tokens: 200
  });

  return response.choices[0].message.content.trim();
}

/**
 * Shared helper: builds a brand voice block for injection into prompts.
 */
function buildVoiceBlock(brandProfile) {
  if (!brandProfile) return '';
  const { positioning, audience, tone } = brandProfile;
  if (!positioning && !audience && !tone) return '';
  return `\n\n### Your Brand Voice\nPositioning: ${positioning || ''}\nTarget Audience: ${audience || ''}\nTone & Style: ${tone || ''}\n\nWrite in a voice consistent with this brand profile.\n`;
}

/**
 * Generate 3-5 tweet-ready insights from a chapter's notes.
 * Returns an array of tweet strings (each under 280 chars).
 */
async function generateTweets({ bookTitle, author, chapterName, notesContent, ideas = [], brandProfile = null }) {
  const voiceBlock = buildVoiceBlock(brandProfile);
  const systemPrompt = `You are an expert at distilling book insights into high-signal, shareable tweets. Each tweet must:
- Be under 280 characters
- Lead with a sharp, counterintuitive or thought-provoking insight
- Feel like it was written by a smart person, not a marketer
- NOT use hashtags or @mentions
- Stand completely alone as a compelling thought
${voiceBlock}
Return ONLY valid JSON: { "tweets": ["tweet1", "tweet2", ...] } — exactly 3 to 5 tweets.`;

  const userPrompt = `Book: "${bookTitle}" by ${author}
Chapter: ${chapterName || 'Key Insights'}

Notes:
"""
${(notesContent || '').slice(0, 2000)}
"""

${ideas.length ? `Already distilled ideas for context:\n${ideas.map(i => `• ${i.title}: ${i.body ? i.body.slice(0, 100) : ''}`).join('\n')}` : ''}

Generate 3-5 high-signal tweets derived from these notes.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.82,
    max_tokens: 800
  });

  const raw = JSON.parse(response.choices[0].message.content);
  return raw.tweets || [];
}

/**
 * Transform chapter notes into a coherent, numbered Twitter thread.
 * Each tweet in the thread builds on the previous to form a single narrative.
 * Returns an array of { number, text } objects.
 */
async function generateThread({ bookTitle, author, chapterName, notesContent, ideas = [], brandProfile = null }) {
  const voiceBlock = buildVoiceBlock(brandProfile);
  const systemPrompt = `You are an expert at transforming book chapter notes into compelling, coherent Twitter threads. The thread is a single narrative — not a list of disconnected points.

Rules:
- Open with a hook tweet: the most counterintuitive or striking insight. Make the reader need to keep reading.
- Each subsequent tweet flows naturally from the one before it — like paragraphs in an essay
- Every tweet starts with its number: "1/" "2/" etc. Do NOT include the number in the "text" field — just the body copy
- Each tweet body must be under 265 characters (the "X/" prefix adds ~3 chars toward the 280 limit)
- The final tweet is a landing: a synthesis that gives the reader something to carry away
- Write in an engaged, first-person-adjacent voice — as if a smart person is sharing a discovery
- No hashtags, no @mentions, no emoji, no filler phrases like "Thread:" or "Let's dive in"
${voiceBlock}
Return ONLY valid JSON: { "thread": [{ "number": 1, "text": "..." }, ...] } — 6 to 10 tweets.`;

  const userPrompt = `Book: "${bookTitle}" by ${author}
Chapter: ${chapterName || 'Key Insights'}

Notes:
"""
${(notesContent || '').slice(0, 2500)}
"""

${ideas.length
    ? `Distilled ideas to weave into the thread:\n${ideas.map(i => `• ${i.title}: ${i.body ? i.body.slice(0, 130) : ''}`).join('\n')}`
    : ''}

Transform these notes into a single, flowing Twitter thread.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.78,
    max_tokens: 1800
  });

  const raw = JSON.parse(response.choices[0].message.content);
  return raw.thread || [];
}

/**
 * Generate three LinkedIn post format variants from chapter notes.
 * Returns { insight, listicle, story } — each a string.
 */
async function generateLinkedInPosts({ bookTitle, author, chapterName, notesContent, ideas = [], brandProfile = null }) {
  const voiceBlock = buildVoiceBlock(brandProfile);
  const systemPrompt = `You are an expert LinkedIn content creator who turns book insights into three distinct post formats. Each post must feel authentic, not corporate.

Format 1 — INSIGHT (600–900 chars): Single idea expanded into hook + depth + CTA. Dense, intellectual.
Format 2 — LISTICLE: "X things I learned from [Book]…" — numbered, punchy, scannable.
Format 3 — STORY (600–900 chars): Personal observation or scenario that wraps a book insight. Narrative-first.
${voiceBlock}
Return ONLY valid JSON: { "insight": "...", "listicle": "...", "story": "..." }`;

  const userPrompt = `Book: "${bookTitle}" by ${author}
Chapter: ${chapterName || 'Key Insights'}

Notes:
"""
${(notesContent || '').slice(0, 2000)}
"""

${ideas.length ? `Key ideas distilled:\n${ideas.map(i => `• ${i.title}: ${i.body ? i.body.slice(0, 120) : ''}`).join('\n')}` : ''}

Generate all three LinkedIn post variants.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.78,
    max_tokens: 2000
  });

  const raw = JSON.parse(response.choices[0].message.content);
  return {
    insight:  raw.insight  || '',
    listicle: raw.listicle || '',
    story:    raw.story    || ''
  };
}

/**
 * Reformat a Twitter thread into a single cohesive LinkedIn long-form post.
 * thread: [{ number, text }]
 * Returns { post: string }
 */
async function repurposeThreadToLinkedIn({ thread, bookTitle, author, brandProfile = null }) {
  const voiceBlock = buildVoiceBlock(brandProfile);
  const threadText = (thread || []).map(t => `${t.number}/ ${t.text}`).join('\n\n');

  const systemPrompt = `You are an expert at repurposing Twitter threads into cohesive LinkedIn long-form posts. Transform the thread's narrative into a single, flowing post (1500–2000 chars). The result must read as a unified essay, not a list of tweets. Preserve the intellectual depth and hook of the thread opening.
${voiceBlock}
Return ONLY valid JSON: { "post": "..." }`;

  const userPrompt = `Book: "${bookTitle || ''}" by ${author || ''}

Twitter Thread:
${threadText}

Rewrite this as a single cohesive LinkedIn post (1500–2000 chars).`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.75,
    max_tokens: 900
  });

  const raw = JSON.parse(response.choices[0].message.content);
  return { post: raw.post || '' };
}

/**
 * Generate a newsletter digest from the past 7 days of distilled ideas.
 * books: [{ title, author, ideas: [{title, body, tags}] }]
 * topArticle: { title, url, domain } | null
 * Returns { subject_line, opening_hook, key_ideas[], article_pick, closing_thought }
 */
async function generateDigest({ books, topArticle, brandProfile = null }) {
  const voiceBlock = buildVoiceBlock(brandProfile);
  const booksText = books.map(b =>
    `### ${b.title} by ${b.author}\n` +
    (b.ideas || []).map(i => `- **${i.title}**: ${(i.body || '').slice(0, 200)}`).join('\n')
  ).join('\n\n');

  const articleText = topArticle
    ? `Top article this week: "${topArticle.title}" from ${topArticle.domain} (${topArticle.url})`
    : 'No saved articles this week.';

  const systemPrompt = `You are a newsletter writer helping a voracious reader share their week's intellectual discoveries. Write a digest that makes the reader's subscribers feel like they're getting a private briefing from someone who out-reads everyone.
${voiceBlock}
Return ONLY valid JSON:
{
  "subject_line": "...",
  "opening_hook": "...",
  "key_ideas": [{ "book": "...", "title": "...", "insight": "..." }],
  "article_pick": "...",
  "closing_thought": "..."
}
key_ideas: 3–5 items. Each insight: 1–2 punchy sentences. article_pick: 1–2 sentences on why the article matters.`;

  const userPrompt = `Ideas from this week's reading:

${booksText}

${articleText}

Generate the weekly newsletter digest.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.80,
    max_tokens: 2000
  });

  const raw = JSON.parse(response.choices[0].message.content);
  return {
    subject_line:    raw.subject_line    || '',
    opening_hook:    raw.opening_hook    || '',
    key_ideas:       raw.key_ideas       || [],
    article_pick:    raw.article_pick    || '',
    closing_thought: raw.closing_thought || ''
  };
}

/**
 * Detect logical contradictions between idea cards.
 * ideas: [{ id, title, body }]
 * Returns array of { idea_a_id, idea_b_id, contradiction_type, description, severity, resolution_options }
 */
async function detectContradictions({ ideas }) {
  const ideaList = ideas.map((idea, i) =>
    `${i + 1}. [ID:${idea.id}] "${idea.title}": ${(idea.body || '').slice(0, 200)}`
  ).join('\n');

  const systemPrompt = `You are a rigorous analytical philosopher. Identify logical contradictions between idea pairs.

A contradiction exists when:
- Two ideas make directly opposing claims (direct_conflict)
- Their underlying premises are mutually exclusive (incompatible_premises)
- They assume different scope/domain that makes them irreconcilable (scope_mismatch)

For each contradiction found, provide 2 resolution options.
severity: 0.0 (trivial) to 1.0 (fundamental).

Return ONLY valid JSON:
{
  "contradictions": [
    {
      "idea_a_id": "uuid",
      "idea_b_id": "uuid",
      "contradiction_type": "direct_conflict"|"incompatible_premises"|"scope_mismatch",
      "description": "string — explains the specific tension in 1-2 sentences",
      "severity": 0.0-1.0,
      "resolution_options": [
        { "option": "string", "reasoning": "string" },
        { "option": "string", "reasoning": "string" }
      ]
    }
  ]
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Analyze these ideas for contradictions:\n\n${ideaList}` }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 2000
  });

  const raw = JSON.parse(response.choices[0].message.content);
  return raw.contradictions || [];
}

/**
 * Reconstruct logical argument structure from raw notes.
 * Extracts: primary claim, premises (with strength tiers), conclusions,
 * logical gaps, and counter-arguments.
 *
 * Returns a structured argument object matching SKILL.md spec.
 */
async function reconstructArgument({
  bookTitle,
  author,
  chapterName,
  rawNotes,
  existingArgument = null
}) {
  const systemPrompt = `You are a logic analyst and argument reconstructor. Your job is to carefully read a reader's raw notes and extract the underlying argument structure.

You must identify and return:
1. **primary_claim**: The central thesis or main argument (1 sentence, clear and definitive)
2. **premises**: Core supporting claims, each labeled as:
   - "foundational": essential to the argument; if removed, argument collapses
   - "supporting": strengthens the argument but not strictly necessary
   - "contextual": provides background or examples
3. **conclusions**: Claims that logically follow from the premises
4. **logical_gaps**: Missing evidence, unstated assumptions, or inferential leaps
   - Classify as "missing_evidence", "unstated_assumption", or "inferential_leap"
   - Assign severity 1 (minor) to 5 (critical)
5. **counter_arguments**: Counterarguments the author acknowledges or should acknowledge
   - Rate as "strong", "moderate", or "weak"

Your analysis should be:
- Precise and scholarly (but accessible)
- Grounded in the text, not speculative
- Forgiving of messiness (notes are rough)
- Helpful for the reader to see the logical thread they're creating

Return valid JSON ONLY. No preamble.`;

  const userPrompt = `Book: "${bookTitle}" by ${author}
Chapter: ${chapterName}

Raw notes:
"""
${rawNotes}
"""

${existingArgument ? `Previous argument extraction (for reference, to avoid exact duplication):\nPrimary claim: ${existingArgument.primary_claim}` : ''}

Extract the argument structure from these notes. Return JSON with this exact shape:
{
  "primary_claim": string,
  "premises": [{ "text": string, "strength": "foundational|supporting|contextual", "evidence_count": number, "order": number }],
  "conclusions": [{ "text": string, "derived_from_premises": [number], "certainty": "high|medium|low" }],
  "logical_gaps": [{ "description": string, "type": "missing_evidence|unstated_assumption|inferential_leap", "severity": number }],
  "counter_arguments": [{ "claim": string, "why_presented": string, "strength": "strong|moderate|weak" }],
  "metadata": { "premise_count": number, "conclusion_count": number, "confidence_score": number, "reasoning_style": string }
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.6, // Lower temp for more consistent logical analysis
    max_tokens: 2500
  });

  const raw = JSON.parse(response.choices[0].message.content);

  // Defensive parsing: handle various response shapes
  return {
    primary_claim: raw.primary_claim || '',
    premises: (raw.premises || []).map((p, i) => ({
      text: p.text || '',
      strength: p.strength || 'supporting',
      evidence_count: p.evidence_count || 0,
      order: p.order !== undefined ? p.order : i
    })),
    conclusions: (raw.conclusions || []).map(c => ({
      text: c.text || '',
      derived_from_premises: c.derived_from_premises || [],
      certainty: c.certainty || 'medium'
    })),
    logical_gaps: (raw.logical_gaps || []).map(g => ({
      description: g.description || '',
      type: g.type || 'missing_evidence',
      severity: Math.min(5, Math.max(1, g.severity || 2))
    })),
    counter_arguments: (raw.counter_arguments || []).map(ca => ({
      claim: ca.claim || '',
      why_presented: ca.why_presented || '',
      strength: ca.strength || 'moderate'
    })),
    metadata: {
      premise_count: (raw.premises || []).length,
      conclusion_count: (raw.conclusions || []).length,
      confidence_score: raw.metadata?.confidence_score || 0.7,
      reasoning_style: raw.metadata?.reasoning_style || 'mixed'
    }
  };
}

/**
 * Extract concept structure from notes.
 * Returns: { concepts, relationships, hierarchy, metadata }
 */
async function generateConceptMap({
  bookTitle,
  author,
  chapterName,
  rawNotes,
  existingConcepts = null
}) {
  const systemPrompt = `You are a knowledge architect. Extract the concept structure from notes.

For each chapter, identify:
1. **Primary concepts**: Main ideas discussed
   - name: concept name
   - definition: 1-2 sentences explaining the concept
   - centrality: 0.0-1.0 (how central to the chapter)
   - type: "primary|secondary|supporting"

2. **Relationships**: How concepts connect
   - from: source concept name
   - to: target concept name
   - type: "causes", "exemplifies", "contradicts", "refines", "analogy"
   - strength: 0.0-1.0 (how strong the relationship)

3. **Hierarchy**: Abstract vs. concrete
   - parent: more abstract concept name
   - children: [concrete instances or specifications]

Return valid JSON only.`;

  const userPrompt = `Book: "${bookTitle}" by ${author}
Chapter: ${chapterName}

Raw notes:
"""
${rawNotes}
"""

Extract concept structure. Return JSON:
{
  "concepts": [
    {
      "name": string,
      "definition": string,
      "centrality": number,
      "type": "primary|secondary|supporting"
    }
  ],
  "relationships": [
    {
      "from": string,
      "to": string,
      "type": "causes|exemplifies|contradicts|refines|analogy",
      "strength": number
    }
  ],
  "hierarchy": [
    {
      "parent": string,
      "children": [string]
    }
  ],
  "metadata": {
    "concept_count": number,
    "primary_concepts": [string],
    "complexity_score": number
  }
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.65,
    max_tokens: 2500
  });

  const raw = JSON.parse(response.choices[0].message.content);

  // Defensive parsing
  return {
    concepts: (raw.concepts || []).map(c => ({
      name: c.name || '',
      definition: c.definition || '',
      centrality: Math.min(1, Math.max(0, c.centrality || 0.5)),
      type: c.type || 'secondary'
    })),
    relationships: (raw.relationships || []).map(r => ({
      from: r.from || '',
      to: r.to || '',
      type: r.type || 'refines',
      strength: Math.min(1, Math.max(0, r.strength || 0.5))
    })),
    hierarchy: (raw.hierarchy || []).map(h => ({
      parent: h.parent || '',
      children: Array.isArray(h.children) ? h.children : []
    })),
    metadata: {
      concept_count: (raw.concepts || []).length,
      primary_concepts: raw.metadata?.primary_concepts || [],
      complexity_score: Math.min(1, Math.max(0, raw.metadata?.complexity_score || 0.5))
    }
  };
}

/**
 * Generate a personal-assistant-style session recap.
 *
 * Takes the books/chapters the user worked on (with note snippets) and
 * returns a structured briefing the user can read before starting the
 * next session.
 *
 * @param {{ books: Array<{title,author,chapters}>, totalWords: number }} opts
 * @returns {{ summary: string, highlights: string[], prep_question: string }}
 */
async function generateSessionRecap({ books, totalWords }) {
  const systemPrompt = `You are a personal reading assistant. The user just ended a focused reading and note-taking session.
Your job is to generate a sharp, insightful session briefing that:
1. Summarises what the user was thinking about in 2-3 vivid sentences
2. Extracts 3-5 intellectual highlights — the most interesting, thought-provoking threads
3. Ends with one powerful open question that will reignite their thinking in the next session

Tone: warm, precise, intellectually engaged — like a brilliant friend who read over their shoulder.
Never use filler phrases. Be concrete. Reference actual ideas from the notes.
Return valid JSON: { "summary": string, "highlights": string[], "prep_question": string }`;

  const booksBlock = books.map(b => {
    const chapters = b.chapters
      .filter(c => c.snippet)
      .map(c => `  Chapter "${c.chapter_name}" (${c.word_count} words):\n  ${c.snippet}`)
      .join('\n\n');
    return `Book: "${b.title}"${b.author ? ` by ${b.author}` : ''}\n${chapters}`;
  }).join('\n\n---\n\n');

  const userPrompt = `Here is what the reader wrote in their last session (${totalWords} words total):\n\n${booksBlock}\n\nGenerate the session recap.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.82,
    max_tokens: 700
  });

  const raw = JSON.parse(response.choices[0].message.content);
  return {
    summary:       raw.summary        || '',
    highlights:    Array.isArray(raw.highlights) ? raw.highlights : [],
    prep_question: raw.prep_question  || ''
  };
}

module.exports = { distillNotes, chatWithPartner, suggestWriting, generateMacroNarrative, classifyArticleStances, generateTweets, generateThread, generateLinkedInPosts, repurposeThreadToLinkedIn, generateDigest, detectContradictions, reconstructArgument, generateConceptMap, generateSessionRecap };
