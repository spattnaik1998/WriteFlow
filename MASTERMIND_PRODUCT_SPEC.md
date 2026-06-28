# WriteFlow Mastermind Product Specification

Version: 1.0
Date: June 27, 2026
Status: Strategic product specification
Audience: Founder, product, design, and engineering agents

## 1. Product Thesis

WriteFlow should become the most advanced personal ideas distillation engine in the world.

The product is not a notes app. It is not a book summary app. It is not a writing assistant with a library attached. WriteFlow is a cognitive engine that converts reading into durable mental models, and converts those mental models into original arguments, essays, theories, and decisions.

The central promise is:

> Read deeply. Think structurally. Remember permanently. Create originally.

The product should feel like a science-fiction interface for serious thought. A user reads a book, writes rough notes, and WriteFlow turns those notes into a living intellectual system: concepts, arguments, tensions, examples, memory prompts, applications, cross-book connections, and writing seeds. The goal is not just that the user can retrieve what they read. The goal is that the book changes the structure of the user's mind.

## 2. North Star

The north star is not notes created, words written, or chats sent.

The north star is:

> Durable ideas mastered and reused in original work.

Supporting metrics:

- Mastered concepts per book
- Ideas revisited within 30 days
- Cross-book connections created per month
- User-generated arguments or essays that reuse mastered ideas
- Recall accuracy over spaced review
- Number of personal theories evolved from library-wide synthesis

## 3. Target User

WriteFlow is for intellectually ambitious readers who want reading to compound.

Primary users:

- Writers, founders, researchers, strategists, engineers, analysts, and students of serious ideas
- People who read nonfiction, papers, essays, and books to build a worldview
- People who do not want passive summaries, but want active transformation

The ideal user thinks:

- "I do not just want to remember this book. I want it to become part of how I reason."
- "I want my reading across books to produce original ideas."
- "I want a system that pressures me to think better than I naturally would."

## 4. Product Category

WriteFlow should define a new category:

> Cognitive infrastructure for idea mastery.

Existing categories are insufficient:

- Notes apps store information.
- Flashcard apps test recall.
- Book summary apps compress other people's thinking.
- Writing assistants generate prose.
- Knowledge graphs connect documents.

WriteFlow should do all of these only when they serve the deeper purpose: transforming reading into structured, remembered, generative thought.

## 5. Core Product Loop

The product loop should be:

1. Capture rough notes
2. Distill them into idea objects
3. Reconstruct the author's reasoning
4. Convert insights into memory assets
5. Test the user's understanding
6. Connect the idea across the library
7. Use the idea in writing or analysis
8. Track mastery and revisit at the right time
9. Detect emergent personal theories

This loop turns reading from a passive archive into a compounding intellectual practice.

## 6. Atomic Unit: The Living Idea

The app should stop treating notes as the atomic unit. The atomic unit is the living idea.

A living idea is not just a card with a title and body. It is a structured cognitive object with:

- Claim: what the idea asserts
- Definition: what the idea means
- Mechanism: how it works
- Evidence: what supports it
- Example: where it appears
- Boundary: where it stops applying
- Counterargument: what challenges it
- Tensions: what it conflicts with
- Connections: what it modifies, extends, or resembles
- Memory prompts: how the user will retain it
- Applications: how the user can use it
- Writing seeds: what original work it could produce
- Mastery state: whether the user can explain, apply, and critique it

Every major feature should enrich, test, or apply living ideas.

## 7. Product Pillars

### 7.1 Distillation

WriteFlow must transform messy notes into high-quality intellectual structure.

Distillation should produce:

- Core concepts
- Claims
- Causal mechanisms
- Definitions
- Examples
- Important distinctions
- Surprising implications
- Open questions
- Compressed principles

Distillation is not summarization. The system should avoid bland "chapter says X" output. It should extract what is reusable for thought.

### 7.2 Reconstruction

WriteFlow must rebuild the intellectual machinery behind a book.

For each chapter or book, the system should identify:

