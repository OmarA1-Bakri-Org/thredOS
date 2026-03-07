# LinkedIn Growth Engine (10K Followers)

A reverse-engineered system for organic LinkedIn growth using AI tools. Based on a documented case study that grew an account from 49 to 10,000 followers in 17 days, spending 1 hour/day.

## Project Structure

```
10k_followers/
├── README.md                              # This file
├── phase1_research.md                     # Deep source extraction (13 topics)
├── phase2_playbook.md                     # Synthesized sequential playbook
├── linkedin-growth-engine.skill           # Packaged Claude skill (installable)
├── linkedin-growth-engine-system.excalidraw  # Visual system diagram (Excalidraw)
├── linkedin-growth-engine-system.png      # Rendered diagram
└── linkedin-growth-engine/                # Claude skill source
    ├── SKILL.md                           # Skill entry point + routing logic
    └── references/
        ├── foundation.md                  # Mission, ICP, profile, headshot
        ├── content-engine.md              # Content formula, templates, hooks
        ├── engagement.md                  # Warm-up protocol, algorithm rules
        ├── tools.md                       # AI tool stack (19 tools)
        └── calendar.md                    # 90-day implementation calendar
```

## Deliverables

| Deliverable | Description |
|---|---|
| **Phase 1 Research** | Structured extraction of 13 topics — each with Core Claim, Mechanism, Action Steps, Tools, Quantified Proof, and Dependencies |
| **Phase 2 Playbook** | Sequential system with Foundation Layer, Content Engine, Engagement Loop, Secret Rules, Tool Stack, and 90-Day Calendar |
| **Claude Skill** | Installable `.skill` file that gives Claude the full growth engine as a guided workflow |
| **System Diagram** | Excalidraw visual showing Foundation → Daily Engine → Growth output with feedback loop |

## Installing the Claude Skill

1. Open Claude Code (or any Claude environment that supports skills)
2. Install the packaged skill:
   ```bash
   claude skill install linkedin-growth-engine.skill
   ```
3. The skill activates automatically when you ask about LinkedIn growth, content creation, profile optimization, or related topics

## Using Without the Skill

The playbook works as a standalone reference:

1. **Start with Foundation** — Read `phase2_playbook.md` Section 2 (Foundation Layer). Define your mission, ICP, and optimize your profile.
2. **Launch Content Engine** — Follow Section 3 daily: research pain points, create visuals, write posts using the templates.
3. **Run Engagement Loop** — Follow Section 4: 15 min warm-up → post → 15 min warm-down + outreach.
4. **Review every 90 days** — Use the calendar in Section 7 to track milestones.

## The System at a Glance

```
FOUNDATION (do once)
  Mission → ICP → Profile → AI Headshot

DAILY ENGINE (1 hour/day)
  Content Engine (20 min)     →  Engagement Loop (30 min)  →  Outreach (10 min)
  Research + Design + Write      Warm-up → POST → Warm-down    DMs + 5 connections

GROWTH OUTPUT
  ~1,000 followers/day → Analytics feedback → refine Content Engine
```

### Core Rules

- Every post is about the reader's problem, never your achievements
- Hook: exactly 2 sentences, ~55 characters each
- Image format: 1080x1350 (4:5), scrappy, unbranded
- Warm up with 10-15 comments BEFORE posting
- No hashtags, no emojis in post copy
- 80% of results come from winning concepts — double down on what works

### Key Algorithm Signals (2025/2026)

- Comments are 15x more important than likes
- First 60 minutes determine post amplification
- Carousels get 5-10x reach vs text posts
- External links get ~60% less reach
- 72% of LinkedIn activity is mobile (1.3 sec attention capture)

## Minimum Viable Tool Stack (Free)

| Tool | Purpose |
|---|---|
| Mission-GPT | Define your mission statement |
| ICP-GPT | Define your ideal customer profile |
| Google Gemini | AI headshots + image generation |
| Claude AI | Post writing + content angles |
| Canva | Image editing + brand alignment |
| Pinterest | Visual inspiration for infographics |

## References

The research and playbook were built from Ruben Hassid's public content, supplemented by:
- Richard van der Blom's LinkedIn algorithm reports
- Trust Insights LinkedIn engagement data
- Sprout Social platform analytics
- LinkedIn's own 360Brew algorithm documentation
