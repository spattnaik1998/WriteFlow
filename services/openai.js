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
 * Generate 3-5 tweet-ready insights from a chapter's notes.
 * Returns an array of tweet strings (each under 280 chars).
 */
async function generateTweets({ bookTitle, author, chapterName, notesContent, ideas = [] }) {
  const systemPrompt = `You are an expert at distilling book insights into high-signal, shareable tweets. Each tweet must:
- Be under 280 characters
- Lead with a sharp, counterintuitive or thought-provoking insight
- Feel like it was written by a smart person, not a marketer
- NOT use hashtags or @mentions
- Stand completely alone as a compelling thought

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
async function generateThread({ bookTitle, author, chapterName, notesContent, ideas = [] }) {
  const systemPrompt = `You are an expert at transforming book chapter notes into compelling, coherent Twitter threads. The thread is a single narrative — not a list of disconnected points.

Rules:
- Open with a hook tweet: the most counterintuitive or striking insight. Make the reader need to keep reading.
- Each subsequent tweet flows naturally from the one before it — like paragraphs in an essay
- Every tweet starts with its number: "1/" "2/" etc. Do NOT include the number in the "text" field — just the body copy
- Each tweet body must be under 265 characters (the "X/" prefix adds ~3 chars toward the 280 limit)
- The final tweet is a landing: a synthesis that gives the reader something to carry away
- Write in an engaged, first-person-adjacent voice — as if a smart person is sharing a discovery
- No hashtags, no @mentions, no emoji, no filler phrases like "Thread:" or "Let's dive in"

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

module.exports = { distillNotes, chatWithPartner, suggestWriting, generateMacroNarrative, classifyArticleStances, generateTweets, generateThread };
