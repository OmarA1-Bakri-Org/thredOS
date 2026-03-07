# Content Engine (Daily)

## Table of Contents
1. The #1 Content Rule
2. Content Creation Formula
3. Post Templates
4. Hook Generation
5. Carousel Creation
6. Pinterest Image Pipeline
7. AI Image Tag Removal

---

## 1. The #1 Content Rule

**Write for your reader. Never about yourself.**

- Every post is about the reader's problem, not your achievement.
- "I (still) never write a personal post. I know no one cares about me."
- Test: remove your name from the post. Is it still valuable?

### Claude Prompt for Content Angles
```
Find the best angle/topic for one LinkedIn post that turns my expertise
into something useful, relatable, and 100% about the reader -- not
bragging -- by asking clarifying questions about real problems my
audience struggles with, what expertise feels most useful to strangers,
and how to frame it so readers see themselves.
```

---

## 2. Content Creation Formula

Every post follows: **Mission + Solution + Angle + Format**

- **Mission**: The one problem you solve
- **Solution**: One specific answer to one specific sub-problem
- **Angle**: The unique framing (see hook techniques below)
- **Format**: Single image (1080x1350) or carousel (PDF, 6-14 slides)

### Research Phase
Use these tools in sequence:
1. **Grok**: Search Reddit for discussions about your ICP's problems
2. **Perplexity**: Deep-dive research on promising topics
3. **Red Searcher GPT**: Find the most viral pain points from Reddit communities

### Design Phase
1. Search Pinterest for visual inspiration
2. Remix in Gemini (see Section 6)
3. Colour-correct in Canva

### Writing Phase
1. Draft body using Claude AI or EasyGen.io
2. Generate hook (see Section 4)
3. Remove AI writing patterns with AI Editor GPT
4. Final check: is this about the reader?

---

## 3. Post Templates

### Template A: Single Image Post

```
[HOOK -- 2 lines, ~55 chars each. Pattern interrupt.]

[Body -- 3-8 short paragraphs. About the reader. No emojis. No hashtags.]

[CTA -- Specific question, not "What do you think?"]
```

**Image specs**: 1080x1350 px, scrappy, unbranded, useful/bookmarkable.

### Template B: Carousel Post

| Slide | Content | Purpose |
|-------|---------|---------|
| 1 | Polarising/curiosity-gap headline | Stop the scroll |
| 2 | Stakes -- why this matters NOW | Create urgency |
| 3 | Core insight or golden quote | First value hit |
| 4-8 | One insight per slide | Value breakdown |
| 9 | TL;DR checklist | Bookmarkable summary |
| 10 | Low-friction CTA question | Drive comments |

**Specs**: PDF, 1080x1350 per slide, 6-14 slides.

### Fill-in-the-Blank Hooks

- "[Specific number] people [did X]. [Unexpected result]."
- "You're [doing X]. Your [ICP] is [doing Y instead]."
- "The [worst/best] [topic] [verb] the [opposite expected result]."
- "I [dramatic action]. [Surprising consequence]."
- "Stop [common advice]. Start [counterintuitive alternative]."

---

## 4. Hook Generation

The hook is the first 2 lines before "see more." It determines everything.

### Specs
- Exactly 2 sentences
- ~55 characters maximum each
- Must break scrolling pattern
- Creates an "open loop" the reader needs answered

### Hook Techniques
- **Contradiction**: "The worst LinkedIn posts get the most followers"
- **Specific number**: "I mass-unfollowed 2,000 people. My engagement tripled"
- **Direct accusation**: "You're writing for your mom, not your audience"
- **Stolen thought**: Express what readers secretly think
- **Absurd reframe**: Make mundane topics dramatic

### Generation Workflow
1. Write the full post body first.
2. Prompt Claude or ChatGPT:
```
Write the hook for this post -- the first 2 lines before 'more'
(roughly 2 short sentences, ~55 characters max each).
The hook's only job is to break scrolling patterns and make them
NEED to click 'more.'

Rules:
- About reader, not you
- Create unanswered questions or contradictions
- No personal achievements, emojis, hashtags
- Should feel like a friend texting something that demands explanation
```
3. Generate 10 variations.
4. Pick the strongest "I need to know more" reaction.

---

## 5. Carousel Creation

### Step-by-Step with Gamma.app
1. Open gamma.app
2. Select Studio Mode
3. Choose Social format, Portrait card size
4. Set text quantity to "Just vibes"
5. Design 10 slides following the Template B structure
6. Export as PDF
7. Upload to LinkedIn as a document post

### Content Extraction for Carousels
Use Gemini with Thinking model to extract from source material:
- **Core Thesis**: Single most important argument, one sentence
- **Key Data/Facts**: Specific numbers, case studies, evidence
- **Golden Quotes**: 3-5 punchy verbatim excerpts
- **Framework**: Any step-by-step process or mental model

### Performance
189,000 impressions and ~1,000 new followers from a single carousel post.

---

## 6. Pinterest Image Pipeline

1. Open Pinterest
2. Search: `[your niche] + graph | cheat sheet | infographic`
3. Find a layout/style you like
4. Upload to Google Gemini
5. Prompt: "Extract all information from this infographic so another designer could remake it."
6. Search Pinterest again: `handwritten style infographic` (or preferred aesthetic)
7. Upload style reference to Gemini
8. Prompt: "Remake this infographic with [extracted content] but in this style [uploaded image]."
9. Download result
10. Colour-correct in Canva to match brand
11. Strip AI metadata (see Section 7)

---

## 7. AI Image Tag Removal

LinkedIn uses C2PA content credentials to label AI-generated content with a "CR" badge.
Microsoft (LinkedIn's parent) signed up to C2PA standards. LinkedIn may also suppress
reach for posts with obvious AI visuals.

### Method 1: Screenshot (Simplest)
Open the generated image full-screen. Take a screenshot (Win+Shift+S or Cmd+Shift+4).
Clip back to original dimensions. Screenshots carry no generation metadata.

### Method 2: Edit in Design Platform
Open in Canva or similar. Make small modifications (add background, overlay text, crop).
Export as new file. The re-export strips C2PA metadata.
"Slightly better performance compared to uploading the raw AI file directly."

### Method 3: Dedicated Metadata Strippers (Browser-Based)
- gptcleanup.com/chatgpt-image-watermark-remover (HTML5 Canvas API, strips C2PA + EXIF + IPTC)
- aimetadatacleaner.com
- exifreader.com/ai-metadata-remover
- nanoglobals.com/tools/metadata-remover/chatgpt/
All processing happens in-browser for privacy.

### Method 4: Remove Third-Party Integrations
Profile icon then Settings & Privacy then Data privacy then Permitted services.
Remove unwanted third-party apps that may auto-add metadata.

### Caveat
Visible Content Credentials baked into image pixels (not metadata) cannot be removed
through metadata stripping -- would require image editing software.
