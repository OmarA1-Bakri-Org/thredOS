# Persona Routing Table

Determines the **value angle** for outreach and replies based on the contact's role. Assign a lane from their job title or headline, then tailor the message accordingly.

| Lane | Target Titles | Value Angle | Messaging Tone |
|---|---|---|---|
| **A — Treasury** | CFO, Treasurer, Finance Director, Head of Treasury | Liquidity optimisation, reduced nostro/vostro, capital efficiency, settlement certainty | Conservative, data-driven, risk-reduction |
| **B — Payments** | Head of Payments, Ops Director, COO, CSO, Settlement Manager | Instant settlement, 24/7 availability, reduced failed payments, STP rates, API simplicity | Operational efficiency, speed, reliability |
| **C — Partnerships** | BD Director, Head of Network, Partnerships Manager, Co-Founder | Network expansion, new corridor access, geographic reach, revenue growth | Growth-oriented, opportunity-focused, collaborative |
| **D — Technical** | CTO, VP Engineering, Head of Integration, Technical Lead | API-first integration, ISO 20022, low latency, sandbox environment, developer experience | Technical precision, developer-friendly |
| **E — Compliance** | CCO, Head of Compliance, Risk Officer, General Counsel | Regulatory alignment, AML/KYC compatibility, settlement finality (legal certainty), audit trail | Risk-mitigation, regulatory-certainty, trust-building |

**Default:** If title doesn't match any lane, use Lane C (Partnerships) — Omar's primary domain.

## Lane Assignment Logic

```
IF title/headline contains (CFO, Treasurer, Finance Director, Head of Treasury)
  → Lane A

ELSE IF title/headline contains (Payments, Operations, Ops, COO, CSO, Settlement)
  → Lane B

ELSE IF title/headline contains (BD, Business Development, Partnerships, Network, Growth, Co-Founder)
  → Lane C

ELSE IF title/headline contains (CTO, VP Engineering, Technical, Integration, Developer)
  → Lane D

ELSE IF title/headline contains (Compliance, Risk, Legal, Counsel, CCO, Regulatory)
  → Lane E

ELSE → Lane C (default)
```

## Motion Type

Determines compliance messaging rules. This affects what regulatory language you include:

```
IF company holds PSP/EMI/banking license OR is a licensed exchange
  → FC (Funds Controller)
  → Include regulatory awareness in messaging
  → Emphasise settlement certainty and regulatory alignment

ELSE IF company connects to payment network for reach but doesn't hold/move funds
  → Participant
  → Emphasise network access, coverage expansion, ease of integration
  → Do NOT reference regulatory requirements unprompted

DEFAULT → FC (assume regulated until confirmed — safer for messaging)
```