- Main thesis
- Premises
- Evidence
- Causal chain
- Hidden assumptions
- Logical leaps
- Counterarguments
- Internal contradictions
- Scope limits

This allows the user to see not only what an author believes, but how the author thinks.

### 7.3 Integration

WriteFlow must connect new ideas to the user's whole library.

The system should detect:

- Repeated concepts under different names
- Books that disagree about the same problem
- Concepts that transfer across domains
- Theories that evolve over multiple books
- Recurring personal fascinations in the user's reading

The product should make the user feel that every book enters a larger intellectual universe.

### 7.4 Interrogation

WriteFlow must pressure the user to understand, not merely collect.

The system should ask the user to:

- Explain ideas in their own words
- Apply ideas to unfamiliar domains
- Defend an idea against critique
- Attack an idea as a skeptic
- Compare the idea to other ideas
- Generate examples and counterexamples
- Compress the idea into a principle

The user should not be allowed to confuse possession with mastery.

### 7.5 Memory

WriteFlow must turn concepts into durable memory.

The system should use:

- Active recall
- Spaced repetition
- Interleaving across books
- Explanation prompts
- Analogy prompts
- Application drills
- Visual memory hooks
- Failure tracking

The purpose is not flashcards for their own sake. The purpose is to make ideas retrievable when the user is writing, arguing, deciding, or creating.

### 7.6 Creation

WriteFlow must help the user create original work from mastered ideas.

The system should produce:

- Essay theses
- Argument outlines
- Cross-book synthesis essays
- Contrarian takes
- Research questions
- Debate maps
- Theory drafts
- Social posts and newsletters when useful

Creation is the proof that the idea has become generative.

## 8. Hero Experience: The Idea Simulator

The flagship experience should be the Idea Simulator.

The user selects a living idea. WriteFlow opens a focused simulation session where the system guides the user through increasingly demanding transformations:

1. Explain the idea without using the author's language.
2. Give a concrete example from the book.
3. Give a concrete example outside the book.
4. State the causal mechanism.
5. Name a boundary condition.
6. Produce a counterexample.
7. Compare it to a related idea from another book.
8. Use it to analyze a current problem.
9. Compress it into one principle.
10. Turn it into a writing thesis.

At the end, the system updates the idea's mastery state.

Mastery should not mean "reviewed." Mastery should mean the user can explain, apply, transfer, and critique.

## 9. Hero Experience: The Theory Builder

The second flagship experience should be the Theory Builder.

The Theory Builder examines the user's whole library and asks:

- What claims keep recurring?
- What tensions does the user keep circling?
- What concepts appear across unrelated domains?
- What has the user changed their mind about?
- What personal worldview is forming?
- Which ideas are powerful but underdeveloped?

The output is not a summary. It is a living map of the user's emerging intellectual system.

Example:

> Across twelve books, you keep returning to one hidden theme: systems fail when local optimization destroys global coherence. This pattern appears in markets, cognition, software architecture, institutions, and ecology. Here are five books that support it, three that complicate it, and one essay thesis that could turn it into an original argument.

This is the point where WriteFlow stops being a reading app and becomes a partner in original thought.

## 10. Product Architecture

Conceptually, the system should have six layers:

1. Source Layer
   Books, articles, papers, notes, Kindle highlights, pasted documents, PDFs, and external references.

2. Extraction Layer
   Parses raw notes into concepts, claims, examples, definitions, evidence, and questions.

3. Reasoning Layer
   Reconstructs arguments, causal chains, assumptions, tensions, and contradictions.

4. Memory Layer
   Generates prompts, schedules reviews, tracks mastery, and adapts difficulty.

5. Synthesis Layer
   Connects ideas across books, detects patterns, evolves personal theories, and creates essays.

6. Creation Layer
   Produces drafts, outlines, debates, narratives, posts, digests, and reusable writing material.

The existing WriteFlow app already has pieces of all six layers. The next phase is to unify them around living ideas and mastery.

## 11. Current Repo Leverage

The current codebase already provides a strong foundation:

- Book and notes management
- Idea cards
- Argument reconstruction
- Concept maps
- Contradiction detection
- Cross-book synthesis
- Insight collisions
- Reading DNA analytics
- Spaced review
- Essay agent sessions
- Wiki ingestion and querying
- Social/digest outputs
- Auth and Supabase persistence

The opportunity is not to add random features. The opportunity is to organize these capabilities into a coherent cognitive operating system.

## 12. Strategic Product Principles

### 12.1 Depth Over Capture

Every feature must increase understanding, memory, synthesis, or creation. If a feature only stores more information, it is suspect.

### 12.2 Pressure Over Comfort

The system should be warm, but intellectually demanding. It should ask better questions than the user would ask themselves.

### 12.3 Structure Over Chat

Chat is useful, but structured outputs should be first-class: idea objects, argument maps, theory maps, mastery records, and synthesis ledgers.

### 12.4 Transformation Over Summarization

The app should never stop at "what the book said." It should ask: what does this idea do to the user's thinking?

### 12.5 Personal Worldview Over Generic Knowledge Graph

The knowledge graph should not merely represent books. It should represent the user's evolving understanding.

## 13. Differentiation

WriteFlow should be different from:

- Readwise: better at reasoning, synthesis, and creation
- Obsidian: less manual and more cognitively active
- Notion: more opinionated and idea-native
- ChatGPT: persistent, structured, memory-aware, library-grounded
- Blinkist: anti-summary, pro-mastery
- Anki: richer than recall, focused on explanation and application

The differentiation is the full loop: extract -> structure -> interrogate -> remember -> synthesize -> create.

## 14. Product Success Criteria

The product succeeds when users say:

- "This app makes books stay with me."
- "I can finally see how my reading connects."
- "I write better because my ideas are structured."
- "I can explain books I read months ago."
- "My thinking is becoming more original."

Engineering success criteria:

- Every chapter can generate living ideas.
- Every living idea has memory prompts and mastery state.
- Every book can produce an argument map and concept map.
- Every idea can be simulated, reviewed, connected, and used in writing.
- Every user's library can produce theory-level synthesis.

## 15. Implementation Roadmap

### Phase 1: Unify Around Living Ideas

Goal: make idea objects richer and central.

Deliverables:

- `living_ideas` data model or extension of `ideas`
- Concept/claim/mechanism/evidence fields
- Mastery state model
- Idea detail page or modal
- Migration path from current idea cards

### Phase 2: Build the Idea Simulator

Goal: turn passive ideas into active learning sessions.

Deliverables:

- Simulation session UI
- Socratic prompt generator
- User response capture
- LLM evaluation rubric
- Mastery update logic
- Review scheduling integration

### Phase 3: Build Memory Engine 2.0

Goal: move from simple review to adaptive mastery.

Deliverables:

- Prompt types: recall, explain, apply, contrast, critique, compress
- Difficulty model
- Failure mode tracking
- Interleaving across books
- Concept decay and reinforcement

### Phase 4: Build Cross-Book Theory Builder

Goal: detect emergent personal worldview.

Deliverables:

- Library-wide pattern detector
- Recurring claim/tension/concept tracker
- Personal theory objects
- Theory evolution timeline
- Theory-to-essay workflow

### Phase 5: Build Creation Studio

Goal: turn mastered ideas into original output.

Deliverables:

- Thesis generator
- Debate builder
- Essay outline from theory
- Draft workspace tied to source ledgers
- Reuse tracker showing which mastered ideas entered writing

### Phase 6: Polish the Science-Fiction Experience

Goal: make the product feel like an advanced cognitive cockpit.

Deliverables:

- Visual idea graph
- Mastery dashboard
- Book-to-brain progress view
- Concept constellation
- Memory heatmap
- Theory map

## 16. Long-Term Vision

In its mature form, WriteFlow should become an intellectual companion that grows with the user over years.

It should remember:

- What the user has read
- What the user understands
- What the user struggles with
- What the user believes
- What the user keeps returning to
- What the user is becoming capable of creating

The deepest product vision is:

> A system that turns reading into a personal theory of the world.

