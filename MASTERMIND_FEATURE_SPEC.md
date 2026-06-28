# WriteFlow Mastermind Feature Specification

Version: 1.0
Date: June 27, 2026
Status: Implementation planning document
Audience: Engineering, design, and AI coding agents

## 1. Purpose

This document translates the Mastermind product vision into concrete features, data models, APIs, UX surfaces, prompts, and build phases.

The implementation goal is to evolve WriteFlow from an AI-powered reading workspace into a full ideas distillation and mastery engine.

Core implementation principle:

> Build around living ideas, not around notes.

## 2. Existing System Baseline

Current WriteFlow already includes:

- Express server with vanilla JS frontend
- Supabase persistence
- Supabase GitHub OAuth and email allow-list
- Books, notes, idea cards, articles, conversations, essays, sessions
- Argument reconstruction
- Concept maps
- Contradictions and insight collisions
- Cross-book synthesis
- Wiki ingestion and query
- Reading DNA analytics
- Spaced review loop
- Kindle import
- Essay agent with memory, planning, proposals, and multiple LLM backends

The next architecture should consolidate these features into a coherent mastery pipeline.

## 3. Core Object Model

### 3.1 Living Idea

The central entity should be a living idea. This can be implemented either by extending the existing `ideas` table or by adding a parallel `living_ideas` table that references `ideas`.

Recommended: add a `living_ideas` table and keep `ideas` as the lightweight public card layer.

Proposed schema:

```sql
create table if not exists living_ideas (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid references ideas(id) on delete cascade,
  book_id uuid references books(id) on delete cascade,
  chapter_name text,

  claim text,
  definition text,
  mechanism text,
  evidence jsonb default '[]',
  examples jsonb default '[]',
  boundary_conditions jsonb default '[]',
  counterarguments jsonb default '[]',
  open_questions jsonb default '[]',
  compressed_principle text,

  source_fragments jsonb default '[]',
  connection_summary text,
  mastery jsonb default '{}',
  metadata jsonb default '{}',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Mastery JSON shape:

```json
{
  "state": "new|seen|explained|applied|critiqued|transferred|mastered",
  "score": 0.0,
  "last_reviewed_at": null,
  "next_review_at": null,
  "failure_modes": ["definition_blur", "weak_application"],
  "strengths": ["mechanism_recall"],
  "review_interval_days": 1
}
```

### 3.2 Concept

Concepts should represent reusable intellectual building blocks.

```sql
create table if not exists concepts (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  aliases text[] default '{}',
  definition text,
  domain text,
  abstraction_level text check (abstraction_level in ('concrete','mid','abstract','meta')),
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### 3.3 Idea-Concept Links

```sql
create table if not exists idea_concept_links (
  id uuid primary key default gen_random_uuid(),
  living_idea_id uuid references living_ideas(id) on delete cascade,
  concept_id uuid references concepts(id) on delete cascade,
  relation_type text check (relation_type in ('defines','uses','extends','contradicts','exemplifies','depends_on')),
  strength float default 0.5,
  rationale text,
  created_at timestamptz default now()
);
```

### 3.4 Mastery Sessions

```sql
create table if not exists mastery_sessions (
  id uuid primary key default gen_random_uuid(),
  living_idea_id uuid references living_ideas(id) on delete cascade,
  session_type text check (session_type in ('simulator','review','quiz','application','critique')),
  prompts jsonb default '[]',
  responses jsonb default '[]',
  evaluations jsonb default '[]',
  mastery_before jsonb default '{}',
  mastery_after jsonb default '{}',
  created_at timestamptz default now()
);
```

### 3.5 Cross-Book Connections

```sql
create table if not exists idea_connections (
  id uuid primary key default gen_random_uuid(),
  source_idea_id uuid references living_ideas(id) on delete cascade,
  target_idea_id uuid references living_ideas(id) on delete cascade,
  connection_type text check (connection_type in (
    'supports',
    'contradicts',
    'extends',
    'refines',
    'same_pattern',
    'shared_mechanism',
    'domain_transfer',
    'productive_tension'
  )),
  explanation text,
  synthesis_potential text,
  strength float default 0.5,
  created_at timestamptz default now(),
  unique(source_idea_id, target_idea_id, connection_type)
);
```

### 3.6 Personal Theories

```sql
create table if not exists personal_theories (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  thesis text,
  pattern_summary text,
  supporting_ideas jsonb default '[]',
  opposing_ideas jsonb default '[]',
  open_questions jsonb default '[]',
  evolution_log jsonb default '[]',
  confidence float default 0.5,
  status text default 'emerging' check (status in ('emerging','active','challenged','retired','essay_ready')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

## 4. Feature 1: Living Idea Distillation

### Goal

Upgrade distillation from idea cards to structured living ideas.

### User Story

As a reader, after I paste chapter notes, I want WriteFlow to extract reusable intellectual objects so I can understand, remember, and apply the ideas later.

### Backend

Routes:

- `POST /api/living-ideas/distill`
- `GET /api/living-ideas?book_id=...`
- `GET /api/living-ideas/:id`
- `PATCH /api/living-ideas/:id`
- `DELETE /api/living-ideas/:id`

Request:

```json
{
  "book_id": "uuid",
  "chapter_name": "Chapter 1",
  "raw_notes": "string",
  "mode": "create|refresh|enrich_existing"
}
```

Response:

```json
{
  "ideas": [
    {
      "idea_id": "uuid",
      "living_idea_id": "uuid",
      "title": "string",
      "claim": "string",
      "definition": "string",
      "mechanism": "string",
      "compressed_principle": "string",
      "mastery": {}
    }
  ]
}
```

### LLM Prompt Requirements

The prompt must require:

- 3 to 7 high-quality living ideas per chapter
- No generic summaries
- Claim, mechanism, evidence, examples, boundaries, counterarguments
- Concrete source grounding
- No fabricated quotes
- Distinguish "what the author says" from "what follows if this is true"

### Frontend

Add an "Idea Detail" modal or full-screen pane from each idea card.

Sections:

- Core claim
- Mechanism
- Evidence
- Examples
- Boundaries
- Counterarguments
- Connections
- Mastery state
- Actions: Simulate, Review, Connect, Write from this

### Acceptance Criteria

- Distilling a chapter creates both current idea cards and living ideas.
- Existing idea grid still works.
- Idea detail view shows structured fields.
- Missing fields degrade gracefully.
- Generated living ideas are persisted.

## 5. Feature 2: Idea Simulator

### Goal

Create the flagship active-learning experience.

### User Story

As a reader, I want to enter a guided simulation for an idea so I can explain, apply, critique, and transfer it until I truly understand it.

### Simulator Flow

Default sequence:

1. Define the idea in your own words.
2. Explain the mechanism.
3. Give an example from the book.
4. Give an example outside the book.
5. Name where the idea stops applying.
6. Produce a counterargument.
7. Compare it to another idea from your library.
8. Apply it to a live problem.
9. Compress it into one principle.
10. Turn it into a thesis or question.

### Backend

Routes:

- `POST /api/simulator/start`
- `POST /api/simulator/:session_id/respond`
- `POST /api/simulator/:session_id/finish`

Start request:

```json
{
  "living_idea_id": "uuid",
  "mode": "standard|exam|creative|skeptical|transfer"
}
```

Respond request:

```json
{
  "prompt_id": "string",
  "response": "user text"
}
```

Evaluation response:

```json
{
  "evaluation": {
    "score": 0.0,
    "diagnosis": "string",
    "strengths": ["string"],
    "weaknesses": ["string"],
    "next_prompt": {
      "id": "string",
      "type": "definition|mechanism|application|critique|transfer|compression",
      "text": "string"
    }
  },
  "mastery_preview": {}
}
```

### Evaluation Rubric

The model should score:

- Accuracy
- Specificity
- Causal understanding
- Transfer ability
- Counterargument awareness
- Compression quality

### Frontend

Create a full-screen simulator surface:

- Left: idea source card and key fields
- Center: current prompt and response composer
- Right: mastery meter, weaknesses, past responses
- Bottom: session progress

### Acceptance Criteria

- User can run a full simulator session.
- Each response is evaluated.
- Session persists to `mastery_sessions`.
- Final mastery update is written to `living_ideas.mastery`.
- Weak responses trigger follow-up prompts.

## 6. Feature 3: Memory Engine 2.0

### Goal

Replace simple review with adaptive concept mastery.

### Review Types

1. Recall: "What is this idea?"
2. Mechanism: "How does it work?"
3. Example: "Give an example."
4. Boundary: "When does it fail?"
5. Contrast: "How is it different from X?"
6. Critique: "What is the strongest objection?"
7. Transfer: "Apply this to a new domain."
8. Compression: "State the principle in one sentence."

### Backend

Routes:

- `GET /api/mastery/due`
- `POST /api/mastery/review`
- `GET /api/mastery/dashboard`
- `GET /api/mastery/idea/:id/history`

Due response:

```json
{
  "reviews": [
    {
      "living_idea_id": "uuid",
      "title": "string",
      "prompt_type": "transfer",
      "prompt": "string",
      "difficulty": 0.7,
      "reason_due": "weak_transfer"
    }
  ]
}
```

### Scheduling Logic

Use adaptive intervals:

- Strong answer: increase interval
- Weak answer: shorten interval
- Failure on transfer: schedule another transfer prompt
- Failure on definition: return to basic recall
- Mastered ideas still reappear occasionally through interleaving

### Frontend

Add "Mastery" view:

- Due today
- Weak ideas
- Mastered ideas
- Books by mastery
- Concept heatmap
- Recent failures

### Acceptance Criteria

- Review prompts vary by weakness.
- Mastery state changes after each review.
- Due queue is sorted by urgency and importance.
- User can see why an idea is due.

## 7. Feature 4: Cross-Book Connection Engine

### Goal

Detect meaningful relationships across the user's library.

### Connection Types

- Same pattern
- Shared mechanism
- Contradiction
- Productive tension
- Domain transfer
- Extension
- Refinement
- Example of same principle

### Backend

Routes:

- `POST /api/connections/discover`
- `GET /api/connections?book_id=...`
- `GET /api/connections/idea/:id`
- `PATCH /api/connections/:id`

Discovery request:

```json
{
  "scope": "book|library|selected_books",
  "book_ids": ["uuid"],
  "min_strength": 0.6
}
```

### LLM Requirements

The connection detector must avoid shallow similarity. It should only save a connection if it can explain the relationship in terms of:

- Shared causal mechanism
- Conceptual contradiction
- Same pattern across domains
- One idea modifying the scope of another
- A synthesis neither source states alone

### Frontend

Add a connection graph or connection panel:

- Idea nodes
- Book colors
- Edge labels
- Filter by connection type
- Click edge for explanation and writing prompts

### Acceptance Criteria

- Library-level discovery creates persisted connections.
- Connections are visible from idea detail.
- Weak or generic connections can be dismissed.
- High-strength tensions can be sent to Essay Agent.

## 8. Feature 5: Personal Theory Builder

### Goal

Detect and cultivate the user's emerging original worldview.

### User Story

As I read across many books, I want WriteFlow to detect the patterns I keep circling so I can turn them into original theories and essays.

### Backend

Routes:

- `POST /api/theories/discover`
- `GET /api/theories`
- `GET /api/theories/:id`
- `PATCH /api/theories/:id`
- `POST /api/theories/:id/essay`

Discovery response:

```json
{
  "theories": [
    {
      "title": "Local Optimization Destroys Global Coherence",
      "thesis": "string",
      "pattern_summary": "string",
      "supporting_ideas": [],
      "opposing_ideas": [],
      "open_questions": [],
      "confidence": 0.72,
      "status": "emerging"
    }
  ]
}
```

### Theory Detection Signals

- Repeated concepts across books
- High-frequency tensions
- User-created essays or notes
- Ideas repeatedly reviewed or marked important
- Similar mechanisms appearing in different domains
- Persistent unanswered questions

### Frontend

Create "Theory Builder" view:

- Emerging theories
- Supporting ideas
- Opposing ideas
- Confidence
- Timeline of how the theory evolved
- Actions: challenge, expand, turn into essay, mark as active

### Acceptance Criteria

- System generates 3 to 7 emerging theories from a library.
- Each theory has traceable supporting and opposing ideas.
- User can edit, accept, retire, or send theory to Essay Agent.
- Theory updates over time as new ideas are added.

## 9. Feature 6: Book Mastery Map

### Goal

Show what a book has become inside the user's mind.

### View Sections

- Core ideas mastered
- Concepts still weak
- Argument map
- Concept map
- Tensions
- Best applications
- Best writing seeds
- Memory progress

### Backend

Routes:

- `GET /api/books/:id/mastery-map`
- `POST /api/books/:id/mastery-map/rebuild`

### Acceptance Criteria

- Every book has a mastery map.
- Mastery map combines notes, ideas, arguments, concepts, connections, and reviews.
- User can start simulator sessions from weak ideas.

## 10. Feature 7: Creation Studio

### Goal

Make original output the proof of mastery.

### Creation Modes

- Essay from one idea
- Essay from tension
- Essay from theory
- Debate brief
- Research memo
- Concept explainer
- Personal manifesto
- Social post and digest outputs

### Backend

Reuse and extend current Essay Agent.

Additional endpoints:

- `POST /api/creation/from-idea`
- `POST /api/creation/from-theory`
- `POST /api/creation/from-connection`
- `POST /api/creation/source-ledger`

### Requirements

Every generated draft should include a source ledger:

- Ideas used
- Books used
- Claims borrowed
- Claims synthesized
- User-original claims
- Weak evidence warnings

### Acceptance Criteria

- User can turn any living idea, connection, or theory into an essay session.
- Draft cites its idea sources internally.
- System warns when a claim is unsupported.
- Final output can update the theory or idea record.

## 11. Feature 8: Science-Fiction Interface Layer

### Goal

Make the app feel like a high-end cognitive cockpit without sacrificing utility.

### UX Surfaces

1. Idea Detail
   A rich object view for one living idea.

2. Simulator
   Active mastery session.

3. Mastery Dashboard
   Memory and understanding status.

4. Connection Graph
   Cross-book idea network.

5. Theory Builder
   Emerging worldview map.

6. Book Mastery Map
   Book-to-brain transformation view.

7. Creation Studio
   Writing from structured thought.

### Design Rules

- Dense but readable
- No marketing hero surface
- No decorative clutter
- Every visual element must support thinking
- Concept graphs should be interactive, not ornamental
- Mastery state should be immediately legible

## 12. Prompt Architecture

### 12.1 Living Idea Extractor

System role:

> You are an idea distillation engine. Extract reusable intellectual objects from rough notes. Do not summarize chapters. Identify claims, mechanisms, examples, boundaries, counterarguments, and compressed principles. Preserve the user's framing. Do not fabricate quotes.

### 12.2 Simulator Evaluator

System role:

> You are a demanding Socratic tutor. Evaluate whether the user understands the idea. Reward accuracy, specificity, mechanism clarity, transfer, and critique. Identify the next prompt that will most improve mastery.

### 12.3 Connection Detector

System role:

> You detect deep conceptual relationships across books. Reject shallow topical overlap. Save only relationships based on shared mechanisms, productive tensions, contradictions, domain transfers, or synthesis potential.

### 12.4 Theory Builder

System role:

> You infer the user's emerging worldview from their library. Identify recurring claims, tensions, mechanisms, and unanswered questions. Build theories that the user could develop into original work.

## 13. Implementation Plan

### Sprint 1: Foundation

Build:

- `living_ideas` schema
- Living idea distillation route
- Idea detail view
- Migration from current ideas

Validation:

- Distill one chapter into living ideas.
- User can inspect and edit a living idea.

### Sprint 2: Simulator

Build:

- Simulator session schema
- Start/respond/finish routes
- Full-screen simulator UI
- Evaluation prompt
- Mastery update logic

Validation:

- User can complete a 10-step simulation.
- Weak answers alter follow-up prompts.

### Sprint 3: Memory Engine

Build:

- Due review route
- Adaptive scheduling
- Review prompt generator
- Mastery dashboard

Validation:

- Ideas become due based on weakness and time.
- Review quality affects schedule.

### Sprint 4: Connections

Build:

- `concepts`, `idea_concept_links`, `idea_connections`
- Connection discovery route
- Connection graph or panel
- Idea detail connection list

Validation:

- Cross-book relationships persist.
- User can filter and dismiss connections.

### Sprint 5: Theory Builder

Build:

- `personal_theories`
- Discovery route
- Theory Builder UI
- Theory to Essay Agent workflow

Validation:

- Library produces traceable emerging theories.
- User can turn a theory into an essay outline.

### Sprint 6: Creation Studio Integration

Build:

- Creation entry points from idea, connection, and theory
- Source ledger
- Unsupported claim warnings
- Essay Agent integration

Validation:

- Generated drafts are grounded in living ideas.
- User can see which ideas powered an essay.

## 14. Technical Integration Notes

### 14.1 Reuse Existing Routes

Existing routes should be reused where possible:

- `routes/distill.js` for basic idea generation
- `routes/arguments.js` for argument reconstruction
- `routes/concepts.js` for concept maps
- `routes/narrative.js` for cross-book synthesis
- `routes/essayAgent.js` for writing sessions
- `routes/wiki.js` for knowledge base operations
- `routes/analytics.js` for dashboard data

### 14.2 Add New Route Modules

Recommended new files:

- `routes/livingIdeas.js`
- `routes/simulator.js`
- `routes/mastery.js`
- `routes/connections.js`
- `routes/theories.js`
- `routes/creation.js`

Recommended new services:

- `services/livingIdeaEngine.js`
- `services/simulatorEngine.js`
- `services/masteryEngine.js`
- `services/connectionEngine.js`
- `services/theoryEngine.js`

### 14.3 LLM Backend

Use `services/llmClient.js` for new features so Ollama/OpenAI/Anthropic routing remains consistent.

Older direct OpenAI functions can remain until migrated.

### 14.4 Data Safety

All new endpoints remain behind existing auth middleware.

All model-generated fields should be editable by the user.

All destructive operations should preserve enough metadata for debugging.

## 15. Acceptance Test Matrix

### Living Ideas

- Distill notes into structured idea records.
- Edit a living idea.
- Delete a living idea without corrupting base notes.
- Load idea detail from card.

### Simulator

- Start a simulator session.
- Answer prompts.
- Receive evaluation.
- Finish session.
- Verify mastery state updated.

### Memory

- Due queue includes weak ideas.
- Review changes next review date.
- Different weakness types produce different prompts.

### Connections

- Discover cross-book connections.
- Persist connections.
- Display connections in idea detail.
- Dismiss connection.

### Theories

- Discover emerging theories.
- Open theory detail.
- Trace supporting and opposing ideas.
- Send theory to Essay Agent.

### Creation

- Generate essay outline from idea.
- Generate essay outline from connection.
- Generate essay outline from theory.
- Show source ledger.

## 16. Risks

### Risk: Feature Sprawl

Mitigation: all features must enrich living ideas, mastery, synthesis, or creation.

### Risk: LLM Hallucination

Mitigation: require source fragments, editable fields, confidence, and unsupported claim warnings.

### Risk: Cognitive Overload

Mitigation: progressive disclosure. Idea cards remain simple; depth opens on demand.

### Risk: Shallow Connections

Mitigation: reject topical similarity unless a mechanism, contradiction, or synthesis is named.

### Risk: Memory Becomes Flashcards Only

Mitigation: prioritize explanation, application, transfer, critique, and compression over simple recall.

## 17. Definition of Complete Fruition

This vision is complete when the app can take a user's rough notes on a book and produce:

- Structured living ideas
- Argument reconstruction
- Concept map
- Memory prompts
- Adaptive mastery schedule
- Cross-book connections
- Productive tensions
- Emerging personal theories
- Original essay or argument drafts
- A visible map of what the user understands and what remains weak

The final product should make reading feel less like storage and more like cognitive transformation.

